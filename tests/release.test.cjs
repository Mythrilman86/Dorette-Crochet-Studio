const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const read = path => readFileSync(path, 'utf8');

test('website and Capacitor builds share the engine and preserve identifiers', () => {
  for (const file of ['app.js', 'pattern-tools.js', 'studio-ops.js', 'stitch-studio.js', 'updates.js']) {
    assert.equal(read('dist/' + file), read('mobile/www/' + file));
  }
  assert.match(read('dist/index.html'), /manifest.webmanifest/);
  assert.match(read('mobile/www/index.html'), /Dee’s Crochet Studio/);
  assert.doesNotMatch(read('mobile/www/index.html'), /manifest.webmanifest/);
  assert.match(read('mobile/www/app.js'), /isNativePlatform\(\)/);
  const config = JSON.parse(read('mobile/capacitor.config.json'));
  assert.equal(config.appId, 'com.deescrochetstudio.app');
  assert.equal(config.server, undefined);
  const context = { window: {} };
  const nativeContext = { window: {} };
  const metadata = read('release-config.js');
  vm.runInNewContext(metadata, context);
  vm.runInNewContext(read('mobile/www/release-config.js'), nativeContext);
  assert.equal(read('dist/release-config.js'), metadata);
  for (const directory of ['dist', 'mobile/www']) {
    assert.match(read(directory + '/index.html'), /id="studioBuildBadge"/);
  }
  const release = context.window.StudioRelease;
  const native = nativeContext.window.StudioRelease;
  assert.equal(release.version, JSON.parse(read('dist/release.json')).web.version);
  assert.equal(native.version, release.nativeVersion);
  assert.equal(native.version, JSON.parse(read('mobile/package.json')).version);
  assert.equal(native.manifest, release.manifest);
  assert.ok(read('mobile/android/app/build.gradle').includes('versionName "' + native.version + '"'));
  assert.ok(read('mobile/ios/App/App.xcodeproj/project.pbxproj').includes('MARKETING_VERSION = ' + native.version + ';'));
});

test('native icon PNG sizes, opacity and adaptive safe area', () => {
  function png(path, size, colorType) {
    const data = readFileSync(path);
    assert.equal(data.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(data.readUInt32BE(16), size);
    assert.equal(data.readUInt32BE(20), size);
    assert.equal(data[25], colorType);
  }
  png('mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024, 2);
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    const dir = 'mobile/android/app/src/main/res/mipmap-' + density;
    png(dir + '/ic_launcher.png', size, 2);
    png(dir + '/ic_launcher_round.png', size, 6);
    png(dir + '/ic_launcher_foreground.png', size * 108 / 48, 6);
  }
  assert.match(read('scripts/icons.ps1'), /60\/108/);
});

function updates({ online = true, body, platform, play, canSave = true, preferences = new Map() } = {}) {
  let click;
  let startup;
  let requests = 0;
  const button = { addEventListener: (_, callback) => { click = callback; } };
  const status = {};
  const badge = {};
  const action = { hidden: true };
  const elements = { button, '[role="status"]': status, a: action };
  const nodes = {
    studioBuildBadge: badge,
    studioUpdates: { querySelector: key => elements[key] },
    studioAndroidUpdate: { hidden: true, querySelector: () => ({}) },
    studioUpdateNow: {},
    studioUpdateLater: {},
    studioAutoUpdate: {},
    studioAutoUpdateSetting: {}
  };
  for (const node of Object.values(nodes)) node.addEventListener = (name, fn) => { node[name] = fn; };
  const description = {};
  nodes.studioAndroidUpdate.querySelector = () => description;
  const window = { setTimeout: fn => { startup = fn; }, StudioBeforeUpdate: async () => canSave, StudioRelease: { version: '1.8.2', manifest: 'https://example.com/release.json' } };
  if (platform) window.Capacitor = { getPlatform: () => platform, Plugins: { StudioUpdates: play } };
  vm.runInNewContext(read('updates.js'), {
    window, navigator: { onLine: online }, URL, AbortSignal,
    document: { getElementById: id => nodes[id] },
    localStorage: { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) },
    fetch: async () => {
      requests++;
      if (body instanceof Error) throw body;
      return { ok: true, text: async () => JSON.stringify(body), json: async () => body };
    }
  });
  return { click, badge, status, action, nodes, description, startup, requests: () => requests };
}

test('update checks are opt-in per click and skip all requests offline', async () => {
  const view = updates({ online: false });
  assert.equal(view.badge.textContent, "v1.8.2 · Local workspace");
  assert.equal(view.requests(), 0);
  await view.click();
  assert.equal(view.requests(), 0);
  assert.match(view.status.textContent, /offline/);
});

