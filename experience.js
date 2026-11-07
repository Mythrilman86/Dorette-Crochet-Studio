(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  let bridge,target=null;
  const layoutKey='studio.settings.layout.v1';
  function layout(){try{return JSON.parse(localStorage.getItem(layoutKey))||{};}catch{return {};}}
  function saveLayout(value){
    try{localStorage.setItem(layoutKey,JSON.stringify(value));document.dispatchEvent(new Event('studio-layout-changed'));}
    catch{bridge?.notify?.('Display preferences could not be saved.');}
  }
  function clearHighlight(){target?.classList.remove('settings-highlight');target=null;}
  function highlight(node){clearHighlight();target=node;node.classList.add('settings-highlight');}
  const groups={painting:['toolPaint','toolErase','toolPick','toolBucket'],selection:['toolRect','toolArea','toolPaste']};
  function applyVisibility(){
    if(!bridge)return;
    const saved=layout(),enabled=bridge.prefs.mode==='personalized'&&saved.personalizedConfigured===true;
    for(const [key,section] of bridge.sections){
      section.classList.toggle('personalized-hidden',enabled&&!saved.personalized?.includes(key));
    }
    for(const [key,ids] of Object.entries(groups))for(const id of ids){
      $(id)?.classList.toggle('personalized-tool-hidden',enabled&&saved.hiddenTools?.includes(key));
    }
  }
  function dialog(id,title){
    const node=document.createElement('dialog');node.id=id;node.className='experience-dialog';
    const h=document.createElement('h2');h.textContent=title;h.id=id+'-title';node.setAttribute('aria-labelledby',h.id);
    const close=document.createElement('button');close.type='button';close.className='button ghost';close.textContent='Close';close.onclick=()=>node.close();
    const content=document.createElement('div');content.className='experience-content';node.append(h,close,content);document.body.append(node);
    return {node,content,open(){node.showModal();}};
  }
  function button(text,action){const b=document.createElement('button');b.type='button';b.className='button ghost';b.textContent=text;b.onclick=action;return b;}
  function paragraph(host,text){const p=document.createElement('p');p.textContent=text;host.append(p);}
  function setup(api){
    bridge=api;
    document.addEventListener('pointerdown',event=>{if(target&&!target.contains(event.target))clearHighlight();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')clearHighlight();});
    function syncLetters(){for(const input of document.querySelectorAll('.show-yarn-letters'))input.checked=api.prefs.showYarnLetters!==false;}
    for(const input of document.querySelectorAll('.show-yarn-letters'))input.onchange=()=>{api.prefs.showYarnLetters=input.checked;api.savePrefs();syncLetters();api.draw();};
    syncLetters();$('compactCenter').onclick=api.center;
    const about=dialog('aboutStudioDialog','About Dee’s Crochet Studio');
    const news=dialog('whatsNewDialog','What’s New');
    const diagnostics=dialog('diagnosticsDialog','Diagnostics & Support');
    const controls=document.createElement('div');controls.hidden=true;document.body.append(controls);
    function command(id,open){const b=button(id,open);b.id=id;controls.append(b);}
    const version=()=>window.StudioRelease?.version||'Unknown';
    const platform=()=>window.Capacitor?.getPlatform?.()||'web';
    command('aboutStudio',()=>{
      about.content.replaceChildren();
      paragraph(about.content,`Dee’s Crochet Studio ${version()} · ${platform()}`);
      paragraph(about.content,'Free, offline crochet charts and Written Pattern Companion. No required accounts, advertising or automatic project uploads. Keep external backups of important work.');
      const guide=document.createElement('a');guide.href='./Dorette-Crochet-Studio-User-Guide.pdf';guide.textContent='User Guide (PDF)';about.content.append(guide);
      const project=document.createElement('a');project.href='https://github.com/Mythrilman86/Dorette-Crochet-Studio';project.textContent='Project source and support';about.content.append(project);
      about.content.append(button('What’s New',()=>{about.node.close();$('whatsNew').click();}),button('Diagnostics & Support',()=>{about.node.close();$('diagnosticsSupport').click();}));about.open();
    });
    command('whatsNew',()=>{
      news.content.replaceChildren();paragraph(news.content,`${version()} · ${platform()}`);
      paragraph(news.content,'2.6.0 development — Personalized interface, clearer navigation, local diagnostics, enlarged crochet previews, original motifs and improved Crochet View controls.');
      paragraph(news.content,'Crochet View: collapse the lower controls, center without changing zoom, and choose whether yarn letters appear on the chart. These preferences do not change artwork or progress.');
      paragraph(news.content,'2.5.2 website maintenance — improved offline-readiness replies. Intermittent Chromium installation aborts remain under investigation.');
      const a=document.createElement('a');a.href='./Dorette-Crochet-Studio-User-Guide.pdf#chapter-navigation';a.textContent='Guide to navigation and display';news.content.append(a);news.open();
    });
    command('diagnosticsSupport',()=>{
      diagnostics.content.replaceChildren();paragraph(diagnostics.content,'This bounded history contains local event codes, version and platform. It excludes project contents, filenames, raw errors and PDFs. Browser-level failures may not be captured. Nothing is uploaded.');
      const preview=document.createElement('pre');preview.tabIndex=0;preview.textContent=JSON.stringify(window.studioDiagnostics.report(),null,2);
      diagnostics.content.append(button('Export this report',()=>api.download(new Blob([preview.textContent],{type:'application/json'}),'Dees-Studio-Diagnostics.json')),button('Clear Log',()=>{if(confirm('Clear local diagnostic history?')){window.studioDiagnostics.clear();preview.textContent='[]';}}),preview);diagnostics.open();
    });
    const health=$('offlineSetupStatus')?.parentElement;
    health?.append(button('Diagnostics & Support',()=>$('diagnosticsSupport').click()));
    setupPersonalization(api);
    setupPreview(api);
    setupPresets(api);
    applyVisibility();
  }
  function setupPersonalization(api){
    const view=dialog('personalizedDialog','Personalized Interface');
    paragraph(view.content,'Choose Settings sections and drawing tool groups. Find a Tool can reveal hidden features temporarily. Advanced restores the full interface.');
    const items=document.createElement('div');view.content.append(items);
    function render(){
      items.replaceChildren();const saved=layout();
      for(const [key,section] of api.sections){
        const label=document.createElement('label');label.className='toggle';const input=document.createElement('input');input.type='checkbox';input.checked=!saved.personalizedConfigured||saved.personalized?.includes(key);
        input.onchange=()=>persist();label.append(input,document.createTextNode(section.dataset.settingsLabel));input.dataset.section=key;items.append(label);
      }
      for(const key of Object.keys(groups)){
        const label=document.createElement('label');label.className='toggle';const input=document.createElement('input');input.type='checkbox';input.checked=!saved.hiddenTools?.includes(key);input.dataset.tool=key;input.onchange=()=>persist();label.append(input,document.createTextNode(key==='painting'?'Painting tools':'Area selection tools'));items.append(label);
      }
    }
    function persist(){
      const saved=layout();saved.personalizedConfigured=true;
      saved.personalized=[...items.querySelectorAll('input[data-section]:checked')].map(input=>input.dataset.section);
      saved.hiddenTools=[...items.querySelectorAll('input[data-tool]:not(:checked)')].map(input=>input.dataset.tool);
      saveLayout(saved);applyVisibility();
    }
    view.content.append(button('Select All',()=>{for(const input of items.querySelectorAll('input'))input.checked=true;persist();}),button('Restore Advanced',()=>{api.prefs.mode='advanced';api.savePrefs();api.applyPrefs();view.node.close();}));
    const configure=button('Personalize sections and tools',()=>{render();view.open();});configure.id='configurePersonalized';$('skillMode').closest('label').after(configure);
    $('skillMode').addEventListener('change',()=>{for(const section of api.sections.values())section.classList.remove('settings-revealed');for(const ids of Object.values(groups))for(const id of ids)$(id)?.classList.remove('tool-revealed');applyVisibility();});
  }
  function setupPreview(api){
    const viewer=dialog('crochetImageViewer','Crochet Preview');const stage=document.createElement('div');stage.className='preview-stage';stage.tabIndex=0;stage.setAttribute('aria-label','Enlarged crochet preview. Use plus and minus to zoom and arrow keys to pan.');
    const image=document.createElement('canvas');image.setAttribute('role','img');image.setAttribute('aria-label','Enlarged chart preview');stage.append(image);
    let scale=1,x=0,y=0;
    function paint(){image.style.transform=`translate(${x}px,${y}px) scale(${scale})`;}
    function fit(){const rect=stage.getBoundingClientRect();scale=Math.min((rect.width-16)/image.width,(rect.height-16)/image.height);x=(rect.width-image.width*scale)/2;y=(rect.height-image.height*scale)/2;paint();}
    function zoom(factor,cx=stage.clientWidth/2,cy=stage.clientHeight/2){const next=Math.max(.03,Math.min(8,scale*factor));x=cx-(cx-x)*next/scale;y=cy-(cy-y)*next/scale;scale=next;paint();}
    viewer.content.append(button('Zoom In',()=>zoom(1.25)),button('Zoom Out',()=>zoom(.8)),button('Fit',fit),button('Reset',fit),stage);
    for(const id of ['textureOriginal','textureSimulated']){
      const canvas=$(id);canvas.tabIndex=0;canvas.setAttribute('role','button');canvas.setAttribute('aria-label','Enlarge '+(id==='textureOriginal'?'chart':'simulation'));
      const open=()=>{api.renderTexture();image.width=canvas.width;image.height=canvas.height;image.getContext('2d').drawImage(canvas,0,0);viewer.open();requestAnimationFrame(fit);};
      canvas.onclick=open;canvas.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};
    }
    stage.onwheel=e=>{e.preventDefault();const r=stage.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.002),e.clientX-r.left,e.clientY-r.top);};
    stage.onkeydown=e=>{if(['+','=','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','0'].includes(e.key)){e.preventDefault();if(e.key==='0')fit();else if(['+','=','-'].includes(e.key))zoom(e.key==='-'?.8:1.25);else{x+=e.key==='ArrowLeft'?20:e.key==='ArrowRight'?-20:0;y+=e.key==='ArrowUp'?20:e.key==='ArrowDown'?-20:0;paint();}}};
    const pointers=new Map();
    stage.onpointerdown=e=>{stage.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});};
    stage.onpointermove=e=>{
      const prior=pointers.get(e.pointerId);if(!prior)return;
      const other=[...pointers].find(([id])=>id!==e.pointerId)?.[1];
      if(other){const a=Math.hypot(prior.x-other.x,prior.y-other.y),b=Math.hypot(e.clientX-other.x,e.clientY-other.y),r=stage.getBoundingClientRect();if(a>0)zoom(b/a,(e.clientX+other.x)/2-r.left,(e.clientY+other.y)/2-r.top);}
      else{x+=e.clientX-prior.x;y+=e.clientY-prior.y;paint();}pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    };
    stage.onpointerup=stage.onpointercancel=stage.onlostpointercapture=e=>pointers.delete(e.pointerId);
    viewer.node.addEventListener('close',()=>pointers.clear());
  }
  function setupPresets(api){
    const patterns={Heart:['0110110','1111111','1111111','0111110','0011100','0001000'],Star:['0001000','0001000','1111111','0111110','0011100','0110110','0100010'],Smiley:['0111110','1000001','1010101','1000001','1011101','1000001','0111110'],Peace:['0011100','0101010','1001001','1001001','1011101','0110110','0011100'],Flower:['0011100','0010100','1110111','1001001','1110111','0010100','0011100'],Diamond:['0001000','0011100','0111110','1111111','0111110','0011100','0001000'],Square:['11111','10001','10001','10001','11111']};
    const choice=document.createElement('select');choice.id='presetMotif';choice.setAttribute('aria-label','Original motif preset');for(const name of Object.keys(patterns))choice.add(new Option(name,name));
    const add=button('Preview preset',()=>{
      const project=api.active();if(!project)return;
      const name=choice.value,rows=patterns[name],background=project.palette[0],foreground=project.palette.find(c=>c.hex!==background.hex)||{hex:'#000000',name:'Black',symbol:'B'};
      const id='original-preset-'+name;const motif={id,name,clip:{width:rows[0].length,height:rows.length,palette:[background.hex,foreground.hex],colors:rows.join('').split('').map(Number)}};
      const existing=api.motifs().filter(m=>m.id!==id);if(existing.length>=30)return alert('The motif library is full. Remove a saved motif before adding this preset.');
      api.saveMotifs([...existing,motif]);$('motifChoice').value=id;api.placeMotif();
    });
    $('motifChoice').before(choice,add);
  }
  window.StudioExperience={setup,applyVisibility,highlight};
})();

