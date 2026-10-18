/*
  Checks for the fit rules. Run with:   node tests/fit.test.js
  Prints one line per check and stops with an error if any check fails.
*/
const assert = require('assert');

global.window = global;                     // the browser files expect "window"
require('../js/util.js');
require('../js/geometry.js');
require('../js/fit.js');
require('../js/material.js');
require('../js/chartparse.js');
require('../js/garmentimage.js');
require('./example-charts.js');

const { Fit, Geometry, Examples, Util } = FitRoom;
const clone = Util.clone;

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

// Run a garment chart against a body. Returns the analysis and the chart.
function run(chartKey, bodyNumbers, tweak) {
  const gar = clone(Examples.list[chartKey]);
  if (tweak) tweak(gar);
  const body = Object.assign({ h: 64, bust: null, waist: null, hip: null, inseam: 29 }, bodyNumbers);
  const g = Geometry.build({}, body);        // no picture, no marks: uses height proportions
  const ana = Fit.analyseAll(body, g, gar, clone(Fit.DEFAULT_RULES));
  return { ana, gar, g, body, size: ana.idx >= 0 ? gar.rows[ana.idx].size : null };
}

console.log('Range charts');

check('body inside every range of M -> M, no note', () => {
  const r = run('hm', { bust: 36, waist: 30, hip: 38 });
  assert.strictEqual(r.size, 'M');
  assert.strictEqual(r.ana.note, null);
});

check('the exact numbers from the brief are inside M (edges count as inside)', () => {
  const lo = run('hm', { bust: 35.5, waist: 29, hip: 37.25 });
  const hi = run('hm', { bust: 38.5, waist: 32.5, hip: 39.5 });
  assert.strictEqual(lo.size, 'M');
  assert.strictEqual(hi.size, 'M');
  assert.strictEqual(lo.ana.note, null);
  assert.strictEqual(hi.ana.note, null);
});

check('above the maximum = runs small, by how many inches', () => {
  const r = run('hm', { bust: 36, waist: 30, hip: 41 });
  const m = r.ana.rows[2].zones.hip;                       // M's hip range is 37.25 to 39.5
  assert.strictEqual(m.status, 'small');
  assert.strictEqual(m.label, 'Runs small');
  assert.strictEqual(Util.fmt(m.by), '1.5');
});

check('below the minimum = runs big, by how many inches', () => {
  const r = run('hm', { bust: 33, waist: 30, hip: 38 });
  const m = r.ana.rows[2].zones.bust;                      // M's bust range starts at 35.5
  assert.strictEqual(m.status, 'big');
  assert.strictEqual(m.label, 'Runs big');
  assert.strictEqual(Util.fmt(m.by), '2.5');
});

check('zones disagree (hip needs L, bust and waist fit M) -> larger size L with a "Between sizes" note naming hip', () => {
  const r = run('hm', { bust: 36, waist: 31, hip: 41 });
  assert.strictEqual(r.size, 'L');
  assert.strictEqual(r.ana.note.title, 'Between sizes');
  assert.ok(/Hip fits L/.test(r.ana.note.text), r.ana.note.text);
  assert.ok(/Hip runs small in M \(by 1\.5 in\)/.test(r.ana.note.text), r.ana.note.text);
  assert.strictEqual(r.ana.note.zones[0], 'hip');          // the zone that caused it is listed first
});

check('a body 0.15 in into the gap between S and M is simply M (a miss that small is measuring error)', () => {
  const r = run('hm', { bust: 35.35, waist: 30, hip: 38 });   // S ends at 35.25, M starts at 35.5
  assert.strictEqual(r.size, 'M');
  assert.strictEqual(r.ana.note, null);
});

check('a body 1 inch inside a 2-inch gap between two sizes is a real "Between sizes", and goes to the larger', () => {
  const gar = { type: 'top', unit: 'in', fabric: 'none', chartType: 'range', rows: [
    Object.assign(Fit.blankRow('S'), { bust: '32', bustMax: '34' }), Object.assign(Fit.blankRow('M'), { bust: '36', bustMax: '38' })] };
  const body = { h: 64, bust: 35, waist: null, hip: null, inseam: 29 };       // 1 in from each size
  const ana = Fit.analyseAll(body, Geometry.build({}, body), gar, clone(Fit.DEFAULT_RULES));
  assert.strictEqual(gar.rows[ana.idx].size, 'M');
  assert.strictEqual(ana.note.title, 'Between sizes');
  assert.strictEqual(ana.note.text, 'Bust falls between S and M. Going with M, the larger size.');
});

check('a tie between two sizes goes to the larger size', () => {
  const r = run('crop', { bust: 34, waist: 30 });             // bust fits S, waist fits M
  assert.strictEqual(r.size, 'M');
  assert.ok(r.ana.note && /bust fits S/i.test(r.ana.note.text), JSON.stringify(r.ana.note));
});

check('the size with the most zones wins when nothing runs small', () => {
  const r = run('hm', { bust: 36, waist: 28, hip: 38 });      // bust and hip fit M, waist fits S
  assert.strictEqual(r.size, 'M');
  assert.ok(/waist fits S/i.test(r.ana.note.text), r.ana.note.text);
});

// bust 32..40, waist 26..34 as a "to fit" chart: each size covers the bodies halfway to its neighbours
const toFitBust = (bust, waist, fabric) => {
  const gar = { type: 'top', unit: 'in', fabric: fabric || 'none', chartType: 'tofit', rows: [['XS', 32, 26], ['S', 34, 28], ['M', 36, 30], ['L', 38, 32], ['XL', 40, 34]].map(([s, b, w]) => Object.assign(Fit.blankRow(s), { bust: String(b), waist: String(w) })) };
  const body = { h: 64, bust: bust, waist: waist, hip: null, inseam: 29 };
  const ana = Fit.analyseAll(body, Geometry.build({}, body), gar, clone(Fit.DEFAULT_RULES));
  return { ana, size: gar.rows[ana.idx].size };
};

check('misses of about a third of an inch each way: a "Close call"; fabric that does not stretch goes to the larger size', () => {
  const r = toFitBust(37.32, 30.67);                     // bust misses M by 0.32 in, waist misses L by 0.33 in
  assert.strictEqual(r.size, 'L');
  assert.strictEqual(r.ana.note.title, 'Close call');
  assert.ok(/^Between M and L: /.test(r.ana.note.text), r.ana.note.text);
  assert.ok(/M misses by 0\.32 in at the bust/.test(r.ana.note.text), r.ana.note.text);
  assert.ok(/L misses by 0\.33 in at the waist/.test(r.ana.note.text), r.ana.note.text);
  assert.ok(/either should fit/.test(r.ana.note.text), r.ana.note.text);
  assert.ok(/Going with L: the fabric does not stretch, so the larger size is the safer one\./.test(r.ana.note.text), r.ana.note.text);
});

check('the same body in a STRETCHY fabric goes to the smaller size', () => {
  const r = toFitBust(37.32, 30.67, 'stretch');
  assert.strictEqual(r.size, 'M');
  assert.strictEqual(r.ana.note.title, 'Close call');
  assert.ok(/Going with M: the fabric stretches, so the smaller size is comfortable\./.test(r.ana.note.text), r.ana.note.text);
});

check('closest fit wins when one size is clearly closer: M misses 0.32 in, L misses 0.05 in -> L, no note', () => {
  const r = toFitBust(37.32, 30.95);
  assert.strictEqual(r.size, 'L');
  assert.strictEqual(r.ana.note, null);
});

check('closest fit wins the other way too: M fits fully, L misses by 0.5 in -> M, with no tie to break even in a non-stretch fabric', () => {
  const r = toFitBust(36.9, 30.5);
  assert.strictEqual(r.size, 'M');
  assert.strictEqual(r.ana.note, null);
});

check('a size that fits fully beats one that misses by 0.1 in: that is not a tie, whatever the fabric', () => {
  // chart: S covers bust 33-35 / waist 27-29, M covers bust 35-37 / waist 29-31
  assert.strictEqual(toFitBust(34.9, 29).size, 'S');                     // fully inside S; M misses the bust by 0.1
  assert.strictEqual(toFitBust(34.9, 29, 'stretch').size, 'S');
  assert.strictEqual(toFitBust(35.1, 29).size, 'M');                     // fully inside M; S misses the bust by 0.1
  assert.strictEqual(toFitBust(35.1, 29, 'stretch').size, 'M');          // stretch does not drag it down to the size that misses
});

check('sizes that fit about equally well (within 0.1 in of each other) are a tie, and the fabric decides', () => {
  assert.strictEqual(toFitBust(33, 27).size, 'S');                       // bust 33 and waist 27 sit exactly on the XS/S lines: non-stretch -> larger
  assert.strictEqual(toFitBust(33, 27, 'stretch').size, 'XS');           // stretchy -> smaller
});

check('misses of 0.8 in or more are a real "Between sizes", with how far each is', () => {
  const r = toFitBust(37.8, 30.2);                       // bust misses M by 0.8 in, waist misses L by 0.8 in
  assert.strictEqual(r.ana.note.title, 'Between sizes');
  assert.ok(/\(in L it runs big by 0\.8 in\)/.test(r.ana.note.text), r.ana.note.text);
});

check('the close-call limit is half an inch: 0.5 in is still close, 0.6 in is not', () => {
  assert.strictEqual(toFitBust(37.5, 30.5).ana.note.title, 'Close call');          // both miss by 0.5
  assert.strictEqual(toFitBust(37.6, 30.4).ana.note.title, 'Between sizes');       // both miss by 0.6
});

check('a zone that runs small by only 0.3 in does not push the whole size up: M is the closest fit (L would be 2 in too big elsewhere)', () => {
  const r = run('hm', { bust: 36.5, waist: 32.8, hip: 38 });      // M's waist ends at 32.5
  assert.strictEqual(r.size, 'M');
  assert.strictEqual(r.ana.note, null);
});

check('but a zone that runs small by more than half an inch still moves the size up', () => {
  const r = run('hm', { bust: 36.5, waist: 33.2, hip: 38 });     // 0.7 in over M's waist
  assert.strictEqual(r.size, 'L');
  assert.ok(/Waist runs small in M \(by 0\.7 in\)/.test(r.ana.note.text), r.ana.note.text);
});

check('a body only a hair outside the smallest or largest size is simply that size, with no "outside the chart" alarm', () => {
  const hm = (b, w, h) => run('hm', { bust: b, waist: w, hip: h });
  const a = hm(29.3, 23.3, 31.8);                        // 0.2 in under XS on bust, waist and hip
  assert.strictEqual(a.size, 'XS'); assert.strictEqual(a.ana.note, null);
  const b = hm(45, 39.7, 45.2);                          // 0.5 in, 0.2 in, 0.2 in over XL
  assert.strictEqual(b.size, 'XL'); assert.strictEqual(b.ana.note, null);
});

