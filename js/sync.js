/* Upload engine: outbox -> Google Drive through the Apps Script web app.
   Order per survey: folders -> original photos (+ marked copies) -> PDF (with photo links) -> Excel -> survey-data.json
   Every step is recorded, so a dropped connection resumes where it stopped. */
(function () {
  const FS = window.FS, DB = FS.DB;
  const SINGLE_MAX = 6 * 1024 * 1024;     // larger files go up in chunks
  const CHUNK = 4 * 1024 * 1024;          // multiple of 256 KB (Drive requirement)
  const UPLOAD_PX = 2400;                 // long edge of the copy sent to Drive (data plates stay readable)
  const PARALLEL = 3;                     // photos sent at the same time
  let running = false, lastPaint = 0, wake = null;

  // Keep the screen on while uploading: iPhones pause the app when the screen locks.
  async function keepAwake() {
    try { if (!wake && navigator.wakeLock && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; }
  }
  function letSleep() { try { if (wake) wake.release(); } catch (e) { } wake = null; }
  FS.uploadKeepsAwake = () => !!wake;

  // the copy that goes to Drive: originals stay full size on the phone and in the backup file
  async function uploadCopy(blob) {
    if (!blob || blob.size < 900 * 1024 || await DB.kvGet('fullSizeUpload', false)) return blob;
    try { const r = await FS.scaleToBlob(blob, UPLOAD_PX, 0.85); return r.blob && r.blob.size < blob.size ? r.blob : blob; }
    catch (e) { return blob; }
  }
  const mins = ms => { const m = Math.round(ms / 60000); return m < 1 ? 'under a minute left' : `about ${m} min left`; };

  const b64 = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  const fromB64 = (s, type) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };

  class NetError extends Error { }

  async function call(payload) {
    const url = await DB.kvGet('uploadUrl', ''), key = await DB.kvGet('uploadKey', '');
    if (!url) throw new Error('Upload link is not set (Settings).');
    let res;
    try {
      res = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, key }) });
    } catch (e) { throw new NetError('No connection'); }
    let j;
    const txt = await res.text();
    try { j = JSON.parse(txt); } catch (e) {
      if (/<html/i.test(txt)) throw new Error('The upload link did not return data. Check that the Apps Script is deployed with access "Anyone".');
      throw new Error('Unexpected reply from upload link');
    }
    if (!j.ok) throw new Error(j.error || 'Upload failed');
    return j;
  }

  async function uploadBlob(blob, folderId, name, overwrite, onPart) {
    const mimeType = blob.type || 'application/octet-stream';
    if (blob.size <= SINGLE_MAX) {
      return (await call({ action: 'upload', folderId, name, mimeType, overwrite: !!overwrite, b64: await b64(blob) })).id;
    }
    const st = await call({ action: 'start', folderId, name, mimeType, size: blob.size, overwrite: !!overwrite });
    if (st.skipped) return st.id;
    for (let start = 0; start < blob.size; start += CHUNK) {
      const part = blob.slice(start, Math.min(blob.size, start + CHUNK));
      const r = await call({ action: 'chunk', session: st.session, start, total: blob.size, b64: await b64(part) });
      onPart && onPart(Math.min(blob.size, start + CHUNK), blob.size);
      if (r.done) return r.id;
    }
    throw new Error('Upload did not complete');
  }

  function paint(s) {
    const now = Date.now();
    if (now - lastPaint < 800) return;
    lastPaint = now;
    FS.updateNet();
    const h = location.hash;
    if (h === '#/' || h === '' || h === `#/s/${s.id}`) FS.route();
  }

  async function save(s) { await DB.put('surveys', s); }

  async function uploadSurvey(id) {
    let s = FS.cur && FS.cur.id === id ? FS.cur : await DB.get('surveys', id);
    if (!s) return;
    FS.normalize(s);
    const sy = s.sync;
    sy.startedAt = Date.now();
    s.status = 'uploading'; sy.lastError = '';
    await save(s);

    // 1. folders
    if (!sy.folderId) {
      const f = await call({ action: 'folder', path: FS.folderPath(s) });
      sy.folderId = f.id; sy.folderUrl = f.url;
    }
    if (!sy.photosFolderId) sy.photosFolderId = (await call({ action: 'folder', parentId: sy.folderId, path: ['Photos'] })).id;
    await save(s);

    // 2. photos
    const ctx = FS.photoContexts(s);
    const ids = FS.photoIds(s);
    const recs = [];
    for (const pid of ids) { const r = await DB.get('photos', pid); if (r) recs.push(r); }
    const used = new Set(recs.map(r => r.driveName).filter(Boolean));
    const held = r => sy.holdVideos && r.kind === 'video';
    const todo = recs.filter(r => (!r.driveId && r.blob && !held(r)) || (r.marked && !r.markedDriveId));
    const total = todo.length + 3;
    let done = 0, photosDone = 0;
    const photoQ = todo.filter(r => r.kind !== 'video'), vidQ = todo.filter(r => r.kind === 'video');
    const t0 = Date.now();
    const photoLabel = () => {
      const left = photoQ.length - photosDone;
      const eta = photosDone >= 3 && left > 0 ? ` – ${mins((Date.now() - t0) / photosDone * left)}` : '';
      return `Uploading photos (${photosDone} of ${photoQ.length})${eta}`;
    };
    sy.progress = { done, total, label: photoQ.length ? photoLabel() : 'Uploading' };
    const nameFor = r => {
      if (r.driveName) return;
      const c = ctx[r.id] || { base: 'Photo', n: 1 };
      const ext = FS.mediaExt(r);
      let name = FS.safeName(`${c.base} – ${c.n}`) + ext, k = 2;
      while (used.has(name)) name = FS.safeName(`${c.base} – ${c.n} (${k++})`) + ext;
      used.add(name); r.driveName = name;
    };
    async function one(r) {
      const video = r.kind === 'video';
      if (!r.driveId) {
        nameFor(r);
        const vStart = Date.now();
        const blob = video ? r.blob : await uploadCopy(r.blob);
        r.driveId = await uploadBlob(blob, sy.photosFolderId, r.driveName, false, video
          ? (a, b) => { const rate = a / Math.max(1, Date.now() - vStart); sy.progress.label = `Uploading video ${FS.fmtBytes(a)} of ${FS.fmtBytes(b)} – ${mins((b - a) / Math.max(rate, 1e-6))}`; paint(s); } : null);
        await DB.put('photos', r);
      }
      if (r.marked && !r.markedDriveId) {
        nameFor(r);
        r.markedDriveId = await uploadBlob(await uploadCopy(r.marked), sy.photosFolderId, r.driveName.replace(/\.jpg$/i, '') + ' (marked).jpg', true);
        await DB.put('photos', r);
      }
      done++; if (!video) photosDone++;
      sy.progress = { done, total, label: video ? `Uploaded video (${done} of ${todo.length} files)` : photoLabel() };
      await save(s); paint(s);
    }
    // photos: several at a time
    let next = 0, failed = null;
    const worker = async () => { while (!failed && next < photoQ.length) { const r = photoQ[next++]; try { await one(r); } catch (e) { failed = failed || e; } } };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, photoQ.length) }, worker));
    if (failed) throw failed;
    // videos: one at a time (each already goes up in pieces)
    for (const r of vidQ) await one(r);

    // 3. PDF with links to the originals
    sy.progress = { done, total, label: 'Building PDF report' }; await save(s); paint(s);
    const pdf = await FS.buildPDF(s, { links: true, onProgress: t => { sy.progress.label = t; paint(s); } });
    sy.progress = { done, total, label: `Uploading PDF (${FS.fmtBytes(pdf.size)})` }; paint(s);
    sy.pdfId = await uploadBlob(pdf, sy.folderId, FS.fileBase(s) + '.pdf', true, (a, b) => { sy.progress.label = `Uploading PDF ${Math.round(100 * a / b)}%`; paint(s); });
    done++;

    // 4. Excel
    sy.progress = { done, total, label: 'Building Excel workbook' }; await save(s); paint(s);
    const xl = await FS.buildExcel(s);
    sy.xlsxId = await uploadBlob(xl, sy.folderId, FS.fileBase(s).replace('Field Survey', 'Equipment List') + '.xlsx', true);
    done++;

    // 5. survey data (so it can be opened and edited on a computer, and for the look-up step)
    const photoMeta = [];
    for (const r of await DB.photosFor(s.id)) photoMeta.push({ id: r.id, kind: r.kind || 'photo', mime: r.mime || null, size: r.size || null, duration: r.duration || null, driveId: r.driveId, markedDriveId: r.markedDriveId || null, driveName: r.driveName, w: r.w, h: r.h, takenAt: r.takenAt, strokes: r.strokes || null });
    const data = { app: 'field-survey', version: 1, survey: { ...s, status: 'uploaded' }, photos: photoMeta, uploadedAt: new Date().toISOString() };
    sy.dataId = await uploadBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), sy.folderId, 'survey-data.json', true);
    done++;

    sy.videosWaiting = recs.filter(r => r.kind === 'video' && !r.driveId && r.blob).length;
    if (!sy.videosWaiting) sy.holdVideos = false;
    s.status = 'uploaded';
    sy.uploadedAt = s.updatedAt > sy.startedAt ? sy.startedAt : Math.max(Date.now(), s.updatedAt);
    sy.progress = null;
    await save(s);
    lastPaint = 0; paint(s);
    FS.toast(`✓ ${FS.surveyTitle(s)} uploaded to Google Drive${sy.videosWaiting ? ` — ${sy.videosWaiting} video${sy.videosWaiting > 1 ? 's' : ''} still to send on Wi-Fi` : ''}`, 5000);
  }

  async function run(force) {
    if (running) return;
    running = true;
    let woke = false;
    try {
      const all = await DB.all('surveys');
      const q = all.filter(s => s.status === 'queued' || s.status === 'uploading' || (force && s.status === 'error'))
        .sort((a, b) => (a.sync.queuedAt || 0) - (b.sync.queuedAt || 0));
      if (q.length) { await keepAwake(); woke = true; }
      for (const s0 of q) {
        try { await uploadSurvey(s0.id); }
        catch (e) {
          const s = FS.cur && FS.cur.id === s0.id ? FS.cur : await DB.get('surveys', s0.id);
          if (!s) continue;
          if (e instanceof NetError) { s.status = 'queued'; s.sync.lastError = 'Waiting for signal'; }
          else { s.status = 'error'; s.sync.lastError = e.message; }
          if (s.sync.progress) s.sync.progress.label = s.status === 'queued' ? 'Waiting for signal' : 'Stopped';
          await DB.put('surveys', s);
          lastPaint = 0; paint(s);
          if (e instanceof NetError) break;   // no point trying the others
        }
      }
    } finally { running = false; if (woke) letSleep(); FS.updateNet(); }
  }

  async function list() {
    const r = await call({ action: 'list' });
    return r.items || [];
  }

  async function importSurvey(fileId) {
    const r = await call({ action: 'get', id: fileId });
    const data = JSON.parse(decodeURIComponent(escape(atob(r.b64))));
    const s = FS.normalize(data.survey);
    const local = await DB.get('surveys', s.id);
    if (local && local.updatedAt > (local.sync.uploadedAt || 0) + 2000 && !confirm('This device has changes to this survey that were never uploaded. Replace them with the Drive copy?')) return local.id;
    for (const p of data.photos || []) {
      const ex = await DB.get('photos', p.id);
      const rec = ex || { id: p.id, surveyId: s.id, blob: null, thumb: null, marked: null, markedThumb: null };
      Object.assign(rec, { kind: p.kind || 'photo', mime: p.mime || null, size: p.size || rec.size, duration: p.duration || null, driveId: p.driveId, markedDriveId: p.markedDriveId, driveName: p.driveName, w: p.w, h: p.h, takenAt: p.takenAt, strokes: p.strokes });
      if (p.markedDriveId && !rec.marked) { rec.marked = null; }
      await DB.put('photos', rec);
    }
    s.status = 'uploaded';
    s.sync.uploadedAt = s.updatedAt;
    await DB.put('surveys', s);
    return s.id;
  }

  async function download(driveId) {
    const r = await call({ action: 'get', id: driveId });
    return fromB64(r.b64, r.mimeType || 'image/jpeg');
  }
  async function thumb(driveId) {
    const r = await call({ action: 'thumb', id: driveId });
    return fromB64(r.b64, r.mimeType || 'image/png');
  }

  FS.Sync = { call, run, list, importSurvey, download, thumb, isRunning: () => running };

  // keep trying while anything is waiting
  window.addEventListener('online', () => run());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (running) keepAwake(); run(); } });
  setInterval(async () => {
    if (!navigator.onLine || running) return;
    const all = await DB.all('surveys');
    if (all.some(s => s.status === 'queued' || s.status === 'uploading')) run();
  }, 30000);
})();
