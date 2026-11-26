(() => {
  if (location.origin !== 'http://127.0.0.1:17828' || window.Capacitor?.isNativePlatform()) return;
  const box=document.createElement('section');box.id='studioUpdateProgress';box.className='update-notice';box.hidden=true;
  box.innerHTML='<h2>Updates</h2><p role="status" aria-live="polite"></p><details><summary>Release notes</summary><p class="windows-release-notes"></p></details><div class="actions"><button type="button" data-check>Check for Updates</button><button type="button" data-apply hidden>Save &amp; Update</button><button type="button" data-later hidden>Remind Me Later</button></div><p>Keep external chart ZIP, Settings &amp; Layout JSON, .deewritten with original PDFs, and .deepattern backups. These remain separate.</p>';
  document.body.prepend(box);
  const status=box.querySelector('[role=status]'),check=box.querySelector('[data-check]'),apply=box.querySelector('[data-apply]'),later=box.querySelector('[data-later]');
  let token,candidate,busy=false;
  function controls(value){busy=value;check.disabled=apply.disabled=later.disabled=value;}
  async function request(action,post=false){
    const response=await fetch('/__studio_update/'+action,{method:post?'POST':'GET',cache:'no-store',credentials:'omit',redirect:'error',headers:{'X-Dees-Request':'1',...(post?{'X-Dees-Update':token,'X-Dees-Version':candidate.version}:{})},signal:AbortSignal.timeout(post?180000:25000)});
    const reply=await response.json();if(!response.ok)throw Error(reply.error||'Unable to Update. Keep your current work open.');return reply;
  }
  async function inspect(automatic=false){
    if(busy)return;controls(true);
    try{
      const session=await request('session');if(session.protocol!==1)throw Error('This launcher needs the one-time updater transition.');
      token=session.token;box.hidden=false;
      const old=document.getElementById('studioUpdates');if(old)old.hidden=true;
      if(!automatic)status.textContent='Checking for updates…';
      const reply=await request('check');candidate=reply.candidate;
      const running=window.StudioRelease.version;
      let completed=false;
      try{completed=sessionStorage.getItem('studio.windows.update.target')===reply.current&&running===reply.current;if(completed)sessionStorage.removeItem('studio.windows.update.target');}catch{}
      status.textContent=(completed?'Update Complete. ':'')+'Current version '+running+'. '+(reply.current!==running?'Version '+reply.current+' app files are prepared. Use the Studio Save & Update notice to finish offline setup.':candidate?'Update Available: '+candidate.version+'. Save and close other Studio windows first.':'No update available.');
      box.querySelector('.windows-release-notes').textContent=candidate?.notes||'';
      apply.hidden=later.hidden=!candidate;
    }catch(error){if(!automatic||token){box.hidden=false;status.textContent=error.message;}}
    finally{controls(false);}
  }
  check.onclick=()=>inspect();later.onclick=()=>{apply.hidden=later.hidden=true;status.textContent='Update postponed. Choose Check for Updates when you are ready.';};
  apply.onclick=async()=>{
    if(busy||!candidate)return;controls(true);
    let switched=false;
    try{
      const safety=window.StudioUpdateSafety,reg=await navigator.serviceWorker?.getRegistration();
      if(!reg?.active||!window.StudioOnlyUpdateWindow||!safety||!await safety.ready())throw Error('Unable to Update. Finish saving, resolve storage errors, and close other Studio windows first.');
      await window.StudioOnlyUpdateWindow(reg.active);
      safety.freeze(true);
      status.textContent='Downloading / Preparing Update. Keep Studio open…';
      await request('prepare',true);
      if(!await safety.ready())throw Error('A write is pending or failed. The prepared files have not been activated.');
      await window.StudioOnlyUpdateWindow(reg.active);
      status.textContent='Applying the verified app files…';
      sessionStorage.setItem('studio.windows.update.target',candidate.version);
      const result=await request('apply',true);switched=true;
      if(!result.applied||result.version!==candidate.version)throw Error('Update status did not match. Keep your work and review the installed version before retrying.');
      await reg.update();
      // Wait for the existing worker's atomic cache installation, not a second updater.
      const deadline=Date.now()+90000;
      while(!reg.waiting&&Date.now()<deadline){if(reg.installing?.state==='redundant')break;await new Promise(resolve=>setTimeout(resolve,250));}
      if(!reg.waiting)throw Error('App files are prepared, but offline setup did not finish. Keep this window open and use Check for Studio updates when connected. Do not repeat the download.');
      status.textContent='Update prepared. Opening the new version…';
      await window.StudioPrepareWebsiteUpdate(reg.waiting);
    }catch(error){status.textContent='Unable to Update. '+error.message+(switched?' Previous app files are retained; no browser data was cleared.':' Your current app files and browser data are retained.');window.StudioUpdateSafety?.freeze(false);}
    finally{controls(false);}
  };
  // Non-modal check; explicit consent is still required for every download/switch.
  setTimeout(()=>inspect(true),2500);
})();