check('a zone the garment does not reach (hip on a crop top) is ignored', () => {
  const r = run('crop', { bust: 36, waist: 30, hip: 60 });    // a wild hip number must not matter
  assert.strictEqual(r.size, 'M');
  assert.strictEqual(r.ana.note, null);
  assert.strictEqual(r.ana.rows[2].zones.hip.covered, false);
  assert.strictEqual(r.ana.rows[2].count, 2);                 // only bust and waist are counted
});

check('a zone the chart leaves blank is ignored', () => {
  const r = run('hm', { bust: 36, waist: 30, hip: 60 }, gar => { gar.rows.forEach(x => { x.hip = ''; x.hipMax = ''; }); });
  assert.strictEqual(r.size, 'M');
  assert.strictEqual(r.ana.note, null);
});

check('every size counts the same zones, even when lengths differ by half an inch (bug found while testing)', () => {
  // In the example chart the top is 24 in long in XS and S, but 24.5 in in M. The hip line is about 24.3 in down.
  const r = run('hm', { bust: 36, waist: 30, hip: 38 });
  const covered = r.ana.rows.map(x => x.zones.hip.covered);
  assert.deepStrictEqual(covered, [true, true, true, true, true]);
});

check('body smaller than the whole chart -> smallest size, "Outside the chart", said once', () => {
  const r = run('hm', { bust: 27, waist: 21, hip: 30 });
  assert.strictEqual(r.size, 'XS');
  assert.strictEqual(r.ana.note.title, 'Outside the chart');
  assert.strictEqual(r.ana.note.text, 'Bust, waist and hip are under the smallest size (XS). XS is the closest size.');
});

check('body bigger than the whole chart -> largest size, "Outside the chart", said once', () => {
  const r = run('hm', { bust: 50, waist: 45, hip: 50 });
  assert.strictEqual(r.size, 'XL');
  assert.strictEqual(r.ana.note.title, 'Outside the chart');
  assert.strictEqual(r.ana.note.text, 'Bust, waist and hip are over the largest size (XL). XL is the closest size.');
});

check('centimetre charts give the same answers as inch charts', () => {
  const cm = gar => {
    gar.unit = 'cm';
    gar.rows.forEach(x => ['bust', 'bustMax', 'waist', 'waistMax', 'hip', 'hipMax', 'length', 'sleeve'].forEach(k => {
      if (x[k] !== '') x[k] = String(Util.fromInches(parseFloat(x[k]), 'cm'));
    }));
  };
  [[36, 30, 38], [36, 31, 41], [35.35, 30, 38], [33, 27, 36], [50, 45, 50]].forEach(b => {
    const inch = run('hm', { bust: b[0], waist: b[1], hip: b[2] });
    const cent = run('hm', { bust: b[0], waist: b[1], hip: b[2] }, cm);
    assert.strictEqual(cent.size, inch.size, 'body ' + b.join('/'));
  });
});

check('only a minimum typed: it is used as the maximum too; swapped min and max still work', () => {
  const gar = { unit: 'in' };
  assert.deepStrictEqual(Fit.rangeCell({ bust: '36', bustMax: '' }, 'bust', gar), { lo: 36, hi: 36 });
  assert.deepStrictEqual(Fit.rangeCell({ bust: '38.5', bustMax: '35.5' }, 'bust', gar), { lo: 35.5, hi: 38.5 });
  assert.strictEqual(Fit.rangeCell({ bust: '', bustMax: '' }, 'bust', gar), null);
});

check('no body numbers -> no prediction', () => {
  const r = run('hm', {});
  assert.strictEqual(r.ana.idx, -1);
});

console.log('Garment charts (the old rules, unchanged)');

check('gap = garment - body, +2 for stretch; Tight < 0, Fitted 0-1.5, Regular 1.5-4, Loose 4+', () => {
  const rules = clone(Fit.DEFAULT_RULES);
  assert.strictEqual(Fit.classifyGap(-0.01, rules).cls, 'tight');
  assert.strictEqual(Fit.classifyGap(0, rules).cls, 'fit');
  assert.strictEqual(Fit.classifyGap(1.49, rules).cls, 'fit');
  assert.strictEqual(Fit.classifyGap(1.5, rules).cls, 'reg');
  assert.strictEqual(Fit.classifyGap(3.99, rules).cls, 'reg');
  assert.strictEqual(Fit.classifyGap(4, rules).cls, 'loose');
});

check('SZN stretch top, bust 36: S is the smallest size with no tight zone', () => {
  const r = run('szn', { bust: 36 });
  assert.strictEqual(r.ana.rows[0].zones.bust.gap, -2);       // XS: 32 + 2 stretch - 36
  assert.strictEqual(r.ana.rows[0].zones.bust.cls, 'tight');
  assert.strictEqual(r.ana.rows[1].zones.bust.gap, 0);        // S: 34 + 2 - 36
  assert.strictEqual(r.size, 'S');
});

check('no stretch fabric = no allowance', () => {
  const r = run('szn', { bust: 36 }, gar => { gar.fabric = 'none'; });
  assert.strictEqual(r.ana.rows[1].zones.bust.gap, -2);       // S: 34 - 36
  assert.strictEqual(r.size, 'M');
});

check('every size tight somewhere -> the largest size, flagged', () => {
  const r = run('szn', { bust: 60 });
  assert.strictEqual(r.size, 'XXL');
  assert.strictEqual(r.ana.noneFits, true);
});

check('a garment chart typed in centimetres is converted', () => {
  const r = run('szn', { bust: 36 }, gar => {
    gar.unit = 'cm';
    gar.rows.forEach(x => { x.bust = String(Util.fromInches(parseFloat(x.bust), 'cm')); x.length = String(Util.fromInches(parseFloat(x.length), 'cm')); });
  });
  assert.strictEqual(r.size, 'S');
  assert.strictEqual(Util.fmt(r.ana.rows[1].zones.bust.gap), '0');
});

console.log('Hem and sleeve');

check('pants hem: garment inseam longer than the body pools at the shoe', () => {
  const r = run('jeans', { waist: 28, hip: 38, inseam: 29 });
  const hem = Fit.hemInfo(r.gar.rows[1], r.g, r.gar, r.body);   // 29.5 vs 29
  assert.ok(/pools at the shoe/.test(hem.text), hem.text);
});

check('top hem lands relative to the body', () => {
  const r = run('long', { bust: 35, waist: 28, hip: 38 });
  const hem = Fit.hemInfo(r.gar.rows[1], r.g, r.gar, r.body);
  assert.ok(hem && hem.text.indexOf('Hem lands') === 0, hem && hem.text);
  assert.ok(hem.height > 0);
});

check('sleeve longer than the arm ends past the wrist', () => {
  const r = run('long', { bust: 35, waist: 28, hip: 38 });
  const longSleeve = Object.assign({}, r.gar.rows[1], { sleeve: '30' });
  assert.ok(/past your wrist bone/.test(Fit.sleeveInfo(longSleeve, r.g, r.gar).text));
});

console.log('Geometry (calibration marks)');

check('head top mark = your height, floor mark = 0 on the tape', () => {
  const person = {
    picture: { src: 'x', w: 1072, h: 1290 },
    marks: { head: { x: 556, y: 25 }, floor: { x: 554, y: 1224 } }
  };
  const g = Geometry.build(person, { h: 64, bust: 36, waist: 29, hip: 38, inseam: 29 });
  // top of the picture is above the head, bottom is below the floor
  assert.ok(Math.abs(g.picture.top - (1224 / ((1224 - 25) / 64))) < 1e-9);
  assert.ok(g.picture.top - g.picture.h < 0, 'the picture margin under the feet sits below the floor line');
  // the head top is at 64 in
  const pxPerIn = (1224 - 25) / 64;
  assert.ok(Math.abs((1224 - 25) / pxPerIn - 64) < 1e-9);
  assert.strictEqual(g.scaled, true);
});

check('marks replace the height proportions for waist and hip', () => {
  const body = { h: 64, bust: 36, waist: 29, hip: 38, inseam: 29 };
  const guess = Geometry.build({ picture: { w: 1072, h: 1290 }, marks: {} }, body);
  const marked = Geometry.build({
    picture: { w: 1072, h: 1290 },
    marks: { head: { x: 556, y: 25 }, floor: { x: 554, y: 1224 }, shoulder: { x: 420, y: 275 }, waist: { x: 556, y: 560 }, hip: { x: 556, y: 700 } }
  }, body);
  const pxPerIn = (1224 - 25) / 64;
  assert.ok(Math.abs(marked.waistD - ((1224 - 275) / pxPerIn + Geometry.SHOULDER_SLOPE - (1224 - 560) / pxPerIn)) < 1e-9);
  assert.notStrictEqual(Util.fmt(marked.waistD), Util.fmt(guess.waistD));
  assert.ok(marked.hipD > marked.waistD);
});

check('arm length comes from shoulder and wrist marks', () => {
  const body = { h: 64, bust: 36, waist: 29, hip: 38, inseam: 29 };
  const g = Geometry.build({
    picture: { w: 1072, h: 1290 },
    marks: { head: { x: 556, y: 25 }, floor: { x: 554, y: 1224 }, shoulder: { x: 420, y: 275 }, wrist: { x: 245, y: 640 } }
  }, body);
  const pxPerIn = (1224 - 25) / 64;
  const expected = Math.hypot(420 - 245, 640 - 275) / pxPerIn;
  assert.ok(Math.abs(g.arm - expected) < 1e-9);
});

check('missing marks fall back to proportions (and are listed as missing)', () => {
  const g = Geometry.build({ picture: { w: 1072, h: 1290 }, marks: { head: { x: 556, y: 25 } } }, { h: 64 });
  assert.ok(g.missing.indexOf('Waist') >= 0 && g.missing.indexOf('Head top') < 0);
  assert.ok(g.waistD > 0 && g.hipD > g.waistD && g.arm > 0);
});

console.log('Elastic waist (the grey pleated pants question)');

// The pants from the screenshot: waist 26/28/30/32, hip 43/45/47/49, inseam 29. Body: waist 30.67, hip 37.
const pantsFor = fabric => {
  const gar = { type: 'pants', unit: 'in', fabric: fabric, chartType: 'garment', rows: [
    Object.assign(Fit.blankRow('XS'), { waist: '26', hip: '43', inseam: '29' }), Object.assign(Fit.blankRow('S'), { waist: '28', hip: '45', inseam: '29' }),
    Object.assign(Fit.blankRow('M'), { waist: '30', hip: '47', inseam: '29' }), Object.assign(Fit.blankRow('L'), { waist: '32', hip: '49', inseam: '29' })] };
  const body = { h: 64, bust: null, waist: 30.67, hip: 37, inseam: 29 };
  const g = Geometry.build({}, body);
  const ana = Fit.analyseAll(body, g, gar, clone(Fit.DEFAULT_RULES));
  return { ana, size: gar.rows[ana.idx].size };
};

check('no stretch: M is 0.67 in short at the waist, so the tool says L (what the screenshot showed)', () => {
  const r = pantsFor('none');
  assert.strictEqual(r.size, 'L');
  assert.strictEqual(Util.fmt(r.ana.rows[2].zones.waist.gap), '-0.67');
});

