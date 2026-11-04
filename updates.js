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

  async function checkPlay(play) {
    showLink('https://play.google.com/store/apps/details?id=com.deescrochetstudio.app',
      'play.google.com', /^\/store\/apps\/details$/, 'Open Google Play');
    status.textContent = `Installed version ${config.version}.`;
    try {
      if (!await window.StudioBeforeUpdate()) {
        status.textContent += ' Finish saving or back up your projects before installing.';
        return;
      }
      const { result } = await play.check();
      status.textContent += result === 'started'
        ? ' Follow the Google Play prompt.'
        : ' Google Play did not start an update. You can check the store for availability.';
    } catch {
      status.textContent += ' The Google Play check couldn’t finish.';
    }
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
      if (platform === 'android') {
        const play = window.Capacitor?.Plugins?.StudioUpdates;
        if ((await play.source()).installedByPlay) await checkPlay(play);
        else status.textContent = `Installed development version ${config.version}. Back up your projects before installing a private test APK. An in-place update requires the same signing certificate.`;
        return;
      }
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
