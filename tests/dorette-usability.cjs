const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../advanced.js'),'utf8'),context={window:{}};vm.runInNewContext(source,context);const {grayscale,wheelZoomStep}=context.window.DoretteAdvanced;
const plain=x=>JSON.parse(JSON.stringify(x));
test('adaptive grayscale preserves narrow portrait tones and improves quantization error',()=>{
 const values=Array.from({length:2560},(_,i)=>{const x=70+(i%256)/255*95;return [x,x,x];}),original=plain(values),options={autoBalance:false,shadows:0};
 const output=grayscale(values,6,options),error=output.cells.reduce((sum,c,i)=>sum+(parseInt(output.palette[c].hex.slice(1,3),16)-values[i][0])**2,0)/values.length;
 const oldError=values.reduce((sum,v)=>{const c=25+Math.round((v[0]-25)/230*2)*115;return sum+(c-v[0])**2;},0)/values.length;
 assert.ok(error<oldError/10,{error,oldError});assert.equal(output.palette.length,6);assert.deepEqual(plain(values),original);assert.deepEqual(plain(output),plain(grayscale(values,6,options)));
});
test('all shade counts and optional controls produce bounded valid chart palettes',()=>{
 const values=Array.from({length:99},(_,i)=>[i*2.5,255-i*2.2,i%13*19]);
 for(const n of [2,3,4,5,6,8,10,12])for(const smoothing of [0,1,2])for(const dither of [false,true]){const r=grayscale(values,n,{width:11,smoothing,dither,edge:40,midtones:20,highlights:-10});assert.ok(r.palette.length<=n&&r.palette.length>=1);assert.equal(r.cells.length,99);assert.ok(r.cells.every(x=>Number.isInteger(x)&&x>=0&&x<r.palette.length));assert.equal(new Set(r.palette.map(p=>p.symbol)).size,r.palette.length);assert.ok(r.palette.every(p=>/^#([0-9a-f]{2})\1\1$/.test(p.hex)));}
 assert.equal(grayscale(Array.from({length:16},()=>[127,127,127]),12,{width:4}).palette.length,1);
 assert.deepEqual(plain(grayscale([],6)),{palette:[{hex:'#ffffff',name:'White',symbol:'A'}],cells:[]});
});
test('wheel input normalizes hardware units and caps a continuous storm at 30 percentage points',()=>{
 for(const deltaMode of [0,1,2]){const state={},steps=[];for(let t=0;t<2000;t+=2)steps.push(wheelZoomStep(state,{deltaY:-100000,deltaMode},t));assert.equal(steps.reduce((a,b)=>a+b,0),30);assert.equal(wheelZoomStep(state,{deltaY:-120,deltaMode},2500),10);assert.equal(wheelZoomStep(state,{deltaY:120,deltaMode},2501),-10);}
 for(const event of [{deltaY:0},{deltaY:NaN},{deltaY:1,deltaX:100}])assert.equal(wheelZoomStep({},event,0),0);
 const state={};assert.equal(wheelZoomStep(state,{deltaY:-1},0),0);for(let i=1;i<16;i++)wheelZoomStep(state,{deltaY:-1},i);assert.equal(state.steps,1);
});
test('worker uses the identical grayscale implementation, including adjustments and dithering',()=>{
 const cols=7,rows=5,pixels=new Uint8ClampedArray(cols*rows*36*4);for(let y=0;y<rows*6;y++)for(let x=0;x<cols*6;x++){const i=(y*cols*6+x)*4,v=(Math.floor(y/6)*cols+Math.floor(x/6))*7;pixels.set([v,v,v,255],i);}
 let message;const ctx={self:{postMessage:m=>message=m},Uint8ClampedArray,postMessage:()=>{},importScripts:()=>vm.runInNewContext(source,ctx)};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../image-worker.js'),'utf8'),ctx);
 const options={width:cols,brightness:4,contrast:15,shadows:25,smoothing:1,dither:true};ctx.self.onmessage({data:{kind:'convert',pixels,cols,rows,s:{mode:'grayscale'},grayCount:8,grayOptions:options}});
 assert.ok(message&&!message.error,JSON.stringify(message));assert.deepEqual(plain(message.result),plain(grayscale(Array.from({length:cols*rows},(_,i)=>[i*7,i*7,i*7]),8,options)));
});