check('elastic waist: only the waist gets the allowance, so M fits, as it does in real life', () => {
  const r = pantsFor('elastic-waist');
  assert.strictEqual(r.size, 'M');
  const m = r.ana.rows[2].zones;
  assert.strictEqual(Util.fmt(m.waist.gap), '1.33');      // 30 + 2 - 30.67
  assert.strictEqual(Util.fmt(m.hip.gap), '10');          // the hips get nothing extra: 47 - 37
});

check('stretch gives the waist and the hips the allowance', () => {
  const r = pantsFor('stretch');
  assert.strictEqual(r.size, 'M');
  assert.strictEqual(Util.fmt(r.ana.rows[2].zones.hip.gap), '12');
});

check('the card explains where the allowance came from', () => {
  const m = pantsFor('elastic-waist').ana.rows[2].zones;
  assert.strictEqual(Fit.formula(m.waist), 'garment 30 plus 2 for the elastic waist, minus body 30.67');
  assert.strictEqual(Fit.formula(m.hip), 'garment 47, minus body 37');
});

console.log('Paste a size chart');

const parseChart = text => FitRoom.ChartParse.parse(text);
const cellsOf = (r, field) => r.rows.map(x => x[field]).join('/');

// the Myntra StyleCast x Revolte chart, copied in the four shapes a browser can produce
const MYNTRA_TABS = 'Size\tBust (in)\tTo Fit Bust (in)\tFront Length (in)\tTo Fit Waist (in)\nS\t26.8\t34.0\t10.6\t28.0\nM\t28.3\t36.0\t11.0\t30.0\nL\t30.7\t38.0\t11.4\t32.0\n* To-Fit Denotes Body Measurements in Inches';
const MYNTRA_LINES = 'in\ncm\nSize\nBust (in)\nTo Fit Bust (in)\nFront Length (in)\nTo Fit Waist (in)\nS\n26.8\n34.0\n10.6\n28.0\nM\n28.3\n36.0\n11.0\n30.0\nL\n30.7\n38.0\n11.4\n32.0\nSeller: Supercom Net\n* To-Fit Denotes Body Measurements in Inches';
const MYNTRA_SPACES = 'Size Bust (in) To Fit Bust (in) Front Length (in) To Fit Waist (in)\nS 26.8 34.0 10.6 28.0\nM 28.3 36.0 11.0 30.0\nL 30.7 38.0 11.4 32.0';
const MYNTRA_GAPS = 'Size    Bust (in)    To Fit Bust (in)    Front Length (in)    To Fit Waist (in)\nS    26.8    34.0    10.6    28.0\nM    28.3    36.0    11.0    30.0\nL    30.7    38.0    11.4    32.0';

[['tab-separated', MYNTRA_TABS], ['one cell per line (with noise around it)', MYNTRA_LINES], ['single spaces', MYNTRA_SPACES], ['wide gaps', MYNTRA_GAPS]].forEach(([shape, text]) => {
  check('the Myntra tube-top chart, copied ' + shape + ': "To Fit" numbers are used, the garment bust is left out', () => {
    const r = parseChart(text);
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.chartType, 'tofit');
    assert.strictEqual(r.unit, 'in');
    assert.strictEqual(r.rows.map(x => x.size).join(','), 'S,M,L');
    assert.strictEqual(cellsOf(r, 'bust'), '34/36/38');
    assert.strictEqual(cellsOf(r, 'waist'), '28/30/32');
    assert.strictEqual(cellsOf(r, 'length'), '10.6/11/11.4');
    assert.ok(r.ignored.some(i => i.header === 'Bust (in)'), JSON.stringify(r.ignored));
    assert.ok(r.used.every(u => u.header !== 'Bust (in)'));
  });
});

// the Savana summer tank top chart: it has TWO size columns ("Size" and "IN Size") and a hem-width column the calculator does not use
const SAVANA_TABS = 'Size\tIN Size\tBust(inch)\tWaist(inch)\tTop Length(inch)\tHem(inch)\nXS\tXS\t28\t24.4\t18.5\t26.8\nS\tS\t29.5\t26\t18.9\t28.3\nM\tM\t31.1\t27.6\t19.3\t29.9\nL\tL\t33.5\t29.1\t19.7\t32.3\nXL\tXL\t35.8\t30.7\t20.1\t34.6\n*This data was obtained from manually measuring the product, it may be off by 1-2 CM.';
const SAVANA_PIPES = 'Garment measurements (Product Size, obtained from measuring the product)\nSize | IN Size | Bust(inch) | Waist(inch) | Top Length(inch) | Hem(inch)\nXS | XS | 28 | 24.4 | 18.5 | 26.8\nS | S | 29.5 | 26 | 18.9 | 28.3\nM | M | 31.1 | 27.6 | 19.3 | 29.9\nL | L | 33.5 | 29.1 | 19.7 | 32.3\nXL | XL | 35.8 | 30.7 | 20.1 | 34.6';
const SAVANA_LINES = 'Size\nIN Size\nBust(inch)\nWaist(inch)\nTop Length(inch)\nHem(inch)\nXS\nXS\n28\n24.4\n18.5\n26.8\nS\nS\n29.5\n26\n18.9\n28.3\nM\nM\n31.1\n27.6\n19.3\n29.9\nL\nL\n33.5\n29.1\n19.7\n32.3\nXL\nXL\n35.8\n30.7\n20.1\n34.6';
[['tab-separated', SAVANA_TABS], ['with pipes', SAVANA_PIPES], ['one cell per line', SAVANA_LINES]].forEach(([shape, text]) => {
  check('the Savana tank chart, copied ' + shape + ': a second "IN Size" column does not stop it being read', () => {
    const r = parseChart(text);
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.rows.map(x => x.size).join(','), 'XS,S,M,L,XL');
    assert.strictEqual(r.unit, 'in');
    assert.strictEqual(cellsOf(r, 'bust'), '28/29.5/31.1/33.5/35.8');
    assert.strictEqual(cellsOf(r, 'waist'), '24.4/26/27.6/29.1/30.7');
    assert.strictEqual(cellsOf(r, 'length'), '18.5/18.9/19.3/19.7/20.1');
    assert.strictEqual(cellsOf(r, 'hem'), '26.8/28.3/29.9/32.3/34.6');
    assert.deepStrictEqual(r.used.map(u => u.name), ['Bust', 'Waist', 'Length', 'Hem']);
    assert.deepStrictEqual(r.ignored.map(i => i.header), ['IN Size']);                 // the Hem column is read now; only the second size column is skipped
  });
});

check('a chart whose header words are single words ("Size / Bust / Waist", one per line) is still read correctly', () => {
  const r = parseChart('Size\nBust\nWaist\nS\n34\n28\nM\n36\n30');
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.rows.map(x => x.size).join(','), 'S,M');
  assert.strictEqual(cellsOf(r, 'bust'), '34/36');
  assert.strictEqual(cellsOf(r, 'waist'), '28/30');
});

check('the H&M polo lines ("XS: Width: 57 cm, Length: 39 cm"): centimetres, length used, Width not used, and a clear warning', () => {
  const r = parseChart('XXS: Width: 53 cm, Length: 39 cm\nXS: Width: 57 cm, Length: 39 cm\nS: Width: 65 cm, Length: 41 cm\nM: Width: 71 cm, Length: 42 cm\nL: Width: 77 cm, Length: 44 cm\nXL: Width: 87 cm, Length: 46 cm');
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.unit, 'cm');
  assert.strictEqual(r.rows.map(x => x.size).join(','), 'XXS,XS,S,M,L,XL');
  assert.strictEqual(cellsOf(r, 'length'), '39/39/41/42/44/46');
  assert.ok(r.ignored.some(i => /Width/.test(i.header) && /flat or all the way around/.test(i.why)));
  assert.ok(r.warnings.some(w => /no bust, waist or hip column/.test(w)));
});

check('body ranges ("34-36") become min and max, and the chart kind is Body ranges', () => {
  const r = parseChart('Size | Chest (in) | Waist (in) | Hip (in)\nXS | 31-32 | 24 - 25 | 34 to 35\nS | 33-34 | 26-27 | 36-37\nM | 35-36 | 28-29 | 38-39');
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.chartType, 'range');
  assert.strictEqual(r.rows[0].bust + '-' + r.rows[0].bustMax, '31-32');
  assert.strictEqual(r.rows[0].waist + '-' + r.rows[0].waistMax, '24-25');
  assert.strictEqual(r.rows[0].hip + '-' + r.rows[0].hipMax, '34-35');
  assert.strictEqual(r.rows[2].bust + '-' + r.rows[2].bustMax, '35-36');
});

check('plain "Bust / Waist / Hip" with no word about body or garment is read as garment measurements, with a warning to check', () => {
  const r = parseChart('Size\tBust (in)\tWaist (in)\tHip (in)\tLength (in)\nS\t34\t28\t36\t24\nM\t36\t30\t38\t24.5');
  assert.strictEqual(r.chartType, 'garment');
  assert.strictEqual(r.kindGuessed, true);
  assert.ok(r.warnings.some(w => /garment or of the body/.test(w)));
});

check('"body" or "garment" written in the text decides the kind', () => {
  assert.strictEqual(parseChart('Body measurements\nSize\tBust (in)\tWaist (in)\nS\t34\t28\nM\t36\t30').chartType, 'tofit');
  assert.strictEqual(parseChart('Garment measurements\nSize\tBust (in)\tWaist (in)\nS\t34\t28\nM\t36\t30').chartType, 'garment');
});

check('no unit named: centimetres are guessed from big numbers, inches from small ones, and it says it guessed', () => {
  const cm = parseChart('Size\tBust\tWaist\nS\t86\t68\nM\t92\t74');
  assert.strictEqual(cm.unit, 'cm'); assert.strictEqual(cm.unitGuessed, true);
  assert.ok(cm.warnings.some(w => /guessed centimetres/.test(w)));
  const inch = parseChart('Size\tBust\tWaist\nS\t34\t28\nM\t36\t30');
  assert.strictEqual(inch.unit, 'in'); assert.strictEqual(inch.unitGuessed, true);
});

check('pants: an inseam column sets the type to pants; a full "Length" column is not used as the inseam', () => {
  const a = parseChart('Size\tWaist (in)\tHip (in)\tInseam (in)\n28\t28\t38\t30\n30\t30\t40\t30');
  assert.strictEqual(a.type, 'pants');
  assert.strictEqual(cellsOf(a, 'inseam'), '30/30');
  const b = parseChart('Size\tWaist (in)\tHip (in)\tLength (in)\n28\t28\t38\t40\n30\t30\t40\t40');
  assert.strictEqual(b.type, null);
  assert.strictEqual(cellsOf(b, 'length'), '/');
  assert.ok(b.ignored.some(i => /inseam/.test(i.why)));
});

