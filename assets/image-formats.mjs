// Content checks run before invoking a decoder. No uploaded contents are executable.
export const IMAGE_ACCEPT='.jpg,.jpeg,.jfif,.png,.webp,.heic,.heif,.avif,.gif,.bmp,image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,image/gif,image/bmp';
export function inspectImage(b,total=b.length){
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength),text=(p,n)=>String.fromCharCode(...b.subarray(p,p+n)),u32=(p,l=false)=>v.getUint32(p,l);let format,width,height;
 if(total<12||total>40*1024*1024)throw Error('Choose an image up to 40 MiB. Export a smaller JPEG or PNG copy from Photos or Gallery.');
 if(text(0,8)==='\x89PNG\r\n\x1a\n'&&text(12,4)==='IHDR'){format='png';width=u32(16);height=u32(20);}
 else if(b[0]===255&&b[1]===216&&b[2]===255){format='jpeg';let p=2;while(p+4<b.length){if(b[p++]!==255)break;while(b[p]===255)p++;const marker=b[p++];if(marker===217||marker===218)break;const n=v.getUint16(p);if(n<2||p+n>b.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){height=v.getUint16(p+3);width=v.getUint16(p+5);break;}p+=n;}}
 else if(['GIF87a','GIF89a'].includes(text(0,6))){format='gif';width=v.getUint16(6,true);height=v.getUint16(8,true);}
 else if(text(0,2)==='BM'&&b.length>=54&&u32(14,true)>=40){format='bmp';width=v.getInt32(18,true);height=Math.abs(v.getInt32(22,true));if(u32(2,true)>total)throw Error('This BMP is incomplete. Export a new JPEG or PNG copy.');}
 else if(text(0,4)==='RIFF'&&text(8,4)==='WEBP'){
  format='webp';if(u32(4,true)+8>total)throw Error('This WebP image is incomplete.');const tag=text(12,4);
  if(tag==='VP8X'){width=1+(b[24]|b[25]<<8|b[26]<<16);height=1+(b[27]|b[28]<<8|b[29]<<16);}
  else if(tag==='VP8L'&&b[20]===47){const n=u32(21,true);width=(n&16383)+1;height=((n>>>14)&16383)+1;}
  else if(tag==='VP8 '&&text(23,3)==='\x9d\x01\x2a'){width=v.getUint16(26,true)&16383;height=v.getUint16(28,true)&16383;}
 }else if(text(4,4)==='ftyp'){
  const end=u32(0);if(end<16||end>Math.min(total,b.length)||end>4096)throw Error('Invalid photo container header.');const brands=[text(8,4)];for(let i=16;i+4<=end;i+=4)brands.push(text(i,4));
  format=brands.some(x=>['avif','avis'].includes(x))?'avif':brands.some(x=>['heic','heix','hevc','hevx','heim','heis','mif1','msf1'].includes(x))?'heif':null;
  if(!format)throw Error('This photo container is unsupported. Export a JPEG or PNG copy.');
  let count=0;function boxes(start,stop,depth=0){if(depth>8)throw Error('Photo container is too complex.');for(let p=start;p+8<=stop;){if(++count>4096)throw Error('Photo container is too complex.');const n=u32(p),type=text(p+4,4);if(n<8||p+n>total)break;if(type==='ispe'&&n>=20&&p+20<=b.length){const w=u32(p+12),h=u32(p+16);if(w*h>(width||0)*(height||0)){width=w;height=h;}}if(['meta','iprp','ipco'].includes(type)&&p+n<=b.length)boxes(p+8+(type==='meta'?4:0),p+n,depth+1);p+=n;}}
  boxes(0,b.length);
 }
 if(!format)throw Error('Unsupported image contents. Use JPEG/JFIF, PNG, WebP, AVIF, GIF or BMP. HEIC/HEIF requires a device decoder. SVG, TIFF and camera RAW/DNG need a JPEG or PNG export.');
 const maxPixels=['png','jpeg'].includes(format)?80000000:format==='heif'?24000000:32000000;
 if(!width||!height||width>32768||height>32768||width*height>maxPixels)throw Error(`This ${format.toUpperCase()} image has invalid dimensions or exceeds the safe ${maxPixels/1000000}-megapixel input limit. Export a smaller JPEG or PNG copy.`);
 return {format,width,height,mime:'image/'+(format==='heif'?'heic':format),maxPixels};
}
