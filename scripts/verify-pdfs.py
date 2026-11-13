"""Independent decoded-object/font/metadata checks. Requires pypdf; no app changes."""
import hashlib,json,re,sys
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import IndirectObject
out=Path(sys.argv[1] if len(sys.argv)>1 else 'publication-test-output')
names=['Stage-B-Synthetic-Letter.pdf','Stage-B-Synthetic-A4.pdf','privacy-output.pdf']
if (out/'Build28-Native-Export.pdf').exists(): names.append('Build28-Native-Export.pdf')
results=[]
for name in names:
 p=out/name;r=PdfReader(p);sentinels=[b'GPS-PRIVATE-SENTINEL',b'PHOTO-PATH-SENTINEL',b'PRIVATE-IMAGE-PATH',b'synthetic-chart',b'LIVE-DRAFT-PRIVATE-SENTINEL']
 receipt=p.with_suffix('.export.json')
 if name=='Build28-Native-Export.pdf':receipt=out/'Build28-Native-PDF.export.json'
 if receipt.exists():
  record=json.loads(receipt.read_text(encoding='utf-8'));assert hashlib.sha256(p.read_bytes()).hexdigest()==record['outputSha256'];sentinels+=[record['snapshotId'].encode()]+[v.encode() for v in record['selectedPhotoIds']]
 metadata={str(k):str(v.get_object()) for k,v in (r.metadata or {}).items()}
 assert set(metadata)<= {'/Producer','/Creator','/CreationDate','/Title','/Author'},metadata
 assert metadata.get('/Producer')=='studio-publisher/0.1.1'
 assert re.fullmatch(r'D:\d{14}Z',metadata.get('/CreationDate','')),metadata
 assert not r.xmp_metadata
 fonts=set();embedded=set()
 for page in r.pages:
  for ref in page['/Resources'].get('/Font',{}).values():
   f=ref.get_object();fonts.add(str(f.get('/BaseFont')));desc=f.get('/DescendantFonts');fd=(desc[0].get_object() if desc else f).get('/FontDescriptor')
   if fd and any(k in fd.get_object() for k in ['/FontFile','/FontFile2','/FontFile3']):embedded.add(str(f.get('/BaseFont')))
  if 'Letter' in name:assert abs(float(page.mediabox.width)-612)<1 and abs(float(page.mediabox.height)-792)<1
  if 'A4' in name:assert abs(float(page.mediabox.width)-595.28)<1 and abs(float(page.mediabox.height)-841.89)<1
 assert fonts and fonts==embedded,(name,fonts-embedded)
 ids={(n,g) for g,entries in r.xref.items() for n in entries if n}|{(n,0) for n in r.xref_objStm}
 for n,g in ids:
  obj=r.get_object(IndirectObject(n,g,r));data=obj.get_data() if hasattr(obj,'get_data') else str(obj).encode('utf-8')
  assert not any(s in data for s in sentinels),(name,n)
 results.append({'file':name,'pages':len(r.pages),'bytes':p.stat().st_size,'objectsInspected':len(ids),'embeddedFonts':sorted(fonts),'privacySentinelsAbsent':True,'metadata':metadata})
(out/'PDF-independent-verification.json').write_text(json.dumps({'documents':results},indent=2),encoding='utf-8')
print('PASS independent PDF objects, metadata whitelist, fonts, page sizes and available receipt hashes:',len(results))
