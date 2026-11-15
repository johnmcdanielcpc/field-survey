/* Photos: capture (full resolution, untouched), thumbnails, viewer, markup editor. */
(function () {
  const FS = window.FS, DB = FS.DB;
  const urlCache = new Map();

  FS.loadImage = blob => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 0); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });

  FS.scaleToBlob = async function (blob, maxPx, quality) {
    const img = await FS.loadImage(blob);
    const s = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const out = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
    c.width = c.height = 0;
    return { blob: out, w, h, srcW: img.naturalWidth, srcH: img.naturalHeight };
  };

  FS.addPhotos = async function (files, surveyId) {
    const ids = [];
    for (const file of files) {
      if (!file || !/^image\//.test(file.type || 'image/jpeg')) continue;
      const t = await FS.scaleToBlob(file, 420, 0.72);
      const rec = {
        id: FS.uid(), surveyId, blob: file.slice(0, file.size, file.type || 'image/jpeg'), thumb: t.blob,
        w: t.srcW, h: t.srcH, size: file.size, takenAt: Date.now(), marked: null, markedThumb: null, strokes: null,
      };
      await DB.put('photos', rec);
      ids.push(rec.id);
    }
    return ids;
  };

  FS.getPhoto = id => DB.get('photos', id);

  /* Full-resolution blob. For surveys opened from Drive on a computer, fetch the original on demand. */
  FS.photoBlob = async function (rec, marked) {
    if (marked && rec.marked) return rec.marked;
    if (rec.blob) return rec.blob;
    if (rec.driveId && FS.Sync) {
      const b = await FS.Sync.download(rec.driveId);
      rec.blob = b; await DB.put('photos', rec);
      return b;
    }
    return null;
  };

  /* What the report shows: the marked-up copy if there is one, else the original. */
  FS.hasMarkup = rec => !!(rec && (rec.marked || rec.markedDriveId));
  FS.displayBlob = async function (rec) {
    if (rec.marked) return rec.marked;
    if (rec.markedDriveId && FS.Sync) {
      const b = await FS.Sync.download(rec.markedDriveId);
      rec.marked = b; await DB.put('photos', rec);
      return b;
    }
    return FS.photoBlob(rec);
  };

  FS.photoUrl = async function (id, full) {
    const key = id + (full ? ':f' : ':t');
    if (urlCache.has(key)) return urlCache.get(key);
    const rec = await FS.getPhoto(id);
    if (!rec) return '';
    let b = full ? await FS.displayBlob(rec) : (rec.markedThumb || rec.thumb);
    if (!b && !full && rec.driveId && FS.Sync) { try { b = await FS.Sync.thumb(rec.driveId); rec.thumb = b; await DB.put('photos', rec); } catch (e) { } }
    if (!b) return '';
    const u = URL.createObjectURL(b);
    urlCache.set(key, u);
    return u;
  };
  FS.forgetPhotoUrls = id => { for (const k of [id + ':f', id + ':t']) { if (urlCache.has(k)) { URL.revokeObjectURL(urlCache.get(k)); urlCache.delete(k); } } };

  /* ------------------------------------------------------------- viewer */
  FS.openViewer = async function ({ ids, index, title, onDelete, onChange }) {
    let i = index;
    const el = document.createElement('div');
    el.className = 'viewer';
    el.innerHTML = `<div class="cap"></div><div class="vimg"><img alt=""></div>
      <div class="vbar">
        <button class="btn" data-a="prev">‹</button>
        <button class="btn" data-a="mark">✎ Mark up</button>
        <button class="btn danger" data-a="del">Delete</button>
        <button class="btn primary" data-a="close">Done</button>
        <button class="btn" data-a="next">›</button>
      </div>`;
    document.body.appendChild(el);
    const img = el.querySelector('img'), cap = el.querySelector('.cap');
    async function show() {
      if (!ids.length) return close();
      i = Math.max(0, Math.min(i, ids.length - 1));
      const rec = await FS.getPhoto(ids[i]);
      cap.textContent = `${title} – Photo ${i + 1} of ${ids.length}${FS.hasMarkup(rec) ? ' (marked up)' : ''}`;
      img.src = await FS.photoUrl(ids[i], true);
      el.querySelector('[data-a=prev]').disabled = i === 0;
      el.querySelector('[data-a=next]').disabled = i === ids.length - 1;
    }
    function close() { el.remove(); }
    el.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      const act = a.dataset.a;
      if (act === 'close') close();
      if (act === 'prev') { i--; show(); }
      if (act === 'next') { i++; show(); }
      if (act === 'del') {
        if (!confirm('Delete this photo?')) return;
        const id = ids[i];
        await onDelete(id); ids = ids.filter(x => x !== id); show();
      }
      if (act === 'mark') {
        const rec = await FS.getPhoto(ids[i]);
        const saved = await FS.openMarkup(rec);
        if (saved) { FS.forgetPhotoUrls(rec.id); onChange && onChange(); show(); }
      }
    });
    show();
  };

  /* ------------------------------------------------------------- markup */
  const COLORS = ['#ff2d2d', '#ffd400', '#ffffff', '#111111'];
  FS.openMarkup = function (rec) {
    return new Promise(async resolve => {
      const src = await FS.photoBlob(rec);
      if (!src) { alert('Original photo is not on this device.'); return resolve(false); }
      const img = await FS.loadImage(src);
      const strokes = rec.strokes ? JSON.parse(JSON.stringify(rec.strokes)) : [];
      let tool = 'pen', color = COLORS[0];
      const el = document.createElement('div');
      el.className = 'viewer markup';
      el.innerHTML = `
        <div class="mtools">
          <button data-t="pen" class="on">✎ Pen</button><button data-t="arrow">➜ Arrow</button>
          <button data-t="circle">◯ Circle</button><button data-t="text">T Text</button>
          ${COLORS.map((c, k) => `<button class="sw${k ? '' : ' on'}" data-c="${c}" style="background:${c}"></button>`).join('')}
        </div>
        <div class="mstage"><canvas></canvas></div>
        <div class="vbar">
          <button class="btn" data-a="undo">Undo</button>
          ${rec.marked ? '<button class="btn danger" data-a="clear">Remove markup</button>' : ''}
          <button class="btn" data-a="cancel">Cancel</button>
          <button class="btn primary" data-a="save">Save</button>
        </div>`;
      document.body.appendChild(el);
      const stage = el.querySelector('.mstage'), cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
      let W, H, dpr = window.devicePixelRatio || 1;
      function fit() {
        const r = stage.getBoundingClientRect();
        const s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
        W = Math.floor(img.naturalWidth * s); H = Math.floor(img.naturalHeight * s);
        cv.style.width = W + 'px'; cv.style.height = H + 'px';
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        redraw();
      }
      function redraw(extra) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        for (const s of extra ? [...strokes, extra] : strokes) FS.drawStroke(ctx, s, cv.width, cv.height);
      }
      const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
      let cur = null;
      cv.addEventListener('pointerdown', e => {
        e.preventDefault(); cv.setPointerCapture(e.pointerId);
        const p = pos(e);
        if (tool === 'text') {
          const t = prompt('Text to add:');
          if (t) { strokes.push({ tool: 'text', color, pts: [p], text: t }); redraw(); }
          return;
        }
        cur = { tool, color, pts: [p] };
      });
      cv.addEventListener('pointermove', e => {
        if (!cur) return;
        const p = pos(e);
        if (cur.tool === 'pen') cur.pts.push(p); else cur.pts[1] = p;
        redraw(cur);
      });
      const end = () => { if (cur && cur.pts.length > 1) strokes.push(cur); cur = null; redraw(); };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      el.querySelector('.mtools').addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.t) { tool = b.dataset.t; el.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b)); }
        if (b.dataset.c) { color = b.dataset.c; el.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); }
      });
      const done = v => { window.removeEventListener('resize', fit); el.remove(); resolve(v); };
      el.querySelector('.vbar').addEventListener('click', async e => {
        const a = e.target.closest('[data-a]'); if (!a) return;
        if (a.dataset.a === 'undo') { strokes.pop(); redraw(); }
        if (a.dataset.a === 'cancel') done(false);
        if (a.dataset.a === 'clear') {
          if (!confirm('Remove the markup and keep only the original?')) return;
          rec.marked = rec.markedThumb = rec.strokes = null; rec.markedDriveId = null;
          await DB.put('photos', rec); done(true);
        }
        if (a.dataset.a === 'save') {
          if (!strokes.length) return done(false);
          a.disabled = true; a.textContent = 'Saving…';
          // render at full resolution (capped for iPhone canvas limits)
          const s = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
          const x = c.getContext('2d');
          x.drawImage(img, 0, 0, c.width, c.height);
          for (const st of strokes) FS.drawStroke(x, st, c.width, c.height);
          rec.marked = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
          c.width = c.height = 0;
          rec.markedThumb = (await FS.scaleToBlob(rec.marked, 420, 0.72)).blob;
          rec.strokes = strokes; rec.markedDriveId = null; rec.markedAt = Date.now();
          await DB.put('photos', rec);
          done(true);
        }
      });
      window.addEventListener('resize', fit);
      requestAnimationFrame(fit);
    });
  };

  FS.drawStroke = function (ctx, s, w, h) {
    const lw = Math.max(2, Math.round(Math.hypot(w, h) * 0.006));
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = s.color; ctx.lineWidth = lw; ctx.lineCap = ctx.lineJoin = 'round';
    const P = s.pts.map(p => [p[0] * w, p[1] * h]);
    if (s.tool === 'pen') {
      ctx.beginPath(); P.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
    } else if (s.tool === 'arrow' && P[1]) {
      const [a, b] = P, ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hl = lw * 5;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - hl * Math.cos(ang - 0.45), b[1] - hl * Math.sin(ang - 0.45));
      ctx.lineTo(b[0] - hl * Math.cos(ang + 0.45), b[1] - hl * Math.sin(ang + 0.45));
      ctx.closePath(); ctx.fill();
    } else if (s.tool === 'circle' && P[1]) {
      const [a, b] = P;
      ctx.beginPath();
      ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2 + 1, Math.abs(b[1] - a[1]) / 2 + 1, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.tool === 'text') {
      const fs = Math.round(lw * 7);
      ctx.font = `bold ${fs}px -apple-system, Helvetica, Arial, sans-serif`;
      ctx.lineWidth = Math.max(2, fs / 7); ctx.strokeStyle = s.color === '#111111' ? '#fff' : '#000';
      ctx.strokeText(s.text, P[0][0], P[0][1]); ctx.fillText(s.text, P[0][0], P[0][1]);
    }
    ctx.restore();
  };
})();
