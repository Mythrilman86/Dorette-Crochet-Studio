"""Developer-only independent verification; not needed on the preview laptop."""
import json,hashlib,re,sys
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import IndirectObject
out=Path(sys.argv[1]);rows=[]
for browser in ['Edge','Chrome']:
 for paper in ['letter','a4','offline']:
  p=out/(browser+'-'+paper+'.pdf');r=PdfReader(p);text=' '.join(page.extract_text() or '' for page in r.pages);compact=re.sub(r'\s+','',text)
  for i in range(3,81):assert ('SyntheticQArecord'+str(i).zfill(3)+'.') in compact,(p.name,i)
  fonts=set();embedded=set();vector=False
  for page in r.pages:
   vector|=bool(re.search(rb'\bre\b',page.get_contents().get_data()))
   for ref in page['/Resources'].get('/Font',{}).values():
    f=ref.get_object();fonts.add(str(f.get('/BaseFont')));ds=f.get('/DescendantFonts');fd=(ds[0].get_object() if ds else f).get('/FontDescriptor')
    if fd and any(k in fd.get_object() for k in ['/FontFile','/FontFile2','/FontFile3']):embedded.add(str(f.get('/BaseFont')))
  assert fonts and fonts==embedded;assert vector
  expected=(595.28,841.89) if paper=='a4' else (612,792)
  assert all(abs(float(page.mediabox.width)-expected[0])<1 and abs(float(page.mediabox.height)-expected[1])<1 for page in r.pages)
  info={str(k):str(v.get_object()) for k,v in r.metadata.items()};assert set(info)<= {'/Producer','/Creator','/CreationDate','/Title','/Author'};assert not r.xmp_metadata
  sentinels=[b'GPS-PRIVATE-SENTINEL',b'private-oriented.jpg',b'PHOTO-PATH-SENTINEL'];receipt=out/(p.name+'.receipt.json')
  if receipt.exists():
   record=json.loads(receipt.read_text());assert hashlib.sha256(p.read_bytes()).hexdigest()==record['outputSha256'];assert len(record['selectedPhotoIds'])==1 and record['coverPhotoId'];sentinels+=[record['snapshotId'].encode()]+[i.encode() for i in record['selectedPhotoIds']]
  images=0
  ids={(n,g) for g,entries in r.xref.items() for n in entries if n}|{(n,0) for n in r.xref_objStm}
  for n,g in ids:
   obj=r.get_object(IndirectObject(n,g,r));images+=int(hasattr(obj,'get') and obj.get('/Subtype')=='/Image');data=obj.get_data() if hasattr(obj,'get_data') else str(obj).encode('utf-8');assert not any(v in data for v in sentinels),(p.name,n)
  assert images>0,(p.name,'photograph missing')
  rows.append({'file':p.name,'pages':len(r.pages),'bytes':p.stat().st_size,'embeddedImageObjects':images,'allExpectedTextPresent':True,'fontsEmbedded':True,'vectorDrawingOperatorsPresent':True,'metadataWhitelistAndPrivacySentinelsPass':True,'paperSizePass':True,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(out/'pdf-independent-results.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8');print('PASS independent PDF text/fonts/vector/photos/paper/metadata/privacy checks:',len(rows))
