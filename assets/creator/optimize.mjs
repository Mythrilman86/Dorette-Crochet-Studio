import {imageDimensions,LIMITS} from './model.mjs';
export async function prepareImage(file){
 if(!file||!['image/png','image/jpeg'].includes(file.type)||file.size<1||file.size>40*1024*1024)throw Error('Choose a PNG/JPEG up to 40 MiB. Larger photos must be reduced in Gallery first.');
 const bytes=new Uint8Array(await file.slice(0,1024*1024).arrayBuffer()),size=imageDimensions(bytes,file.type);
 if(!size.width||!size.height||size.width*size.height>80000000)throw Error('This image exceeds the safe 80-megapixel input limit. Use a smaller camera size or a Gallery copy.');
 if(file.size<=LIMITS.image&&size.width*size.height<=LIMITS.pixels)return {file,optimization:null};
 return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./optimize-worker.mjs',import.meta.url),{type:'module'});const stop=()=>{clearTimeout(timer);worker.terminate();};const timer=setTimeout(()=>{stop();reject(Error('Image optimization timed out safely. The Gallery original was not changed.'));},45000);worker.onerror=()=>{stop();reject(Error('This device could not optimize the image safely. Use a smaller Gallery copy.'));};worker.onmessage=e=>{stop();if(e.data.error)return reject(Error(e.data.error));const {blob,width,height}=e.data;resolve({file:new File([blob],(file.name||'photo').replace(/\.(png|jpe?g)$/i,'')+'-optimized'+(file.type==='image/png'?'.png':'.jpg'),{type:file.type}),optimization:{optimized:true,originalBytes:file.size,originalWidth:size.width,originalHeight:size.height,width,height}});};worker.postMessage({file,width:size.width,height:size.height});});
}