check('decimal commas, blank cells and sizes listed largest to smallest are handled', () => {
  const r = parseChart('Size\tBust (cm)\tWaist (cm)\nL\t96,5\t80\nM\t90\t-\nS\t84\t66');
  assert.strictEqual(r.rows.map(x => x.size).join(','), 'S,M,L');                     // flipped to smallest first
  assert.strictEqual(r.rows[2].bust, '96.5');
  assert.strictEqual(r.rows[1].waist, '');                                            // "-" is a blank, not a number
  assert.ok(r.warnings.some(w => /largest to smallest/.test(w)));
});

check('text that is not a table gives a plain-language error and changes nothing', () => {
  ['', 'hello', 'Product details\nMaterial: Polyester\nFit: Loose', 'Size\nS\nM'].forEach(t => {
    const r = parseChart(t);
    assert.strictEqual(r.ok, false, JSON.stringify(t));
    assert.ok(typeof r.error === 'string' && r.error.length > 10);
  });
});

check('a parsed chart works in the calculator: the Myntra chart gives M for tape numbers (bust 36, waist 30)', () => {
  const r = parseChart(MYNTRA_TABS);
  const gar = { type: 'top', unit: r.unit, fabric: 'none', chartType: r.chartType, lengthFrom: 'top-edge', rows: r.rows.map(x => Object.assign(Fit.blankRow(''), x)) };
  const body = { h: 64, bust: 36, waist: 30, hip: null, inseam: 29 };
  const ana = Fit.analyseAll(body, Geometry.build({}, body), gar, clone(Fit.DEFAULT_RULES));
  assert.strictEqual(gar.rows[ana.idx].size, 'M');
});

console.log('Length counted from the top edge (tube tops, strapless, bandeau)');

// Priya's calibrated marks, and the Myntra StyleCast x Revolte tube top: M front length 11.0 in
const tubePerson = () => ({ picture: { src: 'x', w: 1072, h: 1290 },
  marks: { head: { x: 563, y: 25 }, shoulder: { x: 437, y: 269 }, bust: { x: 559, y: 407 }, waist: { x: 505, y: 606 }, hip: { x: 584, y: 675 }, floor: { x: 554, y: 1224 }, wrist: { x: 233, y: 691 } } });
const tubeBody = { h: 64, bust: 36, waist: 30, hip: null, inseam: 29 };
const tubeHem = (lengthFrom, person) => {
  const gar = { type: 'top', unit: 'in', fabric: 'none', chartType: 'tofit', lengthFrom: lengthFrom,
    rows: [Object.assign(Fit.blankRow('M'), { bust: '36', waist: '30', length: '11.0' })] };
  const g = Geometry.build(person || tubePerson(), tubeBody);
  return { hem: Fit.hemInfo(gar.rows[0], g, gar, tubeBody), g: g };
};
const pxPerInch = (1224 - 25) / 64;
const heightOfPx = y => (1224 - y) / pxPerInch;

check('counted from the shoulder (the default), a length of 11 in lands just below the bust: wrong for a tube top', () => {
  const r = tubeHem('shoulder');
  assert.strictEqual(r.hem.short, '1.73 in below bust');
  assert.strictEqual(tubeHem(undefined).hem.short, r.hem.short);                 // a garment saved before this setting behaves as before
});

check('counted from the top edge, the hem is the bust line + 2 in - the length, about 1.6 in above the waist', () => {
  const r = tubeHem('top-edge');
  assert.ok(Math.abs(r.hem.height - (heightOfPx(407) + 2 - 11.0)) < 1e-9, String(r.hem.height));
  assert.strictEqual(r.hem.short, '1.62 in above waist');
});

check('from the top edge the shoulder mark no longer matters, only the bust mark does', () => {
  const a = tubeHem('top-edge').hem.height;
  const moved = tubePerson(); moved.marks.shoulder = { x: 437, y: 330 };         // shoulder marked 3 in lower
  assert.ok(Math.abs(tubeHem('top-edge', moved).hem.height - a) < 1e-9);
  const bustMoved = tubePerson(); bustMoved.marks.bust = { x: 559, y: 444 };       // bust marked 2 in lower: the hem follows
  assert.ok(Math.abs((a - tubeHem('top-edge', bustMoved).hem.height) - 37 / pxPerInch) < 1e-9);
});

check('the estimate flag asks for the bust mark (not the shoulder) when counting from the top edge', () => {
  const noBust = tubePerson(); delete noBust.marks.bust;
  const { hem, g } = tubeHem('top-edge', noBust);
  assert.strictEqual(hem.fromShoulder, false);
  assert.deepStrictEqual(Geometry.unmarked(g, ['head', 'floor'].concat(hem.fromShoulder ? ['shoulder'] : [], hem.refs)), ['bust']);
  const full = tubeHem('top-edge');
  assert.deepStrictEqual(Geometry.unmarked(full.g, ['head', 'floor'].concat(full.hem.fromShoulder ? ['shoulder'] : [], full.hem.refs)), []);
});

check('which zones the garment reaches follows the same starting point (a longer tube top does cover the waist)', () => {
  const g = Geometry.build(tubePerson(), tubeBody);
  const covers = (lengthFrom, length) => {
    const gar = { type: 'top', unit: 'in', fabric: 'none', chartType: 'garment', lengthFrom: lengthFrom,
      rows: [Object.assign(Fit.blankRow('M'), { bust: '36', waist: '30', length: String(length) })] };
    const a = Fit.analyseAll(tubeBody, g, gar, clone(Fit.DEFAULT_RULES)).rows[0].zones;
    return { bust: a.bust.covered, waist: a.waist.covered };
  };
  assert.deepStrictEqual(covers('top-edge', 11), { bust: true, waist: false });    // hem ends about 1.6 in above the waist
  assert.deepStrictEqual(covers('top-edge', 14), { bust: true, waist: true });     // 3 in longer: now it covers the waist
  assert.deepStrictEqual(covers('shoulder', 14), { bust: true, waist: false });    // counted from the shoulder, 14 in is still above the waist
});

check('the hem adjustment still works on top of it', () => {
  const gar = { type: 'top', unit: 'in', fabric: 'none', chartType: 'tofit', lengthFrom: 'top-edge', hemAmount: '1', hemDir: 'up',
    rows: [Object.assign(Fit.blankRow('M'), { length: '11.0' })] };
  const g = Geometry.build(tubePerson(), tubeBody);
  const plain = tubeHem('top-edge').hem.height;
  assert.ok(Math.abs(Fit.hemInfo(gar.rows[0], g, gar, tubeBody).height - (plain + 1)) < 1e-9);
});

console.log('"To fit" body charts (one body number per size)');

// bust 32 / 34 / 36 for S / M / L, waist 26 / 28 / 30. Each size covers the bodies halfway to its neighbours.
const toFitChart = (unit, scale) => {
  const n = v => String(Util.fmt(v * (scale || 1)));
  return { type: 'top', unit: unit || 'in', fabric: 'none', chartType: 'tofit', rows: [
    Object.assign(Fit.blankRow('S'), { bust: n(32), waist: n(26) }),
    Object.assign(Fit.blankRow('M'), { bust: n(34), waist: n(28) }),
    Object.assign(Fit.blankRow('L'), { bust: n(36), waist: n(30) })] };
};
const toFitRun = (body, gar) => {
  gar = gar || toFitChart();
  const b = Object.assign({ h: 64, bust: null, waist: null, hip: null, inseam: 29 }, body);
  const ana = Fit.analyseAll(b, Geometry.build({}, b), gar, clone(Fit.DEFAULT_RULES));
  return { ana, size: ana.idx >= 0 ? gar.rows[ana.idx].size : null };
};

check('a body near the number a size is made to fit gets that size', () => {
  assert.strictEqual(toFitRun({ bust: 32 }).size, 'S');
  assert.strictEqual(toFitRun({ bust: 34 }).size, 'M');
  assert.strictEqual(toFitRun({ bust: 32.9 }).size, 'S');      // closer to 32 than to 34
  assert.strictEqual(toFitRun({ bust: 33.4 }).size, 'M');      // closer to 34
  assert.strictEqual(toFitRun({ bust: 36.9 }).size, 'L');
});

check('exactly halfway between two sizes goes to the larger size', () => {
  assert.strictEqual(toFitRun({ bust: 33 }).size, 'M');
  assert.strictEqual(toFitRun({ bust: 35 }).size, 'L');
});

check('bigger than the last size, or smaller than the first, is flagged as outside the chart', () => {
  const big = toFitRun({ bust: 39 });
  assert.strictEqual(big.size, 'L');
  assert.strictEqual(big.ana.note.title, 'Outside the chart');
  const small = toFitRun({ bust: 29 });
  assert.strictEqual(small.size, 'S');
  assert.strictEqual(small.ana.note.title, 'Outside the chart');
});

check('several zones: the size most zones agree on wins, and a split is explained', () => {
  assert.strictEqual(toFitRun({ bust: 34, waist: 28 }).size, 'M');
  const split = toFitRun({ bust: 32, waist: 30 });              // bust says S, waist says L: a tie, so the larger size
  assert.strictEqual(split.size, 'L');
  assert.strictEqual(split.ana.note.title, 'Between sizes');
});

check('the zone card shows the number the brand gave and the range made from it', () => {
  const r = toFitRun({ bust: 34 });
  assert.strictEqual(Fit.formula(r.ana.rows[1].zones.bust), 'size made to fit 34 in, so it covers 33 to 35 in (halfway to the neighbouring sizes), body 34 in');
});

check('a chart typed in centimetres gives the same answers', () => {
  const cm = toFitChart('cm', 2.54);
  [32, 32.9, 33, 33.4, 34, 36.9].forEach(b => assert.strictEqual(toFitRun({ bust: b }, cm).size, toFitRun({ bust: b }).size, 'bust ' + b));
});

check('a size that leaves a zone blank is skipped for that zone; its neighbours still meet halfway', () => {
  const gar = toFitChart();
  gar.rows[1].waist = '';                                       // M lists no waist
  const r = toFitRun({ waist: 28 }, gar);                       // S 26 and L 30 now meet at 28
  assert.strictEqual(r.ana.rows[1].zones.waist, null);
  assert.ok(['S', 'L'].indexOf(r.size) >= 0);
});

check('a "to fit" chart does not touch the numbers you typed', () => {
  const gar = toFitChart();
  toFitRun({ bust: 34 }, gar);
  assert.strictEqual(gar.rows[1].bust, '34');
  assert.strictEqual(gar.rows[1].bustMax, '');
  assert.strictEqual(gar.chartType, 'tofit');
});

console.log('Material guess (stretch or not)');

const guess = text => { const g = FitRoom.Material.guessFabric(text); return g ? g.fabric : null; };

check('a listed stretch fibre means Stretch, sure, with the percentage in the reason', () => {
  const g = FitRoom.Material.guessFabric('95% Cotton, 5% Elastane');
  assert.strictEqual(g.fabric, 'stretch');
  assert.strictEqual(g.sure, 'sure');
  assert.ok(/5%/.test(g.reason), g.reason);
  assert.strictEqual(guess('Nylon 80%, SPANDEX 20%'), 'stretch');            // capital letters and "spandex" work too
  assert.strictEqual(guess('elastane 8%, polyamide 92%'), 'stretch');         // percentage written after the fibre
});

