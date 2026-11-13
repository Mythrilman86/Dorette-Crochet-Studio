/* Isolated feasibility kernel. Not imported by Studio, not a complete authoring app. */
const encoder = new TextEncoder();
const maxBytes = 4 * 1024 * 1024;
const id = value => typeof value === 'string' && /^[a-z0-9-]{1,64}$/i.test(value);
const text = (value, max, label) => {
  if (typeof value !== 'string' || value.length > max) throw Error(`Invalid ${label}.`);
  return value;
};
const hash = async value => {
  if (!globalThis.crypto?.subtle) throw Error('SHA-256 is unavailable. No unprotected backup was created.');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
};
function validateChart(chart) {
  if (!chart || !Number.isInteger(chart.cols) || !Number.isInteger(chart.rows) || chart.cols < 1 || chart.cols > 200 || chart.rows < 1 || chart.rows > 300 || !Array.isArray(chart.cells) || chart.cells.length !== chart.cols * chart.rows || !Array.isArray(chart.palette) || !chart.palette.length || chart.palette.length > 12) throw Error('Invalid chart geometry.');
  if (chart.cells.some(c => !Number.isInteger(c) || c < 0 || c >= chart.palette.length)) throw Error('Invalid chart colors.');
  if (chart.palette.some(c => !c || !/^#[0-9a-f]{6}$/i.test(c.hex) || typeof c.name !== 'string' || c.name.length > 100 || typeof c.symbol !== 'string' || c.symbol.length > 8)) throw Error('Invalid palette.');
}
// Reuse the exact shared compose, runs and counts functions via a read-only adapter.
export function captureChart(project, shared) {
  validateChart(project);
  const input = structuredClone(project);
  const cells = shared.compose(input);
  const chart = {
    cols: input.cols, rows: input.rows, cells,
    palette: input.palette.map(({hex, name, symbol}) => ({hex, name, symbol})),
    workDirection: {first: input.workDirection?.first === 'ltr' ? 'ltr' : 'rtl', alternate: input.workDirection?.alternate !== false}
  };
  validateChart(chart);
  return chart;
}
export function chartFacts(chart, shared) {
  validateChart(chart);
  // No gauge, technique, turning chains, yarn quantities or construction are invented.
  return {cols: chart.cols, rows: chart.rows, total: chart.cols * chart.rows,
    counts: shared.counts(chart),
    colorRows: Array.from({length: chart.rows}, (_, i) => ({row: i + 1, direction: shared.direction(chart, i + 1), runs: shared.runs(chart, i + 1)}))};
}
function cleanDraft(value) {
  if (!value || !id(value.id) || !Number.isInteger(value.revision) || value.revision < 0 || !['graph', 'garment', 'amigurumi'].includes(value.type)) throw Error('Unsupported authoring draft.');
  for (const key of ["assets", "photos", "sizes", "templates", "snapshots"]) if (value[key] !== undefined) throw Error("Prototype does not support " + key + "; no partial backup was created.");
  const metadata = value.metadata;
  if (!metadata || !['US', 'UK'].includes(metadata.terminology)) throw Error('Choose US or UK terminology.');
  const cleanMetadata = {};
  for (const [key, max] of Object.entries({title: 200, designer: 200, description: 10000, technique: 1000, materials: 10000, gauge: 2000, measurements: 4000, terminology: 2})) cleanMetadata[key] = text(metadata[key], max, key);
  if (!Array.isArray(value.sections) || value.sections.length > 100) throw Error('Too many or invalid sections.');
  let steps = 0;
  const identifiers = new Set();
  const sections = value.sections.map(section => {
    if (!id(section.id) || identifiers.has(section.id)) throw Error('Invalid or duplicate section identity.');
    identifiers.add(section.id);
    const title = text(section.title, 200, 'section title');
    if (!Array.isArray(section.steps) || (steps += section.steps.length) > 2000) throw Error('Too many or invalid steps.');
    return {id: section.id, title, steps: section.steps.map(step => {
      if (!id(step.id) || identifiers.has(step.id) || !['row', 'round', 'paragraph'].includes(step.kind)) throw Error('Invalid or duplicate step identity.');
      identifiers.add(step.id);
      if (step.number !== null && (!Number.isInteger(step.number) || step.number < 1 || step.number > 100000)) throw Error('Invalid row or round number.');
      if (step.confirmedCount !== null && (!Number.isInteger(step.confirmedCount) || step.confirmedCount < 0 || step.confirmedCount > 1000000)) throw Error('Invalid author-confirmed count.');
      if (!Array.isArray(step.references) || step.references.length > 100 || step.references.some(ref => !id(ref))) throw Error('Invalid step references.');
      return {id: step.id, kind: step.kind, number: step.number, text: text(step.text, 10000, 'step text'), confirmedCount: step.confirmedCount, references: step.references.slice()};
    })};
  });
  let source = null;
  if (value.source !== null) {
    if (!id(value.source?.projectId) || typeof value.source?.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.source.fingerprint)) throw Error('Invalid linked-source identity.');
    validateChart(value.source.chart);
    const c = value.source.chart;
    source = {projectId: value.source.projectId, fingerprint: value.source.fingerprint,
      chart: {cols: c.cols, rows: c.rows, cells: c.cells.slice(), palette: c.palette.map(({hex, name, symbol}) => ({hex, name, symbol})), workDirection: {first: c.workDirection?.first === 'ltr' ? 'ltr' : 'rtl', alternate: c.workDirection?.alternate !== false}}};
  }
  return {id: value.id, revision: value.revision, type: value.type, metadata: cleanMetadata, sections, source};
}
export function createDraft(idValue, type = 'graph') {
  return cleanDraft({id: idValue, revision: 0, type, metadata: {title: '', designer: '', description: '', technique: '', materials: '', gauge: '', measurements: '', terminology: 'US'}, sections: [], source: null});
}
export async function refreshChart(draft, project, shared, confirmed = false) {
  if (!confirmed) throw Error('Review and confirm chart refresh first.');
  const clean = cleanDraft(draft);
  if (!id(project.id)) throw Error('Invalid project identity.');
  if (clean.source && clean.source.projectId !== project.id) throw Error('Select the linked project; relinking requires a separate review.');
  const chart = captureChart(project, shared);
  clean.source = {projectId: project.id, fingerprint: await hash(JSON.stringify(chart)), chart};
  clean.revision++;
  return clean;
}
export function reviewDraft(draft) {
  const clean = cleanDraft(draft), errors = [], concerns = [];
  if (!clean.metadata.title.trim()) errors.push('Add a pattern title.');
  if (!clean.metadata.materials.trim()) concerns.push('Materials have not been supplied.');
  if (!clean.metadata.gauge.trim()) concerns.push('Gauge is missing; provide it or explicitly explain why it is not applicable.');
  if (clean.type === 'graph' && !clean.source) errors.push('Select a chart or choose a written pattern type.');
  if (!clean.metadata.technique.trim()) concerns.push('The author must specify the technique; chart colors do not establish stitch types.');
  const steps = clean.sections.flatMap(s => s.steps), identifiers = new Set(steps.map(s => s.id));
  for (const section of clean.sections) {
    const seen = new Set(); let previous = null;
    for (const step of section.steps) {
      if (!step.text.trim()) errors.push(`Step ${step.id} has no authored instructions.`);
      for (const ref of step.references) if (!identifiers.has(ref)) errors.push(`Step ${step.id} has an unresolved reference.`);
      if (step.references.includes(step.id)) errors.push(`Step ${step.id} refers to itself.`);
      if (step.number !== null && step.kind !== 'paragraph') {
        const key = step.kind + ':' + step.number;
        if (seen.has(key)) errors.push(`Section ${section.id} repeats ${key}.`);
        if (previous?.kind === step.kind && step.number !== previous.number + 1) concerns.push(`Check numbering around ${step.id}; grouped ranges are not modeled by this prototype.`);
        seen.add(key); previous = step;
      }
    }
  }
  if (!steps.length) concerns.push('No authored construction instructions are present; color runs alone do not define a crochet technique.');
  return {errors, concerns, publicationReady: false, limitation: 'Feasibility prototype only: PDF, image, sizing, repeat-cycle and full publication review gates are not implemented.'};
}
function freeze(value) { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return Object.freeze(value); }
export async function freezeSnapshot(draft, confirmed = false) {
  if (!confirmed) throw Error('Explicit snapshot review is required.');
  const clean = cleanDraft(draft);
  // Authoring snapshot is private, not a buyer payload or an assertion of pattern correctness.
  return freeze({kind: 'private-authoring-snapshot', contentHash: await hash(JSON.stringify(clean)), draft: clean});
}
export async function encodeBackup(draft) {
  const payload = JSON.stringify(cleanDraft(draft));
  const serialized = JSON.stringify({format: 'dee-pattern-creator-prototype', version: 0, payload, sha256: await hash(payload)});
  if (encoder.encode(serialized).length > maxBytes) throw Error('Prototype backup exceeds 4 MiB.');
  return serialized;
}
export async function decodeBackup(serialized) {
  if (typeof serialized !== 'string' || encoder.encode(serialized).length > maxBytes) throw Error('Invalid or oversized prototype backup.');
  const envelope = JSON.parse(serialized);
  if (envelope?.format !== 'dee-pattern-creator-prototype' || envelope.version !== 0 || typeof envelope.payload !== 'string') throw Error('Unsupported prototype backup.');
  if (typeof envelope.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.sha256)) throw Error('A valid SHA-256 checksum is required.');
  if (await hash(envelope.payload) !== envelope.sha256) throw Error('Backup checksum does not match.');
  return cleanDraft(JSON.parse(envelope.payload));
}
