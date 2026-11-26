(() => {
  if (window.Capacitor?.isNativePlatform()) return;
  let applying = false;
  function ask(worker, type) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {channel.port1.close();reject(Error('Unable to Update. Keep your work open; the update safety check did not respond.'));}, 5000);
      channel.port1.onmessage = event => {clearTimeout(timer);channel.port1.close();resolve(event.data);};
      worker.postMessage({type}, [channel.port2]);
    });
  }
  window.StudioDescribeUpdate = worker => ask(worker, 'STUDIO_RELEASE');
  window.StudioOnlyUpdateWindow = async worker => {
    const reply = await ask(worker, 'STUDIO_CLIENTS');
    if (reply.count !== 1 || reply.sourceKnown !== true) throw Error('Save and close other Studio tabs, Companion, Creator and Publisher windows before updating.');
  };
  window.StudioPrepareWebsiteUpdate = async worker => {
    const safety = window.StudioUpdateSafety;
    if (!safety || !await safety.ready()) throw Error('Unable to Update. Finish saving or resolve the storage error first. Keep external backups of each kind of work.');
    safety.freeze(true);
    try {
      await window.StudioOnlyUpdateWindow(worker);
      if (!await safety.ready()) throw Error('Unable to Update. A save is still pending or failed.');
      applying = true;
      const reply = await ask(worker, 'STUDIO_ACTIVATE');
      if (!reply.activated) throw Error('Unable to Update. Another Studio window opened or the download is incomplete.');
    } catch (error) {applying=false;safety.freeze(false);throw error;}
  };
  navigator.serviceWorker?.addEventListener('controllerchange', async () => {
    if (!applying) return; // Other windows never reload without their own consent.
    if (await window.StudioUpdateSafety.ready()) location.reload();
    else {applying=false;window.StudioUpdateSafety.freeze(false);alert('Update prepared, but work could not be saved. Keep this window open and make external backups before reloading.');}
  });
  // A non-modal notice is provided by the existing worker/update controls.
  // Visibility checks only prepare a worker; they never activate it or reload.
  let last = 0;
  async function discover() {
    if (document.hidden || !navigator.onLine || Date.now()-last < 60000) return;
    last=Date.now();
    try {const registration=await navigator.serviceWorker?.getRegistration();await registration?.update();} catch { /* Existing controls show actionable errors on explicit checks. */ }
  }
  document.addEventListener('visibilitychange', discover);
  setTimeout(discover, 1500);
})();