test('update check handles failures, compares version numbers and validates store links', async () => {
  const fail = updates({ body: new Error('offline') });
  await fail.click();
  assert.match(fail.status.textContent, /couldn’t finish/);
  const latest = { version: '1.8.10', notes: '<b>release notes</b>', storeUrl: 'https://apps.apple.com/us/app/studio/id123' };
  const manifest = ios => ({ schema: 1, web: null, ios });
  const ios = updates({ platform: 'ios', body: manifest(latest) });
  await ios.click();
  assert.match(ios.status.textContent, /1\.8\.10/);
  assert.match(ios.status.textContent, /<b>release notes<\/b>/);
  assert.equal(ios.action.hidden, false);
  const invalid = updates({ platform: 'ios', body: manifest({ ...latest, storeUrl: 'https://apps.apple.com.example.org/app/id123' }) });
  await invalid.click();
  assert.equal(invalid.action.hidden, true);
  const web = updates({ body: manifest(latest) });
  await web.click();
  assert.match(web.status.textContent, /No published update/);
  assert.doesNotMatch(web.status.textContent, /1\.8\.10/);
});

const githubRelease = (version, extra = {}) => {
  const name = 'Dees-Crochet-Studio-' + version + '-Android.apk';
  return {
    tag_name: 'v' + version, draft: false, prerelease: false, body: 'Release notes',
    assets: [{
      name, state: 'uploaded', digest: 'sha256:' + 'a'.repeat(64),
      browser_download_url: 'https://github.com/Mythrilman86/Dorette-Crochet-Studio/releases/download/v' + version + '/' + name
    }],
    ...extra
  };
};

test('Android startup checks, settings and reminders do not interrupt offline work', async () => {
  const play = { source: async () => ({ installedByPlay: false, githubSupported: true }) };
  const preferences = new Map();
  const body = [githubRelease('1.8.4')];
  const offline = updates({ platform: 'android', online: false, play, preferences, body });
  await offline.startup();
  await offline.click();
  assert.equal(offline.requests(), 0);
  assert.match(offline.status.textContent, /offline/);
  const view = updates({ platform: 'android', play, preferences, body });
  assert.equal(view.requests(), 0);
  await view.startup();
  assert.equal(view.nodes.studioAndroidUpdate.hidden, false);
  assert.match(view.description.textContent, /1\.8\.4.*Release notes/);
  view.nodes.studioUpdateLater.click();
  const reopened = updates({ platform: 'android', play, preferences, body });
  await reopened.startup();
  assert.equal(reopened.nodes.studioAndroidUpdate.hidden, true);
  await reopened.click();
  assert.equal(reopened.nodes.studioAndroidUpdate.hidden, false);
  reopened.nodes.studioAutoUpdate.checked = false;
  reopened.nodes.studioAutoUpdate.change();
  const disabled = updates({ platform: 'android', play, preferences, body });
  assert.equal(disabled.startup, undefined);
  await disabled.click();
  assert.equal(disabled.requests(), 1);
});

test('GitHub updates select the newest eligible asset and save before Android confirmation', async () => {
  const operations = [];
  const play = {
    source: async () => ({ installedByPlay: false, githubSupported: true }),
    download: async value => operations.push(value),
    install: async () => ({ permissionRequired: operations.push('installer') === 2 })
  };
  const wrongHost = githubRelease('1.8.30');
  wrongHost.assets[0].browser_download_url = 'https://example.org/fake.apk';
  const wrongDigest = githubRelease('1.8.31');
  wrongDigest.assets[0].digest = null;
  const body = [githubRelease('1.8.40', { assets: [] }), wrongHost, wrongDigest, githubRelease('1.8.99', { prerelease: true }),
    githubRelease('1.8.100', { draft: true }), githubRelease('1.8.4'), githubRelease('1.8.10')];
  const view = updates({ platform: 'android', play, body });
  await view.click();
  await view.nodes.studioUpdateNow.click();
  assert.equal(operations[0].version, '1.8.10');
  assert.equal(operations[0].sha256, 'a'.repeat(64));
  assert.match(view.description.textContent, /Android Settings/);
  await view.nodes.studioUpdateNow.click();
  assert.deepEqual(operations.slice(1), ['installer', 'installer']);
  assert.match(view.description.textContent, /Confirm the update/);

  const pending = updates({ platform: 'android', play, body, canSave: false });
  await pending.click();
  await pending.nodes.studioUpdateNow.click();
  assert.match(pending.description.textContent, /Finish saving/);
  assert.equal(operations.length, 4);
});

test('Play updates query Play without opening a prompt until the user chooses Update Now', async () => {
  let checks = 0;
  const play = {
    source: async () => ({ installedByPlay: true }),
    availability: async () => ({ available: true, versionCode: 8 }),
    check: async () => { checks++; return { result: 'started' }; }
  };
  const view = updates({ platform: 'android', play });
  await view.startup();
  assert.equal(checks, 0);
  assert.equal(view.requests(), 0);
  assert.match(view.description.textContent, /Google Play update is ready/);
  await view.nodes.studioUpdateNow.click();
  assert.equal(checks, 1);
  assert.match(view.description.textContent, /Follow the Google Play prompt/);
});
