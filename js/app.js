/*
  app.js — the page itself: it keeps the data ("state"), draws the panels, and reacts to clicks and typing.

  The fit maths is in fit.js, the body geometry in geometry.js, the drawing in figure.js,
  the calibration dialog in calibrate.js and saving in storage.js.

  Reading order of this file:
    1. data (people, garment, rules, test log) and saving
    2. Body panel (people, numbers, scan picture)
    3. Garment panel (size chart)
    4. Result panel (size, zones, figure)
    5. Prediction test log
    6. Export / import, then start-up
*/
(function () {
  'use strict';

  const { num, fmt, esc, clone, toInches, fromInches, safeLink, joinList, interp } = FitRoom.Util;
  const { Fit, Geometry, Storage, Figure, Calibrate, Material, ChartParse, GarmentImage } = FitRoom;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // ======================================================================
  // 1. DATA
  // ======================================================================

  const BODY_FIELDS = [['h', 'Height'], ['bust', 'Bust'], ['waist', 'Waist'], ['hip', 'Hip'], ['inseam', 'Inseam']];
  const SOURCE_LABEL = { scan: 'Body scan', tape: 'Tape measure' };
  const CHART_NUMBER_KEYS = ['bust', 'bustMax', 'waist', 'waistMax', 'hip', 'hipMax', 'length', 'hem', 'sleeve', 'inseam'];

  // The scan picture that comes with the project. It is used straight from the avatars folder, exactly as it is.
  const BUILT_IN_PICTURE = { src: 'avatars/prii_front_original.png', w: 1072, h: 1290, name: 'prii_front_original.png', builtin: true };
  // Measured from the pixels of that picture: the top of the head and the bottom of the feet.
  const BUILT_IN_MARKS = { head: { x: 556, y: 25 }, floor: { x: 554, y: 1224 } };

  // Uploaded pictures are stored inside the browser's storage, which has limited room (about 5 MB for everything).
  // Pictures taller than this, or bigger than this many characters, are shrunk before they are stored.
  const MAX_PICTURE_HEIGHT = 1400;
  const MAX_PICTURE_CHARS = 1200000;

  function blankBody() { return { h: '', bust: '', waist: '', hip: '', inseam: '' }; }

  function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  function priiPerson() {
    return { id: 'prii', name: 'Prii', order: 0, scan: blankBody(), tape: blankBody(), lens: { waistD: '', arm: '' },
      picture: clone(BUILT_IN_PICTURE), marks: clone(BUILT_IN_MARKS) };
  }

  function blankPerson(name, order) {
    return { id: newId('p'), name: name, order: order, scan: blankBody(), tape: blankBody(), lens: { waistD: '', arm: '' }, picture: null, marks: {} };
  }

  const state = { people: [], pid: null, source: 'scan', garment: null, rules: null, log: [], sel: null };

  function person() {
    return state.people.filter(p => p.id === state.pid)[0] || state.people[0];
  }

  // ---------- making sure loaded data has every field (files and older saves may be missing some) ----------

  function normPicture(pic) {
    if (!pic || typeof pic.src !== 'string') return null;
    const safe = pic.src.indexOf('data:image/') === 0 || pic.src.indexOf('avatars/') === 0;   // never a web address or script
    const w = +pic.w, h = +pic.h;
    return safe && w > 0 && h > 0 ? { src: pic.src, w: w, h: h, name: String(pic.name || ''), builtin: !!pic.builtin } : null;
  }

  function normMarks(marks) {
    const out = {};
    Geometry.MARKS.forEach(m => {
      const at = marks && marks[m.key];
      if (at && isFinite(at.x) && isFinite(at.y)) out[m.key] = { x: +at.x, y: +at.y };
    });
    return out;
  }

  function normPerson(p, i) {
    return {
      id: String(p.id || newId('p')), name: (typeof p.name === 'string' && p.name) ? p.name : 'Person',
      order: typeof p.order === 'number' ? p.order : i,
      scan: Object.assign(blankBody(), p.scan || {}), tape: Object.assign(blankBody(), p.tape || {}),
      lens: Object.assign({ waistD: '', arm: '' }, p.lens || {}),
      picture: normPicture(p.picture), marks: normMarks(p.marks)
    };
  }

  // A garment with an empty chart: five blank sizes, no name, no link.
  // "keep" carries over the type, chart kind, unit and fabric when you start a new chart.
  function blankGarment(keep) {
    const k = keep || {};
    const type = k.type || 'top';
    const sizes = type === 'pants' ? ['26', '28', '30', '32', '34'] : ['XS', 'S', 'M', 'L', 'XL'];
    // hemAmount / hemDir: the hem adjustment. Typed in the chart's unit; dir is 'up' (hem sits higher on you) or 'down'.
    // material: the text pasted from the product page. fabricAuto: true = the Fabric switch follows the guess made from it,
    // false = you chose the fabric yourself, so the guess leaves it alone.
    // stretchLevel: how much a Stretch fabric gives, 'low' (a flat 2 in), 'medium' or 'high' (a percentage of the garment).
    // stretchAuto works like fabricAuto, for the stretch level.
    // image: the garment's own photo, already cut out ({ src, w, h }), or null. imageOn: show it on the figure.
    // imageTol: how much background the cut-out removed. imageWidth: a hand correction to its width, in percent.
    // imageWrap: curve the garment round the body and light it like the scan (off = a flat cut-out).
    return { name: '', link: '', type: type, weave: '', material: '', fabric: 'none', fabricAuto: true, stretchLevel: 'low', stretchAuto: true,
      image: null, imageOn: true, imageWrap: true, imageTol: 40, imageWidth: 100, chartType: k.chartType || 'garment', unit: k.unit || 'in',
      hemAmount: '', hemDir: 'up', lengthFrom: 'shoulder', rows: sizes.map(s => Fit.blankRow(s)) };
  }

  function clampNumber(v, lo, hi, fallback) {
    const n = num(v);
    return n === null ? fallback : Math.min(hi, Math.max(lo, n));
  }

  // The saved garment photo must be a picture stored in the data itself, never a web address or a script.
  function normGarmentImage(im) {
    if (!im || typeof im.src !== 'string' || im.src.indexOf('data:image/') !== 0) return null;
    const w = +im.w, h = +im.h;
    const kept = num(im.kept);
    return w > 0 && h > 0 ? { src: im.src, w: w, h: h, kept: kept } : null;
  }

  function normGarment(g) {
    const base = blankGarment();
    const out = Object.assign({}, base, g || {});
    out.name = String(out.name || '');
    out.link = String(out.link || '');
    out.weave = String(out.weave || '');
    out.material = String(out.material || '');
    out.fabricAuto = out.fabricAuto !== false;
    out.stretchAuto = out.stretchAuto !== false;
    if (['low', 'medium', 'high'].indexOf(out.stretchLevel) < 0) out.stretchLevel = 'low';
    out.image = normGarmentImage(out.image);
    out.imageOn = out.imageOn !== false;
    out.imageWrap = out.imageWrap !== false;
    out.imageTol = clampNumber(out.imageTol, 5, 120, 40);
    out.imageWidth = clampNumber(out.imageWidth, 60, 140, 100);
    out.hemAmount = String(out.hemAmount == null ? '' : out.hemAmount);
    if (['up', 'down'].indexOf(out.hemDir) < 0) out.hemDir = 'up';
    if (['shoulder', 'top-edge'].indexOf(out.lengthFrom) < 0) out.lengthFrom = 'shoulder';
    if (['top', 'dress', 'pants'].indexOf(out.type) < 0) out.type = 'top';
    if (['stretch', 'elastic-waist', 'none'].indexOf(out.fabric) < 0) out.fabric = 'none';
    if (['garment', 'range', 'tofit'].indexOf(out.chartType) < 0) out.chartType = 'garment';
    if (['in', 'cm'].indexOf(out.unit) < 0) out.unit = 'in';
    out.rows = (Array.isArray(out.rows) && out.rows.length ? out.rows : base.rows).map(r => Object.assign(Fit.blankRow(''), r));
    return out;
  }

  function normRules(r) {
    const out = clone(Fit.DEFAULT_RULES);
    Object.keys(out).forEach(k => { const v = num(r && r[k]); if (v !== null) out[k] = v; });
    return out;
  }

  function normLog(e) {
    const entry = Object.assign({ zones: {}, hem: null, sleeve: null, sizes: {} }, e);
    entry.actual = Object.assign({ size: '', zones: {}, hem: '', sleeve: '', note: '' }, e.actual || {});
    entry.actual.zones = entry.actual.zones || {};
    entry.sizes = entry.sizes || {};
    return entry;
  }

  // Put a data object (from storage or from an imported file) into the state.
  function applyData(d) {
    state.people = d.people.map(normPerson).sort((a, b) => a.order - b.order);
    if (!state.people.length) state.people = [priiPerson()];
    const ui = d.ui || {};
    state.pid = state.people.some(p => p.id === ui.pid) ? ui.pid : state.people[0].id;
    state.source = ui.source === 'tape' ? 'tape' : 'scan';
    state.garment = normGarment(d.garment);
    state.rules = normRules(d.rules);
    state.log = (d.log || []).map(normLog).sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
    state.sel = null;
  }

  // ---------- saving ----------

  let storageOk = true, lastSave = null, saveTimer = null;

  function snapshot() {
    return { app: Storage.APP_ID, version: 1, savedAt: new Date().toISOString(),
      people: state.people, garment: state.garment, rules: state.rules, log: state.log, ui: { pid: state.pid, source: state.source } };
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    lastSave = Storage.save(snapshot());
    renderStatus();
    return lastSave;
  }

  // Typing saves a moment after you stop, not on every key press.
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  function renderStatus() {
    const el = $('#sstat');
    const where = location.protocol === 'file:' ? 'opened from a file' : location.host;
    const last = Storage.lastExport();
    const lastText = last ? new Date(last).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never';
    el.classList.remove('bad');
    if (!storageOk) { el.textContent = 'This browser is blocking saving. Use Export data to keep your work.'; el.classList.add('bad'); }
    else if (lastSave && !lastSave.ok) { el.textContent = 'Could not save: the browser storage is full. Export your data, then remove a picture or old tests.'; el.classList.add('bad'); }
    else {
      const used = lastSave && lastSave.ok ? ' ' + Storage.percentUsed(lastSave.chars) + '% of the space used.' : '';
      el.textContent = 'Saved in this browser (' + where + ').' + used + ' Last export: ' + lastText + '.';
    }
  }

  // ---------- body numbers ----------

  function bodyFor(p, source) {
    const s = p[source] || {};
    return { h: num(s.h), bust: num(s.bust), waist: num(s.waist), hip: num(s.hip), inseam: num(s.inseam) };
  }

  // Work out the whole answer for one person, one set of numbers (scan or tape) and the current chart.
  function analyse(source) {
    const p = person();
    const body = bodyFor(p, source);
    const g = Geometry.build(p, body);
    return { source: source, body: body, g: g, ana: Fit.analyseAll(body, g, state.garment, state.rules) };
  }

  // ======================================================================
  // 2. BODY PANEL
  // ======================================================================

  // A row of buttons where exactly one is pressed.
  function seg(el, options, current, onPick) {
    el.innerHTML = options.map(o => '<button type="button" aria-pressed="' + (o[0] === current) + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>').join('');
    $$('button', el).forEach(b => { b.onclick = () => onPick(b.getAttribute('data-v')); });
  }

  function renderPeople() {
    const el = $('#people');
    const list = state.people.slice().sort((a, b) => a.order - b.order);
    el.innerHTML = list.map(p => '<button type="button" data-id="' + esc(p.id) + '" aria-pressed="' + (p.id === state.pid) + '">' + esc(p.name) + '</button>').join('') +
      '<button type="button" id="addP" style="border-style:dashed">Add person</button>';
    $$('button[data-id]', el).forEach(b => {
      b.onclick = () => { state.pid = b.getAttribute('data-id'); state.sel = null; save(); renderBody(); renderResult(); };
    });
    $('#addP').onclick = () => {
      const order = state.people.reduce((m, p) => Math.max(m, p.order), -1) + 1;
      const p = blankPerson('New person', order);
      state.people.push(p);
      state.pid = p.id;
      state.sel = null;
      save(); renderBody(); renderResult();
      $('#pname').focus(); $('#pname').select();
    };
  }

  function renderBody() {
    const p = person();
    renderPeople();
    $('#pname').value = p.name;
    seg($('#srcSeg'), [['scan', 'Body scan'], ['tape', 'Tape measure']], state.source, v => { state.source = v; state.sel = null; save(); renderBody(); renderResult(); });

    let h = '<span></span><span class="lab">Body scan</span><span class="lab">Tape</span><span class="lab dl">Scan vs tape</span>';
    BODY_FIELDS.forEach(f => {
      h += '<span class="lab dl">' + f[1] + '</span>' +
        ['scan', 'tape'].map(s => '<input class="n" inputmode="decimal" data-s="' + s + '" data-f="' + f[0] + '" value="' + esc(p[s][f[0]]) + '" aria-label="' + f[1] + ', ' + SOURCE_LABEL[s].toLowerCase() + '"' + (s === state.source ? ' style="border-color:var(--ink)"' : '') + '>').join('') +
        '<span class="delta" data-d="' + f[0] + '"></span>';
    });
    $('#bgrid').innerHTML = h;
    $$('#bgrid input').forEach(inp => {
      inp.oninput = () => {
        person()[inp.getAttribute('data-s')][inp.getAttribute('data-f')] = inp.value;
        save(); updateDeltas(); updateBodyNote(); renderResult();
      };
    });
    $('#l-waistD').value = p.lens.waistD;
    $('#l-arm').value = p.lens.arm;
    updateDeltas(); updateBodyNote(); renderPicture();
  }

  // "scan higher by 0.5 in" next to each pair of numbers
  function updateDeltas() {
    const p = person();
    $$('#bgrid .delta').forEach(e => {
      const f = e.getAttribute('data-d'), a = num(p.scan[f]), b = num(p.tape[f]);
      if (a === null || b === null) { e.textContent = ''; e.classList.remove('big'); return; }
      const d = a - b;
      e.textContent = Math.abs(d) < 0.05 ? 'same' : (d > 0 ? 'scan higher by ' : 'scan lower by ') + fmt(Math.abs(d)) + ' in';
      e.classList.toggle('big', Math.abs(d) >= 1);
    });
  }

  function updateBodyNote() {
    const b = bodyFor(person(), state.source);
    let t = '';
    if (b.bust === null || b.waist === null || b.hip === null) t = 'Fill in bust, waist and hip in the ' + SOURCE_LABEL[state.source].toLowerCase() + ' column to get a full result. All body numbers are in inches.';
    else if (b.h === null) t = 'Height is empty, so the picture is scaled to an assumed 64 in.';
    const e = $('#bnote');
    e.textContent = t;
    e.hidden = !t;
  }

  // ---------- the scan picture ----------

  // A message about the last picture action (added, refused, ...). It belongs to one person,
  // so it is only shown while that person is selected.
  let pictureNote = null;    // { pid, text }

  function setPictureStatus(text) {
    pictureNote = text ? { pid: person().id, text: text } : null;
  }

  function renderPicture() {
    const p = person();
    const has = !!p.picture;
    const marked = Geometry.markCount(p);
    $('#picClear').hidden = !has;
    $('#calBtn').disabled = !has;
    $('#calBtn').textContent = has ? 'Calibrate (' + marked + ' of ' + Geometry.MARKS.length + ' marked)' : 'Calibrate';
    $('#calBtn').classList.toggle('ghost', !has || marked >= Geometry.MARKS.length);
    if (pictureNote && pictureNote.pid === p.id) $('#picStat').textContent = pictureNote.text;
    else if (!has) $('#picStat').textContent = 'No picture yet.';
    else if (p.picture.builtin) $('#picStat').textContent = 'Built-in scan, used exactly as it is.';
    else $('#picStat').textContent = 'Picture: ' + (p.picture.name || 'uploaded') + ', ' + p.picture.w + ' x ' + p.picture.h + ' px.';
  }

  // Read an image file and give back { src, w, h, name }. src is a data URL, the picture stored as text.
  // The file is kept exactly as it is, unless it is too big for browser storage; then it is shrunk.
  function readPicture(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) { reject(new Error('type')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read'));
      reader.onload = () => {
        const original = reader.result;
        const img = new Image();
        img.onerror = () => reject(new Error('image'));
        img.onload = () => {
          const w = img.naturalWidth, h = img.naturalHeight;
          if (h <= MAX_PICTURE_HEIGHT && original.length <= MAX_PICTURE_CHARS) { resolve({ src: original, w: w, h: h, name: file.name, builtin: false }); return; }
          const scale = Math.min(1, MAX_PICTURE_HEIGHT / h);
          const cv = document.createElement('canvas');
          cv.width = Math.round(w * scale);
          cv.height = Math.round(h * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          let src = cv.toDataURL('image/png');                                    // lossless first
          if (src.length > MAX_PICTURE_CHARS) src = cv.toDataURL('image/jpeg', 0.92);   // still too big: small quality loss
          resolve({ src: src, w: cv.width, h: cv.height, name: file.name, builtin: false, shrunk: true });
        };
        img.src = original;
      };
      reader.readAsDataURL(file);
    });
  }

  $('#picFile').onchange = async function () {
    const file = this.files && this.files[0];
    this.value = '';
    const p = person();
    if (!file) return;
    if (Object.keys(p.marks).length && !confirm('Replace the picture? The calibration marks for ' + p.name + ' belong to the old picture, so they will be cleared.')) return;
    setPictureStatus('Reading the picture...');
    renderPicture();
    try {
      const pic = await readPicture(file);
      const before = { picture: p.picture, marks: p.marks };
      p.picture = pic;
      p.marks = {};
      if (!saveNow().ok) {                                  // browser storage refused it: put everything back
        p.picture = before.picture;
        p.marks = before.marks;
        saveNow();
        setPictureStatus('That picture does not fit in the browser storage. Remove a picture or export and clear old tests, then try again.');
      } else {
        setPictureStatus('Picture added' + (pic.shrunk ? ' (shrunk to fit the storage)' : '') + '. Press Calibrate to mark the head top, waist, hip, floor and the rest.');
      }
    } catch (e) {
      setPictureStatus(e.message === 'type' || e.message === 'image' ? 'That file cannot be read as a picture. Use a PNG or JPG screenshot.' : 'Could not read that file.');
    }
    renderPicture(); renderResult();
  };

  $('#picClear').onclick = () => {
    const p = person();
    if (!confirm('Remove the picture and the calibration marks for ' + p.name + '?')) return;
    p.picture = null;
    p.marks = {};
    setPictureStatus('');
    save(); renderPicture(); renderResult();
  };

  $('#calBtn').onclick = () => {
    const p = person();
    if (!p.picture) return;
    setPictureStatus('');
    Calibrate.open(p, () => { save(); renderResult(); });
  };
  $('#calDlg').addEventListener('close', () => { saveNow(); renderPicture(); renderResult(); });

  $('#pname').oninput = function () {
    const p = person();
    p.name = this.value;
    const b = $('#people button[data-id="' + p.id + '"]');
    if (b) b.textContent = p.name || 'Person';
    save();
  };
  $('#l-waistD').oninput = function () { person().lens.waistD = this.value; save(); renderResult(); };
  $('#l-arm').oninput = function () { person().lens.arm = this.value; save(); renderResult(); };

  $('#delPerson').onclick = () => {
    const p = person();
    if (!confirm('Remove ' + p.name + ' with their numbers, picture and marks? Their logged tests stay in the test log.')) return;
    state.people = state.people.filter(x => x.id !== p.id);
    if (!state.people.length) state.people.push(blankPerson('New person', 0));
    state.pid = state.people[0].id;
    state.sel = null;
    save(); renderBody(); renderResult();
  };

  // ======================================================================
  // 3. GARMENT PANEL
  // ======================================================================

  const TYPES = [['top', 'Top'], ['dress', 'Dress'], ['pants', 'Pants']];
  const FABRICS = [['stretch', 'Stretch'], ['elastic-waist', 'Elastic waist'], ['none', 'No stretch']];
  const LEVELS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
  const CHARTS = [['garment', 'Garment measurements'], ['range', 'Body ranges'], ['tofit', 'Body, one number (to fit)']];
  const UNITS = [['in', 'Inches'], ['cm', 'Centimetres']];
  const HEM_DIRS = [['up', 'Higher on me'], ['down', 'Lower on me']];
  const LENGTH_FROM = [['shoulder', 'Top of the shoulder'], ['top-edge', 'Top edge (tube, strapless)']];
  const RULE_DEF = [
    ['allow', 'Low stretch allowance', 'Inches added for Low stretch fabric, or for the waist only with an elastic waist'],
    ['allowMedium', 'Medium stretch (%)', 'Percent of the garment measurement added for Medium stretch'],
    ['allowHigh', 'High stretch (%)', 'Percent of the garment measurement added for High stretch'],
    ['fitted', 'Fitted from', 'Room below this is Tight'],
    ['regular', 'Regular from', 'Room at or above this is Regular'],
    ['loose', 'Loose from', 'Room at or above this is Loose']
  ];

  // Switching between inches and centimetres converts every number already typed in the chart.
  function changeUnit(unit) {
    const gar = state.garment;
    if (gar.unit === unit) return;
    gar.rows.forEach(r => CHART_NUMBER_KEYS.forEach(k => {
      const v = num(r[k]);
      if (v !== null) r[k] = fmt(fromInches(toInches(v, gar.unit), unit));
    }));
    const adjust = num(gar.hemAmount);                                   // the hem adjustment is a distance too
    if (adjust !== null) gar.hemAmount = fmt(fromInches(toInches(adjust, gar.unit), unit));
    gar.unit = unit;
  }

  // The Fabric switch, and under it (for Stretch on a garment chart) how much it stretches.
  // Choosing either by hand switches the material guess off for it (fabricAuto / stretchAuto = false).
  function renderFabricSeg() {
    const gar = state.garment;
    seg($('#fabSeg'), FABRICS, gar.fabric, v => { gar.fabric = v; gar.fabricAuto = false; save(); renderGarment(); renderResult(); });
    const showLevel = gar.fabric === 'stretch' && gar.chartType === 'garment';
    $('#levelField').hidden = !showLevel;
    $('#levelNote').hidden = !showLevel;
    if (!showLevel) return;
    seg($('#levelSeg'), LEVELS, gar.stretchLevel, v => { gar.stretchLevel = v; gar.stretchAuto = false; save(); renderGarment(); renderResult(); });
    const r = state.rules;
    $('#levelNote').textContent = 'How much it stretches. Low adds a flat ' + fmt(r.allow) + ' in (stretch denim, a little elastane). Medium adds ' + fmt(r.allowMedium)
      + '% of each garment measurement, High adds ' + fmt(r.allowHigh) + '% (a slim ribbed tank, a body-hugging knit). If the page says "Stretchability", use its word.';
  }

  function renderGarment() {
    const gar = state.garment;
    $('#gname').value = gar.name;
    $('#glink').value = gar.link;
    showLinkButton();
    const again = () => { state.sel = null; save(); renderGarment(); renderResult(); };
    seg($('#typeSeg'), TYPES, gar.type, v => { gar.type = v; again(); });
    seg($('#chartSeg'), CHARTS, gar.chartType, v => { gar.chartType = v; again(); });
    seg($('#unitSeg'), UNITS, gar.unit, v => { changeUnit(v); again(); });
    renderFabricSeg();
    seg($('#hemDirSeg'), HEM_DIRS, gar.hemDir, v => { gar.hemDir = v; save(); renderGarment(); renderResult(); });
    seg($('#lengthFromSeg'), LENGTH_FROM, gar.lengthFrom, v => { gar.lengthFrom = v; save(); renderGarment(); renderResult(); });
    $('#lengthFromBox').hidden = gar.type === 'pants';          // pants are measured from the floor, not from the top
    $('#gweave').value = gar.weave;
    $('#gmat').value = gar.material;
    showMaterialGuess();
    renderImageBox();
    $('#hemAmount').value = gar.hemAmount;
    $('#hemUnit').textContent = '(' + gar.unit + ')';

    const isRange = gar.chartType === 'range';
    const bodyChart = gar.chartType !== 'garment';     // a chart of BODY sizes (ranges, or one "to fit" number)
    $('#rulesBox').hidden = bodyChart;         // the stretch allowance and fit rules only apply to garment measurements
    // The fabric and material stay visible on every chart. On a body chart they have one job: when two sizes fit
    // about equally well, stretchy fabric takes the smaller size and anything else the larger.
    $('#fabNote').hidden = !bodyChart;
    $('#fabNote').textContent = 'On a body chart the fabric is only used to break a tie between two sizes that fit equally well: Stretch picks the smaller size, anything else the larger.';
    renderChart();
    renderRules();

    const hints = {
      garment: 'Type the measurements the way the brand lists them, as the full distance around the garment. Length runs from the high point of the shoulder down the front. Sleeve runs from the shoulder point.',
      range: 'Type the minimum and maximum body measurement the brand lists for each size, for example Chest 35.5 to 38.5. List the sizes from smallest to largest. Leave a zone empty if the brand does not list it. Length and sleeve are single garment measurements and are optional: they place the hem and sleeve on the picture.',
      tofit: 'Type the body measurement each size is made to fit, one number per size. Brands label it "To fit" or "Body measurements". '
        + 'Each size is taken to cover the bodies halfway to its neighbours: sizes 32 and 34 meet at 33, and a body of exactly 33 goes to the larger size. '
        + 'List the sizes from smallest to largest. Length and sleeve are single garment measurements and are optional: they place the hem and sleeve on the picture.',
      pants: 'Hem height is your inseam minus the garment inseam. Waist and hip are full distances around.'
    };
    $('#chartHint').textContent = gar.type === 'pants' ? hints.pants + (isRange ? ' Waist and hip are body ranges.' : bodyChart ? ' Waist and hip are body measurements.' : '') : hints[gar.chartType];
  }

  function renderChart() {
    const gar = state.garment, cols = Fit.COLUMNS[gar.type], zones = Fit.zonesFor(gar.type);
    const isRange = gar.chartType === 'range';
    const ranged = k => isRange && zones.indexOf(k) >= 0;
    const unit = ' (' + gar.unit + ')';

    // header: in a range chart each zone has two columns, min and max
    let h = '<thead><tr><th' + (isRange ? ' rowspan="2"' : '') + '>Size</th>';
    cols.forEach(k => {
      if (ranged(k)) h += '<th colspan="2">' + Fit.COLUMN_LABEL[k] + unit + '</th>';
      else h += '<th' + (isRange ? ' rowspan="2"' : '') + '>' + Fit.COLUMN_LABEL[k] + unit + '</th>';
    });
    h += '<th' + (isRange ? ' rowspan="2"' : '') + '></th></tr>';
    if (isRange) h += '<tr class="subhead">' + zones.map(() => '<th>min</th><th>max</th>').join('') + '</tr>';
    h += '</thead><tbody>';

    const input = (i, key, label, size) => '<td><input class="n" inputmode="decimal" data-k="' + key + '" value="' + esc(gar.rows[i][key]) + '" aria-label="' + label + ', size ' + esc(size) + '"></td>';
    gar.rows.forEach((r, i) => {
      h += '<tr data-i="' + i + '"><td><input type="text" data-k="size" value="' + esc(r.size) + '" aria-label="Size name"></td>';
      cols.forEach(k => {
        if (ranged(k)) h += input(i, k, Fit.COLUMN_LABEL[k] + ' minimum', r.size) + input(i, k + 'Max', Fit.COLUMN_LABEL[k] + ' maximum', r.size);
        else h += input(i, k, Fit.COLUMN_LABEL[k], r.size);
      });
      h += '<td><button type="button" class="x" data-del="' + i + '" aria-label="Remove size ' + esc(r.size) + '">&times;</button></td></tr>';
    });
    $('#chart').innerHTML = h + '</tbody>';

    $$('#chart input').forEach(inp => {
      inp.oninput = () => {
        const i = +inp.closest('tr').getAttribute('data-i');
        gar.rows[i][inp.getAttribute('data-k')] = inp.value;
        save(); renderResult();
      };
    });
    $$('#chart .x').forEach(b => {
      b.onclick = () => {
        if (gar.rows.length <= 1) return;
        gar.rows.splice(+b.getAttribute('data-del'), 1);
        state.sel = null;
        save(); renderChart(); renderResult();
      };
    });
  }

  function renderRules() {
    $('#rules').innerHTML = RULE_DEF.map(r => '<label class="fld"><span class="lab">' + r[1] + '</span><input class="n" inputmode="decimal" data-r="' + r[0] + '" value="' + state.rules[r[0]] + '"><span class="hint">' + r[2] + '</span></label>').join('');
    $$('#rules input').forEach(inp => {
      inp.oninput = () => {
        const v = num(inp.value);
        if (v !== null) { state.rules[inp.getAttribute('data-r')] = v; save(); renderFabricSeg(); renderResult(); }
      };
    });
  }

  // The "Open link" button only shows when the link box holds a real web address.
  function showLinkButton() {
    const href = safeLink(state.garment.link);
    const a = $('#glinkOpen');
    a.hidden = !href;
    if (href) a.setAttribute('href', href); else a.removeAttribute('href');
  }
  $('#glink').oninput = function () { state.garment.link = this.value; showLinkButton(); save(); };

  // Empty the chart, name and link, and start again with five blank sizes. Type, chart kind, unit and fabric are kept.
  $('#newChart').onclick = () => {
    if (!confirm('Start a new chart? The garment name, link and every number in the chart will be cleared. Tests already in the log are kept.')) return;
    state.garment = blankGarment(state.garment);
    state.sel = null;
    save(); renderGarment(); renderResult();
    $('#gname').focus();
  };

  // ---- paste a size chart ----
  let pasted = null;             // what was understood from the pasted text (the result of ChartParse.parse)

  const KIND_NAME = { garment: 'measurements of the garment', tofit: 'body measurements, one number per size ("to fit")', range: 'body ranges' };

  function renderPasteResult() {
    const el = $('#pasteResult');
    if (!$('#pasteText').value.trim()) { pasted = null; el.innerHTML = ''; return; }
    pasted = ChartParse.parse($('#pasteText').value);
    if (!pasted.ok) { el.innerHTML = '<p class="note warn">' + esc(pasted.error) + '</p>'; return; }

    const r = pasted, unitName = r.unit === 'cm' ? 'centimetres' : 'inches';
    let html = '<p class="pr-line">Found <b>' + r.rows.length + ' sizes</b> (' + esc(r.rows.map(x => x.size).join(', ')) + '), numbers in <b>' + unitName + '</b>' + (r.unitGuessed ? ' (a guess)' : '') + '.</p>';
    if (r.hasRanges) {
      html += '<p class="pr-line">These are <b>body ranges</b>: ' + esc(r.kindWhy) + '.</p>';
    } else {
      html += '<label class="fld" style="margin-top:10px;max-width:420px"><span class="lab">These numbers are</span><select id="pasteKind">' +
        '<option value="garment">Measurements of the garment</option><option value="tofit">Body measurements, one number per size ("to fit")</option></select></label>' +
        '<p class="note" id="pasteWhy"></p>';
    }
    html += '<ul class="pr-list">' + r.used.map(u => '<li>' + esc(u.name) + ': from the column "' + esc(u.header) + '"</li>').join('') + '</ul>';
    if (r.ignored.length) html += '<p class="note">Not used: ' + r.ignored.map(i => '"' + esc(i.header) + '" (' + esc(i.why) + ')').join('; ') + '.</p>';
    r.warnings.forEach(w => { html += '<p class="note warn">' + esc(w) + '</p>'; });

    // a small preview of the rows
    const shown = r.used.map(u => u.field);
    html += '<table class="pr-table"><thead><tr><th>Size</th>' + shown.map(f => '<th>' + esc(Fit.COLUMN_LABEL[f]) + '</th>').join('') + '</tr></thead><tbody>' +
      r.rows.map(row => '<tr><td>' + esc(row.size) + '</td>' + shown.map(f => '<td>' + esc(row[f + 'Max'] && row[f + 'Max'] !== row[f] ? row[f] + ' to ' + row[f + 'Max'] : row[f]) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    html += '<div class="actions"><button type="button" class="btn" id="pasteUse">Use this chart</button><button type="button" class="btn ghost" id="pasteClear">Clear</button></div>';
    el.innerHTML = html;

    const kind = $('#pasteKind');
    if (kind) {
      kind.value = r.chartType;
      const why = () => { $('#pasteWhy').textContent = r.chartType === 'garment' && r.kindGuessed ? 'Guess: ' + r.kindWhy + '. Change it here if the page says otherwise.' : 'Because ' + r.kindWhy + '.'; };
      why();
      kind.onchange = () => { r.chartType = kind.value; r.kindGuessed = false; r.kindWhy = 'you chose ' + KIND_NAME[kind.value]; why(); };
    }
    $('#pasteUse').onclick = usePastedChart;
    $('#pasteClear').onclick = () => { $('#pasteText').value = ''; renderPasteResult(); };
  }

  // Put the understood chart into the garment: its sizes and numbers, the unit, the chart kind, and the type if it is pants.
  function usePastedChart() {
    const r = pasted, gar = state.garment;
    if (!r || !r.ok) return;
    const filled = gar.rows.some(row => Object.keys(row).some(k => k !== 'size' && String(row[k]).trim() !== ''));
    if (filled && !confirm('Replace the sizes and numbers in the chart below with the pasted chart?')) return;
    const adjust = num(gar.hemAmount);                                      // the hem adjustment is typed in the chart's unit
    if (adjust !== null && gar.unit !== r.unit) gar.hemAmount = fmt(fromInches(toInches(adjust, gar.unit), r.unit));
    gar.chartType = r.chartType;
    gar.unit = r.unit;
    if (r.type) gar.type = r.type;
    gar.rows = r.rows.map(row => Object.assign(Fit.blankRow(''), row));
    state.sel = null;
    $('#pasteText').value = '';
    $('#pasteResult').innerHTML = '<p class="note">Chart filled in. Check the numbers in the table below.</p>';
    $('#pasteBox').open = false;
    save(); renderGarment(); renderResult();
  }
  $('#pasteText').oninput = renderPasteResult;

  $('#addRow').onclick = () => {
    state.garment.rows.push(Fit.blankRow(''));
    state.sel = null;
    save(); renderChart(); renderResult();
    const inputs = $$('#chart tbody tr:last-child input');
    if (inputs[0]) inputs[0].focus();
  };
  $('#gname').oninput = function () { state.garment.name = this.value; save(); renderResult(); };
  $('#hemAmount').oninput = function () { state.garment.hemAmount = this.value; save(); renderResult(); };

  // ---- the garment's own photo on the figure (rough test) ----
  let imgSource = null;          // the photo you added, kept only while this page is open so the cut-out strength can be changed

  function renderImageBox() {
    const gar = state.garment, has = !!gar.image;
    $('#imgTools').hidden = !has;
    $('#imgClear').hidden = !has;
    if (!has) { imgSource = null; return; }
    $('#imgPrev').src = gar.image.src;
    $('#imgOn').checked = gar.imageOn;
    $('#imgWrap').checked = gar.imageWrap;
    $('#imgTol').value = gar.imageTol;
    $('#imgTol').disabled = !imgSource;
    $('#imgTolVal').textContent = gar.imageTol;
    $('#imgWidth').value = gar.imageWidth;
    $('#imgWidthVal').textContent = gar.imageWidth + '%';
    const warn = GarmentImage.photoWarning(gar.image.kept);
    $('#imgWarn').hidden = !warn;
    $('#imgWarn').textContent = warn;
    if (!imgSource && !$('#imgMsg').textContent) $('#imgMsg').textContent = 'The cut-out is saved. To change how much background is removed, add the photo again.';
  }

  // Cut the background out of the photo at this strength and save the result. Returns a problem text, or '' when it worked.
  function cutAndStore(tolerance) {
    const gar = state.garment;
    const cut = GarmentImage.prepare(imgSource, tolerance);
    if (!cut) return 'Nothing was left after removing the background. Lower the cut-out strength, or use a photo on a plain background.';
    const before = { image: gar.image, tol: gar.imageTol };
    gar.image = { src: GarmentImage.toDataURL(cut), w: cut.w, h: cut.h, kept: Math.round(cut.kept * 1000) / 1000 };
    gar.imageTol = tolerance;
    if (!saveNow().ok) {                                    // browser storage refused it: put everything back
      gar.image = before.image;
      gar.imageTol = before.tol;
      saveNow();
      return 'That photo does not fit in the browser storage. Export your data and remove old pictures or tests, then try again.';
    }
    return '';
  }

  $('#imgFile').onchange = async function () {
    const file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    const msg = $('#imgMsg');
    if (!/^image\//.test(file.type)) { msg.textContent = 'That file is not a picture. Use a PNG or JPG.'; return; }
    msg.textContent = 'Reading the photo...';
    try {
      const url = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
      imgSource = await GarmentImage.loadImage(url);
    } catch (e) { msg.textContent = 'Could not read that file as a picture.'; return; }
    state.garment.imageOn = true;
    const problem = cutAndStore(state.garment.imageTol);
    msg.textContent = problem || 'Photo added. In the Result panel, click the sizes to see each one on the figure. If parts of the garment are missing, or the background is still there, change the cut-out strength.';
    renderImageBox(); renderResult();
  };

  let tolTimer = null;
  $('#imgTol').oninput = function () {
    $('#imgTolVal').textContent = this.value;
    clearTimeout(tolTimer);
    tolTimer = setTimeout(() => {
      if (!imgSource) return;
      $('#imgMsg').textContent = cutAndStore(+$('#imgTol').value);
      renderImageBox(); renderResult();
    }, 150);
  };
  $('#imgWidth').oninput = function () {
    state.garment.imageWidth = +this.value;
    $('#imgWidthVal').textContent = this.value + '%';
    save(); renderResult();
  };
  $('#imgOn').onchange = function () { state.garment.imageOn = this.checked; save(); renderResult(); };
  $('#imgWrap').onchange = function () { state.garment.imageWrap = this.checked; save(); renderResult(); };
  $('#imgClear').onclick = () => {
    state.garment.image = null;
    imgSource = null;
    $('#imgMsg').textContent = '';
    save(); renderImageBox(); renderResult();
  };

  // How strongly the garment photo is wrapped round the body (see garmentimage.js). Starting values, judged by eye.
  const WRAP = 0.55;             // 0 = flat, 1 = a full tube: how much the fabric is squeezed toward the sides
  const EDGE = 0.12;             // how much darker the cloth gets at the very sides
  const SHADE_CONTRAST = 1.3;    // how strongly the scan's own (smoothed) lighting shows on the garment

  // The garment's photo, fitted to the body in the scan, ready for the figure.
  // Widths: at the bust, waist and hip (and the hem, if the chart has one) the garment is as wide as the body REALLY is in the
  // scan at that height, centred where the body really is, plus extra where the chart says the garment is bigger than the body.
  // Where the garment is smaller than the body it is drawn as wide as the body (it would be stretched to fit).
  // Returns null when it cannot be drawn; the line under the figure says why.
  function overlayFor(gar, row, rr, hem, g, body, p) {
    const note = $('#ovNote');
    const say = t => { note.hidden = !t; note.textContent = t || ''; note.classList.remove('p-warn'); return null; };
    if (!gar.image || !gar.imageOn) return say('');
    if (gar.type === 'pants') return say('The garment photo is only drawn for tops and dresses.');
    if (!hem || hem.top == null) return say('The garment photo is not drawn: this size has no length in the chart.');
    if (hem.top - hem.height < 2) return say('The garment photo is not drawn: the length is too short to place.');
    const cut = GarmentImage.cached(gar.image.src);
    if (!cut) { GarmentImage.decode(gar.image.src).then(() => renderResult(), () => {}); return say('Preparing the garment photo...'); }

    // the scan: its real outline and its lighting
    let scan = null;
    if (p.picture && g.picture) {
      scan = GarmentImage.cachedScan(p.picture.src);
      if (!scan) { GarmentImage.scan(p.picture.src).then(() => renderResult()); return say('Preparing the garment photo...'); }
      if (scan.failed) scan = null;
    }
    const pxIn = scan ? scan.pic.w / g.picture.w : 0;                       // scan pixels per inch
    const centreX = scan ? -g.picture.x * pxIn : 0;                          // the column of the figure's centre line
    const floorY = scan ? g.picture.top * pxIn : 0;                          // the row of the floor
    // How wide the body really is at a height, and how far its centre is right of the centre line (inches). null when the scan
    // cannot say (the arms touch the body there, or the scan was not read well): then the fixed proportions are used.
    const outline = (height, formulaHalf) => {
      if (!scan) return null;
      const e = GarmentImage.bodyEdgesAt(scan.mask, scan.pic.w, scan.pic.h, centreX, floorY - height * pxIn, 3);
      if (!e) return null;
      const half = (e.right - e.left) / 2 / pxIn;
      if (half < 0.7 * formulaHalf || half > 1.6 * formulaHalf) return null;
      return { half: half, shift: ((e.right + e.left) / 2 - centreX) / pxIn };
    };
    let measured = 0, guessed = 0;
    const anchors = [], names = [];
    const zoneH = { bust: g.hps - g.bustD, waist: g.hps - g.waistD, hip: g.hps - g.hipD };
    Fit.zonesFor(gar.type).forEach(z => {
      const r = rr.zones[z];
      if (!r || !r.covered || r.gv == null || !r.bv) return;
      if (zoneH[z] > hem.top || zoneH[z] < hem.height) return;
      const ratio = g.half[z] / r.bv;                                        // front-view half-width per inch of circumference
      const o = outline(zoneH[z], g.half[z]);
      if (o) measured++; else guessed++;
      const base = o || { half: g.half[z], shift: 0 };
      anchors.push({ h: zoneH[z], half: base.half + ratio * Math.max(0, r.gv - r.bv), shift: base.shift, flat: r.gv / 4 });
      names.push(Fit.ZONE_NAME[z].toLowerCase());
    });
    // the hem: the distance round the bottom edge, if the chart has it
    const hemC = num(row.hem) === null ? null : toInches(num(row.hem), gar.unit);
    if (hemC) {
      const pts = [[zoneH.bust, body.bust], [zoneH.waist, body.waist], [zoneH.hip, body.hip]].filter(q => q[1] != null && q[1] !== undefined).sort((x, y) => x[0] - y[0]);
      const bodyC = pts.length ? interp(pts, hem.height) : hemC;             // the body's distance round at the hem's height
      const formulaHalf = Geometry.halfWidthAt(g, hem.height);
      const o = outline(hem.height, formulaHalf);
      if (o) measured++; else guessed++;
      const base = o || { half: formulaHalf, shift: 0 };
      anchors.push({ h: hem.height, half: base.half + 0.16 * Math.max(0, hemC - bodyC), shift: base.shift, flat: hemC / 4, atBottom: true });
      names.push('hem');
    }

    const fix = gar.imageWidth / 100;

    // Below the bust the garment follows the body's outline row by row: it can never be narrower than the body it covers, so a
    // fitted top (or one that is too small, and would be stretched) hugs the waist curve instead of keeping the photo's own,
    // narrower shape. Rows where the scan cannot say (the arms touch the body) keep the widths from the anchors above.
    let floor = null, floorFrom = 0;
    if (scan) {
      const length = hem.top - hem.height, rowsN = cut.h, pxPerInOut = rowsN / length;
      floorFrom = Math.min(rowsN - 1, Math.max(0, Math.round((hem.top - zoneH.bust) / length * (rowsN - 1))));
      const raw = new Array(rowsN).fill(null);
      for (let y = floorFrom; y < rowsN; y++) {
        const height = hem.top - (y + 0.5) / pxPerInOut;
        raw[y] = outline(height, Geometry.halfWidthAt(g, height));
      }
      const smooth = new Array(rowsN).fill(null);                            // a moving average, so the edge is smooth
      for (let y = floorFrom; y < rowsN; y++) {
        let sh = 0, ss = 0, n = 0;
        for (let i = Math.max(floorFrom, y - 8); i <= Math.min(rowsN - 1, y + 8); i++) if (raw[i]) { sh += raw[i].half; ss += raw[i].shift; n++; }
        if (raw[y] && n) smooth[y] = { half: sh / n, shift: ss / n };
      }
      floor = y => smooth[y];
    }
    const plan = GarmentImage.planWarp(cut, hem.top, hem.height, anchors, fix, { floor: floor, floorFrom: floorFrom });
    const wrapped = !!gar.imageWrap;
    const shade = wrapped && scan ? (ox, y) => {
      const X = (plan.x0 + ox + 0.5) / plan.pxPerIn, height = hem.top - (y + 0.5) / plan.pxPerIn;
      const px = centreX + X * pxIn, py = floorY - height * pxIn;
      if (px < 0 || py < 0 || px >= scan.pic.w || py >= scan.pic.h) return 1;
      if (!scan.mask[Math.floor(py) * scan.pic.w + Math.floor(px)]) return 0.9;       // past the body's edge (a loose garment): a little in shade
      const l = GarmentImage.lumaSmoothAt(scan.grid, px, py, scan.ref);
      return Math.min(1.08, Math.max(0.8, 1 + SHADE_CONTRAST * (l / scan.ref - 1)));
    } : null;
    const opts = { wrap: wrapped ? WRAP : 0, edge: wrapped ? EDGE : 0, shade: shade };
    const key = [hem.top, hem.height].map(n => n.toFixed(2)).join(',') + '|' + anchors.map(a => [a.h, a.half, a.shift].map(n => n.toFixed(2)).join(':')).join(',') + '|' + fix + '|' + (wrapped ? 1 : 0) +
      '|' + (scan ? p.picture.src.length + ':' + p.picture.src.slice(-12) + ':hug' : 'x');

    // what to tell you under the figure
    const warnings = [GarmentImage.photoWarning(gar.image.kept), GarmentImage.shapeWarning(plan.shape)].filter(Boolean).join(' ');
    let text = 'Garment photo (rough): ';
    if (!anchors.length) text += 'scaled to the length only, because this chart has no garment widths for this size.';
    else {
      text += 'fitted to ' + (measured && !guessed ? 'your scan\'s real outline' : measured ? 'your scan\'s outline where it could be read, standard proportions elsewhere' : 'standard body proportions (the scan\'s outline could not be read)') +
        ' at the ' + joinList(names) + ', and below the bust it follows your outline row by row, so it is never narrower than you. It is wider where the chart says the garment is bigger than you. Where it is smaller than you it is drawn as wide as you, because it would be stretched to fit (a stiff garment that is too small would not).';
      if (wrapped) text += scan ? ' It is curved at the sides and shaded with your scan\'s lighting.' : ' It is curved at the sides.';
      text += ' The neckline, straps, sleeves and folds are the photo as it is.';
    }
    say(text + (warnings ? ' Warning: ' + warnings : ''));
    note.classList.toggle('p-warn', !!warnings);
    // how far the garment reaches left and right at each zone line, so the figure's zone bars are exactly as wide as the garment
    const spans = {};
    ['bust', 'waist', 'hip'].forEach(z => {
      if (zoneH[z] > hem.top || zoneH[z] < hem.height) return;
      const y = Math.min(cut.h - 1, Math.max(0, Math.round((hem.top - zoneH[z]) / (hem.top - hem.height) * (cut.h - 1))));
      const half = plan.halfPx[y] / plan.pxPerIn;
      if (half > 0) spans[z] = { l: plan.shift[y] - half, r: plan.shift[y] + half };
    });
    return { src: GarmentImage.warpedURL(gar.image.src, cut, plan, key, opts), x0: plan.x0In, w: plan.widthIn, topH: hem.top, hemH: hem.height, spans: spans };
  }

  // ---- material: guess stretch / no stretch from the text ----
  const FABRIC_NAME = { 'stretch': 'Stretch', 'elastic-waist': 'Elastic waist', 'none': 'No stretch' };
  const LEVEL_NAME = { low: 'Low', medium: 'Medium', high: 'High' };

  // The weave type and the material, as one piece of text for the guess (and for the test log).
  function materialText(gar) {
    return [gar.weave, gar.material].map(t => t.trim()).filter(Boolean).join(', ');
  }

  // Shows what the guess is and why, with a button to take the guess when you have chosen something else.
  function showMaterialGuess() {
    const gar = state.garment, el = $('#matGuess');
    const guess = Material.guessFabric(materialText(gar));
    if (!materialText(gar)) { el.textContent = 'The material is used to guess whether the fabric stretches. You can always change the Fabric switch yourself.'; return; }
    if (!guess) { el.textContent = 'No clue about stretch in that text. Choose the Fabric yourself, or paste the line that names the fabric (for example "cotton jersey" or "5% elastane").'; return; }
    let html = 'Guess: <strong>' + esc(FABRIC_NAME[guess.fabric]) + '</strong> (' + esc(guess.sure) + '): ' + esc(guess.reason) + '.';
    // For Stretch the guess also names how much, when the text says so.
    const wantLevel = guess.fabric === 'stretch' ? (guess.level || 'low') : gar.stretchLevel;
    if (guess.fabric === 'stretch') {
      html += guess.level ? ' Stretch level <strong>' + esc(LEVEL_NAME[guess.level]) + '</strong>: ' + esc(guess.levelWhy) + '.'
        : ' The text does not say how much it stretches, so the level is Low. Choose Medium or High if the page says so.';
    }
    const differs = gar.fabric !== guess.fabric || (guess.fabric === 'stretch' && gar.stretchLevel !== wantLevel);
    if (differs) html += ' You have chosen <strong>' + esc(FABRIC_NAME[gar.fabric]) + (gar.fabric === 'stretch' ? ', ' + esc(LEVEL_NAME[gar.stretchLevel]) : '') + '</strong>. <button type="button" class="link" id="useGuess">Use the guess</button>';
    el.innerHTML = html;
    const use = $('#useGuess');
    if (use) use.onclick = () => { gar.fabric = guess.fabric; gar.fabricAuto = true; gar.stretchLevel = wantLevel; gar.stretchAuto = true; save(); renderGarment(); renderResult(); };
  }

  // Typing in either box (weave type or material) updates the guess.
  function onMaterialInput() {
    const gar = state.garment;
    gar.weave = $('#gweave').value;
    gar.material = $('#gmat').value;
    const guess = Material.guessFabric(materialText(gar));
    if (guess && gar.fabricAuto) gar.fabric = guess.fabric;       // follow the guess unless you chose the fabric by hand
    if (gar.stretchAuto) gar.stretchLevel = (guess && guess.level) || 'low';     // the same for how much it stretches
    save();
    renderFabricSeg();
    showMaterialGuess();
    renderResult();
  }
  $('#gweave').oninput = onMaterialInput;
  $('#gmat').oninput = onMaterialInput;

  // ======================================================================
  // 4. RESULT PANEL
  // ======================================================================

  // One card per set of numbers, side by side: predicted size, the numbers used, each zone, and the "between sizes" note.
  function sourceCard(A, source) {
    const gar = state.garment, a = A[source], idx = a.ana.idx;
    const zones = Fit.zonesFor(gar.type);
    const on = source === state.source;
    const size = idx >= 0 ? (gar.rows[idx].size || '?') : '?';
    const numbers = zones.map(z => Fit.ZONE_NAME[z] + ' ' + (a.body[z] === null ? '-' : fmt(a.body[z]))).join(' · ');

    let body;
    if (idx < 0) body = '<p class="stat">Needs the numbers for this column, and at least one size in the chart.</p>';
    else {
      const rr = a.ana.rows[idx];
      body = '<ul class="src-zones">' + zones.map(z => {
        const r = rr.zones[z];
        if (!r) return '<li><span class="dot d-none"></span>' + Fit.ZONE_NAME[z] + ': <span class="stat">not compared (no number)</span></li>';
        if (!r.covered) return '<li><span class="dot d-none"></span>' + Fit.ZONE_NAME[z] + ': <span class="stat">not covered, ignored</span></li>';
        return '<li><span class="dot d-' + r.cls + '"></span>' + Fit.ZONE_NAME[z] + ': <strong>' + esc(r.label) + '</strong> <span class="stat">' + esc(Fit.zoneDetail(r)) + '</span></li>';
      }).join('') + '</ul>';
      if (a.ana.note) body += '<div class="between"><strong>' + esc(a.ana.note.title) + '.</strong> ' + esc(a.ana.note.text) + '</div>';
      else if (gar.chartType === 'garment' && a.ana.noneFits) body += '<p class="stat">Every size runs tight somewhere, so this is the largest size.</p>';
    }
    return '<div class="src' + (on ? ' on' : '') + '">' +
      '<div class="src-head"><span class="lab">' + SOURCE_LABEL[source] + '</span>' +
      (on ? '<span class="stat">shown on the figure</span>' : '<button type="button" class="link" data-src="' + source + '">Show on figure</button>') + '</div>' +
      '<div class="src-size' + (idx < 0 ? ' empty' : '') + '">' + esc(size) + '</div>' +
      '<div class="src-nums mono">' + esc(numbers) + '</div>' + body + '</div>';
  }

  function card(head, pill, pillCls, big, sub, wide) {
    return '<div class="zc' + (wide ? ' wide' : '') + '"><div class="zc-head"><strong>' + esc(head) + '</strong>' +
      (pill ? '<span class="pill p-' + pillCls + '">' + esc(pill) + '</span>' : '') + '</div>' +
      (big ? '<div class="zc-num">' + esc(big) + '</div>' : '') + '<div class="zc-sub">' + esc(sub) + '</div></div>';
  }

  // The sentence added under a hem or sleeve result that rests on marks you have not clicked yet.
  function estimateNote(missing, p) {
    if (!missing.length) return '';
    if (!p.picture) return ' This is an estimate from height proportions. Add a scan picture and calibrate it to confirm.';
    return ' This is an estimate. Not marked yet: ' + joinList(missing) + '. Press Calibrate to confirm.';
  }

  // Said under the hem result when you set a hem adjustment for the garment.
  function adjustNote(hem) {
    if (!hem.shift) return '';
    return ' Includes your hem adjustment: ' + fmt(Math.abs(hem.shift)) + ' in ' + (hem.shift > 0 ? 'higher' : 'lower') + ' than the chart length.';
  }

  function figureCaption(p, g) {
    if (!p.picture) return 'Add a front view picture for ' + p.name + ' to see the lines on a body.';
    let t = 'The scan is shown exactly as it is, scaled so the head top sits at ' + fmt(g.H) + ' in and the floor mark sits on the floor of the tape.';
    const lines = g.missing.filter(n => n !== 'Head top' && n !== 'Floor');
    if (!g.scaled) t += ' Head top or floor is not marked yet, so the picture is stretched from its top edge to its bottom edge. Press Calibrate.';
    else if (lines.length) t += ' Height proportions are used for: ' + lines.join(', ').toLowerCase() + '. Press Calibrate to mark them.';
    else t += ' Every line comes from your marks.';
    return t;
  }

  function renderResult() {
    const p = person(), gar = state.garment;
    const A = { scan: analyse('scan'), tape: analyse('tape') };
    const cur = A[state.source];
    const ana = cur.ana, g = cur.g, body = cur.body, idx = ana.idx;

    // the two sets of numbers side by side
    $('#pair').innerHTML = sourceCard(A, 'scan') + sourceCard(A, 'tape');
    $$('#pair [data-src]').forEach(b => { b.onclick = () => { state.source = b.getAttribute('data-src'); state.sel = null; save(); renderBody(); renderResult(); }; });
    const both = A.scan.ana.idx >= 0 && A.tape.ana.idx >= 0;
    const sizeOf = a => gar.rows[a.ana.idx].size || '?';
    const cmp = $('#compare');
    cmp.hidden = !both;
    if (both) {
      const same = A.scan.ana.idx === A.tape.ana.idx;
      cmp.innerHTML = same ? 'Scan and tape numbers both give <b>' + esc(sizeOf(A.scan)) + '</b>.'
        : 'Scan numbers give <b>' + esc(sizeOf(A.scan)) + '</b> and tape numbers give <b>' + esc(sizeOf(A.tape)) + '</b>. They land in different sizes, so the measurement gap matters for this garment.';
    }

    // size chips: click one to see it on the figure
    let sel = state.sel;
    if (sel === null || sel >= gar.rows.length || !ana.rows[sel] || !ana.rows[sel].count) sel = idx;
    $('#chips').innerHTML = gar.rows.map((r, i) => {
      const v = Fit.verdict(ana.rows[i]);
      return '<button type="button" class="chip' + (i === idx ? ' ispred' : '') + '" aria-pressed="' + (i === sel) + '" data-i="' + i + '" title="' + esc(v.text) + '"><span class="dot d-' + v.cls + '"></span>' + esc(r.size || '?') + '</button>';
    }).join('');
    $$('#chips .chip').forEach(b => { b.onclick = () => { state.sel = +b.getAttribute('data-i'); renderResult(); }; });
    $$('#chart tbody tr').forEach(tr => {
      const i = +tr.getAttribute('data-i');
      tr.classList.toggle('sel', i === sel && idx >= 0);
      tr.classList.toggle('ispred', i === idx);
    });

    // the figure and the zone cards for the size being shown
    $('#figcap').textContent = figureCaption(p, g);
    const zEl = $('#zones'), logBtn = $('#logBtn');
    if (idx < 0 || sel < 0) {
      Figure.render($('#fig'), { geo: g, person: p, gar: gar, rres: null, hem: null, slv: null });
      $('#ovNote').hidden = true;
      $('#zsize').textContent = '';
      $('#zverdict').textContent = '';
      $('#zverdict').className = 'pill p-none';
      zEl.innerHTML = '<div class="empty zc wide">Zone results appear here once the body and the chart have numbers.</div>';
      logBtn.disabled = true;
      return;
    }
    const row = gar.rows[sel], rr = ana.rows[sel];
    const hem = Fit.hemInfo(row, g, gar, body), slv = Fit.sleeveInfo(row, g, gar);

    // Which of the marks these two results depend on are still not clicked? Then the result is an estimate.
    const hemMissing = hem ? Geometry.unmarked(g, ['head', 'floor'].concat(hem.fromShoulder ? ['shoulder'] : [], hem.refs)) : [];
    const slvMissing = slv ? Geometry.unmarked(g, ['head', 'floor', 'shoulder', 'wrist']) : [];
    const overlay = overlayFor(gar, row, rr, hem, g, body, p);
    Figure.render($('#fig'), { geo: g, person: p, gar: gar, rres: rr, hem: hem, slv: slv, overlay: overlay, hemEstimated: hemMissing.length > 0, slvEstimated: slvMissing.length > 0 });
    if (p.picture) $('#figcap').textContent += ' The coloured bar at each zone line is as wide as the garment is there. Its colour is the verdict; the amount is in the label.';

    $('#zsize').textContent = (row.size || '?') + (sel === idx ? ' (predicted)' : '');
    const v = Fit.verdict(rr);
    $('#zverdict').textContent = v.text;
    $('#zverdict').className = 'pill p-' + v.cls;
    let h = '';
    Fit.zonesFor(gar.type).forEach(k => {
      const z = rr.zones[k];
      if (!z) return;
      if (!z.covered) h += card(Fit.ZONE_NAME[k], 'Not covered', 'none', '', 'The garment ends above this point, so it is not counted.');
      else h += card(Fit.ZONE_NAME[k], z.label, z.cls, z.mode === 'range' ? (z.status === 'in' ? 'Inside the range' : (z.status === 'small' ? 'Runs small by ' : 'Runs big by ') + fmt(z.by) + ' in') : Fit.gapText(z.gap), Fit.formula(z));
    });
    h += card('Hem', hemMissing.length ? 'Estimated' : (hem && hem.shift ? 'Adjusted' : null), hemMissing.length ? 'warn' : 'none', hem ? hem.short : '',
      hem ? hem.text + '.' + adjustNote(hem) + estimateNote(hemMissing, p) : 'Add a length to see where the hem lands.', true);
    if (gar.type !== 'pants') h += card('Sleeve', slvMissing.length ? 'Estimated' : null, 'warn', slv ? slv.short : '', slv ? slv.text + '.' + estimateNote(slvMissing, p) : 'Add a sleeve length to see where the cuff lands.', true);
    if (g.assumedH) h += card('Height', '', '', '', 'Height is empty, so the picture is scaled to an assumed 64 in.', true);
    zEl.innerHTML = h;
    logBtn.disabled = false;
  }

  // ======================================================================
  // 5. PREDICTION TEST LOG
  // ======================================================================

  const ZOPT = [['', 'Not tried'], ['tight', 'Tight'], ['fit', 'Fitted'], ['reg', 'Regular'], ['loose', 'Loose']];
  // "Higher" means closer to your head, "lower" means closer to your feet. The words say so, to avoid mix-ups.
  const HOPT = [['', 'Not tried'], ['higher', 'Higher on me (nearer my head)'], ['same', 'As predicted'], ['lower', 'Lower on me (nearer my feet)']];
  const SOPT = [['', 'Not tried'], ['shorter', 'Shorter than predicted'], ['same', 'As predicted'], ['longer', 'Longer than predicted']];

  function options(list, current) {
    return list.map(o => '<option value="' + o[0] + '"' + (o[0] === current ? ' selected' : '') + '>' + o[1] + '</option>').join('');
  }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch (e) { return ''; }
  }

  // Step 1: log the prediction BEFORE looking at the tag or trying the garment on.
  $('#logBtn').onclick = () => {
    const p = person(), gar = state.garment, msg = $('#logMsg');
    const A = { scan: analyse('scan'), tape: analyse('tape') };
    const cur = A[state.source];
    if (cur.ana.idx < 0) return;
    const i = cur.ana.idx, row = gar.rows[i], rr = cur.ana.rows[i];
    const hem = Fit.hemInfo(row, cur.g, gar, cur.body), slv = Fit.sleeveInfo(row, cur.g, gar);
    const zones = {}, actualZones = {};
    Object.keys(rr.zones).forEach(k => {
      const z = rr.zones[k];
      if (z && z.covered) { zones[k] = { cls: z.cls, label: z.label, gap: Math.round(z.gap * 100) / 100 }; actualZones[k] = ''; }
    });
    const sizeOf = a => a.ana.idx >= 0 ? (gar.rows[a.ana.idx].size || '?') : '';
    const entry = {
      id: newId('l'), ts: new Date().toISOString(), person: p.name, personId: p.id, source: state.source,
      garment: gar.name || 'Garment', link: safeLink(gar.link), material: materialText(gar), type: gar.type, fabric: gar.fabric, stretchLevel: gar.fabric === 'stretch' && gar.chartType === 'garment' ? gar.stretchLevel : '', chartType: gar.chartType,
      size: row.size || '?', sizes: { scan: sizeOf(A.scan), tape: sizeOf(A.tape) },
      between: cur.ana.note ? cur.ana.note.text : '', zones: zones,
      hem: hem ? { text: hem.text, short: hem.short, shift: Math.round(hem.shift * 100) / 100 } : null, sleeve: slv ? { text: slv.text, short: slv.short } : null,
      actual: { size: '', zones: actualZones, hem: '', sleeve: '', note: '' }
    };
    state.log.unshift(entry);
    saveNow(); renderLog();
    msg.textContent = 'Logged size ' + entry.size + '. Fill in the result below once you have tried it on.';
  };

  function renderLog() {
    const wrap = $('#logWrap');
    if (!state.log.length) {
      wrap.innerHTML = '<div class="empty">No tests yet. Pick a person and a garment, press Log this prediction, then fill in what really happened.</div>';
      renderSummary();
      return;
    }
    let h = '<table class="log"><thead><tr><th>Test</th><th>Predicted</th><th>Actual size</th><th>Actual zones</th><th>Hem</th><th>Sleeve</th><th>Note</th><th></th></tr></thead><tbody>';
    state.log.forEach(e => {
      const zk = Object.keys(e.zones || {});
      const other = e.source === 'scan' ? 'tape' : 'scan';
      const otherSize = e.sizes && e.sizes[other] && e.sizes[other] !== e.size ? '<small>' + SOURCE_LABEL[other] + ' said ' + esc(e.sizes[other]) + '</small>' : '';
      h += '<tr data-id="' + esc(e.id) + '">' +
        '<td><strong>' + esc(e.garment) + '</strong><small>' + esc(e.person) + ', ' + (e.source === 'scan' ? 'scan' : 'tape') + ', ' + esc(fmtDate(e.ts)) + '</small>' +
          (safeLink(e.link) ? '<small><a href="' + esc(safeLink(e.link)) + '" target="_blank" rel="noopener noreferrer">Garment link</a></small>' : '') + '</td>' +
        '<td><strong class="mono">' + esc(e.size) + '</strong>' + otherSize +
          '<small>' + zk.map(k => Fit.ZONE_NAME[k] + ' ' + esc(e.zones[k].label.toLowerCase())).join(', ') + '</small>' +
          (e.between ? '<small>' + esc(e.between) + '</small>' : '') +
          (e.hem ? '<small>Hem ' + esc(e.hem.short) + (e.hem.shift ? ' (adjusted ' + esc(fmt(Math.abs(e.hem.shift))) + ' in ' + (e.hem.shift > 0 ? 'higher' : 'lower') + ')' : '') + '</small>' : '') + (e.sleeve ? '<small>Sleeve ' + esc(e.sleeve.short) + '</small>' : '') + '</td>' +
        '<td class="s"><input type="text" data-k="size" value="' + esc(e.actual.size) + '" aria-label="Actual size"></td>' +
        '<td>' + zk.map(k => '<small>' + Fit.ZONE_NAME[k] + '</small><select data-k="z:' + k + '" aria-label="Actual ' + Fit.ZONE_NAME[k] + '">' + options(ZOPT, e.actual.zones[k] || '') + '</select>').join('') + '</td>' +
        '<td><select data-k="hem" aria-label="Actual hem">' + options(HOPT, e.actual.hem) + '</select></td>' +
        '<td>' + (e.type === 'pants' ? '<small>n/a</small>' : '<select data-k="sleeve" aria-label="Actual sleeve">' + options(SOPT, e.actual.sleeve) + '</select>') + '</td>' +
        '<td><input type="text" data-k="note" value="' + esc(e.actual.note) + '" aria-label="Note"></td>' +
        '<td><button type="button" class="x" data-del="1" aria-label="Delete this test">&times;</button></td></tr>';
    });
    wrap.innerHTML = h + '</tbody></table>';
    renderSummary();
  }

  function entryById(id) { return state.log.filter(e => e.id === id)[0]; }

  // Step 2: after trying the garment on, record what really happened.
  function onLogEdit(ev) {
    const t = ev.target, key = t.getAttribute && t.getAttribute('data-k');
    if (!key) return;
    const e = entryById(t.closest('tr').getAttribute('data-id'));
    if (!e) return;
    if (key.indexOf('z:') === 0) e.actual.zones[key.slice(2)] = t.value; else e.actual[key] = t.value;
    save(); renderSummary();
  }
  $('#logWrap').addEventListener('input', onLogEdit);
  $('#logWrap').addEventListener('change', onLogEdit);
  $('#logWrap').addEventListener('click', ev => {
    const b = ev.target.closest && ev.target.closest('button[data-del]');
    if (!b) return;
    if (!b.getAttribute('data-armed')) {          // first click asks "Delete?", second click deletes
      b.setAttribute('data-armed', '1');
      b.innerHTML = 'Delete?';
      b.style.color = 'var(--tight)';
      b.style.fontSize = '12px';
      setTimeout(() => { if (b.isConnected && b.getAttribute('data-armed')) { b.removeAttribute('data-armed'); b.innerHTML = '&times;'; b.style.color = ''; b.style.fontSize = ''; } }, 3000);
      return;
    }
    const id = b.closest('tr').getAttribute('data-id');
    state.log = state.log.filter(e => e.id !== id);
    saveNow(); renderLog();
  });

  // How often was the prediction right?
  function renderSummary() {
    const el = $('#logSum');
    let tested = 0, sizeOk = 0, scanOk = 0, scanN = 0, tapeOk = 0, tapeN = 0, zoneN = 0, zoneExact = 0, zoneNear = 0, hemN = 0, hemOk = 0, slvN = 0, slvOk = 0;
    const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    state.log.forEach(e => {
      const a = e.actual || {};
      if (a.size !== '' && a.size !== undefined) {
        tested++;
        if (same(a.size, e.size)) sizeOk++;
        if (e.sizes && e.sizes.scan) { scanN++; if (same(a.size, e.sizes.scan)) scanOk++; }
        if (e.sizes && e.sizes.tape) { tapeN++; if (same(a.size, e.sizes.tape)) tapeOk++; }
      }
      Object.keys(e.zones || {}).forEach(k => {
        const actual = a.zones && a.zones[k];
        if (!actual) return;
        zoneN++;
        const d = Math.abs(Fit.ORDER.indexOf(actual) - Fit.ORDER.indexOf(e.zones[k].cls));
        if (d === 0) zoneExact++;
        if (d <= 1) zoneNear++;
      });
      if (a.hem) { hemN++; if (a.hem === 'same') hemOk++; }
      if (a.sleeve) { slvN++; if (a.sleeve === 'same') slvOk++; }
    });
    if (!tested && !zoneN && !hemN && !slvN) { el.hidden = true; return; }
    el.hidden = false;
    const pct = (a, b) => b ? ' (' + Math.round(100 * a / b) + '%)' : '';
    const stat = (label, a, b) => '<span>' + label + ' <b>' + a + ' of ' + b + '</b>' + pct(a, b) + '</span>';
    el.innerHTML = stat('Size right', sizeOk, tested) + stat('Scan numbers right', scanOk, scanN) + stat('Tape numbers right', tapeOk, tapeN) +
      stat('Zones exact', zoneExact, zoneN) + stat('Zones within one step', zoneNear, zoneN) + stat('Hem as predicted', hemOk, hemN) + stat('Sleeve as predicted', slvOk, slvN);
  }

  // The log as a table you can paste into a sheet.
  function logToTsv() {
    const head = ['Date', 'Person', 'Numbers from', 'Garment', 'Link', 'Material', 'Fabric setting', 'Stretch level', 'Type', 'Chart', 'Predicted size', 'Scan said', 'Tape said', 'Actual size',
      'Bust predicted', 'Bust actual', 'Waist predicted', 'Waist actual', 'Hip predicted', 'Hip actual', 'Hem predicted', 'Hem adjustment (in, plus = higher)', 'Hem actual', 'Sleeve predicted', 'Sleeve actual', 'Note'];
    const lab = (list, v) => { const m = list.filter(o => o[0] === v)[0]; return m ? m[1] : ''; };
    const clean = s => String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ');
    const rows = [head.join('\t')];
    state.log.slice().reverse().forEach(e => {
      const a = e.actual || {};
      const z = k => { const pz = e.zones && e.zones[k]; return [pz ? pz.label : 'n/a', pz ? (lab(ZOPT, (a.zones && a.zones[k]) || '') || 'Not tried') : 'n/a']; };
      rows.push([fmtDate(e.ts), e.person, e.source, e.garment, safeLink(e.link), e.material || '', FABRIC_NAME[e.fabric] || '', LEVEL_NAME[e.stretchLevel] || '', e.type, e.chartType, e.size, (e.sizes && e.sizes.scan) || '', (e.sizes && e.sizes.tape) || '', a.size || ''].concat(
        z('bust'), z('waist'), z('hip'),
        [e.hem ? e.hem.short : 'n/a', e.hem ? (e.hem.shift || 0) : 'n/a', e.hem ? (lab(HOPT, a.hem) || 'Not tried') : 'n/a', e.sleeve ? e.sleeve.short : 'n/a', e.sleeve ? (lab(SOPT, a.sleeve) || 'Not tried') : 'n/a', a.note || '']
      ).map(clean).join('\t'));
    });
    return rows.join('\n');
  }

  $('#copyBtn').onclick = () => {
    const text = logToTsv(), box = $('#copyBox'), s = $('#copyStat');
    box.value = text;
    const fallback = () => { box.hidden = false; box.focus(); box.select(); s.textContent = 'Select and copy the text below.'; };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => { box.hidden = true; s.textContent = 'Copied. Paste it into a sheet.'; }, fallback);
      else fallback();
    } catch (e) { fallback(); }
  };

  // ======================================================================
  // 6. EXPORT, IMPORT AND START-UP
  // ======================================================================

  $('#exportBtn').onclick = () => {
    saveNow();
    Storage.exportFile(snapshot());
    renderStatus();
  };

  $('#importFile').onchange = function () {
    const file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => alert('Could not read that file.');
    reader.onload = () => {
      const res = Storage.parseImport(reader.result);
      if (res.error) { alert(res.error); return; }
      const d = res.data;
      const ok = confirm('Import "' + file.name + '"?\n\n' +
        'The file has ' + d.people.length + ' people and ' + d.log.length + ' tests.\n' +
        'This REPLACES what is in the browser now (' + state.people.length + ' people and ' + state.log.length + ' tests).\n\n' +
        'Press Cancel and use Export data first if you want to keep what is here now.');
      if (!ok) return;
      applyData(d);
      saveNow();
      renderAll();
    };
    reader.readAsText(file);
  };

  function renderAll() {
    renderBody();
    renderGarment();
    renderResult();
    renderLog();
    renderStatus();
  }

  function start() {
    storageOk = Storage.available();
    const res = Storage.load();
    if (res.data && Array.isArray(res.data.people)) applyData(res.data);
    else {
      applyData({ people: [priiPerson()], log: [] });   // first run: Prii, an empty chart, an empty log
      if (res.unreadable) alert('The saved data in this browser could not be read, so FitRoom started fresh. A copy of the unreadable data was kept in the browser storage.');
      saveNow();
    }
    Calibrate.init();
    renderAll();

    // Several FitRoom tabs can be open at once and they share the same saved data. When another tab saves, this tab
    // loads the newer copy. Without this, an old tab would later save its OLD copy over the newer data (this really
    // happened once: an old tab wiped a calibration fix).
    window.addEventListener('storage', ev => {
      if (ev.key !== Storage.KEY) return;
      const fresh = Storage.load();
      if (!fresh.data || !Array.isArray(fresh.data.people)) return;
      clearTimeout(saveTimer);                              // anything not yet saved in this tab is older than what just arrived
      saveTimer = null;
      applyData(fresh.data);                                // load the newer copy first ...
      if ($('#calDlg').open) $('#calDlg').close();          // ... then close any open calibration window (closing saves the NEW data)
      renderAll();
      $('#sstat').textContent = 'Another FitRoom tab changed your data, so this tab loaded the newer copy.';
    });
    window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });   // do not lose the last edit when the tab closes
    window.addEventListener('beforeunload', () => { if (saveTimer) saveNow(); });
  }

  start();
})();
