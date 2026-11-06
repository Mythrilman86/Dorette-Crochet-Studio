import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const target = process.argv[2];
if (!['web', 'mobile'].includes(target)) throw new Error('Choose web or mobile');
const native = target === 'mobile';
const out = native ? 'mobile/www' : 'dist';
const window = {};
runInNewContext(await readFile('release-config.js', 'utf8'), { window });
const pkg = JSON.parse(await readFile('mobile/package.json', 'utf8'));
if (window.StudioRelease.version !== pkg.version) throw new Error('Build metadata and package versions must match');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const entry of await readdir('.', { withFileTypes: true })) {
  if (entry.name === 'assets' || (entry.isFile() && /\.(js|css|html|pdf|webmanifest)$/.test(entry.name))) {
    if (native && ['service-worker.js', 'manifest.webmanifest'].includes(entry.name)) continue;
    await cp(entry.name, `${out}/${entry.name}`, { recursive: true });
  }
}
let html = await readFile('index.html', 'utf8');
if (native) {
  html = html.replace(/  <link rel="manifest"[^\n]*\n/, '')
    .replace('<title>Dorette Crochet Studio</title>', '<title>Dee’s Crochet Studio</title>')
    .replace('<strong>Dorette</strong>', '<strong>Dee’s</strong>')
    .replace('</head>', '  <script src="./mobile.js"></script>\n</head>');
  await cp('mobile/mobile.js', out + '/mobile.js');
  const written = await readFile('written-pattern.html', 'utf8');
  await writeFile(out + '/written-pattern.html', written.replace('</head>', '  <script src="./mobile.js"></script>\n</head>'));
} else {
  await cp('release.json', out + '/release.json');
}
await writeFile(out + '/index.html', html);
