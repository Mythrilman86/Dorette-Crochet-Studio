import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const target = process.argv[2];
if (!['web', 'mobile'].includes(target)) throw new Error('Choose web or mobile');
const native = target === 'mobile';
const out = native ? 'mobile/www' : 'dist';
const release = JSON.parse(await readFile('release.json', 'utf8'));
const pkg = JSON.parse(await readFile('mobile/package.json', 'utf8'));
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
} else {
  const worker = (await readFile('service-worker.js', 'utf8'))
    .replace(/^const CACHE = .*;/m, `const CACHE = 'dorette-crochet-${pkg.version}-unified';`);
  await writeFile(out + '/service-worker.js', worker);
  await cp('release.json', out + '/release.json');
}
html = html.replace('v1.8.1 · Local workspace', `v${pkg.version} · Local workspace`);
await writeFile(out + '/index.html', html);
await writeFile(out + '/release-config.js', `window.StudioRelease = ${JSON.stringify({
  version: pkg.version,
  manifest: 'https://mythrilman86.github.io/Dorette-Crochet-Studio/release.json'
})};\n`);
if (release.version !== pkg.version) throw new Error('Release and package versions must match');