check('only a tiny share of elastane is Stretch, but only "probably"', () => {
  const g = FitRoom.Material.guessFabric('98% cotton, 2% elastane denim');
  assert.strictEqual(g.fabric, 'stretch');
  assert.strictEqual(g.sure, 'probably');
});

check('"no elastane", "elastane free" and "non-stretch" mean No stretch (they must not trigger Stretch)', () => {
  assert.strictEqual(guess('100% cotton, no elastane'), 'none');
  assert.strictEqual(guess('Elastane-free woven cotton'), 'none');
  assert.strictEqual(guess('Non-stretch denim'), 'none');
  assert.strictEqual(guess('rigid denim'), 'none');
});

check('a knit fabric means Stretch (the H&M ribbed polo description)', () => {
  assert.strictEqual(guess('Short, fitted polo shirt in ribbed cotton jersey with a collar, button placket and short sleeves.'), 'stretch');
  assert.strictEqual(guess('Cotton interlock'), 'stretch');
});

check('woven fabrics and plain denim mean No stretch', () => {
  assert.strictEqual(guess('100% linen'), 'none');
  assert.strictEqual(guess('Cotton poplin'), 'none');
  assert.strictEqual(guess('Denim'), 'none');
  assert.strictEqual(guess('Woven polyester trousers'), 'none');
});

check('a fibre name alone (the Outzidr track pants: "Polyester") is No stretch, "just a guess"', () => {
  const g = FitRoom.Material.guessFabric('Polyester');
  assert.strictEqual(g.fabric, 'none');
  assert.strictEqual(g.sure, 'just a guess');
});

check('an elastic waist means Elastic waist; a drawstring alone does not', () => {
  assert.strictEqual(guess('Woven trousers with an elasticated waist'), 'elastic-waist');
  assert.strictEqual(guess('Polyester, elastic waistband'), 'elastic-waist');
  assert.strictEqual(guess('Polyester. Closure: drawstring'), 'none');          // a drawstring only tightens
  assert.strictEqual(guess('Non-stretch cotton with an elastic waist'), 'elastic-waist');
});

check('stretch fibre beats a woven word ("stretch denim")', () => {
  assert.strictEqual(guess('Denim with elastane'), 'stretch');
  assert.strictEqual(guess('Stretch denim'), 'stretch');
});

check('weave type and material together, as Myntra lists them ("Knitted" + "Cotton Blend")', () => {
  assert.strictEqual(guess('Knitted, Cotton Blend'), 'stretch');
  assert.strictEqual(guess('Ribbed, Cotton Blend'), 'stretch');
  assert.strictEqual(guess('Woven, Cotton Blend'), 'none');
  assert.strictEqual(guess('Cotton Blend'), 'none');                         // material alone says nothing about knit or woven
});

check('empty or unrecognised text gives no guess', () => {
  assert.strictEqual(FitRoom.Material.guessFabric(''), null);
  assert.strictEqual(FitRoom.Material.guessFabric('   '), null);
  assert.strictEqual(FitRoom.Material.guessFabric(null), null);
  assert.strictEqual(FitRoom.Material.guessFabric('Concept: DIVIDED, BASICS'), null);
});

console.log('Close call (a skipped size that was only narrowly too small)');

const pantsWaist = (waist, fabric) => {
  const gar = { type: 'pants', unit: 'in', fabric: fabric || 'none', chartType: 'garment', rows: [
    Object.assign(Fit.blankRow('XS'), { waist: '26', hip: '43', inseam: '29' }), Object.assign(Fit.blankRow('S'), { waist: '28', hip: '45', inseam: '29' }),
    Object.assign(Fit.blankRow('M'), { waist: '30', hip: '47', inseam: '29' }), Object.assign(Fit.blankRow('L'), { waist: '32', hip: '49', inseam: '29' })] };
  const body = { h: 64, bust: null, waist: waist, hip: 37, inseam: 29 };
  const ana = Fit.analyseAll(body, Geometry.build({}, body), gar, clone(Fit.DEFAULT_RULES));
  return { ana, size: gar.rows[ana.idx].size };
};

check('waist 30.67: L is picked, but M is only 0.67 in short, so the tool says it is a close call', () => {
  const r = pantsWaist(30.67);
  assert.strictEqual(r.size, 'L');
  assert.strictEqual(r.ana.note.title, 'Close call');
  assert.ok(/M was skipped, but only just: its waist is 0\.67 in short/.test(r.ana.note.text), r.ana.note.text);
  assert.ok(/L is the safer choice/.test(r.ana.note.text), r.ana.note.text);
});

check('waist 30: M is picked outright, no note', () => {
  const r = pantsWaist(30);
  assert.strictEqual(r.size, 'M');
  assert.strictEqual(r.ana.note, null);
});

check('a skipped size that is clearly too small (1.5 in short) is not called a close call', () => {
  const r = pantsWaist(31.5);                       // M: 30 - 31.5 = -1.5
  assert.strictEqual(r.size, 'L');
  assert.strictEqual(r.ana.note, null);
});

check('the boundary: exactly 1 in short still counts as a close call', () => {
  const r = pantsWaist(31);
  assert.strictEqual(r.size, 'L');
  assert.ok(r.ana.note && r.ana.note.title === 'Close call');
});

check('when the smallest size already fits there is nothing to skip, so no note', () => {
  const r = pantsWaist(25);
  assert.strictEqual(r.size, 'XS');
  assert.strictEqual(r.ana.note, null);
});

console.log('Estimated labels (the crop top question)');

// The numbers from the screenshot: 64 in tall, only head top and floor marked, length 16.54 in (42 cm).
const cropBody = { h: 64, bust: 37, waist: 30, hip: 39, inseam: 29 };
const cropGar = { type: 'top', unit: 'in', fabric: 'none', chartType: 'range', rows: [Object.assign(Fit.blankRow('M'), { length: '16.54' })] };
const hemNeeds = hem => ['head', 'floor'].concat(hem.fromShoulder ? ['shoulder'] : [], hem.refs);

check('only head top and floor marked: the hem reads "3.1 in below waist" and is flagged as an estimate', () => {
  const person = { picture: { src: 'x', w: 1072, h: 1290 }, marks: { head: { x: 556, y: 25 }, floor: { x: 554, y: 1224 } } };
  const g = Geometry.build(person, cropBody);
  const hem = Fit.hemInfo(cropGar.rows[0], g, cropGar, cropBody);
  assert.strictEqual(Util.fmt(hem.height), '36.58');
  assert.strictEqual(hem.short, '3.1 in below waist');                    // exactly what the screenshot showed
  assert.deepStrictEqual(Geometry.unmarked(g, hemNeeds(hem)), ['shoulder', 'waist', 'hip']);
});

check('after marking shoulder, waist and hip the flag is gone and the waist guess is replaced by the scan', () => {
  const person = { picture: { src: 'x', w: 1072, h: 1290 },
    marks: { head: { x: 556, y: 25 }, floor: { x: 554, y: 1224 }, shoulder: { x: 425, y: 295 }, waist: { x: 556, y: 544 }, hip: { x: 556, y: 664 } } };
  const g = Geometry.build(person, cropBody);
  const hem = Fit.hemInfo(cropGar.rows[0], g, cropGar, cropBody);
  assert.deepStrictEqual(Geometry.unmarked(g, hemNeeds(hem)), []);
  const below = parseFloat(hem.short);                                      // "1.3 in below waist" -> 1.3
  assert.ok(/in below waist$/.test(hem.short) && below < 3.1, hem.short);   // the waist guess was too high, so the gap shrinks
});

check('a hem measured from the floor (pants) only needs head top and floor; a sleeve needs shoulder and wrist', () => {
  const person = { picture: { src: 'x', w: 1072, h: 1290 }, marks: { head: { x: 556, y: 25 }, floor: { x: 554, y: 1224 } } };
  const pantsGar = { type: 'pants', unit: 'in', fabric: 'none', chartType: 'garment', rows: [Object.assign(Fit.blankRow('30'), { inseam: '28' })] };
  const g = Geometry.build(person, cropBody);
  const hem = Fit.hemInfo(pantsGar.rows[0], g, pantsGar, cropBody);
  assert.deepStrictEqual(Geometry.unmarked(g, hemNeeds(hem)), []);
  assert.deepStrictEqual(Geometry.unmarked(g, ['head', 'floor', 'shoulder', 'wrist']), ['shoulder', 'wrist']);
});

check('a person with no picture has nothing marked, so everything is an estimate', () => {
  const g = Geometry.build({}, cropBody);
  assert.deepStrictEqual(Geometry.unmarked(g, ['head', 'floor']), ['head top', 'floor']);
});

console.log('Hem adjustment');

const adjBody = { h: 64, bust: 37, waist: 30, hip: 39, inseam: 29 };
const adjGeo = Geometry.build({}, adjBody);
const adjHem = (extra) => {
  const gar = Object.assign({ type: 'top', unit: 'in', fabric: 'none', chartType: 'range', rows: [Object.assign(Fit.blankRow('M'), { length: '16.54' })] }, extra);
  return Fit.hemInfo(gar.rows[0], adjGeo, gar, adjBody);
};

check('no adjustment = the chart length, unchanged', () => {
  const h = adjHem({});
  assert.strictEqual(Util.fmt(h.height), '36.58');
  assert.strictEqual(h.shift, 0);
});

check('"higher" lifts the hem toward your head, "lower" drops it toward your feet', () => {
  const base = adjHem({}).height;
  assert.strictEqual(Util.fmt(adjHem({ hemAmount: '2', hemDir: 'up' }).height - base), '2');
  assert.strictEqual(Util.fmt(adjHem({ hemAmount: '2', hemDir: 'down' }).height - base), '-2');
  assert.strictEqual(adjHem({ hemAmount: '-2', hemDir: 'up' }).shift > 0, true);      // a minus sign typed by mistake does not flip the direction
});

check('the words follow the hem: lifted enough, it reads "above waist"', () => {
  // waist is 13.44 in below the shoulder here; chart length 16.54 -> 3.1 in below waist. Lift it by 4 in -> 0.9 in above waist.
  const h = adjHem({ hemAmount: '4', hemDir: 'up' });
  assert.strictEqual(h.short, '0.9 in above waist');
  assert.ok(/above your natural waist/.test(h.text), h.text);
});

check('the amount is typed in the chart unit (cm) and converted', () => {
  const rows = [Object.assign(Fit.blankRow('M'), { length: '42' })];                 // H&M's M length: 42 cm
  const plain = adjHem({ unit: 'cm', rows: rows });
  const lifted = adjHem({ unit: 'cm', rows: rows, hemAmount: '5.08', hemDir: 'up' });  // 5.08 cm = exactly 2 in
  assert.strictEqual(Util.fmt(lifted.height - plain.height), '2');
});

