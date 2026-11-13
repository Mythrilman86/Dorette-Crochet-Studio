// Publisher chart palettes accept opaque six-digit sRGB hex only (Stage A schema).
// https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
export function relativeLuminance(hex){
 if(typeof hex!=='string'||!/^#[0-9a-f]{6}$/i.test(hex))throw Error('Use an opaque six-digit chart color such as #72518f.');
 const linear=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
 return 0.2126*linear[0]+0.7152*linear[1]+0.0722*linear[2];
}
export function chartTextContrast(hex){
 const luminance=relativeLuminance(hex),black=(luminance+0.05)/0.05,white=1.05/(luminance+0.05);
 return black>=white?{color:'#000000',ratio:black,luminance}:{color:'#ffffff',ratio:white,luminance};
}
