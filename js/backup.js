/* Backup file: the whole survey (data + full-size photos + videos) in one .zip.
   Made with no signal, saved with the iPhone share screen ("Save to Files"), opens on a Windows laptop,
   and can be restored into the app on any phone. Also: saving photos/videos to the iPhone Photos app. */
(function () {
  const FS = window.FS, DB = FS.DB;

  /* ------------------------------------------------------------ zip (stored, no compression) */
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const readBuf = blob => blob.arrayBuffer ? blob.arrayBuffer() : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(blob); });
  async function crc32(blob, onBytes) {
    let c = 0xFFFFFFFF;
    const STEP = 8 * 1024 * 1024;
    for (let p = 0; p < blob.size; p += STEP) {
      const u = new Uint8Array(await readBuf(blob.slice(p, Math.min(blob.size, p + STEP))));
      for (let i = 0; i < u.length; i++) c = CRC_T[(c ^ u[i]) & 0xFF] ^ (c >>> 8);
      onBytes && onBytes(u.length);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function dosTime(d) {
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }
  async function makeZip(entries, onProgress) {   // entries: [{name, blob}]
    const parts = [], central = [];
    const enc = new TextEncoder(), { time, date } = dosTime(new Date());
    const total = entries.reduce((a, e) => a + e.blob.size, 0);
    if (total > 3.9 * 1024 * 1024 * 1024) throw new Error('This survey is too large for one backup file (over 4 GB).');
    let offset = 0, done = 0;
    for (const e of entries) {
      const name = enc.encode(e.name);
      let crc;
      try { crc = await crc32(e.blob, n => { done += n; onProgress && onProgress(done, total); }); }
      catch (err) {
        // the phone's copy could not be read: use the copy in Google Drive if there is one
        const alt = e.repair && await e.repair().catch(() => null);
        if (!alt) throw new Error(`${e.name.replace(/^.*\//, '')} could not be read on this phone.`);
        e.blob = alt; crc = await crc32(e.blob);
      }
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
      h.setUint32(18, e.blob.size, true); h.setUint32(22, e.blob.size, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, name, e.blob);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
      c.setUint32(20, e.blob.size, true); c.setUint32(24, e.blob.size, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + e.blob.size;
    }
    const cdSize = central.reduce((a, b) => a + b.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }
  async function readZip(file) {
    const tailLen = Math.min(file.size, 65557);
    const tail = new DataView(await readBuf(file.slice(file.size - tailLen)));
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('This is not a survey backup file.');
    const count = tail.getUint16(e + 10, true), cdSize = tail.getUint32(e + 12, true), cdOff = tail.getUint32(e + 16, true);
    const cd = new DataView(await readBuf(file.slice(cdOff, cdOff + cdSize)));
    const dec = new TextDecoder(), out = {};
    for (let i = 0, p = 0; i < count; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('The backup file is damaged.');
      const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
      const lo = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nl));
      out[name] = { lo, size: cd.getUint32(p + 24, true) };
      p += 46 + nl + xl + cl;
    }
    const get = async (name, type) => {
      const z = out[name]; if (!z) return null;
      const lh = new DataView(await readBuf(file.slice(z.lo, z.lo + 30)));
      const start = z.lo + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      return file.slice(start, start + z.size, type || '');
    };
    return { names: Object.keys(out), get };
  }

  /* ------------------------------------------------------------ make a backup */
  FS.backupName = s => FS.fileBase(s) + ' – Backup.zip';
  FS.buildBackup = async function (s, onProgress) {
    await FS.flush();
    const ctx = FS.photoContexts(s);
    const recs = await DB.photosFor(s.id);
    const used = new Set(), entries = [], meta = [];
    const uniq = (base, ext) => { let n = FS.safeName(base) + ext, k = 2; while (used.has(n)) n = FS.safeName(`${base} (${k++})`) + ext; used.add(n); return n; };
    for (const r of recs) {
      const c = ctx[r.id];
      const m = { id: r.id, kind: r.kind || 'photo', mime: r.mime || null, size: r.size || null, duration: r.duration || null,
        driveId: r.driveId || null, markedDriveId: r.markedDriveId || null, driveName: r.driveName || null,
        w: r.w, h: r.h, takenAt: r.takenAt, strokes: r.strokes || null, inRoll: !!r.inRoll, file: null, markedFile: null };
      const base = c ? `${c.base} – ${c.n}` : `Unused – ${r.id}`;
      const folder = r.kind === 'video' ? 'Videos/' : 'Photos/';
      if (r.blob) { m.file = folder + uniq(base, FS.mediaExt(r)); entries.push({ name: m.file, blob: r.blob, repair: () => FS.repairFromDrive(r, false) }); }
      if (r.marked) { m.markedFile = 'Photos/' + uniq(base + ' (marked)', '.jpg'); entries.push({ name: m.markedFile, blob: r.marked, repair: () => FS.repairFromDrive(r, true) }); }
      meta.push(m);
    }
    const data = { app: 'field-survey', version: 1, backup: true, appVersion: FS.VERSION, madeAt: new Date().toISOString(), survey: s, photos: meta };
    entries.unshift({ name: 'survey-data.json', blob: new Blob([JSON.stringify(data)], { type: 'application/json' }) });
    return makeZip(entries, onProgress);
  };

  /* ------------------------------------------------------------ restore */
  FS.restoreBackup = async function (file, onProgress) {
    const z = await readZip(file);
    const jb = await z.get('survey-data.json', 'application/json');
    if (!jb) throw new Error('This is not a survey backup file.');
    const data = JSON.parse(await jb.text());
    if (data.app !== 'field-survey' || !data.survey) throw new Error('This is not a survey backup file.');
    const s = FS.normalize(data.survey);
    const local = await DB.get('surveys', s.id);
    if (local && local.updatedAt > s.updatedAt + 2000 && !confirm('This phone has a NEWER copy of this survey than the backup. Replace it with the backup anyway?')) return null;
    if (local && local.updatedAt <= s.updatedAt + 2000 && !confirm('This survey is already on this phone. Replace it with the backup?')) return null;
    if (s.status === 'uploading') s.status = 'queued';
    const list = data.photos || [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      onProgress && onProgress(i + 1, list.length);
      const ex = await DB.get('photos', p.id);
      const rec = { id: p.id, surveyId: s.id, kind: p.kind === 'video' ? 'video' : undefined, mime: p.mime || null, size: p.size, duration: p.duration,
        driveId: p.driveId || null, markedDriveId: p.markedDriveId || null, driveName: p.driveName || null, w: p.w, h: p.h, takenAt: p.takenAt,
        strokes: p.strokes || null, inRoll: !!p.inRoll, blob: null, thumb: null, marked: null, markedThumb: null };
      if (!rec.kind) delete rec.kind;
      const type = p.mime || (p.kind === 'video' ? 'video/quicktime' : 'image/jpeg');
      if (p.file) rec.blob = await z.get(p.file, type);
      if (p.markedFile) rec.marked = await z.get(p.markedFile, 'image/jpeg');
      if (!rec.blob && ex && ex.blob) rec.blob = ex.blob;
      if (rec.kind !== 'video') {
        try { if (rec.blob) rec.thumb = (await FS.scaleToBlob(rec.blob, 420, 0.72)).blob; } catch (e) { }
        try { if (rec.marked) rec.markedThumb = (await FS.scaleToBlob(rec.marked, 420, 0.72)).blob; } catch (e) { }
        if (!rec.thumb && ex) rec.thumb = ex.thumb;
      }
      await DB.put('photos', rec);
      FS.forgetPhotoUrls(rec.id);
    }
    await DB.put('surveys', s);
    if (FS.cur && FS.cur.id === s.id) FS.cur = null;
    return s.id;
  };

  /* ------------------------------------------------------------ iPhone Photos app */
  FS.rollSetting = async () => (await DB.kvGet('saveToPhotos', true)) !== false;
  // records whose original is on the phone but not yet saved to Photos
  FS.rollPending = async (ids) => {
    const out = [];
    for (const id of ids) { const r = await DB.get('photos', id); if (r && r.blob && !r.inRoll) out.push(r); }
    return out;
  };
  // MUST be called straight from a tap (no awaits before navigator.share), so pass records already loaded.
  // btn (optional): shows "Opening…" while the share screen is up, and the reason if it doesn't open.
  FS.saveRecsToPhotos = function (recs, btn) {
    const say = msg => { if (btn) { let n = btn.parentNode && btn.parentNode.querySelector('.rollmsg'); if (!n) { n = document.createElement('div'); n.className = 'rollmsg muted small'; btn.insertAdjacentElement('afterend', n); } n.textContent = msg; } else alert(msg); };
    const files = recs.map((r, i) => new File([r.blob], `Survey ${r.kind === 'video' ? 'video' : 'photo'} ${i + 1}${FS.mediaExt(r)}`, { type: r.mime || r.blob.type || (r.kind === 'video' ? 'video/quicktime' : 'image/jpeg') }));
    if (!navigator.share || !(navigator.canShare && navigator.canShare({ files }))) {
      say('This file can\'t be sent to the iPhone share screen' + (recs[0] && recs[0].kind === 'video' ? ' (video may be too large). It is still safe in the app and in the backup file.' : '.'));
      return Promise.resolve(false);
    }
    const t0 = Date.now(), label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Opening share screen…'; }
    const done = () => { if (btn) { btn.disabled = false; btn.textContent = label; } };
    let p;
    try { p = navigator.share({ files }); } catch (e) { p = Promise.reject(e); }
    return p.then(async () => {
      for (const r of recs) { const cur = await DB.get('photos', r.id); if (cur) { cur.inRoll = true; await DB.put('photos', cur); } }
      done(); const m = btn && btn.parentNode && btn.parentNode.querySelector('.rollmsg'); if (m) m.remove(); return true;
    }).catch(e => {
      done();
      const fast = Date.now() - t0 < 1200;
      if (e && e.name === 'AbortError' && !fast) return false;          // the user closed the share screen
      if (e && e.name === 'InvalidStateError') say('The last share screen hasn\'t finished. Close it (or switch to another app and back), wait a few seconds, then tap again.');
      else say(`The share screen didn't open (${e && e.name || 'error'}${e && e.message ? ': ' + e.message : ''}). Wait a few seconds and tap again.`);
      return false;
    });
  };
  // one share screen at a time: 10 photos, or 1 video
  FS.rollBatch = recs => {
    if (!recs.length) return [];
    if (recs[0].kind === 'video') return [recs[0]];
    return recs.filter(r => r.kind !== 'video').slice(0, 10);
  };

  /* ------------------------------------------------------------ simple bottom sheet */
  FS.sheet = function (html) {
    const el = document.createElement('div'); el.className = 'sheetwrap';
    el.innerHTML = `<div class="sheet">${html}</div>`;
    document.body.appendChild(el);
    el.close = () => el.remove();
    el.addEventListener('click', e => { if (e.target === el) el.close(); });
    return el;
  };
})();
