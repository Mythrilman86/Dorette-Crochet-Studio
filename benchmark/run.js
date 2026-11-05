'use strict';

const conditions = [
  {name:'original', tilt:0, contrast:1, correction:0},
  {name:'tilted', tilt:12, contrast:1, correction:0},
  {name:'straightened', tilt:12, contrast:1, correction:-12},
  {name:'low contrast', tilt:0, contrast:.35, correction:0},
  {name:'contrast corrected', tilt:0, contrast:.35, correction:0, boost:100}
];

function rasterize(image, angle, contrast, boost = 0, correction = 0) {
  const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, image.naturalWidth * scale);
  const height = Math.max(1, image.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.ceil(Math.hypot(width, height)) + 12;
  const context = canvas.getContext('2d', {willReadFrequently:true});
  context.fillStyle = 'white';
  context.fillRect(0,0,canvas.width,canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(angle * Math.PI / 180);
  context.drawImage(image, -width / 2, -height / 2, width, height);
  let raster = canvas;
  if (correction) {
    raster = document.createElement('canvas');
    raster.width = raster.height = canvas.width;
    const corrected = raster.getContext('2d', {willReadFrequently:true});
    corrected.fillStyle = 'white';
    corrected.fillRect(0,0,raster.width,raster.height);
    corrected.translate(raster.width / 2, raster.height / 2);
    corrected.rotate(correction * Math.PI / 180);
    corrected.drawImage(canvas,-canvas.width / 2,-canvas.height / 2);
  }
  const pixels = raster.getContext('2d').getImageData(0,0,raster.width,raster.height);
  if (contrast !== 1) {
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        pixels.data[i + channel] = 255 - (255 - pixels.data[i + channel]) * contrast;
      }
    }
  }
  if (boost) adjustScanPixels(pixels.data, 0, boost);
  return pixels;
}

function annotatedRegions(image, regions, templates, preserveThin) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', {willReadFrequently:true});
  context.drawImage(image, 0, 0);
  return regions.map(({label,x,y,w,h}) => {
    const rgba = context.getImageData(x,y,w,h).data;
    const mask = inkMask(rgba,w,h);
    const boxes = components(mask,w,h).filter(box => box.area >= 9);
    const scores = boxes.length === 1 ? rankSymbols(mask,w,boxes[0],templates,preserveThin) : [];
    return {label, regions:boxes.length, matches:scores.map(match=>match.id),
      confidence:scores.length ? matchConfidence(scores) : 'Rejected'};
  });
}

function scanSample(image, item, templates, preserveThin = false) {
  if (item.kind === 'legend' || item.kind === 'fabric') {
    return [{condition:'original', outcome:'not classified by the template matcher'}];
  }
  return (item.kind === 'symbol' ? conditions : conditions.slice(0, 1)).map(condition => {
    const pixels = rasterize(image, condition.tilt, condition.contrast, condition.boost, condition.correction);
    const mask = inkMask(pixels.data, pixels.width, pixels.height);
    const boxes = components(mask, pixels.width, pixels.height).filter(box => box.area >= 9);
    const scores = item.kind === 'symbol' && boxes.length === 1
      ? rankSymbols(mask, pixels.width, boxes[0], templates, preserveThin) : [];
    return {
      condition:condition.name, regions:boxes.length, matches:scores.map(match => match.id),
      ...(item.regions ? {manualCrops:annotatedRegions(image,item.regions,templates,preserveThin)} : {}),
      scores:scores.map(match => Number(match.score.toFixed(3))),
      confidence:scores.length ? matchConfidence(scores) : 'Rejected'
    };
  });
}

function summarize(results) {
  const totals = {};
  for (const item of results.filter(item => item.kind === 'symbol')) {
    for (const run of item.runs) {
      const key = item.split + ' / ' + run.condition;
      const tally = totals[key] ??= {count:0, top1:0, top3:0, wrongClear:0, uncertain:0, rejected:0};
      tally.count++;
      if (run.matches[0] === item.label) tally.top1++;
      if (run.matches.includes(item.label)) tally.top3++;
      if (run.confidence === 'Clear shape match' && run.matches[0] !== item.label) tally.wrongClear++;
      if (run.confidence === 'Uncertain') tally.uncertain++;
      if (run.confidence === 'Rejected') tally.rejected++;
    }
  }
  return totals;
}

async function benchmark(files) {
  const catalogFile = files.get('catalog.json');
  if (!catalogFile) throw new Error('Select catalog.json with the images.');
  const catalog = JSON.parse(await catalogFile.text());
  const templates = buildStitchTemplates(stitchEntries);
  const experimentalTemplates = buildStitchTemplates(stitchEntries, true);
  const variedTemplates = buildStitchTemplates(stitchEntries, false, true);
  const results = [], experimental = [], varied = [], missing = [];
  for (const item of catalog) {
    const rendition = item.testedFile && files.get(item.testedFile);
    const file = rendition || files.get(item.file);
    if (!file) { missing.push(item.file); continue; }
    const typed = new Blob([file], {type:rendition ? item.testedMime : item.mime});
    const url = URL.createObjectURL(typed);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      results.push({...item,runs:scanSample(image,item,templates)});
      experimental.push({...item,runs:scanSample(image,item,experimentalTemplates,true)});
      varied.push({...item,runs:scanSample(image,item,variedTemplates)});
    } finally { URL.revokeObjectURL(url); }
  }
  return {defaultTotals:summarize(results),experimentalTotals:summarize(experimental),variedTotals:summarize(varied),missing,results,experimental,varied};
}

document.getElementById('run').addEventListener('click', async event => {
  const output = document.getElementById('results');
  event.target.disabled = true;
  output.textContent = 'Running local benchmark…';
  try {
    const files = new Map([...document.getElementById('dataset').files].map(file => [file.name,file]));
    output.textContent = JSON.stringify(await benchmark(files), null, 2);
  } catch (error) {
    output.textContent = 'Benchmark failed: ' + error.message;
  } finally { event.target.disabled = false; }
});
