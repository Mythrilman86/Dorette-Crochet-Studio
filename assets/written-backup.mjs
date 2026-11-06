export const maxPdfBytes=20*1024*1024;
const maxHeader=3*1024*1024;
const encode=new TextEncoder(),decode=new TextDecoder('utf-8',{fatal:true});
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const unit=n=>Number.isFinite(n)&&n>=0&&n<=1;
const validId=id=>typeof id==='string'&&/^[a-z0-9-]{1,64}$/i.test(id);
function validate(value){
 if(!value||typeof value.name!=='string'||!value.name.trim()||value.name.length>100||
    !Array.isArray(value.instructions)||value.instructions.length>300)throw Error('Invalid written-pattern metadata.');
 const ids=new Set();
 const instructions=value.instructions.map(row=>{
   if(!row||!validId(row.id)||ids.has(row.id)||typeof row.label!=='string'||!row.label.trim()||row.label.length>100||
      typeof row.note!=='string'||row.note.length>2000||typeof row.done!=='boolean'||
      (row.page!==null&&(!Number.isInteger(row.page)||row.page<1||row.page>300))||
      !row.position||!unit(row.position.x)||!unit(row.position.y)||
      (row.box!==null&&(!row.box||row.page===null||!['x','y','w','h'].every(k=>unit(row.box[k]))||
        row.box.x+row.box.w>1.000001||row.box.y+row.box.h>1.000001)))throw Error('Invalid instruction marker in backup.');
   ids.add(row.id);
   const {id,label,note,done,page,position,box}=row;
   return {id,label,note,done,page,position:{x:position.x,y:position.y},box:box&&{x:box.x,y:box.y,w:box.w,h:box.h}};
 });
 if(value.current!==null&&!ids.has(value.current))throw Error('Backup working marker is missing.');
 return {name:value.name.trim(),instructions,current:value.current};
}
export async function makeWrittenBackup(project,pdf,omit){
 if(!pdf?.size||pdf.size>maxPdfBytes)throw Error('Original PDF is missing or too large.');
 const metadata=JSON.stringify(validate(project));
 const pdfHash=await hash(await pdf.arrayBuffer());
 const header=encode.encode(JSON.stringify({format:'dee-written-pattern',version:1,metadata,metadataHash:await hash(encode.encode(metadata)),pdfHash,pdfSize:pdf.size,included:!omit}));
 if(header.length>maxHeader)throw Error('Written-pattern backup metadata is too large.');
 const prefix=new Uint8Array(4);new DataView(prefix.buffer).setUint32(0,header.length);
 return new Blob(omit?[prefix,header]:[prefix,header,pdf],{type:'application/octet-stream'});
}
export async function readWrittenBackup(file,reattach){
 if(!file||file.size<5||file.size>maxPdfBytes+maxHeader+4)throw Error('Written-pattern backup is missing or too large.');
 const length=new DataView(await file.slice(0,4).arrayBuffer()).getUint32(0);
 if(!length||length>maxHeader||length+4>file.size)throw Error('Invalid written-pattern backup header.');
 const header=JSON.parse(decode.decode(await file.slice(4,4+length).arrayBuffer()));
 if(!header||header.format!=='dee-written-pattern'||header.version!==1||typeof header.metadata!=='string'||
    typeof header.included!=='boolean'||!Number.isInteger(header.pdfSize)||header.pdfSize<1||header.pdfSize>maxPdfBytes||
    typeof header.pdfHash!=='string'||!/^[a-f0-9]{64}$/.test(header.pdfHash)||
    file.size!==4+length+(header.included?header.pdfSize:0))throw Error('Unsupported or incomplete written-pattern backup.');
 if(await hash(encode.encode(header.metadata))!==header.metadataHash)throw Error('Backup metadata checksum does not match.');
 const project=validate(JSON.parse(header.metadata));
 const pdf=header.included?file.slice(4+length,undefined,'application/pdf'):reattach;
 if(!pdf)throw Error('Select the exact original PDF to restore this metadata-only backup.');
 if(pdf.size!==header.pdfSize||await hash(await pdf.arrayBuffer())!==header.pdfHash)throw Error('Original PDF checksum does not match this backup.');
 return {project,pdf};
}
