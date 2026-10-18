/*
  fit.js — the fit rules. Numbers in, answers out. Nothing here touches the page.

  Three kinds of size chart (the third, "tofit", is turned into the second before any maths happens):

    "garment"  The chart lists the garment's own measurements (one number per cell).
               gap = garment - body + stretch allowance (flat 2 inches for Low stretch, a percentage of the
               garment's own measurement for Medium and High stretch)
               Tight below 0, Fitted 0 to 1.5, Regular 1.5 to 4, Loose 4 and above.

    "range"    The chart lists, for each size, the body range it is made for (a minimum and a maximum).
               body inside the range  -> "Your size"
               body above the maximum -> "Runs small"  (by how many inches)
               body below the minimum -> "Runs big"    (by how many inches)

    "tofit"    The chart lists ONE body measurement per size ("to fit a bust of 34"). Each size is taken to cover
               the bodies halfway to its neighbours, then it is handled as a "range" chart.

  A chart row is a plain object:
    { size:'M', bust:'35.5', bustMax:'38.5', waist:'29', waistMax:'32.5', hip:'', hipMax:'', length:'24', hem:'', sleeve:'', inseam:'' }
  In a range chart "bust" is the minimum and "bustMax" is the maximum.
  In a garment chart only "bust" is used. Numbers are typed in the chart's own unit (gar.unit is "in" or "cm").
*/
FitRoom.Fit = (function () {
  const { num, fmt, toInches, fromInches, joinList, capitalise } = FitRoom.Util;

  const ZONE_NAME = { bust: 'Bust', waist: 'Waist', hip: 'Hip' };
  const LABEL = { tight: 'Tight', fit: 'Fitted', reg: 'Regular', loose: 'Loose' };
  const ORDER = ['tight', 'fit', 'reg', 'loose'];          // from snug to roomy

  // Which columns each garment type has in its chart.
  const COLUMNS = {
    top:   ['bust', 'waist', 'hip', 'length', 'hem', 'sleeve'],
    dress: ['bust', 'waist', 'hip', 'length', 'hem', 'sleeve'],
    pants: ['waist', 'hip', 'inseam']
  };
  // hem = the distance all the way round the bottom edge of the garment. The fit rules do not use it; the garment photo on the
  // figure does (it sets how wide the bottom edge is drawn).
  const COLUMN_LABEL = { bust: 'Bust', waist: 'Waist', hip: 'Hip', length: 'Length', hem: 'Hem', sleeve: 'Sleeve', inseam: 'Inseam' };

  // allow: the flat stretch allowance in inches (Low stretch, and the waist of an elastic-waist garment).
  // allowMedium / allowHigh: percent of the garment's own measurement that Medium and High stretch fabric gives.
  // Both percentages are starting guesses: High comes from one garment (a slim ribbed tank top whose size M fits)
  // and Medium is a plain guess. Tune them with the test log.
  const DEFAULT_RULES = { allow: 2, allowMedium: 10, allowHigh: 18, fitted: 0, regular: 1.5, loose: 4 };

  // A tube top's top edge sits about this far above the bust line (roughly at the underarm). Change it here if tests show otherwise.
  const TOP_EDGE_ABOVE_BUST = 2;

  const EPS = 0.001;   // ignore differences smaller than 0.001 inch (cm to inch rounding)

  function zonesFor(type) {
    return type === 'pants' ? ['waist', 'hip'] : ['bust', 'waist', 'hip'];
  }

  // A blank chart row, as described at the top of this file.
  function blankRow(size) {
    return {
      size: size || '',
      bust: '', bustMax: '', waist: '', waistMax: '', hip: '', hipMax: '',
      length: '', hem: '', sleeve: '', inseam: ''
    };
  }

  // ---------- reading chart cells ----------

  // One chart cell as inches, or null when it is empty.
  function cell(row, key, gar) {
    const v = num(row[key]);
    return v === null ? null : toInches(v, gar.unit);
  }

  // The min and max of a zone as inches: { lo, hi }, or null when the chart does not list the zone.
  // If only one of the two is typed, it is used for both. If they are typed the wrong way round, they are swapped.
  function rangeCell(row, zone, gar) {
    const a = cell(row, zone, gar), b = cell(row, zone + 'Max', gar);
    if (a === null && b === null) return null;
    const x = a === null ? b : a, y = b === null ? a : b;
    return { lo: Math.min(x, y), hi: Math.max(x, y) };
  }

  // How far down from the high point of the shoulder a zone is (inches).
  function zoneDrop(zone, g) {
    return zone === 'bust' ? g.bustD : zone === 'waist' ? g.waistD : g.hipD;
  }

  // Does the garment reach this zone? A crop top that ends above the hip does not,
  // so the hip is ignored for it. Pants always cover waist and hip.
  function reaches(zone, row, g, gar) {
    if (gar.type === 'pants') return true;
    const length = cell(row, 'length', gar);
    return length === null || lengthStart(g, gar) + length >= zoneDrop(zone, g);
  }

  // How far below the high point of the shoulder the length starts counting: 0 normally; for a tube top or strapless
  // top (gar.lengthFrom === 'top-edge') it starts at the top edge, a little above the bust line.
  function lengthStart(g, gar) {
    return gar.lengthFrom === 'top-edge' ? Math.max(g.bustD - TOP_EDGE_ABOVE_BUST, 0) : 0;
  }

  // Same question for the whole garment, using the longest length in the chart.
  // Range charts compare zones across sizes, so every size must count the same zones.
  // (Otherwise a top that is 24 in long in S but 24.5 in long in M would count the hip for M only.)
  function reachesGarment(zone, g, gar) {
    if (gar.type === 'pants') return true;
    let longest = null;
    gar.rows.forEach(r => {
      const length = cell(r, 'length', gar);
      if (length !== null && (longest === null || length > longest)) longest = length;
    });
    return longest === null || lengthStart(g, gar) + longest >= zoneDrop(zone, g);
  }

  // ---------- garment charts ----------

  function classifyGap(gap, rules) {
    if (gap < rules.fitted) return { cls: 'tight', label: 'Tight' };
    if (gap < rules.regular) return { cls: 'fit', label: 'Fitted' };
    if (gap < rules.loose) return { cls: 'reg', label: 'Regular' };
    return { cls: 'loose', label: 'Loose' };
  }

  // How many inches the fabric can give in this zone (the "stretch allowance"). Returns { inches, pct }.
  //   'stretch'       every zone gives (stretchy knit, stretch denim). How much depends on gar.stretchLevel:
  //                     'low' (or not set)  a flat rules.allow inches (pct is null)
  //                     'medium' / 'high'   a percentage of the garment's own measurement in this zone
  //   'elastic-waist' only the waist gives, a flat rules.allow (drawstring or elastic waistband, hips and legs do not stretch)
  //   'none'          nothing gives
  // garmentIn = the garment's measurement in this zone, in inches.
  function allowanceFor(zone, gar, rules, garmentIn) {
    if (gar.fabric === 'elastic-waist' && zone === 'waist') return { inches: rules.allow, pct: null };
    if (gar.fabric !== 'stretch') return { inches: 0, pct: null };
    const pct = gar.stretchLevel === 'high' ? rules.allowHigh : gar.stretchLevel === 'medium' ? rules.allowMedium : null;
    if (pct === null || pct === undefined) return { inches: rules.allow, pct: null };
    return { inches: garmentIn * pct / 100, pct: pct };
  }

  function emptyRowResult(row, mode) {
    return { size: row.size || '?', mode: mode, zones: {}, count: 0, tight: 0, loose: 0, small: 0, big: 0, inRange: 0 };
  }

  function analyseGarmentRow(row, body, g, gar, rules) {
    const out = emptyRowResult(row, 'garment');
    zonesFor(gar.type).forEach(z => {
      const gv = cell(row, z, gar), bv = body[z];
      if (gv === null || bv === null || bv === undefined) { out.zones[z] = null; return; }
      const covered = reaches(z, row, g, gar);
      const phys = gv - bv;
      const a = allowanceFor(z, gar, rules, gv);
      const allow = a.inches;
      const gap = phys + allow;                        // room the body has inside the garment
      const c = classifyGap(gap, rules);
      out.zones[z] = { z, mode: 'garment', gv, bv, phys, allow, allowPct: a.pct, allowWhy: gar.fabric, gap, cls: c.cls, label: c.label, covered };
      if (covered) {
        out.count++;
        if (c.cls === 'tight') out.tight++;
        if (c.cls === 'loose') out.loose++;
      }
    });
    return out;
  }

  // ---------- range charts ----------

  function analyseRangeRow(row, body, g, gar) {
    const out = emptyRowResult(row, 'range');
    zonesFor(gar.type).forEach(z => {
      const range = rangeCell(row, z, gar), bv = body[z];
      if (!range || bv === null || bv === undefined) { out.zones[z] = null; return; }
      const covered = reachesGarment(z, g, gar);

      let status = 'in', by = 0, cls = 'fit', label = 'Your size';
      if (bv > range.hi + EPS) { status = 'small'; by = bv - range.hi; cls = 'tight'; label = 'Runs small'; }
      else if (bv < range.lo - EPS) { status = 'big'; by = range.lo - bv; cls = 'loose'; label = 'Runs big'; }

      // gap: spare room, the same meaning as in a garment chart. Negative = the size is too small here.
      const gap = status === 'small' ? -by : by;
      out.zones[z] = { z, mode: 'range', lo: range.lo, hi: range.hi, nominal: cell(row, z + 'Fit', gar), bv, status, by, gap, cls, label, covered, unit: gar.unit };
      if (covered) {
        out.count++;
        if (status === 'in') out.inRange++;
        if (status === 'small') out.small++;
        if (status === 'big') out.big++;
      }
    });
    return out;
  }

  /*
    Pick a size from a range chart.

    CLOSEST FIT FIRST. A size is "acceptable" if it misses the body by half an inch or less in every zone: a miss that
    small is inside normal tape-measure error (see RANGE_CLOSE_CALL).
      - Of the acceptable sizes, the one with the smallest total miss wins.
      - If two or more are about equally close (within NEARLY_EQUAL), the fabric decides: a stretchy fabric takes the
        smaller size (comfortable, and a bigger size can slip or gape), anything else takes the larger (the safer one).
        A short "Close call" note says so.

    NOTHING ACCEPTABLE (every size misses somewhere by more than half an inch), so use the older rules:
    1. For every zone, work out which size(s) it belongs to:
         - the sizes whose range contains the body, or
         - if no range contains it (the body is in the gap between two sizes), the next size up.
         - below the smallest range counts for the smallest size, above the largest for the largest.
    2. The size that gets the most zones wins. On a tie, the larger size wins (the smaller if the fabric stretches).
    3. If the winner runs small in some zone by MORE than half an inch, the garment would be tight there,
       so go up one size and say which zone caused it. (Only one size up, to stay predictable.)
    4. Show a note naming the zones: "Between sizes", or "Outside the chart" if the body is past either end.

    Sizes must be listed from smallest to largest in the chart.
  */
  function predictFromRanges(gar, results) {
    const sizeName = i => gar.rows[i].size || ('row ' + (i + 1));
    const hits = results.map(() => 0);
    const info = {};                                   // per zone: where the body falls

    zonesFor(gar.type).forEach(z => {
      const comparable = [];                           // rows that list this zone and cover it
      results.forEach((r, i) => { if (r.zones[z] && r.zones[z].covered) comparable.push(i); });
      if (!comparable.length) return;                  // nobody lists it: ignore the zone

      const bv = results[comparable[0]].zones[z].bv;
      const fits = comparable.filter(i => results[i].zones[z].status === 'in');
      const firstAbove = comparable.find(i => results[i].zones[z].lo > bv);   // first size that starts above the body
      const lastRow = comparable[comparable.length - 1];
      const assigned = fits.length ? fits : [firstAbove !== undefined ? firstAbove : lastRow];
      assigned.forEach(i => { hits[i]++; });
      info[z] = { comparable, fits, firstAbove };
    });

    const zoneList = Object.keys(info);
    if (!zoneList.length) return { idx: -1, note: null };

    // How far does a size miss this body? Each entry is one zone that is outside the size's range.
    const missesOf = i => zoneList.filter(z => results[i].zones[z] && results[i].zones[z].covered && results[i].zones[z].status !== 'in')
      .map(z => ({ z: z, by: results[i].zones[z].by }));
    const totalMiss = i => missesOf(i).reduce((sum, m) => sum + m.by, 0);
    const worstMiss = i => Math.max.apply(null, [0].concat(missesOf(i).map(m => m.by)));
    const stretchy = gar.fabric === 'stretch';

    // CLOSEST FIT FIRST: sizes that miss by half an inch or less everywhere are all acceptable. The closest wins.
    const acceptable = results.map((r, i) => i).filter(i => results[i].count > 0 && worstMiss(i) <= RANGE_CLOSE_CALL + EPS);
    if (acceptable.length) {
      const best = Math.min.apply(null, acceptable.map(totalMiss));
      const candidates = acceptable.filter(i => totalMiss(i) < best + NEARLY_EQUAL - EPS);          // equally close; in chart order, smallest first
      if (candidates.length === 1) return { idx: candidates[0], note: null };
      // Two or more fit about equally well: the fabric decides.
      const chosen = stretchy ? candidates[0] : candidates[candidates.length - 1];
      const missText = i => sizeName(i) + ' misses by ' + joinList(missesOf(i).map(m => fmt(m.by) + ' in at the ' + ZONE_NAME[m.z].toLowerCase()));
      const told = candidates.filter(i => missesOf(i).length).map(missText);
      const why = stretchy ? 'the fabric stretches, so the smaller size is comfortable.' : 'the fabric does not stretch, so the larger size is the safer one.';
      return { idx: chosen, note: { title: 'Close call', zones: zoneList.filter(z => candidates.some(i => results[i].zones[z] && results[i].zones[z].status !== 'in')),
        text: 'Between ' + joinList(candidates.map(sizeName)) + ': ' + (told.length ? told.join(' and ') + '. That is close to normal measuring error, so either should fit.' : 'the body fits each of them equally well.') +
          ' Going with ' + sizeName(chosen) + ': ' + why } };
    }

    // NOTHING ACCEPTABLE: the older rules. Step 2: most zones wins; on a tie the larger size (the smaller if the fabric stretches).
    const mostZones = Math.max.apply(null, hits);
    let pick = stretchy ? hits.indexOf(mostZones) : hits.lastIndexOf(mostZones);

    // Step 3: if that size runs small somewhere, go up one size.
    const smallZones = zoneList.filter(z => {
      const zr = results[pick].zones[z];
      return zr && zr.covered && zr.status === 'small' && zr.by > RANGE_CLOSE_CALL + EPS;   // a hair too small is not worth a size
    });
    let wentUpFrom = null;
    if (smallZones.length) {
      const next = results.findIndex((r, i) => i > pick && r.count > 0);
      if (next >= 0) { wentUpFrom = pick; pick = next; }
    }

    // Step 4: the note.
    const off = zoneList.filter(z => info[z].fits.indexOf(pick) < 0);   // zones that are not inside the final size
    if (!off.length && wentUpFrom === null) return { idx: pick, note: null };

    // Where does the body fall for one zone? e.g. "fits M", "falls between S and M"
    const where = z => {
      const f = info[z].fits, comp = info[z].comparable, above = info[z].firstAbove;
      if (f.length) return 'fits ' + joinList(f.map(sizeName));
      if (above === undefined) return 'is over the largest size (' + sizeName(comp[comp.length - 1]) + ')';
      if (above === comp[0]) return 'is under the smallest size (' + sizeName(comp[0]) + ')';
      return 'falls between ' + sizeName(comp[comp.indexOf(above) - 1]) + ' and ' + sizeName(above);
    };
    const beyondEnds = z => info[z].fits.length === 0 && (info[z].firstAbove === undefined || info[z].firstAbove === info[z].comparable[0]);

    // The zones that caused it come first, then the other zones that are not in the final size.
    const listed = smallZones.concat(off.filter(z => smallZones.indexOf(z) < 0));

    // For a zone that sits in another size, also say how far off it is in the size we picked ("in L it runs big by 0.33 in"),
    // so a miss of a third of an inch is not mistaken for a big disagreement.
    const howFar = z => {
      const zr = results[pick].zones[z];
      return info[z].fits.length && zr && zr.status !== 'in' ? ' (in ' + sizeName(pick) + ' it runs ' + (zr.status === 'big' ? 'big' : 'small') + ' by ' + fmt(zr.by) + ' in)' : '';
    };
    const clauses = listed.map(z => ZONE_NAME[z].toLowerCase() + ' ' + where(z) + howFar(z));
    let title, ending;

    if (wentUpFrom !== null) {
      title = 'Between sizes';
      const causes = joinList(smallZones.map(z => ZONE_NAME[z].toLowerCase()));
      const by = smallZones.map(z => fmt(results[wentUpFrom].zones[z].by) + ' in').join(', ');
      ending = capitalise(causes) + ' runs small in ' + sizeName(wentUpFrom) + ' (by ' + by + '), so ' + sizeName(pick) + ', the larger size, is predicted.';
    } else if (listed.every(beyondEnds)) {
      // Every zone is past one end of the chart: say it once per direction instead of once per zone.
      title = 'Outside the chart';
      const under = listed.filter(z => info[z].firstAbove !== undefined);
      const over = listed.filter(z => info[z].firstAbove === undefined);
      const names = zs => joinList(zs.map(z => ZONE_NAME[z].toLowerCase()));
      const parts = [];
      if (under.length) parts.push(names(under) + (under.length > 1 ? ' are' : ' is') + ' under the smallest size (' + sizeName(info[under[0]].comparable[0]) + ')');
      if (over.length) parts.push(names(over) + (over.length > 1 ? ' are' : ' is') + ' over the largest size (' + sizeName(info[over[0]].comparable[info[over[0]].comparable.length - 1]) + ')');
      return { idx: pick, note: { title: title, text: capitalise(parts.join(', ')) + '. ' + sizeName(pick) + ' is the closest size.', zones: listed } };
    } else {
      title = 'Between sizes';
      // Some zones fit a BIGGER size but miss ours by a hair (so we did not size up): say we are keeping ours.
      const pointsUp = off.some(z => info[z].fits.length && info[z].fits.every(i => i > pick));
      ending = pointsUp ? 'Going with ' + sizeName(pick) + ', which fits the most measurements.' : 'Going with ' + sizeName(pick) + ', the larger size.';
    }

    return { idx: pick, note: { title: title, text: capitalise(clauses.join(', ')) + '. ' + ending, zones: listed } };
  }

  /*
    A "to fit" chart gives ONE body number per size: "size M is made to fit a bust of 34". It is not a range and it is
    not a garment measurement. We turn it into a range chart: each size covers the bodies from halfway down to the
    size below, up to halfway to the size above. Sizes 32 and 34 meet at 33, and a body of exactly 33 goes to the
    larger size (the same tie rule as every range chart). The first and last size reach as far out as their gap.

    Your typed numbers are not changed: the converted chart is a copy. Each converted cell keeps the number the
    brand gave in "<zone>Fit" so the result can say "made to fit 34 in".
  */
  function toFitToRanges(gar) {
    const rows = gar.rows.map(r => Object.assign({}, r));
    zonesFor(gar.type).forEach(z => {
      const listed = [];                                         // the sizes that give a number for this zone
      rows.forEach((r, i) => { const v = num(r[z]); if (v !== null) listed.push({ i: i, v: v }); });
      listed.forEach((item, k) => {
        const below = k > 0 ? listed[k - 1].v : null;
        const above = k < listed.length - 1 ? listed[k + 1].v : null;
        const lo = below !== null ? (below + item.v) / 2 : (above !== null ? item.v - (above - item.v) / 2 : item.v);
        const hi = above !== null ? (item.v + above) / 2 : (below !== null ? item.v + (item.v - below) / 2 : item.v);
        const r = rows[item.i];
        r[z + 'Fit'] = r[z];
        r[z] = fmt(lo);
        r[z + 'Max'] = fmt(hi);
      });
    });
    return Object.assign({}, gar, { chartType: 'range', rows: rows });
  }

  // ---------- one entry point for both kinds of chart ----------

  /*
    Analyse a whole chart for one body.
    Returns { rows: [result per size], idx: predicted row (-1 for none), note, noneFits }
  */
  function analyseAll(body, g, gar, rules) {
    if (gar.chartType === 'tofit') gar = toFitToRanges(gar);      // then it is handled exactly like a range chart
    if (gar.chartType === 'range') {
      const rows = gar.rows.map(r => analyseRangeRow(r, body, g, gar));
      const p = predictFromRanges(gar, rows);
      return { rows: rows, idx: p.idx, note: p.note, noneFits: false };
    }

    const rows = gar.rows.map(r => analyseGarmentRow(r, body, g, gar, rules));
    const have = [];
    rows.forEach((r, i) => { if (r.count > 0) have.push(i); });
    let idx = -1;
    if (have.length) {
      // Smallest size with no tight zone. If every size is tight somewhere, the largest.
      const ok = have.filter(i => rows[i].tight === 0)[0];
      idx = ok !== undefined ? ok : have[have.length - 1];
    }
    const noneFits = idx >= 0 && rows[idx].tight > 0;
    return { rows: rows, idx: idx, note: noneFits ? null : closeCallNote(gar, rows, have, idx), noneFits: noneFits };
  }

  // "Tight" starts at a hard line (room below 0). A size that misses it by a hair is skipped, even though the
  // difference is within normal tape-measure error. So when the size just below the pick was skipped by no more
  // than CLOSE_CALL inches in every tight zone, say so instead of hiding it.
  const CLOSE_CALL = 1;

  // The same idea for range and "to fit" charts, but smaller, because their ranges are only a couple of inches wide.
  // A miss of this many inches or less is inside normal tape-measure error.
  const RANGE_CLOSE_CALL = 0.5;

  // Two sizes whose total misses differ by no more than this are "equally close", so the fabric decides between them.
  const NEARLY_EQUAL = 0.1;

  function closeCallNote(gar, rows, have, idx) {
    const below = have.filter(i => i < idx).pop();                  // the next size down
    if (below === undefined) return null;
    const tightZones = Object.keys(rows[below].zones).map(k => rows[below].zones[k]).filter(z => z && z.covered && z.cls === 'tight');
    if (!tightZones.length || tightZones.some(z => z.gap < -CLOSE_CALL - EPS)) return null;     // clearly too small: no close call
    const name = i => gar.rows[i].size || ('row ' + (i + 1));
    const shortBy = joinList(tightZones.map(z => 'its ' + ZONE_NAME[z.z].toLowerCase() + ' is ' + fmt(-z.gap) + ' in short'));
    return { title: 'Close call', zones: tightZones.map(z => z.z),
      text: name(below) + ' was skipped, but only just: ' + shortBy + '. That is close to normal measuring error, so ' + name(below) +
        ' may fit too, especially if the fabric gives. ' + name(idx) + ' is the safer choice.' };
  }

  // The coloured pill for a whole size.
  function verdict(r) {
    if (!r || !r.count) return { cls: 'none', text: 'No zone to check' };
    if (r.mode === 'range') {
      if (r.inRange === r.count) return { cls: 'fit', text: 'Your size' };
      if (r.small) return { cls: 'tight', text: 'Runs small' };
      return { cls: 'loose', text: 'Runs big' };
    }
    if (r.tight) return { cls: 'tight', text: 'Too tight, skip' };
    if (r.loose === r.count) return { cls: 'loose', text: 'Roomy' };
    if (r.loose) return { cls: 'reg', text: 'Good fit, loose in places' };
    return { cls: 'fit', text: 'Good fit' };
  }

  // ---------- words for the results ----------

  function gapText(gap) {
    return gap >= 0 ? fmt(gap) + ' in of room' : fmt(-gap) + ' in short';
  }

  // The short second line under a zone name, e.g. "1.5 in of room" or "by 1.5 in".
  function zoneDetail(z) {
    if (z.mode === 'range') return z.status === 'in' ? 'inside the range' : 'by ' + fmt(z.by) + ' in';
    return gapText(z.gap);
  }

  // "garment 38, plus 2 stretch, minus body 36"  /  "range 35.5 to 38.5 in, body 36 in"
  // For a chart typed in cm the range is also shown the way it was typed: "(90.17 to 97.79 cm)".
  function formula(z) {
    if (z.mode === 'range') {
      const typed = z.unit === 'cm' ? ' (' + fmt(fromInches(z.lo, 'cm')) + ' to ' + fmt(fromInches(z.hi, 'cm')) + ' cm)' : '';
      if (z.nominal !== null && z.nominal !== undefined) {         // made from a "to fit" chart
        return 'size made to fit ' + fmt(z.nominal) + ' in, so it covers ' + fmt(z.lo) + ' to ' + fmt(z.hi) + ' in (halfway to the neighbouring sizes), body ' + fmt(z.bv) + ' in';
      }
      return 'range ' + fmt(z.lo) + ' to ' + fmt(z.hi) + ' in' + typed + ', body ' + fmt(z.bv) + ' in';
    }
    const why = z.allowWhy === 'elastic-waist' ? ' for the elastic waist' : z.allowPct ? ' stretch (' + fmt(z.allowPct) + '% of the garment)' : ' stretch';
    return 'garment ' + fmt(z.gv) + (z.allow ? ' plus ' + fmt(z.allow) + why : '') + ', minus body ' + fmt(z.bv);
  }

  // A one-line summary of a result row: "bust 1.5 in of room, waist 0.5 in short"
  function zoneSentence(r) {
    return Object.keys(r.zones).map(k => {
      const z = r.zones[k];
      if (!z || !z.covered) return null;
      const text = z.mode === 'range'
        ? (z.status === 'in' ? 'in range' : 'runs ' + (z.status === 'small' ? 'small' : 'big') + ' by ' + fmt(z.by) + ' in')
        : gapText(z.gap);
      return ZONE_NAME[k].toLowerCase() + ' ' + text;
    }).filter(Boolean).join(', ');
  }

  // ---------- hem and sleeve ----------

  // Describe where a garment length (inches down from the high point of the shoulder) lands on the body.
  function describeDrop(D, g) {
    const marks = [
      ['bust line', 'bust', g.bustD], ['natural waist', 'waist', g.waistD], ['hip line', 'hip', g.hipD],
      ['mid thigh', 'mid thigh', g.thighD], ['knee', 'knee', g.kneeD], ['mid calf', 'mid calf', g.calfD], ['ankle', 'ankle', g.ankleD]
    ];
    // "refs" = which of the lines you can mark on the scan (bust, waist, hip) the sentence compares with.
    // If one of those is not marked yet, the sentence rests on a guess, and the page says so.
    const refOf = m => ({ 'bust line': 'bust', 'natural waist': 'waist', 'hip line': 'hip' })[m[0]];
    if (D >= g.hps - 0.3) return { text: 'reaches the floor', short: 'at the floor', refs: [] };
    let best = marks[0], bestDist = 1e9;
    marks.forEach(m => { const d = Math.abs(D - m[2]); if (d < bestDist) { bestDist = d; best = m; } });
    if (bestDist <= 0.8) return { text: 'right at your ' + best[0], short: 'at ' + best[1], refs: [refOf(best)].filter(Boolean) };
    if (D < marks[0][2]) return { text: fmt(marks[0][2] - D) + ' in above your bust line', short: 'above bust', refs: ['bust'] };
    let prev = null, next = null;
    marks.forEach(m => { if (m[2] <= D) prev = m; else if (!next) next = m; });
    let text = fmt(D - prev[2]) + ' in below your ' + prev[0];
    if (next) text += ', ' + fmt(next[2] - D) + ' in above your ' + next[0];
    // The short label names whichever body line is closer: "1.2 in above waist" reads better than "3 in below bust".
    const short = next && (next[2] - D) < (D - prev[2]) ? fmt(next[2] - D) + ' in above ' + next[1] : fmt(D - prev[2]) + ' in below ' + prev[1];
    return { text: text, short: short, refs: [prev, next].filter(Boolean).map(refOf).filter(Boolean) };
  }

  // Where the hem lands. height = inches above the floor.
  // The hem adjustment you set for the garment, in inches. Positive = the real hem sits higher on you
  // (nearer your head) than the chart length suggests, negative = lower (nearer your feet).
  // gar.hemAmount is typed in the chart's unit; gar.hemDir is 'up' (higher) or 'down' (lower).
  function hemShift(gar) {
    const typed = num(gar.hemAmount);
    if (typed === null || typed === 0) return 0;
    const inches = toInches(Math.abs(typed), gar.unit);
    return gar.hemDir === 'down' ? -inches : inches;
  }

  function hemInfo(row, g, gar, body) {
    const shift = hemShift(gar);
    if (gar.type === 'pants') {
      const garmentInseam = cell(row, 'inseam', gar);
      if (garmentInseam === null || body.inseam == null) return null;
      const h = body.inseam - garmentInseam + shift;
      let t;
      if (h < -0.2) t = fmt(-h) + ' in longer than your inseam, so it pools at the shoe';
      else if (h < 0.6) t = 'reaches the floor and drags in flat shoes';
      else if (h < 2) t = 'sits just above the floor and covers the ankle bone';
      else if (h < 3.6) t = 'ends at the ankle bone';
      else if (h < 9) t = 'is cropped, ' + fmt(h) + ' in above the floor, and shows the ankle';
      else if (h < 15) t = 'ends around mid calf';
      else t = 'ends above the calf';
      return { height: Math.max(h, 0), text: 'Hem ' + t, short: fmt(Math.max(h, 0)) + ' in from floor', refs: [], fromShoulder: false, shift: shift };
    }
    const chartLength = cell(row, 'length', gar);
    if (chartLength === null) return null;
    // Where the length starts counting. Normally at the high point of the shoulder. A tube top, strapless or bandeau
    // has no shoulder: its length runs from its TOP EDGE, which sits about TOP_EDGE_ABOVE_BUST inches above the bust line.
    const fromTopEdge = gar.lengthFrom === 'top-edge';
    const startDrop = lengthStart(g, gar);
    // A hem that sits higher is a shorter length.
    const D = Math.max(startDrop + chartLength - shift, 0);
    const d = describeDrop(D, g);
    // fromShoulder: the hem height depends on where the shoulder is. From the top edge it depends on the bust line instead.
    const refs = fromTopEdge && d.refs.indexOf('bust') < 0 ? d.refs.concat('bust') : d.refs;
    return { height: g.hps - D, top: g.hps - startDrop, drop: D, text: 'Hem lands ' + d.text, short: d.short, refs: refs, fromShoulder: !fromTopEdge, fromTopEdge: fromTopEdge, shift: shift };
  }

  // Where the cuff lands. len = sleeve length in inches from the shoulder tip.
  function sleeveInfo(row, g, gar) {
    if (gar.type === 'pants') return null;
    const L = cell(row, 'sleeve', gar);
    if (L === null) return null;
    const marks = [
      ['shoulder edge', 'shoulder', 0], ['mid upper arm', 'mid upper arm', g.elbow / 2], ['elbow', 'elbow', g.elbow],
      ['mid forearm', 'mid forearm', (g.elbow + g.arm) / 2], ['wrist bone', 'wrist', g.arm]
    ];
    let best = marks[0], bestDist = 1e9;
    marks.forEach(m => { const d = Math.abs(L - m[2]); if (d < bestDist) { bestDist = d; best = m; } });
    let t;
    if (bestDist <= 0.8) t = 'ends right at your ' + best[0];
    else if (L > g.arm) t = 'ends ' + fmt(L - g.arm) + ' in past your wrist bone, over the back of the hand';
    else {
      let prev = null, next = null;
      marks.forEach(m => { if (m[2] <= L) prev = m; else if (!next) next = m; });
      t = 'ends ' + fmt(L - prev[2]) + ' in past your ' + prev[0] + (next ? ', ' + fmt(next[2] - L) + ' in short of your ' + next[0] : '');
    }
    return { len: L, text: 'Sleeve ' + t, short: L > g.arm ? fmt(L - g.arm) + ' in past wrist' : 'at ' + best[1] };
  }

  return {
    ZONE_NAME, LABEL, ORDER, COLUMNS, COLUMN_LABEL, DEFAULT_RULES,
    zonesFor, blankRow, cell, rangeCell, classifyGap,
    analyseAll, verdict, gapText, zoneDetail, formula, zoneSentence,
    hemInfo, hemShift, sleeveInfo, describeDrop
  };
})();

if (typeof module !== 'undefined') module.exports = FitRoom.Fit;
