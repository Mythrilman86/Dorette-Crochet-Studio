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
          r && Object.hasOwn(messages,r.code) && Number.isFinite(r.time) && r.time <= now && r.time >= now - age
      )
      .slice(-limit)
      .map((r) => ({
        time: r.time,
        code: r.code,
        category: r.code.split('_')[0].toLowerCase(),
        version: /^\d+\.\d+\.\d+$/.test(r.version) ? r.version : 'unknown',
        platform: ['android', 'ios', 'web'].includes(r.platform) ? r.platform : 'web',
        severity: 'error',
        count: Math.max(1,Math.min(1000,Math.floor(r.count)||1)),
        id: typeof r.id==='string'&&/^[a-f0-9]{1,8}-\d{1,12}$/.test(r.id)?r.id:'legacy-'+r.time+'-'+r.code.toLowerCase().replaceAll('_','-')
      }));
  }
  function create(
    storage,
    clock = Date.now,
    info = () => ({ version: 'unknown', platform: 'web' })
  ) {
    let memory=[],recording=false,reading=false,ignoreStorage=false,sequence=0;const session=Math.floor(Math.random()*0xffffffff).toString(16);
    function read(){if(reading)return memory.slice();reading=true;try{let disk=[];try{const raw=ignoreStorage?'[]':storage.getItem(key)||'[]';if(raw.length<=maxBytes)disk=clean(JSON.parse(raw),clock());}catch{}const merged=new Map();for(const r of [...disk,...memory]){const old=merged.get(r.id);if(!old||r.count>=old.count)merged.set(r.id,r);}memory=clean([...merged.values()].sort((a,b)=>a.time-b.time),clock());return memory.slice();}finally{reading=false;}}
    function record(code){if(recording||!Object.hasOwn(messages,code))return;recording=true;try{const now=clock(),rows=read(),meta=info();const previous=rows.findLast(r=>r.code===code&&now>=r.time&&now-r.time<10000);if(previous){if(previous.count>=1000)return;previous.count++;}else rows.push({time:now,code,...meta,id:session+'-'+(++sequence),count:1});while(rows.length>limit){const noise=rows.findIndex(r=>r.code==='APPLICATION_FAILED');rows.splice(noise<0?0:noise,1);}memory=clean(rows,now);if(previous&&previous.count%25!==0)return;try{storage.setItem(key,JSON.stringify(memory));ignoreStorage=false;}catch{}}catch{}finally{recording=false;}}

    return {
      record,
      read,
      clear() {
        memory=[];ignoreStorage=true;
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
