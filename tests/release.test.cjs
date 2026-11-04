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
  const release = JSON.parse(read('release.json'));
  assert.equal(release.version, JSON.parse(read('mobile/package.json')).version);
  assert.ok(read('mobile/android/app/build.gradle').includes('versionName "' + release.version + '"'));
  assert.ok(read('mobile/ios/App/App.xcodeproj/project.pbxproj').includes('MARKETING_VERSION = ' + release.version + ';'));
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

function updates({ online = true, body, platform, play, canSave = true } = {}) {
  let click;
  let requests = 0;
  const button = { addEventListener: (_, callback) => { click = callback; } };
  const status = {};
  const action = { hidden: true };
  const elements = { button, '[role="status"]': status, a: action };
  const window = { StudioBeforeUpdate: async () => canSave, StudioRelease: { version: '1.8.2', manifest: 'https://example.com/release.json' } };
  if (platform) window.Capacitor = { getPlatform: () => platform, Plugins: { StudioUpdates: play } };
  vm.runInNewContext(read('updates.js'), {
    window, navigator: { onLine: online }, URL, AbortSignal,
    document: { getElementById: () => ({ querySelector: key => elements[key] }) },
    fetch: async () => {
      requests++;
      if (body instanceof Error) throw body;
      return { ok: true, text: async () => JSON.stringify(body) };
    }
  });
  return { click, status, action, requests: () => requests };
}

test('update checks are opt-in per click and skip all requests offline', async () => {
  const view = updates({ online: false });
  assert.equal(view.requests(), 0);
  await view.click();
  assert.equal(view.requests(), 0);
  assert.match(view.status.textContent, /offline/);
});

test('update check handles failures, compares version numbers and validates store links', async () => {
  const fail = updates({ body: new Error('offline') });
  await fail.click();
  assert.match(fail.status.textContent, /couldn’t finish/);
  const latest = { version: '1.8.10', notes: '<b>release notes</b>', iosStore: 'https://apps.apple.com/us/app/studio/id123' };
  const ios = updates({ platform: 'ios', body: latest });
  await ios.click();
  assert.match(ios.status.textContent, /1\.8\.10/);
  assert.match(ios.status.textContent, /<b>release notes<\/b>/);
  assert.equal(ios.action.hidden, false);
  const invalid = updates({ platform: 'ios', body: { ...latest, iosStore: 'https://apps.apple.com.example.org/app/id123' } });
  await invalid.click();
  assert.equal(invalid.action.hidden, true);
});

test('Play checks use Play, including when release notes are unavailable', async () => {
  let checks = 0;
  const play = {
    source: async () => ({ installedByPlay: true }),
    check: async () => { checks++; return { result: 'started' }; }
  };
  const view = updates({ platform: 'android', play, body: new Error('unavailable') });
  await view.click();
  assert.equal(checks, 1);
  assert.match(view.status.textContent, /Follow the Google Play prompt/);
  assert.match(view.action.href, /^https:\/\/play\.google\.com/);
  const pending = updates({ platform: 'android', play, canSave: false, body: { version: '1.8.3', notes: 'New' } });
  await pending.click();
  assert.equal(checks, 1);
  assert.match(pending.status.textContent, /Finish saving/);
});
