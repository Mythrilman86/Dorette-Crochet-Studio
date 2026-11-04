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
      const sx = Math.floor((x + .5 - offsetX) / scale);
      const sy = Math.floor((y + .5 - offsetY) / scale);
      if (sx >= 0 && sx < box.w && sy >= 0 && sy < box.h) {
        output[y * MASK_SIDE + x] = mask[(box.y + sy) * width + box.x + sx];
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

if (typeof module !== 'undefined') module.exports = {inkMask, components, normalizedMask, rankSymbols, matchConfidence};
