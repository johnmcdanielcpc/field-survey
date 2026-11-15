/* Screens, routing and form rendering. */
(function () {
  const FS = window.FS, DB = FS.DB, F = window.SURVEY_FORM, esc = FS.esc;
  const $ = (s, el = document) => el.querySelector(s);
  FS.DEFAULT_NAMES = ['John McDaniel', 'Johnny McDaniel', 'Other Guy'];
  const view = $('#view'), bottom = $('#bottom');
  FS.cur = null;            // survey currently open
  let saveTimer = null;

  /* ---------------------------------------------------------------- utils */
  FS.toast = (msg, ms = 2600) => {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), ms);
  };
  FS.busy = (msg) => {
    let el = $('.busy');
    if (msg === false) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.className = 'busy'; el.innerHTML = '<div class="spinner"></div><div class="bmsg"></div>'; document.body.appendChild(el); }
    el.querySelector('.bmsg').textContent = msg;
  };
  FS.save = (immediate) => {
    if (!FS.cur) return;
    FS.cur.updatedAt = Date.now();
    clearTimeout(saveTimer);
    const s = FS.cur;
    const go = () => DB.put('surveys', s).catch(e => alert('Could not save: ' + e.message));
    if (immediate) return go();
    saveTimer = setTimeout(go, 300);
  };
  FS.flush = () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; return FS.cur && DB.put('surveys', FS.cur); } };
  window.addEventListener('pagehide', () => FS.flush());
  document.addEventListener('visibilitychange', () => { if (document.hidden) FS.flush(); });

  FS.deliverFile = async (blob, name) => {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 30000);
  };

  FS.settings = async () => ({
    url: await DB.kvGet('uploadUrl', ''), key: await DB.kvGet('uploadKey', ''),
    names: await DB.kvGet('names', FS.DEFAULT_NAMES),
    me: await DB.kvGet('me', ''),
  });

  function setHeader(title, back) {
    $('#title').textContent = title;
    const b = $('#backBtn'); b.hidden = !back; b.dataset.href = back || '';
  }
  $('#backBtn').addEventListener('click', e => { location.hash = e.currentTarget.dataset.href; });
  $('#settingsBtn').addEventListener('click', () => { location.hash = '#/settings'; });
  $('#netPill').addEventListener('click', () => { location.hash = '#/'; });

  FS.updateNet = async () => {
    const pill = $('#netPill');
    const all = await DB.all('surveys');
    const waiting = all.filter(s => ['queued', 'uploading', 'error'].includes(s.status)).length;
    const on = navigator.onLine;
    pill.textContent = (on ? 'Online' : 'Offline') + (waiting ? ` · ${waiting} to upload` : '');
    pill.className = 'pill' + (on ? '' : ' off') + (waiting ? ' wait' : '');
  };
  window.addEventListener('online', FS.updateNet); window.addEventListener('offline', FS.updateNet);

  async function loadSurvey(id) {
    if (FS.cur && FS.cur.id === id) return FS.cur;
    await FS.flush();
    const s = await DB.get('surveys', id);
    FS.cur = s ? FS.normalize(s) : null;
    return FS.cur;
  }

  function statusBadge(s) {
    const map = {
      draft: ['In progress', ''], queued: ['Waiting to upload', 'warn'], uploading: ['Uploading…', 'blue'],
      uploaded: ['✓ Uploaded', 'ok'], error: ['Upload problem', 'bad'],
    };
    let [t, c] = map[s.status] || map.draft;
    if (s.status === 'uploaded' && s.updatedAt > (s.sync.uploadedAt || 0) + 2000) { t = 'Edited since upload'; c = 'warn'; }
    return `<span class="badge ${c}">${t}</span>`;
  }

  /* ---------------------------------------------------------------- router */
  async function route() {
    const h = location.hash || '#/';
    if (h.startsWith('#setup=')) return applySetupLink(h.slice(7));
    const p = h.slice(2).split('?')[0].split('/').filter(Boolean);
    const q = new URLSearchParams(h.split('?')[1] || '');
    bottom.innerHTML = '';
    window.scrollTo(0, 0);
    try {
      if (!p.length) return await home();
      if (p[0] === 'settings') return await settingsView();
      if (p[0] === 'drive') return await driveView();
      if (p[0] === 's') {
        const s = await loadSurvey(p[1]);
        if (!s) { location.hash = '#/'; return; }
        if (p.length === 2) return await surveyView(s);
        if (p[2] === 'review') return await reviewView(s);
        if (p[2] === 'r') return await groupView(s, decodeURIComponent(p.slice(3).join('/')), q.get('f'));
      }
      location.hash = '#/';
    } catch (e) { console.error(e); view.innerHTML = `<div class="banner bad">Something went wrong: ${esc(e.message)}</div>`; }
  }
  window.addEventListener('hashchange', route);
  FS.route = route;

  /* ---------------------------------------------------------------- home */
  async function home() {
    setHeader('Field Survey');
    const st = await FS.settings();
    const all = (await DB.all('surveys')).map(FS.normalize).sort((a, b) => b.updatedAt - a.updatedAt);
    const waiting = all.filter(s => ['queued', 'uploading', 'error'].includes(s.status));
    view.innerHTML = `
      ${!st.url ? `<div class="banner warn">Uploads aren't set up on this device yet. Open the setup link you were sent, or enter the upload link in <a href="#/settings">Settings</a>.</div>` : ''}
      ${waiting.length ? `<div class="banner warn row"><div class="grow"><b>${waiting.length} survey${waiting.length > 1 ? 's' : ''} waiting to upload.</b> ${navigator.onLine ? '' : 'No signal right now — they will upload when the app is open with signal.'}</div>
        <button class="btn" id="syncNow">Upload now</button></div>` : ''}
      <div class="card">
        <div class="flabel">Who is surveying?</div>
        ${personSelect(st, st.me, 'meSel')}
      </div>
      <button class="btn accent block" id="newBtn">＋ New survey</button>
      <h2>Surveys on this device</h2>
      ${all.length ? '' : '<p class="muted" style="margin:4px">No surveys yet.</p>'}
      <div id="list"></div>
      <p style="margin-top:20px" class="muted center"><a href="#/drive">Open a survey from Google Drive</a> (for editing on a computer)</p>`;
    const list = $('#list');
    for (const s of all) {
      const miss = FS.missingList(s).length;
      const photos = FS.photoIds(s).length;
      const d = document.createElement('div'); d.className = 'list-item';
      d.innerHTML = `<div class="grow"><div class="title">${esc(FS.surveyTitle(s))}</div>
        <div class="muted">${esc(s.values.site.date || '')} · ${esc(s.values.site.specialist || 'No name')} · ${photos} photos${miss ? ` · <span class="missing-text">${miss} missing</span>` : ''}</div>
        ${s.status === 'uploading' && s.sync.progress ? `<div class="progress"><i style="width:${Math.round(100 * s.sync.progress.done / s.sync.progress.total)}%"></i></div>` : ''}
        </div>${statusBadge(s)}<span class="chev">›</span>`;
      d.onclick = () => { location.hash = `#/s/${s.id}`; };
      list.appendChild(d);
    }
    $('#newBtn').onclick = async () => {
      const me = await DB.kvGet('me', '');
      if (!me) { alert('Pick your name first.'); return; }
      const s = FS.newSurvey(me);
      await DB.put('surveys', s); FS.cur = s;
      location.hash = `#/s/${s.id}/r/site`;
    };
    bindPerson($('#meSel'), async v => { await DB.kvSet('me', v); FS.toast(`Surveying as ${v}`); });
    const sn = $('#syncNow'); if (sn) sn.onclick = () => FS.Sync.run(true);
  }

  function personSelect(st, value, id) {
    const names = [...st.names]; if (value && !names.includes(value)) names.push(value);
    return `<select id="${id}"><option value="">— Pick a name —</option>${names.map(n => `<option ${n === value ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__add">＋ Add a name…</option></select>`;
  }
  function bindPerson(sel, onPick) {
    sel.onchange = async () => {
      let v = sel.value;
      if (v === '__add') {
        v = (prompt('Name to add:') || '').trim();
        if (!v) { sel.value = ''; return; }
        const names = await DB.kvGet('names', FS.DEFAULT_NAMES);
        if (!names.includes(v)) { names.push(v); await DB.kvSet('names', names); }
        const o = document.createElement('option'); o.textContent = v; sel.insertBefore(o, sel.lastElementChild); sel.value = v;
      }
      onPick(v);
    };
  }

  /* ---------------------------------------------------------------- survey overview */
  async function surveyView(s) {
    setHeader(FS.surveyTitle(s), '#/');
    const missBy = FS.missingByRoute(s);
    const totalMiss = FS.missingList(s).length;
    const unreviewed = Object.values(s.meta).filter(m => m.src === 'lookup' && !m.reviewed).length;
    const sy = s.sync || {};
    let banner = '';
    if (s.status === 'uploading' || s.status === 'queued') {
      const p = sy.progress;
      banner = `<div class="banner warn"><b>${s.status === 'uploading' ? 'Uploading' : 'Waiting to upload'}</b>${p ? ` – ${esc(p.label || '')} (${p.done} of ${p.total})` : ''}
        ${p ? `<div class="progress"><i style="width:${Math.round(100 * p.done / p.total)}%"></i></div>` : ''}
        ${!navigator.onLine ? '<div>No signal. Keep the app open once you have signal and it will finish.</div>' : ''}</div>`;
    } else if (s.status === 'error') {
      banner = `<div class="banner bad"><b>Upload problem:</b> ${esc(sy.lastError || '')}<br><button class="btn" id="retry" style="margin-top:8px">Try again</button></div>`;
    } else if (s.status === 'uploaded') {
      const edited = s.updatedAt > (sy.uploadedAt || 0) + 2000;
      banner = edited
        ? `<div class="banner warn">Changed since it was uploaded. <button class="btn" id="reup" style="margin-top:8px">Re-upload changes</button></div>`
        : `<div class="banner ok"><b>✓ Uploaded to Google Drive</b> ${FS.fmtDateTime(sy.uploadedAt)}${sy.folderUrl ? ` · <a href="${esc(sy.folderUrl)}" target="_blank">Open folder</a>` : ''}</div>`;
    }
    view.innerHTML = `${banner}
      ${unreviewed ? `<div class="banner lookup"><b>${unreviewed} look-up value${unreviewed > 1 ? 's' : ''} need your review.</b> They're shaded blue on the unit screens.</div>` : ''}
      <div id="secs"></div>
      <h2>More</h2>
      <div class="card btnrow">
        <button class="btn" id="pdfBtn">Preview PDF</button>
        <button class="btn" id="xlBtn">Excel workbook</button>
      </div>
      <div class="card btnrow">
        ${s.status === 'uploaded' ? '<button class="btn" id="freeBtn">Remove photos from this device</button>' : ''}
        <button class="btn danger" id="delBtn">Delete survey</button>
      </div>`;
    const secs = $('#secs');
    for (const sec of F.sections) {
      const obj = s.values[sec.id];
      const rep = sec.fields.find(f => f.type === 'repeat');
      let sub = [];
      if (rep) sub.push(`${obj[rep.id].length} ${rep.itemName.toLowerCase()}${obj[rep.id].length === 1 ? '' : 's'}`);
      sub.push(`${FS.photoCount(sec.fields, obj)} photos`);
      const m = missBy[sec.id] || 0;
      const d = document.createElement('div'); d.className = 'list-item';
      d.innerHTML = `<div class="grow"><div class="title">${esc(sec.title)}</div><div class="muted">${sub.join(' · ')}</div></div>
        ${m ? `<span class="badge miss">${m} missing</span>` : ''}<span class="chev">›</span>`;
      d.onclick = () => { location.hash = `#/s/${s.id}/r/${sec.id}`; };
      secs.appendChild(d);
    }
    bottom.innerHTML = `<div class="bottombar">
      <button class="btn" id="revBtn">Review${totalMiss ? ` (${totalMiss} missing)` : ' ✓'}</button>
      <button class="btn primary" id="finBtn">${s.status === 'uploaded' ? 'Re-upload' : 'Finish & Upload'}</button></div>`;
    $('#revBtn').onclick = () => { location.hash = `#/s/${s.id}/review`; };
    $('#finBtn').onclick = () => finish(s);
    const rt = $('#retry'); if (rt) rt.onclick = () => { s.status = 'queued'; FS.save(true).then(() => FS.Sync.run(true)); };
    const ru = $('#reup'); if (ru) ru.onclick = () => finish(s);
    $('#pdfBtn').onclick = async () => {
      try { FS.busy('Building PDF…'); const b = await FS.buildPDF(s, { onProgress: t => FS.busy(t) }); FS.busy(false); FS.deliverFile(b, FS.fileBase(s) + '.pdf'); }
      catch (e) { FS.busy(false); alert('PDF failed: ' + e.message); }
    };
    $('#xlBtn').onclick = async () => {
      try { FS.busy('Building Excel…'); const b = await FS.buildExcel(s); FS.busy(false); FS.deliverFile(b, FS.fileBase(s).replace('Field Survey', 'Equipment List') + '.xlsx'); }
      catch (e) { FS.busy(false); alert('Excel failed: ' + e.message); }
    };
    $('#delBtn').onclick = async () => {
      const notUp = s.status !== 'uploaded';
      if (!confirm(notUp ? 'This survey has NOT been uploaded. Delete it and all its photos from this device? This cannot be undone.' : 'Delete this survey from this device? (The copy in Google Drive is kept.)')) return;
      for (const k of await DB.photoKeysFor(s.id)) await DB.del('photos', k);
      await DB.del('surveys', s.id); FS.cur = null; location.hash = '#/';
    };
    const fr = $('#freeBtn'); if (fr) fr.onclick = async () => {
      if (!confirm('Remove the full-size photos from this device to free up space? Thumbnails stay, and the originals are safe in Google Drive.')) return;
      let freed = 0;
      for (const rec of await DB.photosFor(s.id)) {
        if (rec.driveId && rec.blob && (!rec.marked || rec.markedDriveId)) { freed += rec.blob.size + (rec.marked ? rec.marked.size : 0); rec.blob = null; rec.marked = null; await DB.put('photos', rec); }
      }
      FS.toast(`Freed ${FS.fmtBytes(freed)}`);
    };
  }

  async function finish(s) {
    const miss = FS.missingList(s).length;
    if (miss && !confirm(`${miss} item${miss > 1 ? 's are' : ' is'} still missing.\n\nUpload anyway? (Tap Cancel to review them first.)`)) {
      location.hash = `#/s/${s.id}/review`; return;
    }
    const st = await FS.settings();
    if (!st.url) { alert('Uploads are not set up on this device. Open Settings and enter the upload link.'); return; }
    s.status = 'queued'; s.sync.queuedAt = Date.now(); s.sync.lastError = '';
    await FS.save(true);
    FS.toast(navigator.onLine ? 'Uploading…' : 'Saved to outbox. It will upload when you have signal.');
    FS.updateNet();
    route();
    FS.Sync.run(true);
  }

  /* ---------------------------------------------------------------- review */
  async function reviewView(s) {
    setHeader('Review missing info', `#/s/${s.id}`);
    const list = FS.missingList(s);
    const groups = new Map();
    for (const x of list) {
      const k = x.route;
      if (!groups.has(k)) groups.set(k, { sec: x.sec, labels: x.labels, route: x.route, items: [] });
      groups.get(k).items.push(x);
    }
    view.innerHTML = list.length
      ? `<div class="banner warn"><b>${list.length} item${list.length > 1 ? 's' : ''} missing.</b> Tap any line to go fill it in. You can still upload with blanks — they'll show as "Not entered" in the report.</div><div id="rv"></div>`
      : `<div class="banner ok"><b>✓ Nothing missing.</b> Ready to upload.</div>`;
    let lastSec = null;
    const rv = $('#rv');
    for (const g of groups.values()) {
      if (g.sec !== lastSec) { const h = document.createElement('h2'); h.textContent = g.sec.title; rv.appendChild(h); lastSec = g.sec; }
      const c = document.createElement('div'); c.className = 'card review-card';
      c.innerHTML = `<div class="title">${esc(g.labels.join(' – ') || g.sec.title)}</div>` +
        g.items.map((x, i) => `<button class="review-line" data-i="${i}">${esc(x.what)}<span class="chev">›</span></button>`).join('');
      c.addEventListener('click', e => {
        const b = e.target.closest('.review-line'); if (!b) return;
        const x = g.items[+b.dataset.i];
        location.hash = `#/s/${s.id}/r/${encodeURIComponent(x.route)}?f=${x.field.id}`;
      });
      rv.appendChild(c);
    }
    bottom.innerHTML = `<div class="bottombar"><button class="btn" onclick="location.hash='#/s/${s.id}'">Back to survey</button>
      <button class="btn primary" id="finBtn">${s.status === 'uploaded' ? 'Re-upload' : 'Finish & Upload'}</button></div>`;
    $('#finBtn').onclick = () => finish(s);
  }

  /* ---------------------------------------------------------------- section / unit screen */
  async function groupView(s, routeStr, focusField) {
    const R = FS.resolve(s, routeStr);
    if (!R) { location.hash = `#/s/${s.id}`; return; }
    const L = R.last;
    const parentRoute = R.chain.length > 1 ? R.chain[R.chain.length - 2].route : null;
    const back = parentRoute ? `#/s/${s.id}/r/${encodeURIComponent(parentRoute)}` : `#/s/${s.id}`;
    setHeader(L.type === 'item' ? L.label : L.label, back);
    const missBy = FS.missingByRoute(s);
    const crumbs = R.chain.length > 1 ? `<div class="crumbs">${R.chain.slice(0, -1).map(c => esc(c.label)).join(' › ')}</div>` : '';
    view.innerHTML = crumbs + '<div class="card" id="fields"></div><div id="after"></div>';
    renderFields(s, L.fields, L.obj, L.route, $('#fields'), missBy);

    // bottom navigation
    if (L.type === 'item') {
      const { arr, idx, def } = L;
      const prev = arr[idx - 1], next = arr[idx + 1];
      const base = L.route.split('/').slice(0, -1).join('/');
      bottom.innerHTML = `<div class="bottombar">
        <button class="btn" id="pv" ${prev ? '' : 'disabled'}>‹ Prev</button>
        <button class="btn primary" id="dn">Done</button>
        <button class="btn" id="nx">${next ? 'Next ›' : `＋ ${esc(def.itemName)}`}</button></div>`;
      $('#pv').onclick = () => { if (prev) location.hash = `#/s/${s.id}/r/${encodeURIComponent(base + '/' + prev._id)}`; };
      $('#dn').onclick = () => { location.hash = back; };
      $('#nx').onclick = () => {
        if (next) { location.hash = `#/s/${s.id}/r/${encodeURIComponent(base + '/' + next._id)}`; return; }
        const it = FS.newItem(def, arr); arr.push(it); FS.save(true);
        location.hash = `#/s/${s.id}/r/${encodeURIComponent(base + '/' + it._id)}`;
      };
      const del = document.createElement('button'); del.className = 'btn danger block'; del.style.marginTop = '8px';
      del.textContent = `Delete ${L.label}`;
      del.onclick = async () => {
        if (!confirm(`Delete ${L.label} and its photos?`)) return;
        const pids = [];
        collectPhotos(def.fields, L.obj, pids);
        for (const id of pids) await DB.del('photos', id);
        arr.splice(idx, 1); await FS.save(true); location.hash = back;
      };
      $('#after').appendChild(del);
    } else {
      const i = F.sections.indexOf(R.sec), next = F.sections[i + 1];
      bottom.innerHTML = `<div class="bottombar"><button class="btn" id="ov">Survey</button>
        ${next ? `<button class="btn primary" id="ns">Next: ${esc(next.title)} ›</button>` : `<button class="btn primary" id="ns">Review ›</button>`}</div>`;
      $('#ov').onclick = () => { location.hash = `#/s/${s.id}`; };
      $('#ns').onclick = () => { location.hash = next ? `#/s/${s.id}/r/${next.id}` : `#/s/${s.id}/review`; };
    }
    if (focusField) {
      const el = view.querySelector(`[data-fid="${CSS.escape(focusField)}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); const inp = el.querySelector('input,textarea'); if (inp && inp.type !== 'file') setTimeout(() => inp.focus(), 300); }
    }
  }
  function collectPhotos(fields, obj, out) {
    for (const f of fields) {
      if (f.type === 'photo') out.push(...(obj[f.id] || []));
      if (f.type === 'repeat') (obj[f.id] || []).forEach(it => collectPhotos(f.fields, it, out));
    }
  }

  const MISSING_CHECK = f => !(f.optional || f.lookup || f.type === 'check' || (f.type === 'photo' && !f.expect));

  function renderFields(s, fields, obj, route, host, missBy) {
    host.innerHTML = '';
    const normal = fields.filter(f => !f.lookup), lookups = fields.filter(f => f.lookup);
    const rerender = () => {
      const y = window.scrollY;
      renderFields(s, fields, obj, route, host, FS.missingByRoute(s));
      window.scrollTo(0, y);
    };
    for (const f of normal) {
      if (!FS.visible(f, obj)) continue;
      if (f.type === 'repeat') host.appendChild(renderRepeat(s, f, obj, route, missBy));
      else host.appendChild(renderField(s, f, obj, route, rerender));
    }
    if (lookups.length) {
      const d = document.createElement('details'); d.className = 'lookupbox';
      const anyMeta = lookups.some(f => s.meta[FS.metaKey(route, f.id)]);
      if (anyMeta) d.open = true;
      d.innerHTML = `<summary>Look-up info <span class="muted">— filled in after the visit from model/serial</span></summary>`;
      for (const f of lookups) d.appendChild(renderField(s, f, obj, route, rerender));
      host.appendChild(d);
    }
  }

  function renderRepeat(s, def, obj, route, missBy) {
    const wrap = document.createElement('div'); wrap.className = 'repeat';
    const arr = obj[def.id];
    wrap.innerHTML = `<div class="flabel">${esc(def.itemName)}s (${arr.length})</div>`;
    arr.forEach((it, i) => {
      const r = `${route}/${def.id}/${it._id}`;
      const m = missBy[r] || 0, pc = FS.photoCount(def.fields, it);
      const sub = [it.area, it.category, it.running === 'No' ? 'Not running' : ''].filter(Boolean).map(esc).join(' · ');
      const c = document.createElement('div'); c.className = 'list-item unit-card';
      c.innerHTML = `<div class="grow"><div class="title">${esc(FS.itemLabel(def, it, i))}</div>
        <div class="muted">${sub ? sub + ' · ' : ''}${pc} photo${pc === 1 ? '' : 's'}</div></div>
        ${m ? `<span class="badge miss">${m} missing</span>` : '<span class="badge ok">✓</span>'}<span class="chev">›</span>`;
      c.onclick = () => { location.hash = `#/s/${s.id}/r/${encodeURIComponent(r)}`; };
      wrap.appendChild(c);
    });
    const add = document.createElement('button'); add.className = 'btn block add-unit';
    add.textContent = `＋ ${def.addLabel || 'Add ' + def.itemName}`;
    add.onclick = () => {
      const it = FS.newItem(def, arr); arr.push(it); FS.save(true);
      location.hash = `#/s/${s.id}/r/${encodeURIComponent(`${route}/${def.id}/${it._id}`)}`;
    };
    wrap.appendChild(add);
    return wrap;
  }

  function renderField(s, f, obj, route, rerender) {
    const w = document.createElement('div'); w.className = 'field'; w.dataset.fid = f.id;
    const mk = FS.metaKey(route, f.id), meta = s.meta[mk];
    const id = 'f_' + route.replace(/\W/g, '_') + '_' + f.id;
    const markMiss = () => w.classList.toggle('miss', MISSING_CHECK(f) && FS.isEmpty(obj[f.id]));
    const set = (v, rr) => {
      obj[f.id] = v;
      if (meta && meta.src === 'lookup') { meta.edited = true; }
      FS.save(); markMiss(); if (rr) rerender();
    };
    const label = `<label for="${id}">${esc(f.label)}</label>`;
    if (f.type === 'text' || f.type === 'number') {
      const list = f.suggest ? `<datalist id="${id}_dl">${f.suggest.map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : '';
      w.innerHTML = `${label}<input id="${id}" type="text" ${f.type === 'number' ? 'inputmode="decimal"' : f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${f.suggest ? `list="${id}_dl"` : ''} ${f.hint ? `placeholder="${esc(f.hint)}"` : ""} autocomplete="off" autocapitalize="${f.type === 'number' ? 'off' : 'characters'}" value="${esc(obj[f.id] || '')}">${list}`;
      if (/model|serial|tag|label|name|curb/i.test(f.id) === false) w.querySelector('input').setAttribute('autocapitalize', 'sentences');
      w.querySelector('input').addEventListener('input', e => set(e.target.value.trim() ? e.target.value : ''));
    } else if (f.type === 'textarea') {
      w.innerHTML = `${label}<textarea id="${id}" autocapitalize="sentences">${esc(obj[f.id] || '')}</textarea>`;
      w.querySelector('textarea').addEventListener('input', e => set(e.target.value));
    } else if (f.type === 'date') {
      w.innerHTML = `${label}<input id="${id}" type="date" value="${esc(obj[f.id] || '')}">`;
      w.querySelector('input').addEventListener('change', e => set(e.target.value));
    } else if (f.type === 'person') {
      w.innerHTML = `${label}<div class="psel">…</div>`;
      FS.settings().then(st => {
        w.querySelector('.psel').innerHTML = personSelect(st, obj[f.id] || '', id);
        bindPerson(w.querySelector('select'), v => set(v));
      });
    } else if (f.type === 'choice' || f.type === 'yesno') {
      const opts = f.type === 'yesno' ? ['Yes', 'No'] : f.options;
      w.innerHTML = `<div class="flabel">${esc(f.label)}</div><div class="chips">${opts.map(o => `<button type="button" class="chip ${obj[f.id] === o ? 'on' : ''}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
      w.querySelector('.chips').addEventListener('click', e => {
        const b = e.target.closest('.chip'); if (!b) return;
        const v = obj[f.id] === b.dataset.v ? '' : b.dataset.v;
        w.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x.dataset.v === v));
        set(v, true);
      });
    } else if (f.type === 'check') {
      w.innerHTML = `<label class="checkrow"><input type="checkbox" id="${id}" ${obj[f.id] ? 'checked' : ''}> ${esc(f.label)}</label>`;
      w.querySelector('input').addEventListener('change', e => set(e.target.checked ? true : false, true));
    } else if (f.type === 'photo') {
      renderPhotoField(s, f, obj, w, set);
    }
    if (meta && meta.src === 'lookup') {
      w.classList.toggle('looked', !meta.reviewed);
      const note = document.createElement('div'); note.className = 'lookup-note';
      note.innerHTML = meta.reviewed ? `✓ Look-up reviewed${meta.source ? ` · ${esc(meta.source)}` : ''}`
        : `From look-up${meta.confidence ? ` (${esc(meta.confidence)} confidence)` : ''}: ${meta.url ? `<a href="${esc(meta.url)}" target="_blank">${esc(meta.source || 'source')}</a>` : esc(meta.source || '')} <button class="btn small" type="button">Mark reviewed</button>`;
      const b = note.querySelector('button');
      if (b) b.onclick = () => { meta.reviewed = true; meta.reviewedAt = Date.now(); FS.save(); rerender(); };
      w.appendChild(note);
    }
    markMiss();
    return w;
  }

  function renderPhotoField(s, f, obj, w, set) {
    const ids = obj[f.id] || [];
    w.innerHTML = `<div class="flabel">${esc(f.label)} <span class="muted">(${ids.length})</span></div>
      <div class="photos"></div>
      <div class="addphoto">
        <label class="btn"><input type="file" accept="image/*" capture="environment">📷 Take photo</label>
        <label class="btn"><input type="file" accept="image/*" multiple>🖼 Library</label>
      </div>`;
    const grid = w.querySelector('.photos');
    ids.forEach(async (pid, i) => {
      const t = document.createElement('div'); t.className = 'thumb';
      t.innerHTML = `<img alt=""><span>${i + 1}</span>`;
      grid.appendChild(t);
      const rec = await FS.getPhoto(pid);
      if (FS.hasMarkup(rec)) t.classList.add('marked');
      t.querySelector('img').src = await FS.photoUrl(pid, false);
      t.onclick = () => FS.openViewer({
        ids: [...(obj[f.id] || [])], index: i, title: f.label,
        onDelete: async id => { obj[f.id] = obj[f.id].filter(x => x !== id); await DB.del('photos', id); FS.forgetPhotoUrls(id); set(obj[f.id]); redraw(); },
        onChange: () => redraw(),
      });
    });
    const redraw = () => { const nw = document.createElement('div'); nw.className = w.className; nw.dataset.fid = w.dataset.fid; renderPhotoField(s, f, obj, nw, set); w.replaceWith(nw); };
    w.querySelectorAll('input[type=file]').forEach(inp => inp.addEventListener('change', async () => {
      const files = [...inp.files]; inp.value = '';
      if (!files.length) return;
      FS.busy(`Saving ${files.length} photo${files.length > 1 ? 's' : ''}…`);
      try {
        const newIds = await FS.addPhotos(files, s.id);
        obj[f.id] = [...(obj[f.id] || []), ...newIds];
        set(obj[f.id]); await FS.save(true);
      } catch (e) { alert('Could not save photo: ' + e.message + (e.name === 'QuotaExceededError' ? '\nThe phone may be out of storage.' : '')); }
      FS.busy(false);
      redraw();
    }));
  }

  /* ---------------------------------------------------------------- settings */
  async function settingsView() {
    setHeader('Settings', '#/');
    const st = await FS.settings();
    let est = '';
    try { const e = await navigator.storage.estimate(); est = `${FS.fmtBytes(e.usage || 0)} used of about ${FS.fmtBytes(e.quota || 0)} available`; } catch (e) { }
    view.innerHTML = `
      <div class="card">
        <div class="flabel">Names in the dropdown</div>
        <div id="names"></div>
        <div class="row" style="margin-top:8px"><input id="newName" type="text" placeholder="Add a name" autocapitalize="words"><button class="btn" id="addName">Add</button></div>
      </div>
      <div class="card">
        <div class="flabel">Google Drive upload link</div>
        <input id="url" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(st.url)}">
        <div class="flabel" style="margin-top:10px">Upload key</div>
        <input id="key" type="text" autocapitalize="off" value="${esc(st.key)}">
        <div class="btnrow" style="margin-top:10px"><button class="btn primary" id="saveUp">Save</button><button class="btn" id="test">Test connection</button></div>
        <div id="testOut" class="muted" style="margin-top:8px"></div>
      </div>
      <div class="card">
        <div class="flabel">Set up another phone</div>
        <p class="muted">Copy this link and text it to a tech. When they open it in Safari, it fills in the upload settings and names. Then they tap Share → Add to Home Screen.</p>
        <button class="btn block" id="copyLink">Copy setup link</button>
      </div>
      <div class="card"><div class="flabel">Storage</div><div class="muted">${esc(est)}</div>
        <div class="muted" style="margin-top:6px">App version ${esc(FS.VERSION)}</div>
        <button class="btn block" id="upd" style="margin-top:8px">Check for app update</button></div>`;
    const drawNames = async () => {
      const names = await DB.kvGet('names', st.names);
      $('#names').innerHTML = names.map((n, i) => `<div class="row name-row"><div class="grow">${esc(n)}</div><button class="btn small danger" data-i="${i}">Remove</button></div>`).join('');
      $('#names').onclick = async e => { const b = e.target.closest('[data-i]'); if (!b) return; names.splice(+b.dataset.i, 1); await DB.kvSet('names', names); drawNames(); };
    };
    drawNames();
    $('#addName').onclick = async () => {
      const v = $('#newName').value.trim(); if (!v) return;
      const names = await DB.kvGet('names', st.names); if (!names.includes(v)) names.push(v);
      await DB.kvSet('names', names); $('#newName').value = ''; drawNames();
    };
    $('#saveUp').onclick = async () => { await DB.kvSet('uploadUrl', $('#url').value.trim()); await DB.kvSet('uploadKey', $('#key').value.trim()); FS.toast('Saved'); };
    $('#test').onclick = async () => {
      await DB.kvSet('uploadUrl', $('#url').value.trim()); await DB.kvSet('uploadKey', $('#key').value.trim());
      $('#testOut').textContent = 'Testing…';
      try { const r = await FS.Sync.call({ action: 'ping' }); $('#testOut').textContent = `✓ Connected. Uploads go to: ${r.root || 'Google Drive'}`; }
      catch (e) { $('#testOut').textContent = '✗ ' + e.message; }
    };
    $('#copyLink').onclick = async () => {
      const cfg = { url: $('#url').value.trim(), key: $('#key').value.trim(), names: await DB.kvGet('names', st.names) };
      const link = location.href.split('#')[0] + '#setup=' + btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      try { await navigator.clipboard.writeText(link); FS.toast('Setup link copied'); } catch (e) { prompt('Copy this link:', link); }
    };
    $('#upd').onclick = async () => {
      if (!navigator.serviceWorker) return FS.toast('Not available here');
      const r = await navigator.serviceWorker.getRegistration(); if (r) { await r.update(); FS.toast('Checked. If there is an update, you will see a notice.'); }
    };
  }

  async function applySetupLink(b64) {
    try {
      const cfg = JSON.parse(decodeURIComponent(escape(atob(b64.replace(/-/g, '+').replace(/_/g, '/')))));
      if (cfg.url) await DB.kvSet('uploadUrl', cfg.url);
      if (cfg.key) await DB.kvSet('uploadKey', cfg.key);
      if (cfg.names) { const names = await DB.kvGet('names', FS.DEFAULT_NAMES); for (const n of cfg.names) if (!names.includes(n)) names.push(n); await DB.kvSet('names', names); }
      FS.toast('✓ Upload settings saved on this device', 4000);
    } catch (e) { alert('That setup link did not work: ' + e.message); }
    history.replaceState(null, '', location.pathname + '#/');
    route();
  }

  /* ---------------------------------------------------------------- open from Drive (computer) */
  async function driveView() {
    setHeader('Open from Google Drive', '#/');
    view.innerHTML = '<div class="card muted">Loading surveys from Google Drive…</div>';
    try {
      const items = await FS.Sync.list();
      view.innerHTML = `<p class="muted" style="margin:4px 4px 10px">Pick a survey to open on this device. You can fill in look-up info, fix anything, and re-upload — the PDF and Excel are rebuilt.</p><div id="dl"></div>`;
      if (!items.length) $('#dl').innerHTML = '<div class="card muted">No uploaded surveys found.</div>';
      for (const it of items) {
        const d = document.createElement('div'); d.className = 'list-item';
        d.innerHTML = `<div class="grow"><div class="title">${esc(it.title)}</div><div class="muted">Updated ${FS.fmtDateTime(it.updated)}</div></div><span class="chev">›</span>`;
        d.onclick = async () => {
          try { FS.busy('Opening…'); const id = await FS.Sync.importSurvey(it.id); FS.busy(false); FS.cur = null; location.hash = `#/s/${id}`; }
          catch (e) { FS.busy(false); alert('Could not open: ' + e.message); }
        };
        $('#dl').appendChild(d);
      }
    } catch (e) { view.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
  }
})();
