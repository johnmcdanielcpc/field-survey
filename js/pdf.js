/* PDF report: two photos per row, high quality, each photo linked to its full-resolution original in Drive. */
(function () {
  const FS = window.FS, F = window.SURVEY_FORM;
  const PW = 612, PH = 792, M = 36, CW = PW - 2 * M;
  const TOP = 62, BOT = PH - 40;
  const NAVY = [22, 50, 79], GRAY = [102, 112, 125], LINE = [221, 226, 232], ORANGE = [192, 98, 20], BLUE_BG = [222, 235, 250];

  // jsPDF's built-in fonts are Latin-1 only
  const t = s => String(s == null ? '' : s)
    .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, '...').replace(/[✓✔]/g, '').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');

  FS.buildPDF = async function (survey, opts = {}) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    const site = survey.values.site;
    const ctxs = FS.photoContexts(survey);
    const allPhotos = Object.keys(ctxs).length;
    let photoDone = 0;
    let y = TOP;

    const prog = msg => opts.onProgress && opts.onProgress(msg);
    const newPage = () => { doc.addPage(); y = TOP; };
    const need = h => { if (y + h > BOT) newPage(); };

    function sectionBar(title) {
      need(40);
      y += 6;
      doc.setFillColor(...NAVY); doc.rect(M, y, CW, 20, 'F');
      doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text(t(title.toUpperCase()), M + 8, y + 14);
      y += 26; doc.setTextColor(0);
    }
    function itemBar(label, right, depth) {
      need(44);
      y += 4;
      doc.setFillColor(233, 239, 246); doc.rect(M + depth * 12, y, CW - depth * 12, 18, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...NAVY);
      doc.text(t(label), M + depth * 12 + 6, y + 12.5);
      if (right) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(t(right), PW - M - 6, y + 12.5, { align: 'right' }); }
      y += 24; doc.setTextColor(0);
    }

    // Field rows: two label/value pairs per line; long text spans the full width
    function fieldRows(pairs, indent) {
      const x0 = M + indent, w = CW - indent;
      const colW = w / 2, labW = 118;
      let i = 0;
      doc.setFontSize(9);
      while (i < pairs.length) {
        const p = pairs[i];
        if (p.wide) {
          const lines = doc.splitTextToSize(t(p.value), w - labW - 6);
          const h = Math.max(14, lines.length * 11 + 3, labLines(p, labW) * 10 + 4);
          need(h);
          drawPair(p, x0, labW, lines, h, w);
          y += h; i++;
          continue;
        }
        const q = pairs[i + 1] && !pairs[i + 1].wide ? pairs[i + 1] : null;
        const l1 = doc.splitTextToSize(t(p.value), colW - labW - 8);
        const l2 = q ? doc.splitTextToSize(t(q.value), colW - labW - 8) : [];
        const h = Math.max(14, Math.max(l1.length, l2.length) * 11 + 3, labLines(p, labW) * 10 + 4, q ? labLines(q, labW) * 10 + 4 : 0);
        need(h);
        drawPair(p, x0, labW, l1, h, colW);
        if (q) drawPair(q, x0 + colW, labW, l2, h, colW);
        y += h; i += q ? 2 : 1;
      }
      y += 4;
    }
    function labLines(p, labW) { return doc.splitTextToSize(t(p.label), labW - 4).length; }
    function drawPair(p, x, labW, lines, h, wTotal) {
      if (p.looked) { doc.setFillColor(...BLUE_BG); doc.rect(x + labW, y, wTotal - labW - 4, h - 1, 'F'); }
      doc.setDrawColor(...LINE); doc.line(x, y + h - 0.5, x + wTotal - 4, y + h - 0.5);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRAY);
      const ll = doc.splitTextToSize(t(p.label), labW - 4);
      doc.text(ll, x, y + 10, { lineHeightFactor: 1.1 });
      if (p.missing) { doc.setTextColor(...ORANGE); doc.setFont('helvetica', 'italic'); }
      else { doc.setTextColor(20); doc.setFont('helvetica', 'bold'); }
      doc.text(lines, x + labW + 2, y + 10, { lineHeightFactor: 1.2 });
      doc.setTextColor(0); doc.setFont('helvetica', 'normal');
    }

    async function photos(label, ids, indent, plate) {
      const x0 = M + indent, w = CW - indent, gap = 12, cellW = (w - gap) / 2, maxH = 300;
      let labelled = false;
      for (let i = 0; i < ids.length; i += 2) {
        const row = [];
        for (const id of ids.slice(i, i + 2)) {
          photoDone++;
          prog(`Adding photos to PDF… ${photoDone} of ${allPhotos}`);
          const rec = await FS.getPhoto(id);
          let img = null, why = '';
          try {
            const src = rec && await FS.displayBlob(rec);
            if (src) img = await FS.scaleToBlob(src, plate ? 1600 : 1200, plate ? 0.8 : 0.75);
            else why = 'photo file missing';
          } catch (e) { console.warn(e); why = (e && e.message) || String(e); }
          row.push({ id, rec, img, why, n: i + row.length + 1 });
        }
        const sizes = row.map(r => {
          if (!r.img) return { w: cellW, h: 60 };
          const s = Math.min(cellW / r.img.w, maxH / r.img.h);
          return { w: r.img.w * s, h: r.img.h * s };
        });
        const rowH = Math.max(...sizes.map(s => s.h)) + 16;
        if (!labelled) {
          need(rowH + 14);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...GRAY);
          doc.text(t(`${label} (${ids.length} photo${ids.length === 1 ? '' : 's'})`), x0, y + 9);
          doc.setTextColor(0); doc.setFont('helvetica', 'normal'); y += 14; labelled = true;
        } else need(rowH);
        for (let k = 0; k < row.length; k++) {
          const r = row[k], sz = sizes[k], cx = x0 + k * (cellW + gap);
          if (r.img) {
            const bytes = new Uint8Array(await r.img.blob.arrayBuffer());
            doc.addImage(bytes, 'JPEG', cx, y, sz.w, sz.h, undefined, 'NONE');
            doc.setDrawColor(...LINE); doc.rect(cx, y, sz.w, sz.h);
            const driveId = r.rec && (FS.hasMarkup(r.rec) ? r.rec.markedDriveId : r.rec.driveId);
            if (opts.links && driveId) doc.link(cx, y, sz.w, sz.h, { url: `https://drive.google.com/file/d/${driveId}/view` });
          } else {
            doc.setDrawColor(...LINE); doc.rect(cx, y, cellW, 60);
            doc.setFontSize(8); doc.setTextColor(...GRAY); doc.text(t('Photo could not be added' + (r.why ? ' (' + r.why + ')' : '') + ' - tap to open it in Drive'), cx + 8, y + 32, { maxWidth: cellW - 16 });
            const did = r.rec && (FS.hasMarkup(r.rec) ? r.rec.markedDriveId : r.rec.driveId);
            if (opts.links && did) doc.link(cx, y, cellW, 60, { url: `https://drive.google.com/file/d/${did}/view` });
          }
          doc.setFontSize(8); doc.setTextColor(...GRAY);
          const cap = `Photo ${r.n}${FS.hasMarkup(r.rec) ? ' - marked up' : ''}${opts.links && r.rec && (r.rec.driveId) ? ' - tap to open full size' : ''}`;
          doc.text(t(cap), cx, y + sz.h + 10);
          doc.setTextColor(0);
        }
        y += rowH;
      }
      y += 4;
    }

    function valueOf(f, obj, route) {
      const v = obj[f.id];
      if (f.type === 'check') return v ? 'Yes' : '';
      if (f.type === 'number' && v && !isNaN(String(v).replace(/,/g, '')) && String(v).replace(/,/g, '').length > 4) {
        return Number(String(v).replace(/,/g, '')).toLocaleString('en-US');
      }
      return v == null ? '' : String(v);
    }

    async function group(fields, obj, route, depth) {
      const indent = Math.max(0, depth - 1) * 12;
      const pairs = [];
      const flushPairs = () => { if (pairs.length) { fieldRows(pairs.splice(0), indent); } };
      for (const f of fields) {
        if (!FS.visible(f, obj)) continue;
        if (f.type === 'repeat') {
          flushPairs();
          const arr = obj[f.id] || [];
          if (!arr.length) { pairs.push({ label: f.itemName + 's', value: 'None recorded', missing: false }); flushPairs(); continue; }
          for (let i = 0; i < arr.length; i++) {
            const it = arr[i];
            const right = [it.category, it.running === 'No' ? 'Not running' : ''].filter(Boolean).join(' | ');
            itemBar(FS.itemLabel(f, it, i) + (it.area ? `  -  ${it.area}` : ''), right, depth);
            await group(f.fields, it, `${route}/${f.id}/${it._id}`, depth + 1);
          }
          continue;
        }
        if (f.type === 'photo') {
          const ids = obj[f.id] || [];
          if (!ids.length) {
            if (f.expect) pairs.push({ label: f.label, value: 'No photo', missing: true });
            continue;
          }
          flushPairs();
          await photos(f.label, ids, indent, f.plate);
          continue;
        }
        const v = valueOf(f, obj, route);
        const meta = survey.meta[FS.metaKey(route, f.id)];
        if (FS.isEmpty(v)) {
          if (f.optional || f.lookup || f.type === 'check') continue;
          pairs.push({ label: f.label, value: 'Not entered', missing: true });
          continue;
        }
        const looked = meta && meta.src === 'lookup' && !meta.reviewed;
        pairs.push({ label: f.label, value: v + (looked ? ' (look-up, pending review)' : ''), wide: f.type === 'textarea' || String(v).length > 34, looked });
      }
      flushPairs();
    }

    prog('Building PDF…');
    // Title block
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...NAVY);
    doc.text(t(F.title), M, y + 6); y += 18;
    doc.setFontSize(12); doc.setTextColor(0);
    doc.text(t(FS.surveyTitle(survey)), M, y + 6); y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRAY);
    if (opts.links) { doc.text('Tap any photo to open the full-resolution original in Google Drive.', M, y + 6); y += 12; }
    const miss = FS.missingList(survey).length;
    if (miss) { doc.setTextColor(...ORANGE); doc.text(t(`${miss} item${miss > 1 ? 's' : ''} marked "Not entered" in this report.`), M, y + 6); y += 12; }
    doc.setTextColor(0); y += 6;

    for (const sec of F.sections) {
      sectionBar(sec.title);
      await group(sec.fields, survey.values[sec.id], sec.id, 0);
    }

    // header / footer on every page
    const n = doc.getNumberOfPages();
    const surveyedBy = `Surveyed by ${site.specialist || '-'}${site.date ? ' on ' + site.date : ''}`;
    for (let p = 1; p <= n; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRAY);
      doc.text(t(F.title), M, 30);
      doc.text(t(FS.surveyNo(survey)), PW - M, 30, { align: 'right' });
      doc.setDrawColor(...LINE); doc.line(M, 38, PW - M, 38);
      doc.line(M, PH - 30, PW - M, PH - 30);
      doc.text(t(surveyedBy + `  |  Generated ${new Date().toLocaleString('en-US')}`), M, PH - 18);
      doc.text(`Page ${p} of ${n}`, PW - M, PH - 18, { align: 'right' });
    }
    prog('Saving PDF…');
    return doc.output('blob');
  };
})();
