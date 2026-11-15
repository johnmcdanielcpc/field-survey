/* Form traversal, survey model, missing-info checks, naming helpers. */
(function () {
  const F = window.SURVEY_FORM;
  const FS = window.FS;

  FS.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  FS.today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  FS.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  FS.section = id => F.sections.find(s => s.id === id);

  function initGroup(fields, obj) {
    for (const f of fields) {
      if (f.type === 'repeat') { if (!Array.isArray(obj[f.id])) obj[f.id] = []; obj[f.id].forEach(it => initGroup(f.fields, it)); }
    }
    return obj;
  }
  FS.normalize = function (survey) {
    survey.values = survey.values || {};
    // older surveys had one electrical room with a flat list of panels
    const el = survey.values.electrical;
    if (el && Array.isArray(el.panels) && !Array.isArray(el.rooms)) {
      el.rooms = el.panels.length ? [{ _id: FS.uid(), name: 'Electrical Room 1', location: '', panels: el.panels }] : [];
      delete el.panels;
    }
    for (const s of F.sections) survey.values[s.id] = initGroup(s.fields, survey.values[s.id] || {});
    survey.meta = survey.meta || {};
    survey.sync = survey.sync || {};
    return survey;
  };

  FS.newSurvey = function (person) {
    const s = { id: FS.uid(), formVersion: F.version, createdAt: Date.now(), updatedAt: Date.now(), status: 'draft', values: {}, meta: {}, sync: {} };
    FS.normalize(s);
    s.values.site.date = FS.today();
    if (person) s.values.site.specialist = person;
    return s;
  };

  FS.newItem = function (def, arr) {
    const item = { _id: FS.uid() };
    initGroup(def.fields, item);
    for (const f of def.fields) if (f.initial !== undefined && item[f.id] === undefined) item[f.id] = f.initial;
    if (def.labelPrefix && def.labelField) {
      // next number after the highest numeric suffix in use
      let n = arr.length;
      for (const it of arr) { const m = String(it[def.labelField] || '').match(/(\d+)\s*$/); if (m) n = Math.max(n, +m[1]); }
      item[def.labelField] = def.labelPrefix + (n + 1);
    }
    return item;
  };

  FS.isEmpty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0);
  // blank, or a placeholder answer like "Not Identified" that still counts as not finished
  FS.isUnfinished = (f, v) => FS.isEmpty(v) || !!(f.missingIf && f.missingIf.includes(v));
  FS.matches = (cond, obj) => cond.in.includes(obj[cond.field]);
  FS.isMedia = f => f.type === 'photo' || f.type === 'video';
  // fields never flagged as missing
  FS.notChecked = (f, obj) => !!(f.optional || f.lookup || f.type === 'check' || f.type === 'info'
    || (FS.isMedia(f) && !f.expect) || (f.optionalIf && obj && FS.matches(f.optionalIf, obj)));
  FS.visible = (f, obj) => {
    if (f.showIf && !FS.matches(f.showIf, obj)) return false;
    if (f.hideIf && FS.matches(f.hideIf, obj)) return false;
    return true;
  };

  FS.itemLabel = (def, item, idx) => {
    const v = def.labelField && item[def.labelField];
    return (v && String(v).trim()) || `${def.itemName} ${idx + 1}`;
  };

  /* Route strings: "secId" for a section, "secId/fieldId/itemId[/fieldId/itemId]" for a unit. */
  FS.resolve = function (survey, route) {
    const parts = route.split('/');
    const sec = FS.section(parts[0]);
    if (!sec) return null;
    let fields = sec.fields, obj = survey.values[sec.id];
    const chain = [{ type: 'section', sec, fields, obj, route: sec.id, label: sec.title }];
    for (let i = 1; i + 1 < parts.length; i += 2) {
      const def = fields.find(f => f.id === parts[i]);
      if (!def) return null;
      const arr = obj[def.id];
      const idx = arr.findIndex(it => it._id === parts[i + 1]);
      if (idx < 0) return null;
      obj = arr[idx]; fields = def.fields;
      chain.push({ type: 'item', def, arr, idx, obj, fields, route: parts.slice(0, i + 2).join('/'), label: FS.itemLabel(def, obj, idx) });
    }
    return { sec, chain, last: chain[chain.length - 1] };
  };

  /* Units in number order by their label (RTU-1, RTU-2 … RTU-10), whatever order they were surveyed in.
     Each entry keeps its original position so unnamed units keep their "Unit 3" style label. */
  FS.sortedItems = (def, arr) => (arr || []).map((it, i) => ({ it, i, label: FS.itemLabel(def, it, i) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true, sensitivity: 'base' }) || a.i - b.i);

  /* Walk every visible field. cb({sec, field, obj, route, labels:[...]}) */
  FS.walk = function (survey, cb, opts = {}) {
    for (const sec of F.sections) {
      const go = (fields, obj, route, labels) => {
        for (const f of fields) {
          if (!FS.visible(f, obj)) continue;
          if (f.type === 'repeat') {
            FS.sortedItems(f, obj[f.id]).forEach(({ it, i, label }) => {
              const r = `${route}/${f.id}/${it._id}`;
              if (opts.onItem) opts.onItem({ sec, def: f, item: it, idx: i, route: r, labels: [...labels, label] });
              go(f.fields, it, r, [...labels, label]);
            });
          } else cb({ sec, field: f, obj, route, labels });
        }
      };
      go(sec.fields, survey.values[sec.id], sec.id, []);
    }
  };

  FS.metaKey = (route, fieldId) => `${route}:${fieldId}`;

  /* Missing info: visible, non-optional, non-lookup fields left blank; expected photos with none. */
  FS.missingList = function (survey) {
    const out = [];
    FS.walk(survey, ({ sec, field, obj, route, labels }) => {
      if (FS.notChecked(field, obj)) return;
      if (FS.isUnfinished(field, obj[field.id])) out.push({ sec, field, route, labels, what: field.type === 'photo' ? `${field.label} (no photo)` : field.type === 'video' ? `${field.label} (no video)` : field.label });
    });
    return out;
  };
  FS.missingByRoute = function (survey) {
    const m = {};
    for (const x of FS.missingList(survey)) {
      // credit every ancestor route so section / unit cards can show counts
      const parts = x.route.split('/');
      for (let i = 1; i <= parts.length; i += 2) { const r = parts.slice(0, i).join('/'); m[r] = (m[r] || 0) + 1; }
    }
    return m;
  };

  FS.photoIds = function (survey) {
    const ids = [];
    FS.walk(survey, ({ field, obj }) => { if (FS.isMedia(field)) ids.push(...(obj[field.id] || [])); });
    return ids;
  };
  FS.photoCount = function (fields, obj) {
    let n = 0;
    for (const f of fields) {
      if (f.type === 'photo') n += (obj[f.id] || []).length;
      else if (f.type === 'repeat') (obj[f.id] || []).forEach(it => { n += FS.photoCount(f.fields, it); });
    }
    return n;
  };

  FS.surveyTitle = s => {
    const v = s.values.site;
    return [v.customer, v.store].filter(Boolean).join(' – ') || 'Untitled survey';
  };
  FS.safeName = s => String(s || '').replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  // "Canton, GA" — from the City/State boxes, or pulled from an older one-box address ("…, Canton, GA 30114")
  FS.cityState = v => {
    let city = String(v.city || '').trim(), st = String(v.state || '').trim().toUpperCase();
    if (!city || !st) {
      const m = String(v.address || '').replace(/\s*\n\s*/g, ', ').match(/([A-Za-z .'-]+),\s*([A-Za-z]{2})\.?(?:\s+\d{5}(?:-\d{4})?)?\s*$/);
      if (m) { city = city || m[1].trim(); st = st || m[2].toUpperCase(); }
    }
    return [city, st].filter(Boolean).join(', ');
  };
  FS.fullAddress = v => [String(v.address || '').replace(/\s*\n\s*/g, ', ').trim(), (v.city || v.state) ? FS.cityState(v) : ''].filter(Boolean).join(', ');
  FS.folderPath = s => {
    const v = s.values.site;
    return [FS.safeName(v.customer || 'No Customer'),
      FS.safeName([v.store || 'Store', FS.cityState(v), v.date || FS.today()].filter(Boolean).join(' – '))];
  };
  FS.fileBase = s => {
    const v = s.values.site;
    return FS.safeName(`${[[v.customer || 'Survey', v.store].filter(Boolean).join(' '), FS.cityState(v), v.date].filter(Boolean).join(' – ')} – Field Survey`);
  };
  FS.surveyNo = s => {
    const v = s.values.site;
    return [v.customer, v.store, v.date].filter(Boolean).join(' – ');
  };

  /* Context name for a photo, e.g. "RTU-4 – Data Plate" or "Site Information – Store Front" */
  FS.photoContexts = function (survey) {
    const ctx = {};
    FS.walk(survey, ({ sec, field, obj, labels }) => {
      if (!FS.isMedia(field)) return;
      const base = labels.length ? labels.join(' – ') : sec.title;
      (obj[field.id] || []).forEach((pid, i) => { ctx[pid] = { base: `${base} – ${field.label}`, n: i + 1, plate: !!field.plate, video: field.type === 'video' }; });
    });
    return ctx;
  };

  FS.fmtBytes = b => b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(0) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
  FS.fmtDateTime = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
})();
