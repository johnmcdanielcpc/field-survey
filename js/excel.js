/* Excel workbook in John's layouts:
   REPLACE / REMOVE AND CAP / ETR / INSTALL NEW  (Stop & Shop equipment replacement list)
   AIR BALANCE                                  (WF Cheshire air-balance schedule)
   MISSING INFO, LOOK-UP REVIEW                 (helpers) */
(function () {
  const FS = window.FS;
  const FILL = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + c } });
  const C_TITLE = 'FFFF00', C_NOTSURE = 'FFF2CC', C_LOOKUP = 'DDEBF7', C_MISSING = 'FCE4D6', C_HEAD = 'F2F2F2';
  const THIN = { style: 'thin', color: { argb: 'FF999999' } };
  const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };

  const num = v => {
    if (v == null || v === '') return null;
    let s = String(v).trim().toLowerCase().replace(/,/g, '');
    let mult = 1;
    if (/k$/.test(s)) { mult = 1000; s = s.slice(0, -1); }
    const n = parseFloat(s);
    return isNaN(n) ? null : n * mult;
  };
  const mbh = v => { const n = num(v); return n == null ? null : (n >= 5000 ? Math.round(n / 1000) : n); };
  const year = v => { const m = String(v || '').match(/(19|20)\d{2}/); return m ? +m[0] : null; };
  const driveUrl = id => `https://drive.google.com/file/d/${id}/view`;

  FS.buildExcel = async function (survey) {
    const ExcelJS = window.ExcelJS;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Field Survey app';
    const site = survey.values.site;
    const project = FS.surveyTitle(survey);
    const missing = FS.missingList(survey);
    const missSet = new Set(missing.map(m => FS.metaKey(m.route, m.field.id)));

    // gather units
    const units = [];
    const photoDrive = {};
    for (const rec of await FS.DB.photosFor(survey.id)) photoDrive[rec.id] = rec.driveId;
    const kinds = [['rtus', 'rtu'], ['efs', 'ef'], ['hoods', 'hood']];
    for (const [secId, kind] of kinds) {
      const sec = FS.section(secId), def = sec.fields[0];
      survey.values[secId][def.id].forEach((it, i) => {
        const route = `${secId}/${def.id}/${it._id}`;
        const firstPlate = (it.dataPlate || it.photo || it.sides || [])[0];
        units.push({ kind, it, route, tag: FS.itemLabel(def, it, i), def, photo: firstPlate && photoDrive[firstPlate] ? driveUrl(photoDrive[firstPlate]) : survey.sync.folderUrl || '' });
      });
    }
    const meta = (u, f) => survey.meta[FS.metaKey(u.route, f)];
    const isLook = (u, f) => { const m = meta(u, f); return m && m.src === 'lookup' && !m.reviewed && m.suggested === undefined; };
    const isMiss = (u, f) => missSet.has(FS.metaKey(u.route, f));

    function noteFor(u) {
      const it = u.it, out = [];
      if (u.it.category === 'Not sure') out.push('CATEGORY NOT SURE - VERIFY');
      if (it.heatOnly) out.push('Heat only');
      if (it.reclaim && !/none/i.test(it.reclaim)) out.push('Heat reclaim: ' + it.reclaim);
      if (it.running === 'No') out.push('Not running');
      if (it.condition) out.push('Condition: ' + it.condition);
      if (it.disconnect) out.push('Disconnect: ' + it.disconnect);
      if (it.notes) out.push(it.notes.replace(/\s*\n\s*/g, '; '));
      return out.join('; ');
    }

    /* --------- shared sheet helpers */
    function styleRange(ws, r1, c1, r2, c2, fn) { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) fn(ws.getCell(r, c), r, c); }
    function header2(ws, defs) {
      // defs: [{col, top, sub, span}] -> rows 2-3 with merges like the template
      for (const d of defs) {
        if (d.sub === undefined) { ws.mergeCells(2, d.col, 3, d.col); ws.getCell(2, d.col).value = d.top; }
        else {
          if (d.top !== null) { if (d.span > 1) ws.mergeCells(2, d.col, 2, d.col + d.span - 1); ws.getCell(2, d.col).value = d.top; }
          d.sub.forEach((s, k) => { ws.getCell(3, d.col + k).value = s; });
        }
      }
      styleRange(ws, 2, 1, 3, ws.columnCount, c => {
        c.font = { bold: true, size: 10 }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        c.border = BOX; c.fill = FILL(C_HEAD);
      });
    }
    function titleRow(ws, title, lastCol) {
      ws.getCell('A1').value = 'PROJECT:'; ws.getCell('A1').font = { bold: true };
      ws.mergeCells(1, 2, 1, 4); ws.getCell('B1').value = `${title} - ${project}`;
      ws.getCell('B1').fill = FILL(C_TITLE); ws.getCell('B1').font = { bold: true }; ws.getCell('B1').alignment = { horizontal: 'center' };
      ws.getCell('E1').value = 'Date:'; ws.getCell('E1').alignment = { horizontal: 'right' };
      ws.getCell('F1').value = site.date || ''; ws.getCell('F1').font = { bold: true };
      ws.getRow(1).height = 18;
    }
    function legend(ws, row) {
      const items = [[C_NOTSURE, 'Category "Not sure" - verify'], [C_LOOKUP, 'From model/serial look-up - pending review'], [C_MISSING, 'Not entered in the field']];
      items.forEach(([c, t], k) => {
        const a = ws.getCell(row + k, 1); a.fill = FILL(c); a.border = BOX;
        ws.getCell(row + k, 2).value = t; ws.getCell(row + k, 2).font = { italic: true, size: 9 };
      });
    }
    function paint(ws, r, c, u, field, val) {
      const cell = ws.getCell(r, c);
      if (val !== undefined) cell.value = val === null ? null : val;
      if (field && isLook(u, field)) cell.fill = FILL(C_LOOKUP);
      else if (field && isMiss(u, field) && (cell.value == null || cell.value === '')) cell.fill = FILL(C_MISSING);
      return cell;
    }
    function rowBorders(ws, r, n, notSure) {
      for (let c = 1; c <= n; c++) {
        const cell = ws.getCell(r, c);
        cell.border = BOX; cell.alignment = { vertical: 'top', wrapText: true, horizontal: c <= 2 ? 'left' : 'center' };
        cell.font = { size: 10 };
        if (notSure && !cell.fill) cell.fill = FILL(C_NOTSURE);
      }
    }
    const link = (url, text = 'Photo') => url ? { text, hyperlink: url } : '';

    /* --------- REPLACE */
    const rep = wb.addWorksheet('REPLACE', { views: [{ state: 'frozen', ySplit: 3, xSplit: 1 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const repW = [14, 20, 13, 22, 18, 10, 10, 10, 10, 11, 8, 12, 8, 8, 18, 14, 10, 10, 9, 8, 8, 14, 14, 40, 9];
    rep.columns = repW.map(w => ({ width: w }));
    titleRow(rep, 'Equipment Replacement');
    header2(rep, [
      { col: 1, top: 'TAG' }, { col: 2, top: 'Service' },
      { col: 3, top: 'Existing', span: 3, sub: ['Manufacturer', 'Model', 'Serial'] },
      { col: 6, top: 'Old Nat. Gas', span: 1, sub: ['Input (MBH)'] }, { col: 7, top: 'Old Nat. Gas', span: 1, sub: ['Output (MBH)'] },
      { col: 8, top: 'New Nat. Gas', span: 1, sub: ['Input (MBH)'] },
      { col: 9, top: 'Mfg Date' }, { col: 10, top: 'Refrigerant' }, { col: 11, top: 'Age', span: 1, sub: ['(Years)'] },
      { col: 12, top: 'Elect. Old', span: 3, sub: ['Voltage/Phase', 'MCA', 'MOCP'] },
      { col: 15, top: 'Curb Size' }, { col: 16, top: 'CURB ADAPTOR' }, { col: 17, top: 'WEIGHT OLD' }, { col: 18, top: 'Weight New' },
      { col: 19, top: 'Elect. New', span: 3, sub: ['Voltage', 'MCA', 'MOCP'] },
      { col: 22, top: 'New', span: 2, sub: ['Manufacturer', 'Model'] },
      { col: 24, top: 'Notes' }, { col: 25, top: 'Data Plate' },
    ]);
    let r = 4;
    for (const u of units.filter(u => u.it.category === 'Replace' || u.it.category === 'Not sure')) {
      const it = u.it, ns = it.category === 'Not sure';
      rep.getCell(r, 1).value = u.tag; rep.getCell(r, 2).value = it.area || '';
      paint(rep, r, 3, u, 'mfr', it.mfr || ''); paint(rep, r, 4, u, 'model', it.model || ''); paint(rep, r, 5, u, 'serial', it.serial || '');
      if (it.heatType === 'Gas') { paint(rep, r, 6, u, 'btuIn', mbh(it.btuIn)); paint(rep, r, 7, u, 'btuOut', mbh(it.btuOut)); }
      paint(rep, r, 9, u, 'mfgDate', it.mfgDate || ''); paint(rep, r, 10, u, 'refrigerant', it.refrigerant || '');
      const yr = year(it.mfgDate); rep.getCell(r, 11).value = yr ? { formula: `YEAR(TODAY())-${yr}` } : '';
      paint(rep, r, 12, u, 'voltage', it.voltage || ''); paint(rep, r, 13, u, 'mca', num(it.mca)); paint(rep, r, 14, u, 'mocp', num(it.mocp));
      paint(rep, r, 15, u, 'curb', it.curb || ''); paint(rep, r, 16, u, 'curbAdapter', it.curbAdapter || '');
      paint(rep, r, 17, u, 'weight', num(it.weight));
      rep.getCell(r, 24).value = noteFor(u); rep.getCell(r, 25).value = link(u.photo);
      rowBorders(rep, r, 25, ns); rep.getCell(r, 24).alignment = { wrapText: true, vertical: 'top' };
      r++;
    }
    rep.getCell(r + 1, 1).value = 'NOTE:'; rep.getCell(r + 1, 1).font = { bold: true };
    rep.getCell(r + 2, 1).value = '1.  EXISTING EQUIPMENT DATA PER NAMEPLATE / FIELD SURVEY.';
    legend(rep, r + 4);

    /* --------- REMOVE AND CAP / ETR */
    function shortSheet(name, title, filter) {
      const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] });
      ws.columns = [16, 26, 16, 24, 20, 50, 9].map(w => ({ width: w }));
      titleRow(ws, title);
      header2(ws, [{ col: 1, top: 'TAG' }, { col: 2, top: 'Service' }, { col: 3, top: 'Existing', span: 3, sub: ['Manufacturer', 'Model', 'Serial'] }, { col: 6, top: 'Notes' }, { col: 7, top: 'Data Plate' }]);
      let rr = 4;
      for (const u of units.filter(filter)) {
        ws.getCell(rr, 1).value = u.tag; ws.getCell(rr, 2).value = u.it.area || '';
        paint(ws, rr, 3, u, 'mfr', u.it.mfr || ''); paint(ws, rr, 4, u, 'model', u.it.model || ''); paint(ws, rr, 5, u, 'serial', u.it.serial || '');
        ws.getCell(rr, 6).value = noteFor(u); ws.getCell(rr, 7).value = link(u.photo);
        rowBorders(ws, rr, 7, false); rr++;
      }
      ws.getCell(rr + 1, 1).value = 'NOTE:'; ws.getCell(rr + 1, 1).font = { bold: true };
      ws.getCell(rr + 2, 1).value = '1.  EXISTING EQUIPMENT DATA PER NAMEPLATE / FIELD SURVEY.';
      return ws;
    }
    shortSheet('REMOVE AND CAP', 'Remove and Cap', u => u.it.category === 'Remove & Cap');
    shortSheet('ETR', 'Existing To Remain', u => u.it.category === 'Existing to Remain');

    /* --------- INSTALL NEW (blank, for John) */
    const inw = wb.addWorksheet('INSTALL NEW');
    inw.columns = [16, 26, 18, 24, 12, 8, 8, 12, 16, 40].map(w => ({ width: w }));
    titleRow(inw, 'Install New');
    header2(inw, [{ col: 1, top: 'TAG' }, { col: 2, top: 'Service' }, { col: 3, top: 'New', span: 2, sub: ['Manufacturer', 'Model'] },
      { col: 5, top: 'Elect. New', span: 3, sub: ['Voltage', 'MCA', 'MOCP'] }, { col: 8, top: 'Weight' }, { col: 9, top: 'Curb / Adaptor' }, { col: 10, top: 'Notes' }]);
    for (let k = 4; k < 16; k++) rowBorders(inw, k, 10, false);

    /* --------- AIR BALANCE */
    const ab = wb.addWorksheet('AIR BALANCE', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ab.columns = [16, 11, 11, 11, 10, 22, 12, 90].map(w => ({ width: w }));
    ab.getCell('A1').value = 'Project:'; ab.getCell('B1').value = project; ab.getCell('B1').font = { bold: true };
    ab.getCell('G1').value = 'Date Created:'; ab.getCell('H1').value = site.date || '';
    ab.getCell('A2').value = 'Location:'; ab.getCell('B2').value = FS.fullAddress(site);
    ab.getCell('G2').value = 'REV.:';
    ab.getCell('A4').value = 'AIR-BALANCE SCHEDULE'; ab.getCell('A4').font = { bold: true, size: 12 };
    const abH = ['TAG', 'SUPPLY', 'MAKEUP', 'EXHAUST', 'Capacity', 'SERVICE', '', 'Notes'];
    const abU = ['', '(CFM)', '(CFM)', '(CFM)', '(Tons)', '(ft.2)', '', ''];
    abH.forEach((h, k) => { ab.getCell(5, k + 1).value = h; ab.getCell(6, k + 1).value = abU[k]; });
    ab.mergeCells(5, 6, 5, 7); ab.mergeCells(6, 6, 6, 7);
    styleRange(ab, 5, 1, 6, 8, c => { c.font = { bold: true, size: 10 }; c.alignment = { horizontal: 'center', vertical: 'middle' }; c.border = BOX; c.fill = FILL(C_HEAD); });

    const inAB = u => u.it.category !== 'Remove & Cap';
    const split = v => String(v || '').split(/\s*,\s*/).map(x => x.trim()).filter(x => x && !/^none$/i.test(x));
    const links = h => ({ ef: split(h.it.efs || h.it.ef), mau: h.it.exhaustOnly === 'Yes' ? [] : split(h.it.maus) });
    const abRows = [];
    const rtuNote = u => {
      const it = u.it, p = [];
      if (it.mfr) p.push('Mfr: ' + it.mfr);
      if (it.model) p.push('Model: ' + it.model);
      if (it.serial) p.push('Serial: ' + it.serial);
      if (it.voltage) p.push(it.voltage + 'V');
      if (it.mca || it.mocp) p.push(`MCA ${it.mca || '-'} / MOCP ${it.mocp || '-'}`);
      if (it.controls) p.push(it.controls + ' controls');
      if (it.vfd === 'Yes') p.push('VFD present');
      if (it.refrigerant) p.push(it.refrigerant);
      if (it.coil) p.push('Condenser coil ' + it.coil);
      if (it.heatType) p.push(it.heatType === 'Gas' && it.btuIn ? `Gas heat ${mbh(it.btuIn)} MBH in` : `${it.heatType} heat`);
      if (it.oa) p.push('OA: ' + it.oa);
      if (it.curb) p.push('Curb ' + it.curb);
      const n = noteFor(u); if (n) p.push(n);
      if (it.category) p.push('Category: ' + it.category);
      return p.join('; ');
    };
    const efNote = u => {
      const it = u.it, p = [];
      if (it.mfr) p.push('Mfr: ' + it.mfr);
      if (it.voltage) p.push(it.voltage + 'V');
      if (it.curb) p.push(it.curb + ' curb');
      if (it.running) p.push(it.running === 'Yes' ? 'Running' : 'Not running');
      if (it.condition) p.push(it.condition + ' cond.');
      if (it.notes) p.push(it.notes.replace(/\s*\n\s*/g, '; '));
      if (it.category) p.push('Category: ' + it.category);
      return p.join('; ');
    };
    const hoodNote = u => {
      const it = u.it, p = [];
      if (it.hoodType) p.push(it.hoodType);
      if (it.length) { const L = num(it.length); p.push(`Length: ${it.length}"${L ? ` (${+(L / 12).toFixed(1)} ft)` : ''}`); }
      const lk = links(u);
      if (lk.ef.length) p.push('Exhaust fan(s): ' + lk.ef.join(', '));
      if (lk.mau.length) p.push('Makeup air unit(s): ' + lk.mau.join(', '));
      if (!lk.ef.length && !lk.mau.length) p.push('NO FANS LINKED - VERIFY');
      if (it.equipment) p.push('Equip: ' + it.equipment);
      if (it.exhaustOnly === 'Yes') p.push('Exhaust only');
      if (it.dcv === 'Yes') p.push('Demand ventilation');
      if (it.notes) p.push(it.notes.replace(/\s*\n\s*/g, '; '));
      return p.join('; ');
    };
    const efs = units.filter(u => u.kind === 'ef' && inAB(u));
    const rtus = units.filter(u => u.kind === 'rtu' && inAB(u));
    const hoods = units.filter(u => u.kind === 'hood' && inAB(u));
    const placed = new Map();                       // fan unit -> hood it is listed under
    const key = t => String(t || '').trim().toUpperCase();
    const groups = hoods.map(h => {
      const lk = links(h), rows = [];
      for (const [tags, pool] of [[lk.ef, efs], [lk.mau, rtus]]) for (const t of tags) {
        const f = pool.find(x => key(x.tag) === key(t));
        if (!f) continue;
        if (placed.has(f)) { (f.alsoHoods = f.alsoHoods || []).push(h.tag); continue; }
        placed.set(f, h); rows.push({ u: f, type: f.kind, hood: h });
      }
      return { h, rows };
    });
    for (const u of rtus) if (!placed.has(u)) abRows.push({ u, type: 'rtu' });
    for (const g of groups) { abRows.push({ u: g.h, type: 'hood' }); abRows.push(...g.rows); }
    for (const e of efs) if (!placed.has(e)) abRows.push({ u: e, type: 'ef' });
    let ar = 7;
    for (const row of abRows) {
      const u = row.u, it = u.it, ns = it.category === 'Not sure';
      ab.getCell(ar, 1).value = row.hood ? '   ' + u.tag : u.tag;
      const hoodPre = row.hood ? `FOR ${row.hood.tag.toUpperCase()}${u.alsoHoods ? ' (ALSO SERVES ' + u.alsoHoods.join(', ').toUpperCase() + ')' : ''}. ` : '';
      if (row.type === 'rtu') {
        paint(ab, ar, 2, u, 'supplyCfm', num(it.supplyCfm));
        paint(ab, ar, 3, u, 'oaCfm', num(it.oaCfm));
        const tons = num(it.tons);
        if (tons != null) paint(ab, ar, 5, u, 'tons', tons);
        else if (num(it.supplyCfm) != null) ab.getCell(ar, 5).value = { formula: `B${ar}/400` };
        ab.getCell(ar, 8).value = hoodPre + rtuNote(u);
      } else if (row.type === 'hood') {
        ab.getCell(ar, 8).value = hoodNote(u);
      } else {
        const cfm = num(it.cfm);
        paint(ab, ar, 4, u, 'cfm', cfm == null ? null : -Math.abs(cfm));
        ab.getCell(ar, 8).value = hoodPre + efNote(u);
      }
      ab.mergeCells(ar, 6, ar, 7);
      ab.getCell(ar, 6).value = (it.area || '').toUpperCase();
      rowBorders(ab, ar, 8, ns);
      ab.getCell(ar, 8).alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
      ab.getCell(ar, 6).alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
      ['B', 'C', 'D'].forEach(L => { ab.getCell(`${L}${ar}`).numFmt = '#,##0'; });
      ab.getCell(`E${ar}`).numFmt = '0.0';
      if (row.type === 'hood') { ab.getCell(ar, 1).font = { bold: true, size: 10 }; if (!ns) for (let k = 1; k <= 8; k++) ab.getCell(ar, k).fill = FILL('E7E6E6'); }
      ar++;
    }
    const last = Math.max(7, ar - 1);
    ab.getCell(ar, 1).value = 'TOTALS:';
    ['B', 'C', 'D'].forEach(L => { ab.getCell(`${L}${ar}`).value = { formula: `SUM(${L}7:${L}${last})` }; ab.getCell(`${L}${ar}`).numFmt = '#,##0'; });
    styleRange(ab, ar, 1, ar, 8, c => { c.font = { bold: true }; c.border = { top: { style: 'medium' } }; });
    ab.getCell(ar + 1, 1).value = 'SPACE PRESSURIZATION (CFM) = ';
    ab.getCell(ar + 1, 4).value = { formula: `C${ar}+D${ar}` }; ab.getCell(ar + 1, 4).numFmt = '#,##0;[Red]-#,##0';
    ab.getCell(ar + 1, 1).font = ab.getCell(ar + 1, 4).font = { bold: true };
    const abNotes = [
      'NO MECH. PLANS; TONNAGE AND CFM VALUES ARE ESTIMATED WHERE NOT SHOWN ON DATA PLATE.',
      'VALUES SHADED BLUE ARE FROM MANUFACTURER LOOK-UP BY MODEL/SERIAL AND ARE PENDING REVIEW (SEE LOOK-UP REVIEW TAB).',
      'EXHAUST SHOWN AS NEGATIVE. MAKEUP COLUMN = UNIT OUTSIDE AIR CFM.',
      'EACH HOOD (GRAY ROW) IS FOLLOWED BY ITS EXHAUST FAN(S) AND MAKEUP AIR UNIT(S); HOOD CFM IS CARRIED BY THOSE FANS.',
      'SPACE PRESSURIZATION = MAKEUP + EXHAUST (SUPPLY AIR IS RECIRCULATED AND NOT INCLUDED).',
      'EQUIPMENT MARKED REMOVE & CAP IS NOT INCLUDED. ROWS SHADED YELLOW ARE "NOT SURE" - VERIFY.',
    ];
    ab.getCell(ar + 3, 1).value = 'Note:'; ab.getCell(ar + 3, 1).font = { bold: true };
    abNotes.forEach((n, k) => { ab.getCell(ar + 4 + k, 1).value = `${k + 1}.  ${n}`; });

    /* --------- MISSING INFO */
    const mi = wb.addWorksheet('MISSING INFO');
    mi.columns = [{ header: 'Section', width: 24 }, { header: 'Unit', width: 28 }, { header: 'Missing', width: 50 }];
    mi.getRow(1).font = { bold: true };
    for (const m of missing) mi.addRow([m.sec.title, m.labels.join(' - '), m.what]);
    if (!missing.length) mi.addRow(['', '', 'Nothing missing']);

    /* --------- LOOK-UP REVIEW */
    const lu = wb.addWorksheet('LOOK-UP REVIEW');
    lu.columns = [{ header: 'Unit', width: 18 }, { header: 'Field', width: 22 }, { header: 'Value', width: 14 }, { header: 'Source', width: 40 },
      { header: 'Link', width: 12 }, { header: 'Confidence', width: 12 }, { header: 'Reviewed', width: 10 }];
    lu.getRow(1).font = { bold: true };
    const labelOf = {};
    FS.walk(survey, ({ field, obj, route, labels }) => { labelOf[FS.metaKey(route, field.id)] = { unit: labels.join(' - '), field: field.label, value: obj[field.id] }; });
    let any = false;
    for (const [k, m] of Object.entries(survey.meta)) {
      if (m.src !== 'lookup' || !labelOf[k]) continue;
      any = true;
      const L = labelOf[k];
      const row = lu.addRow([L.unit, L.field, m.suggested !== undefined ? `Kept field value ${L.value}; look-up found ${m.suggested}` : (num(L.value) ?? L.value), m.source || '', m.url ? { text: 'Open', hyperlink: m.url } : '', m.confidence || '', m.reviewed ? 'Yes' : 'No']);
      if (!m.reviewed && m.suggested === undefined) row.eachCell(c => { c.fill = FILL(C_LOOKUP); });
    }
    if (!any) lu.addRow(['', '', '', 'No look-up values yet. Ask Claude to run the model/serial look-up after the survey is uploaded.']);

    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };
})();
