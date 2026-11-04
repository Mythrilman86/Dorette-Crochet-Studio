(() => {
  const get = id => document.getElementById('stitch' + id);
  const dialog = get('Studio');
  const mode = get('Mode');
  const canvas = get('Image');
  const source = document.createElement('canvas');
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

  function showLibrary() {
    const results = get('Entries');
    results.replaceChildren();
    const entries = searchStitches(get('Search').value, get('Terms').value);
    if (!entries.length) element('p', 'No matching stitches.', results);
    for (const entry of entries) {
      const card = element('details', '', results);
      element('summary', 'US ' + entry.us + ' (' + usCode(entry) + ') · UK ' +
        entry.uk + ' (' + entry.ukCode + ')', card).prepend(glyph(entry));
      const steps = element('ol', '', card);
      entry.steps.forEach((step, index) => {
        const item = element('li', step, steps);
        const stage = loopStages[entry.id]?.[index];
        if (stage) item.append(loopDiagram(...stage));
      });
      element('p', 'Practice example · ' + entry.example, card);
    }
  }

  function refresh() {
    if (!crop) return;
    const ctx = canvas.getContext('2d');
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
    source.width = canvas.width = Math.max(1, Math.round(width * scale));
    source.height = canvas.height = Math.max(1, Math.round(height * scale));
    source.getContext('2d', {willReadFrequently:true}).drawImage(image, 0, 0, source.width, source.height);
    marks = [];
    get('Preview').hidden = false;
    status('Image ready. Crop around the area you want to inspect.');
    wholeImage();
    showMarks();
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

  function scan() {
    if (mode.value === 'fabric') {
      status('Uncertain. Compare the enlarged photo with a known swatch or the stitch guide. Yarn texture, tension, viewing angle, and front versus back can hide the stitch structure.');
      return;
    }
    const {x,y,w,h} = crop;
    const pixels = source.getContext('2d').getImageData(x,y,w,h).data;
    const mask = inkMask(pixels, w, h);
    const boxes = components(mask, w, h).filter(box => box.area >= 9);
    if (!boxes.length || (mode.value === 'symbol' && boxes.length !== 1)) {
      status('Uncertain. Try a tighter crop with a clean background, or mark the crop manually.');
      return;
    }
    if (boxes.length > 100 || marks.length + boxes.length > 100) {
      status('Too many marks. Crop a smaller section or remove existing marks.');
      return;
    }
    const detected = boxes.map(box => ({
      box:{...box, x:x + box.x, y:y + box.y},
      matches:rankSymbols(mask, w, box, getTemplates()), id:'', confirmed:false
    }));
    marks = mode.value === 'symbol' ? detected : marks.concat(detected);
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
      };
      confirm.onchange = () => { mark.confirmed = confirm.checked; updateSummary(); };
      const actions = element('div', '', card);
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
  mode.onchange = () => {
    stopCamera();
    get('Photo').hidden = mode.value === 'library';
    get('Add').hidden = mode.value === 'fabric';
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
  get('Analyze').onclick = scan;
  get('Add').onclick = () => {
    if (marks.length >= 100 && mode.value === 'chart') { status('Remove a mark before adding another.'); return; }
    if (mode.value === 'symbol') marks = [];
    marks.push({box:{...crop}, matches:[], id:'', confirmed:false});
    showMarks();
  };
  showLibrary();
})();
