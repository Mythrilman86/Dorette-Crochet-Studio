/* Pinned pdfmake runs in a disposable worker, with no network fonts or live draft access. */
importScripts('./vendor/pdfmake.min.js','./fonts/vfs_fonts.js');
self.onmessage=async({data})=>{try{const {definition,MAX_BYTES}=await import('./layout.mjs');const pdf=pdfMake.createPdf(definition(data.snapshot,data.options,data.images));
 // Pinned internal adapter gives bytes and layout from the SAME rendering pass.
 pdf._createDoc({},doc=>pdf._flushDoc(doc,(buffer,pages)=>{
  try{if(pages.length>250)throw Error('This document exceeds 250 pages. Split it into reviewed publications.');if(buffer.length>MAX_BYTES)throw Error('PDF exceeds the 18 MB safety margin below Etsy’s current 20 MB per-file limit. Select fewer or smaller photographs.');
   const overflow=[];for(const [i,p]of pages.entries())for(const item of p.items){const v=item.item;if(item.type==='line'&&(v.x < -1||v.y < -1||v.x+v.getWidth()>p.pageSize.width+1||v.y+v.getHeight()>p.pageSize.height+1))overflow.push(i+1);}
   if(overflow.length)throw Error('Text overflow on page '+[...new Set(overflow)].join(', ')+'. Shorten an unbroken heading or instruction.');
   const bytes=Uint8Array.from(buffer);postMessage({bytes:bytes.buffer,pages:pages.length},[bytes.buffer]);
  }catch(e){postMessage({error:e.message});}
 }));
 }catch(e){postMessage({error:e.message||String(e)});}};
