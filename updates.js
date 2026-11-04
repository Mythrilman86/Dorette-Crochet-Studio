(() => {
  const config = window.StudioRelease;
  if (!config) return;
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

  async function checkPlay(play, manifestRead) {
    showLink('https://play.google.com/store/apps/details?id=com.deescrochetstudio.app',
      'play.google.com', /^\/store\/apps\/details$/, 'Open Google Play');
    if (!manifestRead) status.textContent = 'Release notes are unavailable.';
    try {
      if (!await window.StudioBeforeUpdate()) {
        status.textContent += ' Finish saving or back up your projects before installing.';
        return;
      }
      const { result } = await play.check();
      status.textContent += result === 'started' ? ' Follow the Google Play prompt.' : ' No in-app update is available from Google Play.';
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
    let installedByPlay = false;
    let manifestRead = false;
    const play = window.Capacitor?.Plugins.StudioUpdates;
    try {
      if (platform === 'android') ({ installedByPlay } = await play.source());
      const response = await fetch(config.manifest, {
        cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error('Manifest unavailable');
      const body = await response.text();
      if (body.length > 16000) throw new Error('Manifest too large');
      const release = JSON.parse(body);
      if (typeof release?.version !== 'string' || !versionPattern.test(release.version) || typeof release.notes !== 'string') throw new Error('Invalid manifest');
      manifestRead = true;
      const update = newer(release.version, config.version);
      status.textContent = update ? `Version ${release.version} · ${release.notes.slice(0, 4000)}` : `You’re using version ${config.version}.`;
      if (platform === 'android') {
        if (!installedByPlay && update) {
          showLink(release.androidApk, 'github.com', /^\/Mythrilman86\/Dorette-Crochet-Studio\/releases\/download\/v\d+\.\d+\.\d+\/[^/]+\.apk$/i, 'Download development APK');
          if (!action.hidden) status.textContent += ' Back up your projects first. Open the APK in Files and follow Android’s prompts. An in-place update requires the same signing key.';
        }
      } else if (update && platform === 'ios') {
        showLink(release.iosStore, 'apps.apple.com', /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+$/, 'Open App Store');
      } else if (update) {
        status.textContent += ' When the website update is ready, use Save and update Studio.';
      }
      if (update && !installedByPlay && action.hidden && ['ios', 'android'].includes(platform)) status.textContent += ' No install link is listed for this build.';
    } catch {
      status.textContent = 'The update check couldn’t finish. You can keep working and try again later.';
    } finally {
      if (installedByPlay) await checkPlay(play, manifestRead);
      button.disabled = false;
    }
  });
})();