check('pants: adjusting lifts the hem off the floor', () => {
  const pants = { type: 'pants', unit: 'in', fabric: 'none', chartType: 'garment', rows: [Object.assign(Fit.blankRow('30'), { inseam: '29' })] };
  const plain = Fit.hemInfo(pants.rows[0], adjGeo, pants, adjBody);
  pants.hemAmount = '1.5'; pants.hemDir = 'up';
  const lifted = Fit.hemInfo(pants.rows[0], adjGeo, pants, adjBody);
  assert.strictEqual(Util.fmt(lifted.height - plain.height), '1.5');
});

check('the short label names the closer body line', () => {
  const g = adjGeo;                                    // bust line 9.28 in down, waist 13.44 in down
  assert.strictEqual(Fit.describeDrop(g.bustD + 1, g).short, '1 in below bust');
  assert.strictEqual(Fit.describeDrop(g.waistD - 1.2, g).short, '1.2 in above waist');
});

console.log('Garment link');

check('a pasted link is cleaned up; anything that is not a normal web page is dropped', () => {
  const safe = Util.safeLink;
  assert.strictEqual(safe(''), '');
  assert.strictEqual(safe('   '), '');
  assert.strictEqual(safe('https://www.hm.com/en_in/product/123'), 'https://www.hm.com/en_in/product/123');
  assert.strictEqual(safe('www.zara.com/in/shirt'), 'https://www.zara.com/in/shirt');      // no https:// typed
  assert.strictEqual(safe('  http://example.com  '), 'http://example.com/');              // spaces trimmed
  assert.strictEqual(safe('javascript:alert(1)'), '');                                    // never a script
  assert.strictEqual(safe('data:text/html,<b>x</b>'), '');
  assert.strictEqual(safe('mailto:a@b.com'), '');
  assert.strictEqual(safe('just some words'), '');
  assert.strictEqual(safe('hello'), '');
});

check('a blank chart row has every column empty', () => {
  const r = Fit.blankRow('M');
  assert.strictEqual(r.size, 'M');
  ['bust', 'bustMax', 'waist', 'waistMax', 'hip', 'hipMax', 'length', 'hem', 'sleeve', 'inseam'].forEach(k => assert.strictEqual(r[k], '', k));
});

console.log('Stretch strength (Low = flat 2 in, Medium and High = a percentage of the garment)');

// The Savana slim tank top, read from its page exactly as copied, then run with Priya's numbers (it fits her in M).
const tank = (level, fabric) => {
  const parsed = parseChart(SAVANA_PIPES);
  const gar = { type: 'top', unit: 'in', fabric: fabric || 'stretch', stretchLevel: level, chartType: 'garment', lengthFrom: 'shoulder', rows: parsed.rows };
  const run1 = body => { const ana = Fit.analyseAll(body, Geometry.build({}, body), gar, clone(Fit.DEFAULT_RULES)); return { ana, size: ana.idx >= 0 ? gar.rows[ana.idx].size : null }; };
  return { gar, tape: run1({ h: 62, bust: 36, waist: 30, hip: 38, inseam: 29 }), scan: run1({ h: 62, bust: 37.32, waist: 30.67, hip: 40.6, inseam: 29 }) };
};

check('the default rules carry the two percentages', () => {
  assert.strictEqual(Fit.DEFAULT_RULES.allow, 2);
  assert.strictEqual(Fit.DEFAULT_RULES.allowMedium, 10);
  assert.strictEqual(Fit.DEFAULT_RULES.allowHigh, 18);
});

check('Savana tank, High stretch, her tape numbers (bust 36, waist 30): M, the size she really wears, with nothing tight', () => {
  const r = tank('high');
  assert.strictEqual(r.tape.size, 'M');
  const m = r.tape.ana.rows[r.tape.ana.idx].zones;
  assert.strictEqual(m.bust.cls, 'fit');                           // 31.1 + 18% - 36 = 0.7 in of room: Fitted, as a slim top should be
  assert.ok(Math.abs(m.bust.gap - 0.698) < 0.001, String(m.bust.gap));
  assert.strictEqual(m.waist.cls, 'reg');                          // 27.6 + 18% - 30 = 2.6 in
  assert.strictEqual(r.tape.ana.rows[r.tape.ana.idx].tight, 0);
});

check('Savana tank, High stretch, S is still skipped (bust 29.5 + 18% = 34.8, 1.2 in short)', () => {
  const s = tank('high').tape.ana.rows[1];
  assert.strictEqual(s.zones.bust.cls, 'tight');
  assert.ok(Math.abs(s.zones.bust.gap + 1.19) < 0.01, String(s.zones.bust.gap));
});

check('Savana tank, High stretch, her scan numbers (bust 37.32): L, with a Close call note about M (the scan reads high)', () => {
  const r = tank('high');
  assert.strictEqual(r.scan.size, 'L');
  assert.strictEqual(r.scan.ana.note.title, 'Close call');
  assert.ok(/M was skipped, but only just/.test(r.scan.ana.note.text), r.scan.ana.note.text);
});

check('the same chart with Low (the flat 2 in) still gives the old answer, XL', () => {
  assert.strictEqual(tank('low').tape.size, 'XL');
});

check('a chart saved before stretch levels existed (no stretchLevel) behaves as Low', () => {
  assert.strictEqual(tank(undefined).tape.size, 'XL');
  assert.strictEqual(tank('nonsense').tape.size, 'XL');
});

check('Medium stretch adds 10% of the garment: L is the pick for her tape numbers', () => {
  const r = tank('medium');
  assert.strictEqual(r.tape.size, 'L');
  const bust = r.tape.ana.rows[3].zones.bust;                      // L: 33.5 + 3.35 - 36
  assert.ok(Math.abs(bust.allow - 3.35) < 0.001, String(bust.allow));
  assert.strictEqual(bust.allowPct, 10);
});

check('a bigger size gets a bigger allowance (the percentage is of that size\'s own measurement)', () => {
  const rows = tank('high').tape.ana.rows;
  assert.ok(rows[4].zones.bust.allow > rows[2].zones.bust.allow);
  assert.ok(Math.abs(rows[2].zones.bust.allow - 31.1 * 0.18) < 0.001);
  assert.ok(Math.abs(rows[4].zones.bust.allow - 35.8 * 0.18) < 0.001);
});

check('the zone explanation names the percentage; Low still says just "plus 2 stretch"', () => {
  const hi = Fit.formula(tank('high').tape.ana.rows[2].zones.bust);
  assert.ok(/garment 31\.1 plus 5\.6 stretch \(18% of the garment\), minus body 36/.test(hi), hi);
  const lo = Fit.formula(tank('low').tape.ana.rows[2].zones.bust);
  assert.ok(/garment 31\.1 plus 2 stretch, minus body 36/.test(lo), lo);
});

check('changing the High percentage in the rules changes the answer (here 10% makes it behave like Medium)', () => {
  const t = tank('high');
  const rules = clone(Fit.DEFAULT_RULES); rules.allowHigh = 10;
  const body = { h: 62, bust: 36, waist: 30, hip: 38, inseam: 29 };
  const ana = Fit.analyseAll(body, Geometry.build({}, body), t.gar, rules);
  assert.strictEqual(t.gar.rows[ana.idx].size, 'L');
});

check('an elastic waist ignores the stretch level: the flat 2 in at the waist only', () => {
  const t = tank('high', 'elastic-waist');
  const z = t.tape.ana.rows[2].zones;
  assert.strictEqual(z.waist.allow, 2);
  assert.strictEqual(z.waist.allowPct, null);
  assert.strictEqual(z.bust.allow, 0);
});

check('No stretch ignores the stretch level', () => {
  const t = tank('high', 'none');
  assert.strictEqual(t.tape.ana.rows[2].zones.bust.allow, 0);
  assert.strictEqual(t.tape.ana.rows[2].zones.waist.allow, 0);
});

check('body charts (ranges) do not use the stretch level, only the tie-break', () => {
  const lo = run('hm', { bust: 36, waist: 30, hip: 38 }, g => { g.fabric = 'stretch'; g.stretchLevel = 'low'; });
  const hi = run('hm', { bust: 36, waist: 30, hip: 38 }, g => { g.fabric = 'stretch'; g.stretchLevel = 'high'; });
  assert.strictEqual(lo.size, hi.size);
});

check('material text: "Stretchability: High" is Stretch, level High (also across a line break)', () => {
  ['Fit Type Slim, Stretchability: High', 'Stretchability\nHigh', 'stretchability high'].forEach(txt => {
    const g = FitRoom.Material.guessFabric(txt);
    assert.strictEqual(g.fabric, 'stretch', txt);
    assert.strictEqual(g.level, 'high', txt);
    assert.ok(/stretchability/.test(g.levelWhy), g.levelWhy);
  });
});

check('material text: Medium and Low stretch are read from plain phrases and labels', () => {
  assert.strictEqual(FitRoom.Material.guessFabric('Stretchability: Medium').level, 'medium');
  assert.strictEqual(FitRoom.Material.guessFabric('medium stretch cotton').level, 'medium');
  assert.strictEqual(FitRoom.Material.guessFabric('95% cotton 5% elastane, slight stretch').level, 'low');
  assert.strictEqual(FitRoom.Material.guessFabric('Stretchability: Low').level, 'low');
  assert.strictEqual(FitRoom.Material.guessFabric('ribbed knit, high stretch').level, 'high');
});

check('material text: a stretch fabric that does not say how much has level null (the page then uses Low)', () => {
  const g = FitRoom.Material.guessFabric('95% cotton, 5% elastane');
  assert.strictEqual(g.fabric, 'stretch');
  assert.strictEqual(g.level, null);
  assert.strictEqual(FitRoom.Material.guessFabric('cotton jersey').level, null);
});

check('material text: "Stretchability: None" is No stretch, and fabrics that are not Stretch carry no level', () => {
  const none = FitRoom.Material.guessFabric('Stretchability: None');
  assert.strictEqual(none.fabric, 'none');
  assert.strictEqual(none.level, undefined);
  assert.strictEqual(FitRoom.Material.guessFabric('woven poplin').level, undefined);
});

console.log('Garment picture on the figure (cut-out and warp)');

const GI = FitRoom.GarmentImage;
// A little picture to test with: fn(x, y) gives [r, g, b, a].
const makePic = (w, h, fn) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  return { data, w, h };
};
const alphaAt = (pic, x, y) => pic.data[(y * pic.w + x) * 4 + 3];
const solidCount = (pic, y) => { let n = 0; for (let x = 0; x < pic.w; x++) if (alphaAt(pic, x, y) > 128) n++; return n; };

