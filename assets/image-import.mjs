import {inspectImage,IMAGE_ACCEPT} from './image-formats.mjs';
export {IMAGE_ACCEPT,inspectImage};
let busy=false;
export async function normalizeImageFile(file,destination='creator'){
 if(busy)throw Error('An image is already being prepared. Wait for it to finish before importing another.');
 if(!file||file.size<1||file.size>40*1024*1024)throw Error('Choose an image up to 40 MiB. Export a smaller JPEG or PNG copy from Photos or Gallery.');
 busy=true;let worker;
 try{
  const info=inspectImage(new Uint8Array(await file.slice(0,1024*1024).arrayBuffer()),file.size);
  let input=file;
  const native=globalThis.Capacitor?.Plugins?.StudioImageImport;
  if(info.format==='heif'&&native?.prepareHeif){
   if(file.size>15*1024*1024)throw Error('This HEIC photo exceeds the 15 MiB Android input limit. Export a smaller JPEG or PNG copy.');
   const encoded=await new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]);r.onerror=()=>fail(Error('Could not read this photo.'));r.readAsDataURL(file);});
   const result=await native.prepareHeif({data:encoded});input=new Blob([Uint8Array.from(atob(result.data),c=>c.charCodeAt(0))],{type:result.mime});
  }
  const data=await new Promise((resolve,reject)=>{let timer;const stop=()=>{clearTimeout(timer);worker?.terminate();};timer=setTimeout(()=>{stop();reject(Error('Photo preparation timed out safely. Try a smaller JPEG or PNG export. Your original and saved work were not changed.'));},45000);
   try{worker=new Worker(new URL('./image-import-worker.mjs',import.meta.url),{type:'module'});worker.onmessage=e=>{stop();e.data.error?reject(Error(e.data.error)):resolve(e.data);};worker.onerror=()=>{stop();reject(Error('This device could not prepare the image safely. Export a JPEG or PNG copy and try again.'));};worker.postMessage({file:input,destination});}catch{stop();reject(Error('Local photo preparation is unavailable. Use a current browser and a JPEG or PNG export.'));}
  });
  const name=(file.name||'photo').split(/[\\/]/).pop().replace(/\.[^.]*$/,'').slice(0,100)+(data.blob.type==='image/png'?'.png':'.jpg');
  return {file:new File([data.blob],name,{type:data.blob.type}),optimization:{optimized:true,originalBytes:file.size,originalWidth:info.width,originalHeight:info.height,width:data.width,height:data.height},format:info.format,width:data.width,height:data.height};
 }catch(error){throw Error('Photo import: '+String(error.message||'Could not prepare the image.').replace(/[\r\n]/g,' ').slice(0,500));}finally{worker?.terminate();busy=false;}
}
