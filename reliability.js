/* Dorette Crochet Studio v1.7.1 - portable, read-only project integrity and diagnostics.
   Does not repair, delete, mutate or upload user data. */
(()=>{'use strict';
const isFlag=v=>v===0||v===1;
const hex=/^#[0-9a-f]{6}$/i;
function auditProject(p){
 const errors=[],warnings=[];
 const bad=m=>{if(errors.length<24)errors.push(m);};
 const warn=m=>{if(warnings.length<24)warnings.push(m);};
 if(!p||typeof p!=='object')return {ok:false,errors:['Project is not an object'],warnings};
 if(!Number.isInteger(p.cols)||p.cols<1||p.cols>200||!Number.isInteger(p.rows)||p.rows<1||p.rows>300){
   bad('Grid dimensions must be 1–200 columns and 1–300 rows');return {ok:false,errors,warnings};
 }
 const n=p.cols*p.rows;
 if(typeof p.id!=='string'||!p.id)bad('Project identifier is missing');
 if(typeof p.name!=='string')bad('Project name is invalid');
 const array=(a,size,label)=>{if(!Array.isArray(a)||a.length!==size){bad(label+' length does not match the chart');return false;}return true;};
 const palette=Array.isArray(p.palette)?p.palette:[];
 if(!palette.length||palette.length>12)bad('Yarn palette must contain 1–12 colors');
 palette.forEach((c,i)=>{if(!c||!hex.test(c.hex)||typeof c.name!=='string'||typeof c.symbol!=='string')bad('Invalid yarn color at index '+i);});
 if(array(p.cells,n,'Stitch colors'))for(let i=0;i<n;i++)if(!Number.isInteger(p.cells[i])||p.cells[i]<0||p.cells[i]>=palette.length){bad('Invalid stitch color at cell '+(i+1));break;}
 if(array(p.done,n,'Completion flags'))for(let i=0;i<n;i++)if(!isFlag(p.done[i])){bad('Invalid completion flag at cell '+(i+1));break;}
 if(array(p.rowDone,p.rows,'Completed rows'))for(let i=0;i<p.rows;i++)if(!isFlag(p.rowDone[i])){bad('Invalid completed row '+(i+1));break;}
 const layers=p.layers??[];
 if(!Array.isArray(layers)||layers.length>80)bad('Editable layer collection invalid');
 else layers.forEach((l,k)=>{
   if(!l||typeof l.name!=='string'||!Array.isArray(l.entries)||l.entries.length>n){bad('Invalid layer '+(k+1));return;}
   for(const entry of l.entries){if(!Array.isArray(entry)||entry.length!==2||!Number.isInteger(entry[0])||entry[0]<0||entry[0]>=n||!Number.isInteger(entry[1])||entry[1]<0||entry[1]>=palette.length){bad('Out-of-bounds color entry in layer '+(k+1));break;}}
 });
 const versions=p.versions??[];
 if(!Array.isArray(versions)||versions.length>8)bad('Design version history invalid');
 else versions.forEach((v,i)=>{
   const d=v?.data;
   if(!d||!Number.isInteger(d.cols)||!Number.isInteger(d.rows)||d.cols<1||d.rows<1||d.cols>200||d.rows>300||!Array.isArray(d.cells)||d.cells.length!==d.cols*d.rows||!Array.isArray(d.palette)||d.palette.length<1||d.palette.length>12||!Array.isArray(d.done)||d.done.length!==d.cells.length||!Array.isArray(d.rowDone)||d.rowDone.length!==d.rows){bad('Saved design version '+(i+1)+' is incomplete');return;}
   const nested=auditProject({...d,id:'version',name:'Version',versions:[],checkpoints:[]});
   if(!nested.ok)bad('Invalid design version '+(i+1)+': '+nested.errors[0]);
 });
 const annotations=p.annotations??[];
 if(!Array.isArray(annotations)||annotations.length>200)bad('Stitch note collection invalid');
 else annotations.forEach((a,i)=>{if(!a||!['stitch','row','section'].includes(a.scope)||!Number.isInteger(a.col)||!Number.isInteger(a.row)||a.col<1||a.col>p.cols||a.row<1||a.row>p.rows||typeof a.text!=='string'||a.text.length>280)bad('Note '+(i+1)+' is out of chart bounds');});
 const cps=p.checkpoints??[];
 if(!Array.isArray(cps)||cps.length>3)bad('Editing snapshots invalid');
 else cps.forEach((s,i)=>{
   if(!s||typeof s!=='object'){bad('Editing snapshot '+(i+1)+' is incomplete');return;}
   const nested=auditProject({...s,id:'snapshot',name:'Snapshot',versions:[],checkpoints:[]});
   if(!nested.ok)bad('Invalid editing snapshot '+(i+1)+': '+nested.errors[0]);
 });
 if(p.guide && (!Number.isInteger(p.guide.row)||p.guide.row<1||p.guide.row>p.rows||!Number.isInteger(p.guide.position)||p.guide.position<0||p.guide.position>=p.cols))warn('Guided crochet cursor needs checking');
 if(typeof p.referenceImage==='string'&&p.referenceImage.length>22*1024*1024)warn('Large embedded photo may slow project backups');
 return {ok:errors.length===0,errors,warnings};
}
function auditExport(project,composed){
 const report=auditProject(project);if(!report.ok)return report;
 if(!Array.isArray(composed)||composed.length!==project.cols*project.rows)return {ok:false,errors:['Exported chart dimensions differ from the project'],warnings:[]};
 const seen=new Set(composed);
 for(const c of seen)if(!Number.isInteger(c)||c<0||c>=project.palette.length)return {ok:false,errors:['Export contains invalid yarn-color indexes'],warnings:[]};
 return {ok:true,errors:[],warnings:report.warnings};
}
function verifyPdf(bytes){const str=String.fromCharCode(...new Uint8Array(bytes).slice(0,8));return str.startsWith('%PDF-');}
function makeDiagnostics({version='1.7.1',saveState='unknown',pendingWrites=0,projectCount=0,activeProject=null,renderMetrics=null}={}){
 const cvs=document.createElement('canvas');let canvas2d=false;try{canvas2d=!!cvs.getContext('2d');}catch{}
 let storage='unknown';try{localStorage.setItem('__dorette_diag','ok');localStorage.removeItem('__dorette_diag');storage='available';}catch{storage='blocked';}
 const safe={version,createdAt:new Date().toISOString(),online:navigator.onLine,secureContext:window.isSecureContext,serviceWorkerSupported:'serviceWorker' in navigator,serviceWorkerControlled:!!navigator.serviceWorker?.controller,indexedDBSupported:!!window.indexedDB,localStorage:storage,canvas2d,clipboardSupported:!!navigator.clipboard,wakeLockSupported:!!navigator.wakeLock,pointerEventsSupported:!!window.PointerEvent,saveState,pendingWrites,projectCount,activeGrid:activeProject?`${activeProject.cols}x${activeProject.rows}`:null,projectCheck:activeProject?auditProject(activeProject):null,renderMetrics};
 return safe; // Intentionally omits names, images, notes, yarn records, and chart cells.
}
window.DoretteReliability=Object.freeze({auditProject,auditExport,verifyPdf,makeDiagnostics});
})();
