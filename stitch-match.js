/* Local, shape-only comparison. Scores measure mask overlap, never probability. */
const MASK_SIDE = 32;

function inkMask(rgba, width, height) {
  const luminance = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < luminance.length; i++) {
    const offset = i * 4;
    const alpha = rgba[offset + 3] / 255;
    const gray = Math.round(255 * (1 - alpha) + alpha *
      (rgba[offset] * .299 + rgba[offset + 1] * .587 + rgba[offset + 2] * .114));
    luminance[i] = gray;
    histogram[gray]++;
    total += gray;
  }
  let count = 0, sum = 0, best = 0, threshold = -1;
  for (let gray = 0; gray < 255; gray++) {
    count += histogram[gray];
    sum += gray * histogram[gray];
    const rest = luminance.length - count;
    if (!count || !rest) continue;
    const gap = (total - sum) / rest - sum / count;
    const variance = count * rest * gap * gap;
    if (gap >= 45 && variance > best) {
      best = variance;
      threshold = gray;
    }
  }
  return luminance.map(gray => Number(gray <= threshold));
}

function components(mask, width, height) {
  const remaining = mask.slice();
  const boxes = [];
  for (let start = 0; start < remaining.length; start++) {
    if (!remaining[start]) continue;
    const queue = [start];
    remaining[start] = 0;
    let left = width, top = height, right = 0, bottom = 0;
    for (let index = 0; index < queue.length; index++) {
      const position = queue[index];
      const x = position % width, y = Math.floor(position / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, next = ny * width + nx;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || !remaining[next]) continue;
          remaining[next] = 0;
          queue.push(next);
        }
      }
    }
    if (queue.length >= 5) boxes.push({x:left, y:top, w:right-left+1, h:bottom-top+1, area:queue.length});
  }
  return boxes;
}

function normalizedMask(mask, width, box) {
  const output = new Uint8Array(MASK_SIDE ** 2);
  const scale = 26 / Math.max(box.w, box.h);
  const offsetX = (MASK_SIDE - box.w * scale) / 2;
  const offsetY = (MASK_SIDE - box.h * scale) / 2;
  for (let y = 0; y < MASK_SIDE; y++) {
    for (let x = 0; x < MASK_SIDE; x++) {
      if (scale >= 1) {
        const sx = Math.floor((x + .5 - offsetX) / scale);
        const sy = Math.floor((y + .5 - offsetY) / scale);
        if (sx >= 0 && sx < box.w && sy >= 0 && sy < box.h) {
          output[y * MASK_SIDE + x] = mask[(box.y + sy) * width + box.x + sx];
        }
      } else {
        // Preserve hairline strokes when reducing a large source symbol.
        const left = Math.max(0, Math.floor((x - offsetX) / scale));
        const right = Math.min(box.w, Math.ceil((x + 1 - offsetX) / scale));
        const top = Math.max(0, Math.floor((y - offsetY) / scale));
        const bottom = Math.min(box.h, Math.ceil((y + 1 - offsetY) / scale));
        for (let sy = top; sy < bottom && !output[y * MASK_SIDE + x]; sy++) {
          for (let sx = left; sx < right; sx++) {
            if (!mask[(box.y + sy) * width + box.x + sx]) continue;
            output[y * MASK_SIDE + x] = 1;
            break;
          }
        }
      }
    }
  }
  return output;
}

function rankSymbols(mask, width, box, templates) {
  const sample = normalizedMask(mask, width, box);
  const scores = new Map();
  for (const {id, pixels} of templates) {
    let intersection = 0, union = 0;
    for (let i = 0; i < sample.length; i++) {
      intersection += sample[i] & pixels[i];
      union += sample[i] | pixels[i];
    }
    scores.set(id, Math.max(scores.get(id) || 0, union ? intersection / union : 0));
  }
  return [...scores].map(([id, score]) => ({id, score}))
    .sort((a, b) => b.score - a.score).slice(0, 3);
}

function matchConfidence(matches) {
  return matches[0]?.score >= .60 && matches[0].score - (matches[1]?.score || 0) >= .10
    ? 'Clear shape match' : 'Uncertain';
}

function adjustScanPixels(rgba, exposure, contrast) {
  const factor = 1 + contrast / 100;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const index = offset + channel;
      rgba[index] = (rgba[index] - 128) * factor + 128 + exposure;
    }
  }
  return rgba;
}

function sameScanRegion(a, b) {
  const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return width * height >= .75 * Math.min(a.w * a.h, b.w * b.h);
}

function buildStitchTemplates(entries) {
  const supported = new Set(["ch", "sc", "hdc", "dc", "tr", "dtr"]);
  const sample = document.createElement('canvas');
  sample.width = sample.height = 48;
  const ctx = sample.getContext('2d', {willReadFrequently:true});
  const shapes = entries.filter(entry => supported.has(entry.id))
    .map(entry => ({id:entry.id, path:entry.path}));
  shapes.push({id:'sc', path:'M24 10v28M10 24h28'});
  return shapes.flatMap(({id,path}) => [2, 3, 5].map(lineWidth => {
    ctx.clearRect(0, 0, 48, 48);
    ctx.lineCap = 'round';
    ctx.lineWidth = lineWidth;
    ctx.stroke(new Path2D(path));
    const mask = inkMask(ctx.getImageData(0, 0, 48, 48).data, 48, 48);
    const box = components(mask, 48, 48).sort((a,b) => b.area - a.area)[0];
    return {id, pixels:normalizedMask(mask, 48, box)};
  }));
}

if (typeof module !== 'undefined') module.exports = {inkMask, components, normalizedMask, rankSymbols, matchConfidence, adjustScanPixels, sameScanRegion};
