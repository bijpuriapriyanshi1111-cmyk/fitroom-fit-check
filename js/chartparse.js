/*
  chartparse.js — reads a size chart that you copied from a product page and pasted as text.

  Copying a table out of a web page can come out in different shapes, so the text is read in four ways, and the
  first way that makes sense wins:

    1. cells separated by tabs, "|" or wide gaps        Size<TAB>Bust (in)<TAB>Waist (in)
    2. every row on one line, cells separated by spaces  S 34 28 10.6
    3. one cell per line                                 Size / Bust (in) / Waist (in) / S / 34 / 28 ...
    4. a line per size with "label: value" pairs         XS: Width: 57 cm, Length: 39 cm  (the H&M style)

  Then it works out, for every column, what it is (bust, waist, hip, length, sleeve, inseam), whether the brand says
  the numbers are BODY measurements ("To Fit", "body") and which unit they are in. The answer is a plain object:

    { ok, error, rows, unit, unitGuessed, chartType, kindWhy, kindGuessed, hasRanges, type, used, ignored, warnings }

  rows are chart rows in the shape fit.js uses. Nothing is changed on the page by this file: the page shows
  what was understood, and only changes the chart when you press "Use this chart".
*/
FitRoom.ChartParse = (function () {

  // ---------- what a cell looks like ----------
  const NUM = '\\d+(?:[.,]\\d+)?';
  const UNIT = '(?:in|inch|inches|cm|")?';
  const numberCell = new RegExp('^' + NUM + '\\s*' + UNIT + '$', 'i');
  const rangeCell = new RegExp('^' + NUM + '\\s*' + UNIT + '\\s*(?:-|–|—|to)\\s*' + NUM + '\\s*' + UNIT + '$', 'i');
  const isNumber = s => numberCell.test(s.trim());
  const isRange = s => rangeCell.test(s.trim());
  const isBlank = s => s.trim() === '' || /^(?:-|–|—|n\/?a)$/i.test(s.trim());     // "-" or "NA": the brand left it out
  const isValue = s => isNumber(s) || isRange(s) || isBlank(s);
  const numbersIn = s => (String(s).replace(/,/g, '.').match(/\d+(?:\.\d+)?/g) || []).map(parseFloat);

  // A size label: S, XL, 3XL, 28, 6/8, XS-S ...
  const isSizeLabel = s => /^[A-Za-z0-9][A-Za-z0-9\/\-.]{0,7}$/.test(s.trim());

  // The cells after a row's size label must be numbers, ranges or blanks. The one exception is a second column whose header
  // also says "size" ("IN Size", "UK Size"): it holds labels such as XS and is skipped later.
  const valuesFit = (row, head) => row.every((c, i) => i === 0 || isValue(c) || (/size/i.test(head[i]) && isSizeLabel(c)));

  // ---------- reading the text in the four ways; each returns a grid (header row first) or null ----------

  function gridFromDelimited(lines) {
    const split = lines.map(l => (l.indexOf('\t') >= 0 ? l.split('\t') : l.split(/\s*\|\s*| {2,}/)).map(c => c.trim()));
    for (let h = 0; h < split.length - 1; h++) {
      const head = split[h].filter((c, i, a) => c !== '' || (i > 0 && i < a.length - 1));
      if (head.length < 3 || head.every(isValue)) continue;
      const data = [];
      for (let i = h + 1; i < split.length; i++) {
        const row = split[i];
        if (row.length === head.length && row[0] !== '' && valuesFit(row, head)) data.push(row); else break;
      }
      if (data.length) return [head].concat(data);
    }
    return null;
  }

  // The words a column header can be made of. Used to cut a header line that has no clear gaps into columns.
  const HEADER_WORD = /(?:to[\s-]*fit\s+|body\s+|garment\s+|front\s+|back\s+|top\s+|sleeve\s+|inside\s+|inner\s+)?(?:bust|chest|waist|hips?|seat|length|sleeve|inseam|leg|shoulder|width|thigh|rise|outseam)(?:\s+(?:length|measurement))?(?:\s*\(\s*(?:in|cm|inch|inches)\s*\))?/gi;

  function gridFromSpaced(lines) {
    const dataRow = /^(\S+)\s+(\d+(?:[.,]\d+)?(?:\s+\d+(?:[.,]\d+)?)+)$/;
    for (let d = 1; d < lines.length; d++) {
      const m = lines[d].match(dataRow);
      if (!m) continue;
      const count = lines[d].split(/\s+/).length - 1;                       // numbers per row
      const headers = lines[d - 1].match(HEADER_WORD);
      if (!headers || headers.length !== count) continue;
      const data = [];
      for (let i = d; i < lines.length; i++) {
        const r = lines[i].match(dataRow);
        if (r && lines[i].split(/\s+/).length - 1 === count) data.push(lines[i].split(/\s+/)); else break;
      }
      return [['Size'].concat(headers.map(h => h.trim()))].concat(data);
    }
    return null;
  }

  function gridFromOnePerLine(lines) {
    let start = lines.findIndex(l => /^size$/i.test(l));
    if (start < 0) start = 0;
    // the header is every line from "Size" up to the first size label that starts a run of valid rows (the header needs a size and two more)
    for (let first = start + 3; first < lines.length; first++) {
      if (!isSizeLabel(lines[first]) || /^size$/i.test(lines[first])) continue;
      const head = lines.slice(start, first);
      const data = [];
      for (let i = first; i + head.length <= lines.length; i += head.length) {
        const row = lines.slice(i, i + head.length);
        if (isSizeLabel(row[0]) && valuesFit(row, head) && row.some((c, j) => j > 0 && !isBlank(c) && isValue(c))) data.push(row); else break;
      }
      if (data.length) return [head].concat(data);
    }
    return null;
  }

  function gridFromKeyValue(lines) {
    const pair = /([A-Za-z][A-Za-z ]*?)\s*[:=]\s*(\d+(?:[.,]\d+)?)\s*(cm|in|inch|inches|")?/g;
    const rows = [];
    const labels = [];
    lines.forEach(l => {
      const m = l.match(/^\s*([A-Za-z0-9\/\-.]{1,8})\s*[:\-]\s*(.+)$/);
      if (!m) return;
      const cells = {};
      let p;
      pair.lastIndex = 0;
      while ((p = pair.exec(m[2])) !== null) {
        const name = p[1].trim() + (p[3] ? ' (' + (p[3] === 'cm' ? 'cm' : 'in') + ')' : '');
        cells[name] = p[2];
        if (labels.indexOf(name) < 0) labels.push(name);
      }
      if (Object.keys(cells).length) rows.push({ size: m[1], cells: cells });
    });
    if (rows.length < 2 || !labels.length) return null;
    return [['Size'].concat(labels)].concat(rows.map(r => [r.size].concat(labels.map(n => r.cells[n] || ''))));
  }

  // ---------- understanding the columns ----------

  function describeColumn(header) {
    const h = header.toLowerCase();
    const unit = /\(\s*cm\s*\)|\bcm\b|centi/.test(h) ? 'cm' : (/\(\s*in\s*\)|\binch|"/.test(h) ? 'in' : null);
    const body = /to[\s-]*fit|\bbody\b/.test(h);
    let field = null, why = null;
    if (/inseam|inside leg|inner leg/.test(h)) field = 'inseam';
    else if (/sleeve/.test(h)) field = 'sleeve';
    else if (/bust|chest/.test(h)) field = 'bust';
    else if (/waist/.test(h)) field = 'waist';
    else if (/hip|seat/.test(h)) field = 'hip';
    else if (/length/.test(h)) field = 'length';
    else if (/\bhem\b/.test(h) && !/width/.test(h)) field = 'hem';                // the distance round the bottom edge; "hem width" is flat or all round, so it is not used
    else if (/size/.test(h)) why = 'a second size label column, the first one is used';
    else if (/width/.test(h)) why = '"Width" does not say whether it is flat or all the way around, so it is not used';
    else why = 'the calculator does not use this measurement';
    return { header: header, field: field, body: body, unit: unit, why: why };
  }

  const ZONES = ['bust', 'waist', 'hip'];
  const FIELD_NAME = { bust: 'Bust', waist: 'Waist', hip: 'Hip', length: 'Length', hem: 'Hem', sleeve: 'Sleeve', inseam: 'Inseam' };

  function interpret(grid, fullText) {
    const head = grid[0], data = grid.slice(1);
    let sizeCol = head.findIndex(h => /size/i.test(h));
    if (sizeCol < 0) sizeCol = 0;

    const cols = head.map((h, i) => Object.assign({ index: i }, describeColumn(h))).filter(c => c.index !== sizeCol);
    const used = {}, ignored = [], warnings = [];

    // for each field keep one column. A body ("To Fit") column beats a plain one, because it says who the size is for.
    cols.forEach(c => {
      if (!c.field) { ignored.push({ header: c.header, why: c.why }); return; }
      const have = used[c.field];
      if (!have) { used[c.field] = c; return; }
      const better = ZONES.indexOf(c.field) >= 0 && c.body && !have.body;
      const loser = better ? have : c;
      if (better) used[c.field] = c;
      ignored.push({ header: loser.header, why: better || have.body ? 'the chart\'s "To Fit" body numbers are used instead of the garment\'s own ' + FIELD_NAME[c.field].toLowerCase() : 'another ' + FIELD_NAME[c.field].toLowerCase() + ' column is used' });
    });
    if (used.length && !used.inseam) {                                       // pants: a full length is not an inseam
      const pantsLike = !used.bust && (used.waist || used.hip);
      if (pantsLike) { ignored.push({ header: used.length.header, why: 'for pants the calculator needs the inseam (inside leg), not the full length' }); delete used.length; }
    }

    if (used.hem && (used.inseam || (!used.bust && (used.waist || used.hip)))) {         // pants have no hem column here
      ignored.push({ header: used.hem.header, why: 'the pants chart has no hem column in the calculator' });
      delete used.hem;
    }

    const usedFields = Object.keys(used);
    if (!usedFields.length) return fail('I found a table, but none of its columns is a bust, waist, hip, length, hem, sleeve or inseam.');
    if (!usedFields.some(f => ZONES.indexOf(f) >= 0)) warnings.push('There is no bust, waist or hip column, so I can fill the sizes and lengths but not the body zones. Type those yourself.');

    // sizes and values
    let rows = data.filter(r => r[sizeCol] && !isBlank(r[sizeCol])).map(r => {
      const row = { size: r[sizeCol].trim() };
      usedFields.forEach(f => { row['_' + f] = r[used[f].index] == null ? '' : r[used[f].index].trim(); });
      return row;
    });
    if (!rows.length) return fail('I could not find any size rows under the header.');

    // range or single number?
    const hasRanges = rows.some(r => ZONES.some(z => used[z] && isRange(r['_' + z] || '')));

    // the unit
    const units = usedFields.map(f => used[f].unit).filter(Boolean);
    let unit = units.length ? (units.filter(u => u === 'cm').length > units.length / 2 ? 'cm' : 'in') : null;
    let unitGuessed = false;
    if (!unit) {
      const zoneValues = [].concat.apply([], rows.map(r => ZONES.filter(z => used[z]).map(z => numbersIn(r['_' + z])[0]).filter(v => v !== undefined)));
      zoneValues.sort((a, b) => a - b);
      unit = zoneValues.length && zoneValues[Math.floor(zoneValues.length / 2)] > 55 ? 'cm' : 'in';
      unitGuessed = true;
      warnings.push('The table does not name its unit, so I guessed ' + (unit === 'cm' ? 'centimetres' : 'inches') + ' from the size of the numbers. Check it.');
    } else if (new Set(units).size > 1) {
      warnings.push('The columns use different units. I used ' + (unit === 'cm' ? 'centimetres' : 'inches') + ' for all of them. Check the numbers.');
    }

    // body numbers or garment numbers?
    const bodyLabelled = ZONES.some(z => used[z] && used[z].body);
    const textBody = /to[\s-]*fit denotes|body measurement|body size|fits body|to fit/.test(fullText);
    const textGarment = /garment measurement|garment size/.test(fullText);
    let chartType, kindWhy, kindGuessed = false;
    if (hasRanges) { chartType = 'range'; kindWhy = 'the zone columns give ranges, so they are body ranges'; }
    else if (bodyLabelled) { chartType = 'tofit'; kindWhy = 'the headers say "To Fit", which means body measurements'; }
    else if (textBody && !textGarment) { chartType = 'tofit'; kindWhy = 'the text says the numbers are body measurements'; }
    else if (textGarment) { chartType = 'garment'; kindWhy = 'the text says these are garment measurements'; }
    else {
      chartType = 'garment'; kindGuessed = true;
      kindWhy = 'the chart does not say whether these are garment or body measurements. I assumed the garment\'s own';
      if (ZONES.some(z => used[z])) warnings.push('Check whether these are measurements of the garment or of the body it fits. If the page says "body" or "to fit", choose "Body, one number" below.');
    }

    // build the chart rows
    const cell = (r, f) => r['_' + f] || '';
    const out = rows.map(r => {
      const row = { size: r.size, bust: '', bustMax: '', waist: '', waistMax: '', hip: '', hipMax: '', length: '', hem: '', sleeve: '', inseam: '' };
      usedFields.forEach(f => {
        const v = cell(r, f);
        if (isBlank(v)) return;
        const n = numbersIn(v);
        if (ZONES.indexOf(f) >= 0 && chartType === 'range') { row[f] = String(n[0]); row[f + 'Max'] = String(n.length > 1 ? n[1] : n[0]); }
        else row[f] = String(n[0]);
      });
      return row;
    });

    // sizes listed from largest to smallest? the calculator wants smallest first
    const lead = usedFields.find(f => ZONES.indexOf(f) >= 0) || usedFields[0];
    const seq = out.map(r => parseFloat(r[lead])).filter(v => !isNaN(v));
    if (seq.length >= 3 && seq.every((v, i) => i === 0 || v < seq[i - 1])) { out.reverse(); warnings.push('The sizes were listed from largest to smallest, so I reversed them. The calculator wants smallest first.'); }

    const type = used.inseam ? 'pants' : null;
    if (!used.bust && (used.waist || used.hip) && !used.inseam) warnings.push('This chart looks like pants or a skirt. Set Type to Pants if it is pants.');

    return {
      ok: true, error: null, rows: out, unit: unit, unitGuessed: unitGuessed, chartType: chartType, kindWhy: kindWhy, kindGuessed: kindGuessed,
      hasRanges: hasRanges, type: type, ignored: ignored, warnings: warnings,
      used: usedFields.map(f => ({ field: f, name: FIELD_NAME[f], header: used[f].header }))
    };
  }

  function fail(message) {
    return { ok: false, error: message, rows: [], used: [], ignored: [], warnings: [] };
  }

  // ---------- entry point ----------

  function parse(text) {
    const raw = String(text == null ? '' : text).replace(/\r/g, '').replace(/ /g, ' ');
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return fail('Paste the whole table: the header row and the size rows.');
    const grid = gridFromDelimited(lines) || gridFromSpaced(lines) || gridFromOnePerLine(lines) || gridFromKeyValue(lines);
    if (!grid) return fail('I could not find a table in that text. Copy just the table, with its header row and the size rows, and paste it again.');
    return interpret(grid, raw.toLowerCase());
  }

  return { parse };
})();

if (typeof module !== 'undefined') module.exports = FitRoom.ChartParse;
