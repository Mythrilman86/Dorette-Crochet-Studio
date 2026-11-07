export const LIMITS=Object.freeze({image:5*1024*1024,pixels:16000000,totalImages:50*1024*1024,backup:80*1024*1024,header:8*1024*1024});
export const uid=()=>crypto.randomUUID();
export const digest=async bytes=>{if(!crypto?.subtle)throw Error('SHA-256 is unavailable; no unprotected backup was created.');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');};
export const jsonBytes=value=>new TextEncoder().encode(JSON.stringify(value));
const ident=v=>typeof v==='string'&&/^[a-z0-9-]{1,100}$/i.test(v);
const str=(v,n=10000)=>typeof v==='string'&&v.length<=n;
export const META=['title','description','designer','difficulty','terminology','hooks','yarn','materials','dimensions','gauge','glossary','notes','technique'];
export function newDraft(type='graph'){return {schema:1,id:uid(),revision:0,type,meta:Object.fromEntries(META.map(k=>[k,k==='terminology'?'US':''])),sizes:[],pieces:[],images:[],chart:null,origin:null,updatedAt:new Date().toISOString()};}
export function newPiece(){return {id:uid(),name:'New piece',sections:[]};}
export function newSection(){return {id:uid(),title:'New section',steps:[],attachments:[]};}
export function newStep(kind='row'){return {id:uid(),kind,text:'',note:'',count:null,sizeValues:{},repeat:null,attachments:[]};}
export function numbered(section){let row=0,round=0;return section.steps.map(s=>({...s,label:s.kind==='row'?'Row '+ ++row:s.kind==='round'?'Round '+ ++round:'Note'}));}
function validateChart(c){if(!c||!Number.isInteger(c.cols)||!Number.isInteger(c.rows)||c.cols<1||c.cols>200||c.rows<1||c.rows>300||!Array.isArray(c.cells)||c.cells.length!==c.cols*c.rows||!Array.isArray(c.palette)||!c.palette.length||c.palette.length>12||c.cells.some(i=>!Number.isInteger(i)||i<0||i>=c.palette.length)||c.palette.some(x=>!/^#[a-f0-9]{6}$/i.test(x?.hex)||!str(x.name,100)||!str(x.symbol,8)))throw Error('Invalid chart snapshot.');}
export function validateDraft(d){
 if(!d||d.schema!==1||!ident(d.id)||!Number.isInteger(d.revision)||d.revision<0||!['graph','garment','amigurumi'].includes(d.type)||!str(d.updatedAt,50)||!d.meta||META.some(k=>!str(d.meta[k],k==='title'?200:10000))||!['US','UK'].includes(d.meta.terminology))throw Error('Unsupported or invalid pattern metadata.');
 if(d.origin!==undefined&&d.origin!==null&&(!ident(d.origin.draftId)||!Number.isInteger(d.origin.revision)||d.origin.revision<0))throw Error('Invalid restored revision provenance.');
 const allowed=['schema','id','revision','type','meta','sizes','pieces','images','chart','updatedAt','origin'];if(Object.keys(d).some(k=>!allowed.includes(k)))throw Error('Unsupported pattern field; no partial import performed.');
 if(!Array.isArray(d.sizes)||d.sizes.length>20||!Array.isArray(d.pieces)||d.pieces.length>50||!Array.isArray(d.images)||d.images.length>100)throw Error('Pattern exceeds supported limits.');
 const ids=new Set();const unique=v=>{if(!ident(v)||ids.has(v))throw Error('Invalid or duplicate identity.');ids.add(v);};
 d.sizes.forEach(s=>{unique(s.id);if(!str(s.label,50)||!str(s.notes,2000))throw Error('Invalid size.');});
 const sizeIds=new Set(d.sizes.map(s=>s.id));let steps=0,sections=0;
 d.pieces.forEach(p=>{unique(p.id);if(!str(p.name,200)||!Array.isArray(p.sections)||(sections+=p.sections.length)>150)throw Error('Invalid piece/section.');p.sections.forEach(s=>{unique(s.id);if(!str(s.title,200)||!Array.isArray(s.attachments)||s.attachments.some(a=>a!=='chart'&&!ident(a))||!Array.isArray(s.steps)||(steps+=s.steps.length)>2000)throw Error('Invalid section.');s.steps.forEach(t=>{unique(t.id);if(!['row','round','note'].includes(t.kind)||!str(t.text)||!str(t.note,4000)||(t.count!==null&&(!Number.isInteger(t.count)||t.count<0||t.count>1000000))||!t.sizeValues||Array.isArray(t.sizeValues)||Object.entries(t.sizeValues).some(([k,v])=>!sizeIds.has(k)||!str(v,1000))||!Array.isArray(t.attachments)||t.attachments.length>100||t.attachments.some(a=>a!=='chart'&&!ident(a))||(t.repeat!==null&&(!ident(t.repeat.from)||!ident(t.repeat.to)||!Number.isInteger(t.repeat.times)||t.repeat.times<1||t.repeat.times>10000)))throw Error('Invalid instruction or size reference.');});});});
 d.images.forEach(i=>{unique(i.id);if(!str(i.name,200)||!str(i.caption,2000)||!['image/png','image/jpeg'].includes(i.mime)||!Number.isInteger(i.size)||i.size<1||i.size>LIMITS.image||!/^[a-f0-9]{64}$/.test(i.hash)||!Number.isInteger(i.width)||!Number.isInteger(i.height)||i.width<1||i.height<1||i.width*i.height>LIMITS.pixels||i.rights!=='author-confirmed')throw Error('Invalid image descriptor.');if(i.optimization!==undefined){const o=i.optimization;if(o?.optimized!==true||!Number.isInteger(o.originalBytes)||o.originalBytes<1||o.originalBytes>40*1024*1024||!Number.isInteger(o.originalWidth)||!Number.isInteger(o.originalHeight)||o.originalWidth<1||o.originalHeight<1||o.originalWidth*o.originalHeight>80000000||o.width!==i.width||o.height!==i.height)throw Error('Invalid image optimization provenance.');}});
 if(d.chart!==null){if(!ident(d.chart?.sourceId)||!/^[a-f0-9]{64}$/.test(d.chart.fingerprint)||!str(d.chart.reviewedAt,50)||!Array.isArray(d.chart.yarn)||d.chart.yarn.length>12)throw Error('Invalid chart link.');validateChart(d.chart.data);if(d.chart.yarn.some(y=>Object.entries(y).some(([k,v])=>!['brand','name','weight','color','code','dyeLot','skeinYards'].includes(k)||!str(v,200))))throw Error('Invalid imported yarn facts.');}
 if(jsonBytes(d).length>3*1024*1024)throw Error('Authoring metadata exceeds 3 MiB.');return structuredClone(d);
}
export async function captureSource(project){
 const data={cols:project.cols,rows:project.rows,cells:window.DoretteAdvanced.compose(structuredClone(project)),palette:project.palette.map(({hex,name,symbol})=>({hex,name,symbol})),workDirection:{first:project.workDirection?.first==='ltr'?'ltr':'rtl',alternate:project.workDirection?.alternate!==false}};validateChart(data);
 const yarn=(project.yarnInfo||[]).slice(0,12).map(y=>Object.fromEntries(['brand','name','weight','color','code','dyeLot','skeinYards'].filter(k=>y?.[k]!==undefined).map(k=>[k,String(y[k]).slice(0,200)])));
 return {sourceId:project.id,fingerprint:await digest(jsonBytes({data,yarn})),reviewedAt:new Date().toISOString(),data,yarn};
}
export function imageDimensions(bytes,mime){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(mime==='image/png'&&bytes.length>=24&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&String.fromCharCode(...bytes.slice(12,16))==='IHDR')return {width:v.getUint32(16),height:v.getUint32(20)};
 if(mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216){let at=2;while(at+4<bytes.length){if(bytes[at++]!==255)throw Error('Invalid JPEG marker.');while(bytes[at]===255)at++;const code=bytes[at++];if(code===217||code===218)break;const length=v.getUint16(at);if(length<2||at+length>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(code)&&length>=7)return {height:v.getUint16(at+3),width:v.getUint16(at+5)};at+=length;}}
 throw Error('Unsupported or invalid image contents.');
}
export function jpegOrientation(bytes){try{const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=2;while(at+4<bytes.length){if(bytes[at++]!==255)return 1;const marker=bytes[at++],length=v.getUint16(at);if(length<2||at+length>bytes.length)return 1;if(marker===225&&String.fromCharCode(...bytes.slice(at+2,at+8))==='Exif\0\0'){const t=at+8,little=v.getUint16(t)===0x4949;if(v.getUint16(t+2,little)!==42)return 1;const dir=t+v.getUint32(t+4,little),count=Math.min(v.getUint16(dir,little),256);for(let i=0;i<count;i++){const e=dir+2+i*12;if(v.getUint16(e,little)===274){const n=v.getUint16(e+8,little);return n>=1&&n<=8?n:1;}}}at+=length;}}catch{}return 1;}
export async function imageRecord(file){
 if(!file||file.size<1||file.size>LIMITS.image||!['image/png','image/jpeg'].includes(file.type))throw Error('Use a PNG or JPEG image up to 5 MiB.');
 const bytes=new Uint8Array(await file.arrayBuffer());const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(file.type==='image/png'?!png:!jpg)throw Error('Image contents do not match its file type.');
 const declared=imageDimensions(bytes,file.type);if(!declared.width||!declared.height||declared.width*declared.height>LIMITS.pixels)throw Error('Image exceeds 16 megapixels or has invalid dimensions.');
 const bitmap=await createImageBitmap(file);const {width,height}=bitmap;bitmap.close();if(width*height>LIMITS.pixels)throw Error('Image exceeds 16 megapixels. Resize it before importing.');
 return {descriptor:{id:uid(),name:(file.name||'Original image').slice(0,200),caption:'',mime:file.type,size:file.size,width,height,hash:await digest(bytes),rights:'author-confirmed'},blob:file};
}
export function review(d,available=new Set(d.images.map(i=>i.id))){
 validateDraft(d);const errors=[],suggestions=[];const all=d.pieces.flatMap(p=>p.sections.flatMap(s=>s.steps));const ids=new Set(all.map(t=>t.id));
 if(!d.meta.title.trim())errors.push('Add a pattern title.');if(!all.length)suggestions.push('No written construction instructions yet.');
 for(const k of ['materials','gauge','dimensions','technique'])if(!d.meta[k].trim())suggestions.push('Review missing '+k+'; supply it or explain why it is not applicable.');
 if(d.type==='graph'&&!d.chart)errors.push('Graph pattern has no reviewed chart.');
 for(const p of d.pieces)for(const s of p.sections)for(const a of s.attachments)if(a==='chart'?!d.chart:!d.images.some(i=>i.id===a))errors.push('A section has a missing attachment.');
 const labels=d.sizes.map(s=>s.label.trim().toLowerCase());if(labels.some((s,i)=>!s||labels.indexOf(s)!==i))errors.push('Size labels must be nonempty and distinct.');
 d.images.forEach(i=>{if(!available.has(i.id))errors.push('Missing image: '+i.name);});
 for(const t of all){if(!t.text.trim())errors.push('An instruction has no text ('+t.id.slice(0,8)+').');for(const a of t.attachments)if(a==='chart'?!d.chart:!d.images.some(i=>i.id===a))errors.push('An instruction has a missing attachment.');}
 const edges=new Map(all.map(t=>[t.id,[]]));for(const p of d.pieces)for(const s of p.sections)for(const t of s.steps)if(t.repeat){const a=s.steps.findIndex(x=>x.id===t.repeat.from),b=s.steps.findIndex(x=>x.id===t.repeat.to);if(!ids.has(t.repeat.from)||!ids.has(t.repeat.to)||a<0||b<a)errors.push('Repeat range must reference ordered steps in the same section.');else edges.set(t.id,s.steps.slice(a,b+1).map(x=>x.id));}
 const visiting=new Set(),done=new Set();const visit=id=>{if(visiting.has(id))return true;if(done.has(id))return false;visiting.add(id);if((edges.get(id)||[]).some(visit))return true;visiting.delete(id);done.add(id);return false;};if(all.some(t=>visit(t.id)))errors.push('A repeat contains a circular reference.');
 return {errors:[...new Set(errors)],suggestions,notice:'Author review and test crochet are required. This does not certify fit, stitch feasibility or rights to sell.'};
}
export async function snapshot(d){const content=validateDraft(d);return {id:uid(),at:new Date().toISOString(),content,hash:await digest(jsonBytes(content))};}
export async function validateSnapshot(s){if(!ident(s?.id)||!str(s.at,50)||!/^[a-f0-9]{64}$/.test(s.hash))throw Error('Invalid frozen snapshot.');validateDraft(s.content);if(await digest(jsonBytes(s.content))!==s.hash)throw Error('Frozen snapshot checksum mismatch.');return s;}
