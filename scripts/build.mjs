import {checkIdentity} from './cache-identity.mjs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
await checkIdentity();
const target = process.argv[2];
if (!['web', 'mobile'].includes(target)) throw new Error('Choose web or mobile');
const native = target === 'mobile';
const out = native ? 'mobile/www' : 'dist';
const window = {};
runInNewContext(await readFile('release-config.js', 'utf8'), { window });
const pkg = JSON.parse(await readFile('mobile/package.json', 'utf8'));
const release = JSON.parse(await readFile('release.json', 'utf8'));
if (window.StudioRelease.nativeVersion !== pkg.version || window.StudioRelease.version !== release.web.version) {
  throw new Error('Website and native build metadata must match their respective manifests');
}
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
  const { nativeVersion, ...config } = window.StudioRelease;
  await writeFile(out + '/release-config.js', 'window.StudioRelease = ' +
    JSON.stringify({ ...config, version: nativeVersion }) + ';\n');
  html = html.replace(/  <link rel="manifest"[^\n]*\n/, '')
    .replace('<title>Dorette Crochet Studio</title>', '<title>Dee’s Crochet Studio</title>')
    .replace('<strong>Dorette</strong>', '<strong>Dee’s</strong>')
    .replace('</head>', '  <script src="./mobile.js"></script>\n</head>');
  await cp('mobile/mobile.js', out + '/mobile.js');
  const creator = await readFile('pattern-creator.html', 'utf8');
  await writeFile(out + '/pattern-creator.html', creator.replace('</head>', '  <script src="./mobile.js"></script>\n</head>'));
  const written = await readFile('written-pattern.html', 'utf8');
  await writeFile(out + '/written-pattern.html', written.replace('</head>', '  <script src="./mobile.js"></script>\n</head>'));
} else {
  await cp('release.json', out + '/release.json');
}
await writeFile(out + '/index.html', html);
