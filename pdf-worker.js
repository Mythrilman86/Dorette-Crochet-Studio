/* v1.7.1: render large PDF pages off the UI thread, using the same offline PDF engine. */
self.window=self;
importScripts('./pattern-tools.js?v=1.7.1','./pdf-export.js?v=1.7.1');
self.onmessage=(ev)=>{
  try{
    const {kind,project,settings}=ev.data||{};
    if(kind!=='chart'&&kind!=='written')throw Error('Unknown PDF export type');
    const result=kind==='written'?self.DorettePdf.buildWritten(project,settings):self.DorettePdf.build(project,settings);
    const bytes=result.bytes instanceof Uint8Array?result.bytes:new Uint8Array(result.bytes);
    self.postMessage({bytes,pages:result.pages},[bytes.buffer]);
  }catch(e){self.postMessage({error:String(e.message||e)});}
};