check('cut-out: a plain background goes, the garment stays, and white INSIDE the garment stays too', () => {
  // white page, red garment (x 10-49, y 10-69), a white 6x6 print inside it
  const pic = makePic(60, 80, (x, y) => {
    const inGarment = x >= 10 && x < 50 && y >= 10 && y < 70;
    const inPrint = x >= 25 && x < 31 && y >= 30 && y < 36;
    return inGarment && !inPrint ? [200, 30, 40, 255] : [255, 255, 255, 255];
  });
  const box = GI.removeBackground(pic.data, pic.w, pic.h, 40);
  assert.deepStrictEqual(box, { x0: 10, y0: 10, x1: 50, y1: 70 });
  assert.strictEqual(alphaAt(pic, 2, 2), 0);                         // page corner
  assert.strictEqual(alphaAt(pic, 30, 40), 255);                     // garment
  assert.ok(alphaAt(pic, 27, 32) > 128, 'the white print inside must not be cut out');
});

check('cut-out: a slightly grey, slightly noisy background still goes at the default strength', () => {
  const pic = makePic(40, 40, (x, y) => {
    const noise = (x * 7 + y * 3) % 5;
    return x >= 10 && x < 30 && y >= 5 && y < 35 ? [30, 90, 160, 255] : [244 + noise, 244 + noise, 244 + noise, 255];
  });
  const box = GI.removeBackground(pic.data, pic.w, pic.h, 40);
  assert.deepStrictEqual(box, { x0: 10, y0: 5, x1: 30, y1: 35 });
});

check('cut-out: a picture that is all background leaves nothing (null)', () => {
  const pic = makePic(20, 20, () => [255, 255, 255, 255]);
  assert.strictEqual(GI.removeBackground(pic.data, pic.w, pic.h, 40), null);
});

check('cut-out: crop keeps just the box', () => {
  const pic = makePic(10, 10, (x, y) => [x * 10, y * 10, 0, 255]);
  const c = GI.crop(pic.data, 10, 10, { x0: 2, y0: 3, x1: 6, y1: 9 });
  assert.strictEqual(c.w, 4); assert.strictEqual(c.h, 6);
  assert.strictEqual(c.data[0], 20); assert.strictEqual(c.data[1], 30);          // pixel (2,3) of the original
});

check('row widths: a gap between sleeve and body is not counted, and an empty centre (neckline) uses the whole row', () => {
  // 50 wide. rows 0-1: whole row solid. rows 2-3: arm 0-9, gap, body 20-39, gap, arm 45-49. rows 4-5: neckline gap in the middle
  const pic = makePic(50, 6, (x, y) => {
    if (y < 2) return [0, 0, 0, 255];
    if (y < 4) return (x < 10 || (x >= 20 && x < 40) || x >= 45) ? [0, 0, 0, 255] : [0, 0, 0, 0];
    return (x < 15 || x >= 35) ? [0, 0, 0, 255] : [0, 0, 0, 0];
  });
  const half = GI.rowHalfWidths(pic);
  assert.strictEqual(half[0], 25);
  assert.strictEqual(half[2], 15);                                   // body only: 20..39 around the centre line at 25
  assert.strictEqual(half[4], 25);                                   // centre empty: the whole row
});

check('warp plan: a garment is stretched until its row is as wide as the chart says (6 in each side at the bust)', () => {
  const pic = makePic(40, 100, () => [200, 30, 40, 255]);            // a plain rectangle, 40 px wide
  const plan = GI.planWarp(pic, 40, 20, [{ h: 30, half: 6 }], 1);    // 20 in long, so 5 px per inch
  assert.strictEqual(plan.pxPerIn, 5);
  assert.ok(Math.abs(plan.halfPx[50] - 30) < 0.01, String(plan.halfPx[50]));      // 6 in x 5 px
  assert.ok(Math.abs(plan.halfIn - 6.2) < 0.05, String(plan.halfIn));
  const out = GI.warp(pic, plan);
  assert.strictEqual(out.h, 100);
  const n = solidCount(out, 50);
  assert.ok(n >= 58 && n <= 62, 'row 50 is ' + n + ' px wide, expected about 60 (12 in)');
  assert.strictEqual(out.data[(50 * out.w + out.w / 2) * 4], 200);   // the colour carried over unchanged
});

check('warp plan: exact at the anchors (bust 5 in, waist 8 in), smooth and one-directional between, and the scale is what is blended', () => {
  const pic = makePic(40, 100, () => [0, 0, 0, 255]);
  const plan = GI.planWarp(pic, 40, 20, [{ h: 35, half: 5 }, { h: 25, half: 8 }], 1);
  const a = Math.round((40 - 35) / 20 * 99), b = Math.round((40 - 25) / 20 * 99), mid = Math.round((a + b) / 2);
  const inches = y => plan.halfPx[y] / plan.pxPerIn;
  assert.ok(Math.abs(inches(a) - 5) < 0.01 && Math.abs(inches(b) - 8) < 0.01);
  for (let y = a; y < b; y++) assert.ok(inches(y + 1) >= inches(y) - 1e-9, 'row ' + y);          // never goes back
  assert.ok(inches(mid) > 5.5 && inches(mid) < 7.5, String(inches(mid)));
  assert.ok(Math.abs(plan.k[mid] - (plan.k[a] + plan.k[b]) / 2) < 0.02);                      // the sideways scale blends evenly
  assert.ok(Math.abs(inches(0) - 5) < 0.01);                                                  // above the first anchor: its width
  assert.ok(Math.abs(inches(99) - 8) < 0.01);                                                 // below the last: its width
});

check('warp plan: with no chart widths the picture only scales to the length and keeps its own proportions', () => {
  const pic = makePic(40, 100, () => [0, 0, 0, 255]);
  const plan = GI.planWarp(pic, 40, 20, [], 1);
  assert.strictEqual(plan.k[10], 1);
  assert.strictEqual(plan.outW, 2 * 20 + 2);
});

check('warp plan: the width fix makes the garment wider or narrower (1.2 = 20% wider)', () => {
  const pic = makePic(40, 100, () => [0, 0, 0, 255]);
  const base = GI.planWarp(pic, 40, 20, [{ h: 30, half: 6 }], 1);
  const wide = GI.planWarp(pic, 40, 20, [{ h: 30, half: 6 }], 1.2);
  assert.ok(Math.abs(wide.halfPx[50] / base.halfPx[50] - 1.2) < 0.001);
});

check('warp plan: an anchor outside the garment (a zone the garment does not reach) is ignored', () => {
  const pic = makePic(40, 100, () => [0, 0, 0, 255]);
  const plan = GI.planWarp(pic, 40, 20, [{ h: 10, half: 9 }, { h: 30, half: 6 }], 1);   // 10 in is below the hem
  assert.ok(Math.abs(plan.halfPx[0] / plan.pxPerIn - 6) < 0.01);
  assert.ok(Math.abs(plan.halfPx[99] / plan.pxPerIn - 6) < 0.01);
});

check('safety check: a photo where most of the picture was kept (a person, a busy background) gets a warning; a garment alone does not', () => {
  assert.strictEqual(GI.photoWarning(0.35), '');
  assert.strictEqual(GI.photoWarning(0.7), '');
  assert.ok(/Most of the photo \(93%\) was kept/.test(GI.photoWarning(0.93)), GI.photoWarning(0.93));
  assert.ok(/person is wearing the garment/.test(GI.photoWarning(0.93)));
  assert.strictEqual(GI.photoWarning(null), '');                    // a cut-out saved before this check existed: no warning
});

check('safety check: prepare-style numbers: the share kept is the garment over the WHOLE photo', () => {
  // the earlier red-rectangle photo: 40 x 60 garment in a 60 x 80 photo = 2400 / 4800 = 0.5 (the white print inside stays garment)
  const pic = makePic(60, 80, (x, y) => (x >= 10 && x < 50 && y >= 10 && y < 70 ? [200, 30, 40, 255] : [255, 255, 255, 255]));
  const box = GI.removeBackground(pic.data, pic.w, pic.h, 40);
  const cut = GI.crop(pic.data, pic.w, pic.h, box);
  let opaque = 0; for (let i = 3; i < cut.data.length; i += 4) if (cut.data[i] > 128) opaque++;
  assert.ok(Math.abs(opaque / (pic.w * pic.h) - 0.5) < 0.02, String(opaque / (pic.w * pic.h)));
});

check('safety check: the photo shape is judged against a flat garment of the chart size (1 = right)', () => {
  // flat tank, bust 31 in: a quarter of that is 7.75 in each side. 20 in long photo, 155 px wide half-reach at 8 px/in -> 155/(7.75*8)=2.5: far too wide
  const pic = makePic(60, 160, () => [0, 0, 0, 255]);                        // 30 px reach, 160 px tall
  const right = GI.planWarp(pic, 40, 20, [{ h: 30, half: 6, flat: 30 / (160 / 20) }], 1);   // flat = exactly what the photo shows
  assert.ok(Math.abs(right.shape[0] - 1) < 0.01, String(right.shape[0]));
  assert.strictEqual(GI.shapeWarning(right.shape), '');
  const tooNarrow = GI.planWarp(pic, 40, 20, [{ h: 30, half: 6, flat: 60 / (160 / 20) }], 1);   // photo is half as wide as a flat garment would be
  assert.ok(Math.abs(tooNarrow.shape[0] - 0.5) < 0.01);
  assert.ok(/do not match the chart/.test(GI.shapeWarning(tooNarrow.shape)), GI.shapeWarning(tooNarrow.shape));
  assert.ok(/2\.0 times/.test(GI.shapeWarning(tooNarrow.shape)));
  const tooWide = GI.planWarp(pic, 40, 20, [{ h: 30, half: 6, flat: 10 / (160 / 20) }], 1);     // photo is three times too wide
  assert.ok(/do not match the chart/.test(GI.shapeWarning(tooWide.shape)));
});

check('safety check: a tee with sleeves (photo about 1.5 times a flat torso) is still accepted; no widths in the chart means no judgement', () => {
  assert.strictEqual(GI.shapeWarning([1.5]), '');
  assert.strictEqual(GI.shapeWarning([1.0, 1.2, 0.8]), '');
  assert.strictEqual(GI.shapeWarning([]), '');
  assert.strictEqual(GI.shapeWarning(undefined), '');
  assert.ok(GI.shapeWarning([1.0, 0.4]) !== '');                    // one zone far off is enough
});

console.log('Hem column (the distance round the bottom edge)');

check('tops and dresses have a Hem column after Length; pants do not', () => {
  assert.deepStrictEqual(Fit.COLUMNS.top, ['bust', 'waist', 'hip', 'length', 'hem', 'sleeve']);
  assert.deepStrictEqual(Fit.COLUMNS.dress, ['bust', 'waist', 'hip', 'length', 'hem', 'sleeve']);
  assert.ok(Fit.COLUMNS.pants.indexOf('hem') < 0);
  assert.strictEqual(Fit.COLUMN_LABEL.hem, 'Hem');
});

check('a Hem number does not change the size or the zone verdicts (the fit rules do not use it)', () => {
  const plain = run('szn', { bust: 36, waist: 30, hip: 38 });
  const withHem = run('szn', { bust: 36, waist: 30, hip: 38 }, gar => gar.rows.forEach((row, i) => { row.hem = String(30 + i * 2); }));
  assert.strictEqual(plain.size, withHem.size);
  assert.deepStrictEqual(plain.ana.rows.map(r => Fit.verdict(r).text), withHem.ana.rows.map(r => Fit.verdict(r).text));
});

