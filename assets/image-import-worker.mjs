import {inspectImage} from './image-formats.mjs';
import {jpegOrientation} from './creator/model.mjs';
self.onmessage=async({data})=>{let bitmap,canvas;try{
 const {file,destination}=data,head=new Uint8Array(await file.slice(0,1024*1024).arrayBuffer()),info=inspectImage(head,file.size),orientation=info.format==='jpeg'?jpegOrientation(head):1;
 const tail=new Uint8Array(await file.slice(-12).arrayBuffer()),end=(...bytes)=>bytes.every((v,i)=>tail[tail.length-bytes.length+i]===v);
 if((info.format==='jpeg'&&!end(255,217))||(info.format==='png'&&!end(0,0,0,0,73,69,78,68,174,66,96,130))||(info.format==='gif'&&!end(59)))throw Error('This image is incomplete. Export a fresh JPEG or PNG copy.');
 const maxSide=destination==='chart'?1800:destination==='scanner'?2400:4096,maxPixels=destination==='creator'?12000000:maxSide*maxSide;
 const sw=orientation>=5?info.height:info.width,sh=orientation>=5?info.width:info.height,ratio=Math.min(1,maxSide/Math.max(sw,sh),Math.sqrt(maxPixels/(sw*sh)));
 // createImageBitmap yields the first still frame; EXIF rotation is applied before storage.
 const options={imageOrientation:'from-image',resizeQuality:'high'};if(['jpeg','png'].includes(info.format)&&sw*sh>16000000){options.resizeWidth=Math.max(1,Math.floor(sw*ratio));options.resizeHeight=Math.max(1,Math.floor(sh*ratio));}
 try{bitmap=await createImageBitmap(new Blob([file],{type:info.mime}),options);}catch{throw Error(info.format==='heif'?'This device cannot decode this HEIC/HEIF photo locally. In Photos or Gallery, export or save a JPEG/PNG copy, then import that copy. No photo was uploaded.':'This image is damaged or its encoding is not supported on this device. Export a JPEG or PNG copy.');}
 if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>info.maxPixels)throw Error('Decoded image exceeds the input safety limit.');
 const outputScale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height),Math.sqrt(maxPixels/(bitmap.width*bitmap.height)));
 canvas=new OffscreenCanvas(Math.max(1,Math.floor(bitmap.width*outputScale)),Math.max(1,Math.floor(bitmap.height*outputScale)));const g=canvas.getContext('2d');g.imageSmoothingQuality='high';if(destination==='chart'){g.fillStyle='#fff';g.fillRect(0,0,canvas.width,canvas.height);}g.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();bitmap=null;
 const mime=destination==='chart'&&info.format!=='png'?'image/jpeg':['png','webp','gif','bmp','avif'].includes(info.format)?'image/png':'image/jpeg';
 for(let attempt=0;attempt<10;attempt++){const blob=await canvas.convertToBlob({type:mime,quality:Math.max(.76,.94-attempt*.02)});if(blob.size<=5*1024*1024){self.postMessage({blob,width:canvas.width,height:canvas.height});return;}const next=new OffscreenCanvas(Math.max(1,Math.round(canvas.width*.82)),Math.max(1,Math.round(canvas.height*.82)));next.getContext('2d').drawImage(canvas,0,0,next.width,next.height);canvas.width=canvas.height=1;canvas=next;}
 throw Error('This image could not fit the safe storage limit. Export a smaller JPEG or PNG copy.');
 }catch(e){self.postMessage({error:e.message||'Image preparation failed. Export a JPEG or PNG copy.'});}finally{bitmap?.close();if(canvas)canvas.width=canvas.height=1;}};
