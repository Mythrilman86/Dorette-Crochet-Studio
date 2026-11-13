importScripts('./cartoon.js');
self.onmessage=({data})=>{
  try{
    const result=self.StudioCartoon.convert(data,percent=>self.postMessage({percent}));
    self.postMessage({result},[result.preview.buffer]);
  }catch(error){self.postMessage({error:error.message});}
};