check('paste: a "Hem" column is read; "Hem Width" is not (flat or all round is unknown); a pants chart drops it', () => {
  const tops = parseChart('Size | Bust | Waist | Hem\nS | 34 | 28 | 36\nM | 36 | 30 | 38\nL | 38 | 32 | 40');
  assert.strictEqual(tops.ok, true, tops.error);
  assert.strictEqual(cellsOf(tops, 'hem'), '36/38/40');
  const width = parseChart('Size | Bust | Waist | Hem Width\nS | 34 | 28 | 18\nM | 36 | 30 | 19\nL | 38 | 32 | 20');
  assert.strictEqual(cellsOf(width, 'hem'), '//');
  assert.ok(width.ignored.some(i => i.header === 'Hem Width'));
  const pants = parseChart('Size | Waist | Hip | Inseam | Hem\n28 | 28 | 38 | 30 | 14\n30 | 30 | 40 | 30 | 15\n32 | 32 | 42 | 31 | 16');
  assert.strictEqual(pants.ok, true, pants.error);
  assert.strictEqual(cellsOf(pants, 'hem'), '//');
  assert.ok(pants.ignored.some(i => i.header === 'Hem'), JSON.stringify(pants.ignored));
});

console.log('Wrap (the garment follows the body in the scan)');

check('wrap: the output picture is placed where the rows are, so a body that is off-centre shifts the garment with it', () => {
  const pic = makePic(40, 100, () => [200, 30, 40, 255]);
  const plan = GI.planWarp(pic, 40, 20, [{ h: 30, half: 6, shift: -1 }], 1);         // body centre is 1 in left of the centre line
  assert.ok(Math.abs(plan.shift[50] + 1) < 1e-6);
  const out = GI.warp(pic, plan);
  // opaque span on row 50 in inches from the centre line: should be -7 to 5
  let lo = null, hi = null;
  for (let x = 0; x < out.w; x++) if (out.data[(50 * out.w + x) * 4 + 3] > 128) { if (lo === null) lo = x; hi = x + 1; }
  assert.ok(Math.abs((plan.x0 + lo) / plan.pxPerIn + 7) < 0.1, String((plan.x0 + lo) / plan.pxPerIn));
  assert.ok(Math.abs((plan.x0 + hi) / plan.pxPerIn - 5) < 0.1, String((plan.x0 + hi) / plan.pxPerIn));
  assert.ok(Math.abs(plan.widthIn - plan.outW / plan.pxPerIn) < 1e-9);
});

check('wrap: the hem anchor measures the widest row near the bottom, so a slanted hem does not blow the width up', () => {
  // a garment 40 wide, but its last 8 rows narrow to a point (a slanted hem)
  const pic = makePic(40, 100, (x, y) => (y < 92 || Math.abs(x - 20) < Math.max(1, 20 - (y - 91) * 2.4) ? [0, 0, 0, 255] : [0, 0, 0, 0]));
  const plan = GI.planWarp(pic, 40, 20, [{ h: 20, half: 6, atBottom: true }], 1);
  assert.ok(plan.k[99] > 0.3 && plan.k[99] < 5, String(plan.k[99]));                  // a sane scale, not a huge one
  assert.ok(Math.abs(plan.halfPx[91] / plan.pxPerIn - 6) < 0.3, String(plan.halfPx[91] / plan.pxPerIn));   // the widest of the bottom rows is 6 in
});

check('wrap: curving the fabric squeezes the picture toward the sides and leaves the centre alone', () => {
  // a picture whose colour tells the column: red = column / width * 255
  const w = 100, h = 20;
  const pic = makePic(w, h, x => [Math.round(x / (w - 1) * 255), 0, 0, 255]);
  const plan = GI.planWarp(pic, 40, 36, [{ h: 38, half: 10 }], 1);
  const flat = GI.warp(pic, plan, { wrap: 0 }), curved = GI.warp(pic, plan, { wrap: 1 });
  const at = (img, t) => { const x = Math.round(img.w / 2 + t * plan.halfPx[10] * 0.999); return img.data[(10 * img.w + x) * 4]; };
  assert.ok(Math.abs(at(flat, 0) - at(curved, 0)) <= 3);                                // centre: the same
  assert.ok(at(curved, 0.5) < at(flat, 0.5) - 20, at(curved, 0.5) + ' vs ' + at(flat, 0.5));   // half way to the right edge shows a column nearer the middle
  assert.ok(Math.abs(at(curved, 0.95) - at(flat, 0.95)) < 40);                           // the very edge still ends at the edge of the picture
});

check('wrap: shading and the darker edge change the colours but never the see-through parts', () => {
  const pic = makePic(40, 40, () => [200, 100, 50, 255]);
  const plan = GI.planWarp(pic, 40, 30, [{ h: 35, half: 5 }], 1);
  const plain = GI.warp(pic, plan, {});
  const lit = GI.warp(pic, plan, { wrap: 0.5, edge: 0.3, shade: () => 0.5 });
  const mid = (img) => (20 * img.w + Math.floor(img.w / 2)) * 4;
  assert.ok(lit.data[mid(lit)] < plain.data[mid(plain)] * 0.6, lit.data[mid(lit)] + ' vs ' + plain.data[mid(plain)]);
  assert.strictEqual(lit.data[mid(lit) + 3], plain.data[mid(plain) + 3]);               // alpha unchanged
  assert.strictEqual(lit.data[3], 0);                                                  // the corner is still empty
});

check('scan outline: the body mask finds the body on a plain background and the edges leave out arms that are separated by a gap', () => {
  // 60 x 40 scan: grey background; torso columns 20-39 (rows 0-39); an arm at columns 5-10 that does not touch the torso
  const bg = [142, 145, 153, 255], skin = [230, 232, 240, 255];
  const scan = makePic(60, 40, (x, y) => ((x >= 20 && x < 40) || (x >= 5 && x < 11 && y > 10) ? skin : bg));
  const mask = GI.bodyMask(scan.data, scan.w, scan.h, 30);
  assert.strictEqual(mask[20 * 60 + 25], 1);
  assert.strictEqual(mask[20 * 60 + 2], 0);
  const e = GI.bodyEdgesAt(mask, 60, 40, 29, 20, 2);                                    // centre column 29
  assert.ok(Math.abs(e.left - 20) < 1 && Math.abs(e.right - 40) < 1, JSON.stringify(e));    // the arm (columns 5-10) is not included
  assert.strictEqual(GI.bodyEdgesAt(mask, 60, 40, 2, 20, 2), null);                      // centre not on the body: no answer
});

check('scan lighting: brightness is blended between pixels, and the reference is a well lit part of the body', () => {
  const scan = makePic(10, 10, (x, y) => (x < 5 ? [100, 100, 100, 255] : [200, 200, 200, 255]));
  const mask = new Uint8Array(100).fill(1);
  assert.ok(Math.abs(GI.lumaAt(scan.data, 10, 10, 2.5, 5) - 100) < 1);
  assert.ok(Math.abs(GI.lumaAt(scan.data, 10, 10, 7.5, 5) - 200) < 1);
  assert.ok(Math.abs(GI.lumaAt(scan.data, 10, 10, 5, 5) - 150) < 2);                    // half way between the two halves
  assert.ok(GI.lumaReference(scan.data, mask, 10, 10) >= 100);
});

check('scan lighting: the smooth map keeps the broad lighting, ignores empty squares and falls back where there is no body', () => {
  // 40 x 40 scan, body in the left 30 columns: lit (200) on the left half of the body, shaded (100) on the right half
  const scan = makePic(40, 40, (x, y) => (x < 15 ? [200, 200, 200, 255] : x < 30 ? [100, 100, 100, 255] : [142, 145, 153, 255]));
  const mask = new Uint8Array(40 * 40); for (let y = 0; y < 40; y++) for (let x = 0; x < 30; x++) mask[y * 40 + x] = 1;
  const grid = GI.lumaGrid(scan.data, mask, 40, 40, 5, 1);
  assert.ok(GI.lumaSmoothAt(grid, 5, 20, -1) > 170, String(GI.lumaSmoothAt(grid, 5, 20, -1)));       // lit side stays bright
  assert.ok(GI.lumaSmoothAt(grid, 25, 20, -1) < 130, String(GI.lumaSmoothAt(grid, 25, 20, -1)));    // shaded side stays dark
  const mid = GI.lumaSmoothAt(grid, 15, 20, -1);
  assert.ok(mid > 110 && mid < 190, String(mid));                                                  // blended where they meet
  assert.strictEqual(GI.lumaSmoothAt(grid, 38, 20, 777), 777);                                      // no body there: the fallback
});

check('wrap: below the floor row a garment is never narrower than the body outline, and follows the body centre; above it nothing changes', () => {
  const pic = makePic(40, 100, () => [200, 30, 40, 255]);
  // photo is 20 wide-half; anchor at the top makes the garment 4 in each side (a narrow, corset-like cut)
  const base = GI.planWarp(pic, 40, 20, [{ h: 39, half: 4 }], 1);
  const hug = GI.planWarp(pic, 40, 20, [{ h: 39, half: 4 }], 1, { floorFrom: 40, floor: y => ({ half: 6, shift: -0.5 }) });
  assert.ok(Math.abs(base.halfPx[80] / base.pxPerIn - 4) < 0.05);                       // without the floor: 4 in
  assert.ok(Math.abs(hug.halfPx[80] / hug.pxPerIn - 6) < 0.05, String(hug.halfPx[80] / hug.pxPerIn));   // with it: the body's 6 in
  assert.ok(Math.abs(hug.shift[80] + 0.5) < 1e-6);                                       // centred on the body
  assert.strictEqual(hug.halfPx[10], base.halfPx[10]);                                   // rows above floorFrom are untouched
  assert.strictEqual(hug.shift[10], base.shift[10]);
  // a looser garment (8 in) stays at 8 in: the floor only ever widens
  const loose = GI.planWarp(pic, 40, 20, [{ h: 39, half: 8 }], 1, { floorFrom: 40, floor: y => ({ half: 6, shift: 0 }) });
  assert.ok(Math.abs(loose.halfPx[80] / loose.pxPerIn - 8) < 0.05);
  // rows the scan cannot read (floor gives null) keep the anchor widths
  const gaps = GI.planWarp(pic, 40, 20, [{ h: 39, half: 4 }], 1, { floorFrom: 40, floor: y => (y < 70 ? null : { half: 6, shift: 0 }) });
  assert.ok(Math.abs(gaps.halfPx[60] / gaps.pxPerIn - 4) < 0.05 && Math.abs(gaps.halfPx[85] / gaps.pxPerIn - 6) < 0.05);
  // the output picture is wide enough for the widened rows
  assert.ok(hug.widthIn >= 12);
});

console.log('\n' + passed + ' checks passed' + (process.exitCode ? ', some FAILED' : ''));
