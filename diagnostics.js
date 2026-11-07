/* Diagnostic records accept codes only. Raw errors and user content never enter storage. */
(function (root) {
  'use strict';
  const key = 'studio.diagnostics.v1',
    limit = 200,
    maxBytes = 128 * 1024,
    age = 30 * 86400000;
  const messages = {
    APPLICATION_FAILED: 'An unexpected application operation did not complete.',
    SAVE_FAILED: 'Local save did not complete.',
    BACKUP_FAILED: 'Backup could not complete.',
    RESTORE_FAILED: 'Backup could not be restored.',
    IMPORT_FAILED: 'Import did not complete.',
    PDF_FAILED: 'PDF operation did not complete.',
    UPDATE_FAILED: 'Update request did not complete.',
    OFFLINE_FAILED: 'Offline setup or verification did not complete.',
    STORAGE_FAILED: 'Local storage is unavailable.'
  };
  function clean(records, now) {
    if (!Array.isArray(records)) return [];
    return records
      .filter(
        (r) =>
          r && messages[r.code] && Number.isFinite(r.time) && r.time <= now && r.time >= now - age
      )
      .slice(-limit)
      .map((r) => ({
        time: r.time,
        code: r.code,
        category: r.code.split('_')[0].toLowerCase(),
        version: /^\d+\.\d+\.\d+$/.test(r.version) ? r.version : 'unknown',
        platform: ['android', 'ios', 'web'].includes(r.platform) ? r.platform : 'web',
        severity: 'error'
      }));
  }
  function create(
    storage,
    clock = Date.now,
    info = () => ({ version: 'unknown', platform: 'web' })
  ) {
    function read() {
      try {
        const raw = storage.getItem(key) || '[]';
        if (raw.length > maxBytes) return [];
        return clean(JSON.parse(raw), clock());
      } catch {
        return [];
      }
    }
    function record(code) {
      if (!messages[code]) return;
      try {
        const rows = clean([...read(), { time: clock(), code, ...info() }], clock());
        while (rows.length && new TextEncoder().encode(JSON.stringify(rows)).length > maxBytes)
          rows.shift();
        storage.setItem(key, JSON.stringify(rows));
      } catch {
        /* Recording must never affect the originating operation. */
      }
    }
    return {
      record,
      read,
      clear() {
        try {
          storage.removeItem(key);
        } catch {}
      },
      report() {
        return read().map((r) => ({ ...r, time: new Date(r.time).toISOString(), summary: messages[r.code] }));
      }
    };
  }
  root.StudioDiagnostics = { create, messages };
  if (typeof module !== 'undefined') module.exports = root.StudioDiagnostics;
  if (typeof document !== 'undefined') {
    let storage;
    try {
      storage = root.localStorage;
    } catch {
      storage = {
        getItem() {
          return null;
        },
        setItem() {}
      };
    }
    root.studioDiagnostics = create(storage, Date.now, () => ({
      version: root.StudioRelease?.version || 'unknown',
      platform: root.Capacitor?.getPlatform?.() || 'web'
    }));
    root.addEventListener('error', () => root.studioDiagnostics.record('APPLICATION_FAILED'));
    root.addEventListener('unhandledrejection', () => root.studioDiagnostics.record('APPLICATION_FAILED'));
  }
})(globalThis);
