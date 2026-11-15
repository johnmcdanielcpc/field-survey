/* IndexedDB storage: surveys, photos (full-res blobs + thumbnails), small key/value settings. */
(function () {
  const DB_NAME = 'field-survey';
  const DB_VER = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('surveys')) db.createObjectStore('surveys', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) {
          const s = db.createObjectStore('photos', { keyPath: 'id' });
          s.createIndex('survey', 'surveyId');
        }
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => resolve(out && out.result !== undefined && out instanceof IDBRequest ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Storage aborted (phone storage may be full)'));
    }));
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const DB = {
    async get(store, key) { const db = await open(); return req(db.transaction(store).objectStore(store).get(key)); },
    async all(store) { const db = await open(); return req(db.transaction(store).objectStore(store).getAll()); },
    async put(store, val, key) { return tx(store, 'readwrite', s => { key === undefined ? s.put(val) : s.put(val, key); }); },
    async del(store, key) { return tx(store, 'readwrite', s => { s.delete(key); }); },
    async photosFor(surveyId) {
      const db = await open();
      return req(db.transaction('photos').objectStore('photos').index('survey').getAll(surveyId));
    },
    async photoKeysFor(surveyId) {
      const db = await open();
      return req(db.transaction('photos').objectStore('photos').index('survey').getAllKeys(surveyId));
    },
    async kvGet(k, dflt) { const v = await DB.get('kv', k); return v === undefined ? dflt : v; },
    async kvSet(k, v) { return DB.put('kv', v, k); },
  };
  window.FS = window.FS || {};
  FS.DB = DB;
})();
