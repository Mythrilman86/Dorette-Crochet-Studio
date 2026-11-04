(() => {
  const config = window.StudioRelease;
  if (!config) return;
  document.getElementById('studioBuildBadge').textContent = `v${config.version} · Local workspace`;
  const panel = document.getElementById('studioUpdates');
  panel.hidden = false;
  const button = panel.querySelector('button');
  const status = panel.querySelector('[role="status"]');
  const action = panel.querySelector('a');
  const platform = window.Capacitor?.getPlatform();
  const versionPattern = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
  const newer = (remote, local) => {
    const installed = local.split('.').map(Number);
    for (const [index, value] of remote.split('.').map(Number).entries()) {
      if (value !== installed[index]) return value > installed[index];
    }
    return false;
  };

  function showLink(raw, host, path, label) {
    if (typeof raw !== 'string') return;
    let url;
    try { url = new URL(raw); } catch { return; }
    if (url.origin !== 'https://' + host || url.username || url.password || !path.test(url.pathname)) return;
    if (platform === 'android' || platform === 'ios') action.target = '_self';
    action.href = url.href;
    action.textContent = label;
    action.hidden = false;
  }

  if (platform === 'android') {
    const native = window.Capacitor.Plugins.StudioUpdates;
    const notice = document.getElementById('studioAndroidUpdate');
    const description = notice.querySelector('[role="status"]');
    const updateNow = document.getElementById('studioUpdateNow');
    const later = document.getElementById('studioUpdateLater');
    const setting = document.getElementById('studioAutoUpdate');
    const preference = 'studio.android.autoUpdates';
    const reminder = 'studio.android.updateReminder';
    const repository = 'Mythrilman86/Dorette-Crochet-Studio';
    let candidate;
    let downloaded;
    let busy = false;
    let deferred;

    function readSetting(key) {
      try { return localStorage.getItem(key); } catch { return undefined; }
    }

    function saveSetting(key, value) {
      try { localStorage.setItem(key, value); } catch { /* Keep the current session preference. */ }
    }

    function setBusy(value) {
      busy = value;
      button.disabled = updateNow.disabled = later.disabled = value;
    }

    async function githubUpdate() {
      const response = await fetch('https://api.github.com/repos/' + repository + '/releases?per_page=10', {
        cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error('GitHub releases unavailable');
      const releases = await response.json();
      if (!Array.isArray(releases)) throw new Error('Invalid GitHub release list');
      let latest;
      for (const release of releases) {
        if (typeof release?.tag_name !== 'string' || !release.tag_name.startsWith('v')
            || release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets)) continue;
        const version = release.tag_name.slice(1);
        if (!versionPattern.test(version) || !newer(version, latest?.version ?? config.version)) continue;
        const name = 'Dees-Crochet-Studio-' + version + '-Android.apk';
        const url = 'https://github.com/' + repository + '/releases/download/v' + version + '/' + name;
        const apk = release.assets.find(asset => asset?.name === name && asset.browser_download_url === url
          && asset.state === 'uploaded' && /^sha256:[a-f0-9]{64}$/.test(asset.digest));
        if (!apk) continue;
        latest = { id: 'github:' + version, version, sha256: apk.digest.slice(7),
          notes: typeof release.body === 'string' ? release.body.slice(0, 4000) : '' };
      }
      return latest;
    }

    async function checkAndroid(automatic = false) {
      if (busy) return;
      if (!navigator.onLine) {
        if (!automatic) status.textContent = 'You’re offline. You can keep working and check again later.';
        return;
      }
      setBusy(true);
      if (!automatic) status.textContent = 'Checking for updates…';
      try {
        const source = await native.source();
        let next;
        if (source.installedByPlay) {
          const play = await native.availability();
          if (play.available) next = { id: 'play:' + play.versionCode, play: true };
        } else if (source.githubSupported) {
          next = await githubUpdate();
        }
        if (automatic && !setting.checked) return;
        status.textContent = 'Installed version ' + config.version + '.';
        if (!next) {
          notice.hidden = true;
          candidate = undefined;
          status.textContent += ' No compatible update was found.';
          return;
        }
        candidate = next;
        const savedReminder = deferred ?? readSetting(reminder);
        const expires = Number(savedReminder?.split('|')[1]);
        if (automatic && savedReminder?.startsWith(next.id + '|') && Date.now() < expires) return;
        description.textContent = next.play
          ? 'A Google Play update is ready. Open Google Play to see the update details.'
          : 'Android version ' + next.version + ' is available. ' + next.notes;
        notice.hidden = false;
        status.textContent += ' An update is available.';
      } catch {
        if (!automatic) status.textContent = 'The update check couldn’t finish. You can keep working and try again later.';
      } finally {
        setBusy(false);
      }
    }

    updateNow.addEventListener('click', async () => {
      if (!candidate || busy) return;
      setBusy(true);
      try {
        if (!candidate.play && downloaded !== candidate.id) {
          description.textContent = 'Downloading and verifying version ' + candidate.version + '…';
          await native.download({ version: candidate.version, sha256: candidate.sha256 });
          downloaded = candidate.id;
        }
        if (!await window.StudioBeforeUpdate()) {
          description.textContent = 'Finish saving your projects or export a backup before installing.';
          return;
        }
        if (candidate.play) {
          const { result } = await native.check();
          description.textContent = result === 'started' ? 'Follow the Google Play prompt.' : 'Google Play did not start the update.';
        } else {
          const { permissionRequired } = await native.install();
          description.textContent = permissionRequired
            ? 'Allow Dee’s Crochet Studio to install updates in Android Settings, then return and tap Update Now again.'
            : 'Confirm the update in Android’s installer.';
        }
      } catch {
        downloaded = undefined;
        description.textContent = 'The update could not be downloaded, verified, or opened. Try Update Now again.';
      } finally {
        setBusy(false);
      }
    });
    later.addEventListener('click', () => {
      if (!candidate) return;
      deferred = candidate.id + '|' + (Date.now() + 24 * 60 * 60 * 1000);
      saveSetting(reminder, deferred);
      notice.hidden = true;
      status.textContent = 'We’ll remind you the next time you open the app after 24 hours.';
    });
    document.getElementById('studioAutoUpdateSetting').hidden = false;
    const savedPreference = readSetting(preference);
    setting.checked = savedPreference !== 'off' && savedPreference !== undefined;
    setting.addEventListener('change', () => saveSetting(preference, setting.checked ? 'on' : 'off'));
    status.textContent = 'Check now, or let Studio check when it opens.';
    button.addEventListener('click', () => checkAndroid());
    if (setting.checked) window.setTimeout(() => checkAndroid(true), 0);
    return;
  }

  button.addEventListener('click', async () => {
    action.hidden = true;
    if (!navigator.onLine) {
      status.textContent = 'You’re offline. You can keep working and check again later.';
      return;
    }
    button.disabled = true;
    status.textContent = 'Checking for updates…';
    try {
      const response = await fetch(config.manifest, {
        cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error('Manifest unavailable');
      const body = await response.text();
      if (body.length > 16000) throw new Error('Manifest too large');
      const manifest = JSON.parse(body);
      const channel = platform === 'ios' ? 'ios' : 'web';
      if (manifest?.schema !== 1 || !Object.hasOwn(manifest, channel)) throw new Error('Invalid manifest');
      const release = manifest[channel];
      status.textContent = `Installed version ${config.version}.`;
      if (release === null) {
        status.textContent += ' No published update is listed for this platform.';
        return;
      }
      if (typeof release?.version !== 'string' || !versionPattern.test(release.version) || typeof release.notes !== 'string') throw new Error('Invalid release');
      if (!newer(release.version, config.version)) {
        status.textContent += ' No newer published update is listed for this platform.';
        return;
      }
      if (platform === 'ios') {
        showLink(release.storeUrl, 'apps.apple.com', /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+$/, 'Open App Store');
        if (action.hidden) throw new Error('Invalid App Store URL');
      }
      status.textContent += ` Published version ${release.version} · ${release.notes.slice(0, 4000)}`;
      if (channel === 'web') status.textContent += ' If Studio offers Save and update Studio, use it to apply the cached website update.';
    } catch {
      status.textContent = 'The update check couldn’t finish. You can keep working and try again later.';
    } finally {
      button.disabled = false;
    }
  });
})();
