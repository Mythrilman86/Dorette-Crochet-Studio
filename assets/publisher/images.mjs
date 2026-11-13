import {digest,imageDimensions,LIMITS} from '../creator/model.mjs';
// Decode one authoring master at a time. Canvas serialization produces fresh pixel-only bytes.
// Browser decoding applies EXIF orientation; no second rotation is applied.
export async function sanitizePhoto(record,descriptor){
 if(!(record?.blob instanceof Blob)||record.blob.size!==descriptor.size||record.blob.size>LIMITS.image)throw Error('Missing or invalid publication photograph.');
 const bytes=new Uint8Array(await record.blob.arrayBuffer());if(await digest(bytes)!==descriptor.hash)throw Error('Publication photograph checksum mismatch.');
 const dimensions=imageDimensions(bytes,descriptor.mime);if(dimensions.width*dimensions.height>LIMITS.pixels)throw Error('Photograph exceeds the safe decoding limit.');
 const bitmap=await createImageBitmap(new Blob([bytes],{type:descriptor.mime}),{imageOrientation:'from-image'});
 try{const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height),Math.sqrt(6000000/(bitmap.width*bitmap.height))),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const blob=await new Promise((ok,fail)=>canvas.toBlob(b=>b?ok(b):fail(Error('Photograph could not be sanitized.')),descriptor.mime,.9));const output=await blob.arrayBuffer();const data=await new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>fail(Error('Photograph could not be prepared.'));r.readAsDataURL(blob);});const result={data,width:canvas.width,height:canvas.height,bytes:output.byteLength};canvas.width=canvas.height=1;return result;}finally{bitmap.close();}
}
