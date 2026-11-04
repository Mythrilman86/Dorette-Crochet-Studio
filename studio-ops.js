/* Dorette Crochet Studio v1.8.1 — local-only session ownership and storage statistics.
   No network calls, cloud storage, background backups, or project-data uploads. */
(()=>{'use strict';
 const LOCK_NAME='dorette-crochet-studio-editor';
 const LEASE_KEY='dorette-crochet-studio-editor-lease-v1';
 const tabId=crypto.randomUUID?.()||('tab-'+Date.now()+'-'+Math.random());
 let writable=false,releaseLock=null,renewTimer=null,channel=null,lockPending=false,callback=()=>{};
 let pageClosed=false;
 const useWebLocks=()=>!!navigator.locks?.request&&location.protocol!=='file:';
 const now=()=>Date.now();
 const leaseValue=()=>JSON.stringify({tabId,until:now()+6000});
 function currentLease(){try{return JSON.parse(localStorage.getItem(LEASE_KEY)||'null');}catch{return null;}}
 function notify(){callback(writable);try{channel?.postMessage({type:'ownership',tabId,writable});}catch{}}
 function setWritable(value){if(writable===value)return;writable=!!value;notify();}
 function fallbackAcquire(){
   const old=currentLease();
   if(old&&old.tabId!==tabId&&old.until>now()){setWritable(false);return false;}
   try{localStorage.setItem(LEASE_KEY,leaseValue());}catch{setWritable(false);return false;}
   const latest=currentLease();const got=latest?.tabId===tabId;
   setWritable(got);
   if(got&&!renewTimer)renewTimer=setInterval(()=>{
     const record=currentLease();
     if(!writable||record?.tabId!==tabId||record.until<=now()){setWritable(false);clearInterval(renewTimer);renewTimer=null;return;}
     try{localStorage.setItem(LEASE_KEY,leaseValue());}catch{setWritable(false);}
   },1800);
   return got;
 }
 function release(){pageClosed=true;if(releaseLock){releaseLock();releaseLock=null;}
   if(renewTimer){clearInterval(renewTimer);renewTimer=null;}
   if(currentLease()?.tabId===tabId)try{localStorage.removeItem(LEASE_KEY);}catch{}
   setWritable(false);channel?.close();channel=null;
 }
 async function acquire(){
   pageClosed=false;
   if(canWrite())return true;
   if(lockPending)return false;
   lockPending=true;
   if(useWebLocks()){
     const didAcquire=await new Promise(resolve=>{
       let settled=false;
       const finish=x=>{if(!settled){settled=true;resolve(x);}};
       navigator.locks.request(LOCK_NAME,{mode:'exclusive',ifAvailable:true},lock=>{
         if(!lock){finish(false);return;}
         if(pageClosed){finish(false);return;}
         releaseLock=null;
         setWritable(true);finish(true);
         return new Promise(done=>{releaseLock=done;});
       }).catch(()=>finish(null));
     });
     lockPending=false;
     return didAcquire===true;
   } else lockPending=false;
   return fallbackAcquire();
 }
 async function init(onChange){callback=onChange||(()=>{});
   if(typeof BroadcastChannel==='function')try{
     channel=new BroadcastChannel('dorette-studio-tabs');
     channel.onmessage=event=>{
       if(event.data?.type==='ownership'&&event.data.tabId!==tabId&&event.data.writable&&writable&&(!useWebLocks())){
         // A competing lease claimant is treated as a conflict: never overwrite silently.
         setWritable(false);
       }
     };
   }catch{}
   window.addEventListener('storage',ev=>{
     if(ev.key!==LEASE_KEY||useWebLocks()||!writable)return;
     const other=currentLease();if(other&&other.tabId!==tabId&&other.until>now())setWritable(false);
   });
   // The application releases ownership only after its pending storage transactions settle.
   // Browser termination also releases navigator.locks automatically.
   const result=await acquire();callback(writable);return result;
 }
 function canWrite(){
   if(writable&&!useWebLocks()){
     const lease=currentLease();
     if(lease?.tabId!==tabId||lease.until<=now())setWritable(false);
   }
   return writable;
 }
 function formatSize(num){if(num===null||num===undefined||!Number.isFinite(num))return 'Unavailable';
   return num>1024**3?(num/1024**3).toFixed(2)+' GB':num>1024**2?(num/1024**2).toFixed(1)+' MB':(num/1024).toFixed(1)+' KB';}
 async function inspectStorage(projects){
   let estimate=null;
   try{estimate=await navigator.storage?.estimate?.();}catch{}
   const sizes=Array.from(projects||[]).map(p=>{
     const base=(p.cells?.length||0)*6+(p.done?.length||0)*2+(p.rowDone?.length||0)*2;
     const history=(p.versions||[]).reduce((n,v)=>n+(v?.data?.cells?.length||0)*6,0);
     const images=String(p.referenceImage||'').length*0.75;
     const layer=(p.layers||[]).reduce((n,l)=>n+(l.entries?.length||0)*18,0);
     return {name:p.name||'Untitled',bytes:Math.round(base+history+images+layer)};
   }).sort((a,b)=>b.bytes-a.bytes);
   const used=estimate?.usage??null,quota=estimate?.quota??null;
   const ratio=quota&&used!==null?used/quota:null;
   let persistent=null;try{persistent=await navigator.storage?.persisted?.();}catch{}
   return {used,quota,ratio,persistent,totalEstimate:sizes.reduce((n,p)=>n+p.bytes,0),large:sizes.slice(0,5),warning:ratio!==null&&ratio>=.8};
 }
 window.DoretteOps=Object.freeze({init,acquire,release,canWrite,inspectStorage,formatSize});
})();
