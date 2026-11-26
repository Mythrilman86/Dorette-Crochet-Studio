/* Update coordination only. No project data or backup formats are changed. */
(() => {
  const guards = new Map();
  let writes = 0, failed = false, frozen = false;
  const changes = new Set();
  function storageFailure() { failed = true; }
  for (const method of ['setItem','removeItem','clear']) {
    const original = Storage.prototype[method];
    if (!original) continue;
    Storage.prototype[method] = function (...args) {
      try { return original.apply(this, args); } catch (error) { storageFailure(); throw error; }
    };
  }
  const originalTransaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    let tx;
    try { tx = originalTransaction.apply(this, args); }
    catch(error) { if(args[1] === 'readwrite') storageFailure(); throw error; }
    if (args[1] === 'readwrite') {
      writes++;
      tx.addEventListener('complete', () => writes--, {once:true});
      tx.addEventListener('abort', () => { writes--; storageFailure(); }, {once:true});
    }
    return tx;
  };
  // A page loaded during an update also makes the worker refuse activation.
  window.StudioUpdateSafety = {
    register(name, guard) { guards.set(name, guard); },
    failed: storageFailure,
    async ready() {
      if (!guards.size || failed) return false;
      try {
        for (const guard of guards.values()) if (!await guard()) return false;
        return writes === 0 && !failed;
      } catch { return false; }
    },
    freeze(value) {
      frozen = value;
      // The update notice remains usable; other pages cannot be edited mid-switch.
      for (const node of document.body.children) {
        if (node.tagName === 'SCRIPT' || node.id === 'studioUpdateProgress') continue;
        if (value && !node.inert) { node.inert = true; changes.add(node); }
      }
      if (!value) { for (const node of changes) node.inert = false; changes.clear(); }
    },
    get frozen() { return frozen; }
  };
})();
