(() => {
  const get = id => document.getElementById('stitch' + id);
  const dialog = get('Studio');
  const mode = get('Mode');
  const canvas = get('Image');
  const original = document.createElement('canvas');
  const source = document.createElement('canvas');
  let angle = 0;
  const cropFields = [...get('Crop').querySelectorAll('input')];
  const video = get('Live').querySelector('video');
  const status = text => { get('Status').textContent = text; };
  const supported = new Set(['ch', 'sc', 'hdc', 'dc', 'tr', 'dtr']);
  const known = new Map(stitchEntries.map(entry => [entry.id, entry]));
  let crop, drag, stream, templates, imageRequest = 0, cameraRequest = 0;
  let marks = [];

  function element(tag, text, parent) {
    const node = document.createElement(tag);
    node.textContent = text;
    parent?.append(node);
    return node;
  }

  const usCode = entry => entry.id === 'sl' ? 'sl st' : entry.id;

  function glyph(entry) {
    const node = element('span', '');
    node.innerHTML = '<svg class="stitch-glyph" viewBox="0 0 48 48" aria-hidden="true">' +
      '<path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"' + (entry.id === 'sl' ? ' style="fill:currentColor"' : '') + ' d="' +
      entry.path + '"/></svg>';
    return node;
  }

  // A schematic of the active loops and the target stitch, with a highlighted draw-through.
  function loopDiagram(count, pulled, target) {
    const svg = element('span', '');
    const loops = Array.from({length: count}, (_, index) =>
      '<ellipse cx="' + (30 + index * 14) + '" cy="19" rx="5" ry="12" stroke="' +
      (index < pulled ? '#a33c58' : '#36566d') + '"/>').join('');
    svg.innerHTML = '<svg class="stitch-step" viewBox="0 0 128 50" aria-hidden="true">' +
      '<g fill="none" stroke-width="2.5"><path stroke="#222" d="M119 19H13q-8 0-5-6l5-2"/>' +
      loops + (target ? '<path stroke="#36566d" d="M16 37l13 10 13-10m-13 10V21"/>' : '') +
      (pulled ? '<path stroke="#a33c58" d="M' + (28 + pulled * 14) + ' 34H13m5-4-5 4 5 4"/>' : '') +
      '</g></svg>';
    return svg;
  }

  const loopStages = {
    ch: [[2,0],[2,1]], sl: [[1,0,true],[2,2,true]],
    sc: [[1,0,true],[2,0,true],[2,2]], hdc: [[2,0],[3,0,true],[3,3]],
    dc: [[2,0],[3,0,true],[3,2],[2,2]], tr: [[3,0],[4,0,true],[4,2]],
    dtr: [[4,0],[5,0,true],[5,2]], sc2tog: [[2,0,true],[3,0,true],[3,3]],
    dc2tog: [[3,2,true],[4,2,true],[3,3]]
  };

  const references = [
    {id:'symbols', title:'Craft Yarn Council chart symbols', url:'https://www.craftyarncouncil.com/standards/crochet-chart-symbols', keywords:'chart diagram symbol legend'},
    {id:'terms', title:'Craft Yarn Council crochet abbreviations', url:'https://www.craftyarncouncil.com/standards/crochet-abbreviations', keywords:'terms abbreviations us uk stitch'},
    {id:'hooks', title:'Craft Yarn Council hook sizes', url:'https://www.craftyarncouncil.com/standards/hooks-and-needles', keywords:'hook yarn gauge tension size'},
    {id:'images', title:'Openverse openly licensed images', url:'https://openverse.org/', keywords:'image photo picture reference'}
  ];
  const bookmarkKey = 'studio.crochet.references';
  let bookmarks = [];
  try {
    const saved = JSON.parse(localStorage.getItem(bookmarkKey) || '[]');
    if (Array.isArray(saved)) bookmarks = saved.filter(id => references.some(ref => ref.id === id));
  } catch {}

  function renderHelp() {
    const question = get('Question').value.trim();
    const answers = get('Answers');
    answers.replaceChildren();
    for (const topic of crochetHelp.filter(item => !question || item.match.test(question))) {
      const item = element('article', '', answers);
      element('h4', topic.title, item);
      element('p', topic.text, item);
    }
    if (question) {
      const terms = question.toLowerCase().match(/[a-z0-9-]+/g) || [];
      const candidates = stitchEntries.filter(entry => {
        const text = question.toLowerCase();
        return text.includes(entry.us.toLowerCase()) || text.includes(entry.uk.toLowerCase())
          || terms.includes(entry.id) || terms.includes(entry.ukCode);
      }).slice(0, 6);
      for (const entry of candidates) {
        element('button', 'Read ' + entry.us + ' (US)', answers).onclick = () => openEntry(entry.id);
      }
      if (!answers.childElementCount) element('p', 'No matching offline guidance. Try a stitch name, abbreviation, or a shorter question.', answers);
    }
    function list(target, items) {
      target.replaceChildren();
      for (const ref of items) {
        const item = element('li', '', target);
        const link = element('a', ref.title, item);
        link.href = ref.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const saved = bookmarks.includes(ref.id);
        element('button', saved ? 'Remove bookmark' : 'Bookmark', item).onclick = () => {
          const next = saved ? bookmarks.filter(id => id !== ref.id) : [...bookmarks, ref.id];
          try {
            localStorage.setItem(bookmarkKey, JSON.stringify(next));
            bookmarks = next;
            get('ReferenceStatus').textContent = saved ? 'Bookmark removed.' : 'Reference saved on this device.';
            renderHelp();
          } catch { get('ReferenceStatus').textContent = 'This device could not save the bookmark.'; }
        };
      }
    }
    const words = question.toLowerCase().split(/\W+/).filter(word => word.length > 2);
    const relevant = references.filter(ref => words.some(word => ref.keywords.includes(word)));
    list(get('Links'), relevant.length ? relevant : references);
    list(get('Bookmarks'), references.filter(ref => bookmarks.includes(ref.id)));
  }

  function openEntry(id) {
    get('Search').value = '';
    get('Category').value = '';
    showLibrary();
    const entry = document.getElementById('stitchEntry-' + id);
    entry.open = true;
    entry.querySelector('summary').focus();
    entry.scrollIntoView({block:'nearest'});
  }

  function showLibrary() {
    const results = get('Entries');
    results.replaceChildren();
    const entries = searchStitches(get('Search').value, get('Terms').value, get('Category').value);
    if (!entries.length) element('p', 'No matching stitches.', results);
    for (const entry of entries) {
      const card = element('details', '', results);
      card.id = 'stitchEntry-' + entry.id;
      element('summary', 'US ' + entry.us + ' (' + usCode(entry) + ') · UK ' +
        entry.uk + ' (' + entry.ukCode + ')', card).prepend(glyph(entry));
      const steps = element('ol', '', card);
      entry.steps.forEach((step, index) => {
        const item = element('li', step, steps);
        const stage = loopStages[entry.id]?.[index];
        if (stage) item.append(loopDiagram(...stage));
      });
      element('p', entry.category + ' · Practice example · ' + entry.example, card);
    }
  }

  function refresh() {
    if (!crop) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0);
    ctx.lineWidth = 2;
    ctx.font = 'bold 14px sans-serif';
    marks.forEach(({box}, index) => {
      ctx.strokeStyle = '#15645e';
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = '#15645e';
      ctx.fillRect(box.x, box.y, 26, 17);
      ctx.fillStyle = '#fff';
      ctx.fillText(index + 1, box.x + 2, box.y + 13);
    });
    ctx.strokeStyle = '#dd6200';
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
    const zoom = get('Zoom');
    const scale = Math.min(620 / crop.w, 380 / crop.h);
    zoom.width = Math.max(1, Math.round(crop.w * scale));
    zoom.height = Math.max(1, Math.round(crop.h * scale));
    zoom.getContext('2d').drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, zoom.width, zoom.height);
  }

  function setCrop(box) {
    const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));
    const x = clamp(box.x, 0, source.width - 1);
    const y = clamp(box.y, 0, source.height - 1);
    crop = {x, y, w:clamp(box.w, 1, source.width - x), h:clamp(box.h, 1, source.height - y)};
    cropFields.forEach((field, index) => { field.value = Object.values(crop)[index]; });
    refresh();
  }

  function wholeImage() { setCrop({x:0, y:0, w:source.width, h:source.height}); }

  function loadSource(image, width, height) {
    const scale = Math.min(1, 1200 / Math.max(width, height));
    original.width = Math.max(1, Math.round(width * scale));
    original.height = Math.max(1, Math.round(height * scale));
    original.getContext('2d').drawImage(image, 0, 0, original.width, original.height);
    angle = 0;
    for (const field of ['Angle', 'Exposure', 'Contrast']) get(field).value = 0;
    marks = [];
    get('Preview').hidden = false;
    status('Image ready. Crop around the area you want to inspect.');
    renderAdjustedPhoto(true);
  }

  function renderAdjustedPhoto(resetCrop) {
    const radians = angle * Math.PI / 180;
    const sin = Math.abs(Math.sin(radians)), cos = Math.abs(Math.cos(radians));
    const {width, height} = original;
    source.width = canvas.width = Math.max(1, Math.round(width * cos + height * sin));
    source.height = canvas.height = Math.max(1, Math.round(width * sin + height * cos));
    const ctx = source.getContext('2d', {willReadFrequently:true});
    ctx.save();
    ctx.translate(source.width / 2, source.height / 2);
    ctx.rotate(radians);
    ctx.drawImage(original, -width / 2, -height / 2);
    ctx.restore();
    const exposure = get('Exposure').valueAsNumber, contrast = get('Contrast').valueAsNumber;
    if (exposure || contrast) {
      const pixels = ctx.getImageData(0, 0, source.width, source.height);
      adjustScanPixels(pixels.data, exposure, contrast);
      ctx.putImageData(pixels, 0, 0);
    }
    if (resetCrop) wholeImage();
    else for (const mark of marks) mark.matches = [];
    showMarks();
  }

  function setAngle(value, reset = false) {
    if (!crop || !Number.isFinite(value)) { get('Angle').value = angle; return; }
    const next = ((Math.round(value) + 180) % 360 + 360) % 360 - 180;
    if (next !== angle && marks.length && !confirm('Rotation clears current marks. Rotate this photo?')) {
      get('Angle').value = angle;
      return;
    }
    const rotated = next !== angle;
    if (rotated) marks = [];
    angle = next;
    get('Angle').value = angle;
    if (reset) { get('Exposure').value = 0; get('Contrast').value = 0; }
    renderAdjustedPhoto(rotated || reset);
  }

  async function readPhoto(file) {
    if (!file) return;
    const request = ++imageRequest;
    if (file.size > 30 * 1024 * 1024) {
      status('Choose an image smaller than 30 MB.');
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (request === imageRequest) loadSource(image, image.naturalWidth, image.naturalHeight);
    } catch {
      if (request === imageRequest) status('Could not open that photo. Try a JPEG, PNG, or WebP image.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function stopCamera() {
    cameraRequest++;
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    video.srcObject = null;
    get('Live').hidden = true;
  }

  function point(event) {
    const bounds = canvas.getBoundingClientRect();
    return {x:(event.clientX - bounds.left) * canvas.width / bounds.width,
      y:(event.clientY - bounds.top) * canvas.height / bounds.height};
  }

  function getTemplates() {
    if (templates) return templates;
    const sample = document.createElement('canvas');
    sample.width = sample.height = 48;
    const ctx = sample.getContext('2d', {willReadFrequently:true});
    const shapes = stitchEntries.filter(entry => supported.has(entry.id))
      .map(entry => ({id:entry.id, path:entry.path}));
    shapes.push({id:'sc', path:'M24 10v28M10 24h28'});
    templates = shapes.flatMap(({id,path}) => [2, 3, 5].map(lineWidth => {
      ctx.clearRect(0, 0, 48, 48);
      ctx.lineCap = 'round';
      ctx.lineWidth = lineWidth;
      ctx.stroke(new Path2D(path));
      const mask = inkMask(ctx.getImageData(0, 0, 48, 48).data, 48, 48);
      const box = components(mask, 48, 48).sort((a,b) => b.area - a.area)[0];
      return {id, pixels:normalizedMask(mask, 48, box)};
    }));
    return templates;
  }

  function scan(asRegion = false) {
    if (mode.value === 'fabric') {
      status('Uncertain. Compare the enlarged photo with a known swatch or the stitch guide. Yarn texture, tension, viewing angle, and front versus back can hide the stitch structure.');
      return;
    }
    const {x,y,w,h} = crop;
    const pixels = source.getContext('2d').getImageData(x,y,w,h).data;
    const mask = inkMask(pixels, w, h);
    let boxes = components(mask, w, h).filter(box => box.area >= 9);
    if (boxes.length > 100) {
      status('Too many marks. Crop a smaller section or remove existing marks.');
      return;
    }
    if (asRegion && boxes.length) {
      const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
      const right = Math.max(...boxes.map(box => box.x + box.w)), bottom = Math.max(...boxes.map(box => box.y + box.h));
      boxes = [{x:left, y:top, w:right-left, h:bottom-top}];
    }
    if (!boxes.length || (mode.value === 'symbol' && boxes.length !== 1)) {
      status('Uncertain. Try a tighter crop with a clean background, or mark the crop manually.');
      return;
    }
    const detected = boxes.map(box => ({
      box:{...box, x:x + box.x, y:y + box.y},
      matches:rankSymbols(mask, w, box, getTemplates()), id:'', confirmed:false
    }));
    const newMarks = detected.filter(next => !marks.some(mark => sameScanRegion(mark.box, next.box)));
    if (mode.value !== 'symbol' && marks.length + newMarks.length > 100) {
      status('Too many marks. Crop a smaller section or remove existing marks.');
      return;
    }
    if (mode.value === 'symbol' && marks.some(mark => mark.confirmed)) {
      status('Remove the confirmed mark before replacing it with a new scan.');
      return;
    }
    marks = mode.value === 'symbol' ? detected : marks.concat(newMarks);
    status('Review the marks against the pattern legend. Touching symbols may share a box and specks can create extra boxes.');
    showMarks();
  }

  function showMarks() {
    refresh();
    const results = get('Results');
    results.replaceChildren();
    if (mode.value === 'fabric') {
      element('p', 'Experimental visual comparison. A validated fabric classifier is unavailable.', results);
      const clues = element('ul', '', results);
      element('li', 'Short, closely packed posts: compare with US single crochet (UK double crochet).', clues);
      element('li', 'Taller posts with open gaps: compare with US double or treble crochet (UK treble or double treble).', clues);
      element('li', 'Several posts fanning from one base: compare with a shell. Look for the shared base on the reverse side as well.', clues);
      element('p', 'For a side-by-side comparison, photograph the unknown fabric next to a labeled swatch in similar yarn and light.', results);
      return;
    }
    const summary = element('p', '', results);
    const updateSummary = () => {
      const confirmed = marks.filter(mark => mark.confirmed);
      summary.textContent = confirmed.length
        ? 'Confirmed in mark order · ' + confirmed.map(mark => mark.id).join(' · ') : '';
    };
    updateSummary();
    marks.forEach((mark, index) => {
      const card = element('article', '', results);
      element('h4', 'Mark ' + (index + 1) + ' · left ' + mark.box.x + ', top ' + mark.box.y, card);
      if (mark.matches.length) {
        element('p', matchConfidence(mark.matches) + ' · Visual overlap scores', card);
        const list = element('ol', '', card);
        for (const {id,score} of mark.matches) {
          const entry = known.get(id);
          element('li', entry.us + ' (' + id + ') · ' + Math.round(score * 100) + '% overlap', list)
            .prepend(glyph(entry));
        }
      }
      const label = element('label', 'Stitch from pattern legend', card);
      const select = element('select', '', label);
      element('option', 'Unidentified', select).value = '';
      stitchEntries.forEach(entry => {
        element('option', entry.us + ' (' + usCode(entry) + ') / ' + entry.uk + ' (' + entry.ukCode + ')', select).value = entry.id;
      });
      select.value = mark.id;
      const confirm = element('input', '', element('label', 'Confirmed against legend', card));
      confirm.type = 'checkbox';
      confirm.checked = mark.confirmed;
      confirm.disabled = !mark.id;
      select.onchange = () => {
        mark.id = select.value;
        mark.confirmed = confirm.checked = false;
        confirm.disabled = !mark.id;
        updateSummary();
        readInstructions.hidden = !mark.id;
      };
      confirm.onchange = () => { mark.confirmed = confirm.checked; updateSummary(); };
      const actions = element('div', '', card);
      const readInstructions = element('button', 'Read stitch instructions', actions);
      readInstructions.hidden = !mark.id;
      readInstructions.onclick = () => openEntry(mark.id);
      element('button', 'Compare this box again', actions).onclick = () => {
        const {x,y,w,h} = mark.box;
        const rgba = source.getContext('2d').getImageData(x,y,w,h).data;
        const mask = inkMask(rgba,w,h);
        mark.matches = mask.some(Boolean) ? rankSymbols(mask,w,{x:0,y:0,w,h},getTemplates()) : [];
        showMarks();
      };
      actions.className = 'stitch-controls';
      element('button', 'Select this box', actions).onclick = () => {
        setCrop(mark.box);
        cropFields[0].focus();
      };
      element('button', 'Move box to crop', actions).onclick = () => {
        mark.box = {...crop};
        mark.matches = [];
        mark.confirmed = false;
        showMarks();
      };
      if (index > 0) element('button', 'Move earlier in list', actions).onclick = () => {
        [marks[index-1], marks[index]] = [marks[index], marks[index-1]];
        showMarks();
      };
      element('button', 'Remove', actions).onclick = () => { marks.splice(index, 1); showMarks(); };
    });
  }

  document.getElementById('openStitchStudio').onclick = () => dialog.showModal();
  dialog.addEventListener('close', stopCamera);
  get('Search').oninput = showLibrary;
  get('Terms').onchange = showLibrary;
  get('Category').onchange = showLibrary;
  get('Question').oninput = renderHelp;
  mode.onchange = () => {
    stopCamera();
    get('Photo').hidden = ['library','help'].includes(mode.value);
    get('Help').hidden = mode.value !== 'help';
    if (!get('Help').hidden) renderHelp();
    get('Add').hidden = get('AnalyzeRegion').hidden = mode.value === 'fabric';
    get('Analyze').textContent = mode.value === 'fabric' ? 'Check fabric photo' : 'Scan crop';
    status(crop ? 'Image ready. Adjust the crop for this tool.' : 'Choose an image to start.');
    showMarks();
  };
  for (const id of ['File', 'Capture']) get(id).onchange = event => {
    readPhoto(event.target.files[0]);
    event.target.value = '';
  };
  get('Camera').onclick = async () => {
    stopCamera();
    const request = cameraRequest;
    try {
      const live = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}, audio:false});
      if (request !== cameraRequest || !dialog.open) {
        live.getTracks().forEach(track => track.stop());
        return;
      }
      stream = live;
      video.srcObject = stream;
      get('Live').hidden = false;
      status('Camera ready. Take a photo to start.');
    } catch {
      if (request === cameraRequest) status('Camera unavailable or access denied. Open a saved photo instead.');
    }
  };
  get('Snap').onclick = () => {
    if (!video.videoWidth) { status('Wait for the camera preview and try again.'); return; }
    imageRequest++;
    loadSource(video, video.videoWidth, video.videoHeight);
    stopCamera();
  };
  get('Stop').onclick = () => { stopCamera(); status('Camera stopped.'); };
  canvas.onpointerdown = event => {
    drag = point(event);
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = event => {
    if (!drag) return;
    const {x,y} = point(event);
    setCrop({x:Math.min(x,drag.x), y:Math.min(y,drag.y), w:Math.abs(x-drag.x), h:Math.abs(y-drag.y)});
  };
  canvas.onpointerup = canvas.onpointercancel = () => { drag = undefined; };
  cropFields.forEach(field => field.onchange = () => {
    const [x,y,w,h] = cropFields.map(input => input.valueAsNumber);
    if ([x,y,w,h].every(Number.isFinite)) setCrop({x,y,w,h});
    else setCrop(crop);
  });
  get('Reset').onclick = wholeImage;
  get('Analyze').onclick = () => scan();
  get('AnalyzeRegion').onclick = () => scan(true);
  get('Angle').onchange = () => setAngle(get('Angle').valueAsNumber);
  get('RotateLeft').onclick = () => setAngle(angle - 90);
  get('RotateRight').onclick = () => setAngle(angle + 90);
  get('ResetPhoto').onclick = () => setAngle(0, true);
  for (const field of ['Exposure', 'Contrast']) get(field).onchange = () => {
    if (crop) renderAdjustedPhoto(false);
  };
  get('Add').onclick = () => {
    if (marks.length >= 100 && mode.value === 'chart') { status('Remove a mark before adding another.'); return; }
    if (mode.value === 'symbol') {
      if (marks.some(mark => mark.confirmed)) {
        status('Remove the confirmed mark before replacing it with a manual mark.');
        return;
      }
      marks = [];
    }
    marks.push({box:{...crop}, matches:[], id:'', confirmed:false});
    showMarks();
  };
  showLibrary();
})();
