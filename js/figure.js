/*
  figure.js — draws the front view: the tape ruler, the person's scan picture, and the
  zone bands, hem line and sleeve marker on top of it.

  The picture is shown exactly as stored (no cutting out, no recolouring). It is only scaled,
  so that the head top sits at the entered height and the floor mark sits on the floor of the tape.

  The page has one <svg id="fig"> with four layers, bottom to top:
    #fig-ruler    the yellow tape
    #fig-img      the scan picture (kept between redraws so it does not flicker)
    #fig-garment  the garment's own photo, cut out and stretched to the chart (only when one was added; see garmentimage.js)
    #fig-lines    floor line, zone bands, hem line, sleeve marker, labels (redrawn each time)
*/
FitRoom.Figure = (function () {
  const { esc, fmt } = FitRoom.Util;
  const Fit = FitRoom.Fit;
  const Geometry = FitRoom.Geometry;

  const S = 7.8;          // drawing units per inch
  const FLOOR = 640;      // y of the floor line
  const CX = 336;         // x of the body's centre line
  const WIDTH = 640;      // width of the drawing
  const TAG_W = 128, TAG_H = 34;
  const LEFT_EDGE = 176, RIGHT_EDGE = 496;   // where the label tags sit (right edge of the left tags, left edge of the right tags)

  const X = inches => CX + S * inches;        // inches right of the centre line -> x
  const Y = height => FLOOR - S * height;     // inches above the floor -> y
  const f = n => n.toFixed(1);

  // ---------- pieces ----------

  // The yellow tape with a tick for every inch and a number at every 12.
  function tape(H) {
    const top = Y(H);
    let s = '<rect x="8" y="' + f(top) + '" width="14" height="' + f(FLOOR - top) + '" rx="2" fill="var(--tape)"/>';
    for (let h = 0; h <= Math.floor(H); h++) {
      const len = h % 12 === 0 ? 14 : h % 6 === 0 ? 9 : 5;
      s += '<line x1="8" x2="' + (8 + len) + '" y1="' + f(Y(h)) + '" y2="' + f(Y(h)) + '" stroke="var(--tape-ink)" stroke-width="1"/>';
      if (h % 12 === 0) s += '<text class="fig-t" x="27" y="' + f(Y(h) + 4) + '" style="font-size:10.5px;fill:var(--ink2)">' + h + '</text>';
    }
    return s;
  }

  // A text tag with a leader line to the point it describes. side is 'left' or 'right'.
  // it.l3 is an optional third line, used to say "estimated" when the lines it depends on are guesses.
  function tag(side, it) {
    const x = side === 'left' ? LEFT_EDGE - TAG_W : RIGHT_EDGE;
    const lineFrom = side === 'left' ? x + TAG_W : x;
    const cls = it.cls ? ' class="z-' + it.cls + '"' : '';
    const height = it.l3 ? TAG_H + 14 : TAG_H;
    const top = it.ly - 17;                                   // the tag hangs from this line; text lines sit 14 px apart
    return '<path d="M' + f(lineFrom) + ',' + f(it.ly) + ' L' + f(it.ax) + ',' + f(it.y) + '" stroke="var(--ink)" stroke-opacity=".55" stroke-width="1" fill="none"/>' +
      '<circle cx="' + f(it.ax) + '" cy="' + f(it.y) + '" r="2.8" fill="var(--ink)" stroke="var(--surface)" stroke-width="1"/>' +
      '<rect x="' + f(x) + '" y="' + f(top) + '" width="' + TAG_W + '" height="' + height + '" rx="6" fill="var(--surface)" fill-opacity=".94" stroke="' + (it.l3 ? 'var(--warn)' : 'var(--line)') + '"/>' +
      '<text class="fig-t" x="' + f(x + 8) + '" y="' + f(top + 14) + '" style="font-weight:600;font-size:11px"><tspan' + cls + '>' + esc(it.l1) + '</tspan></text>' +
      '<text class="fig-t" x="' + f(x + 8) + '" y="' + f(top + 28) + '" style="fill:var(--ink2);font-size:10.5px">' + esc(it.l2) + '</text>' +
      (it.l3 ? '<text class="fig-t" x="' + f(x + 8) + '" y="' + f(top + 42) + '" style="fill:var(--warn);font-weight:600;font-size:10.5px">' + esc(it.l3) + '</text>' : '');
  }

  // Keep tags from sitting on top of each other: push each one down until it has room.
  function spread(items) {
    items.sort((a, b) => a.y - b.y);
    items.forEach((it, i) => {
      it.ly = it.y;
      const room = (items[i - 1] && items[i - 1].l3 ? TAG_H + 14 : TAG_H) + 6;     // a taller tag above needs more room
      if (i && it.ly < items[i - 1].ly + room) it.ly = items[i - 1].ly + room;
    });
  }

  // A line with a light line underneath so it stays readable on the grey picture.
  function strongLine(x1, y1, x2, y2, dashed) {
    return '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '" stroke="var(--surface)" stroke-opacity=".75" stroke-width="5" stroke-linecap="round"/>' +
      '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '" stroke="var(--ink)" stroke-width="2"' + (dashed ? ' stroke-dasharray="5 3"' : '') + ' stroke-linecap="round"/>';
  }

  // Where the cuff lands, in inches: from the shoulder tip, along the line to the wrist, sleeve-length inches.
  // A sleeve longer than the arm carries on past the wrist in the same direction.
  function cuffPoint(g, sleeveLength) {
    const dx = g.wrist.x - g.tip.x, dh = g.wrist.h - g.tip.h, len = Math.hypot(dx, dh) || 1;
    return { x: g.tip.x + dx / len * sleeveLength, h: g.tip.h + dh / len * sleeveLength, ux: dx / len, uh: dh / len };
  }

  // ---------- the lines drawn over the picture ----------

  function linesLayer(c) {
    const g = c.geo, rres = c.rres, out = [];
    const left = [], right = [];

    // floor line and the line at the entered height, so you can see the picture was scaled to them
    out.push('<line x1="40" x2="' + (WIDTH - 12) + '" y1="' + FLOOR + '" y2="' + FLOOR + '" stroke="var(--ink)" stroke-opacity=".55" stroke-width="1.5"/>');
    out.push('<line x1="26" x2="' + (WIDTH - 12) + '" y1="' + f(Y(g.H)) + '" y2="' + f(Y(g.H)) + '" stroke="var(--ink)" stroke-opacity=".55" stroke-width="1" stroke-dasharray="2 4"/>');
    out.push('<text class="fig-t fig-h" x="' + (WIDTH - 14) + '" y="' + f(Y(g.H) - 5) + '" text-anchor="end" style="font-size:11px">Height ' + fmt(g.H) + ' in' + (g.assumedH ? ' (assumed)' : '') + '</text>');

    if (!rres) return out.join('');

    // zone bars at the bust, waist and hip lines: a bar in the zone's colour that is exactly as wide as the garment is at that line.
    // With a garment photo that is how far the photo really reaches at that row. Without one it is the garment's width in the same
    // front-view terms as the body: the body's half width at that line, widened when the garment is bigger than the body.
    const zoneH = { bust: g.hps - g.bustD, waist: g.hps - g.waistD, hip: g.hps - g.hipD };
    Fit.zonesFor(c.gar.type).forEach(z => {
      const r = rres.zones[z];
      if (!r || !r.covered) return;
      const span = c.overlay && c.overlay.spans && c.overlay.spans[z];
      const hw = g.half[z] * (r.gv != null && r.bv ? Math.max(r.gv, r.bv) / r.bv : 1);
      const l = span ? span.l : -hw, rt = span ? span.r : hw;
      out.push('<rect class="z-' + r.cls + '" x="' + f(X(l)) + '" y="' + f(Y(zoneH[z]) - 5) + '" width="' + f(S * (rt - l)) + '" height="10" rx="5" fill-opacity=".92" stroke="var(--surface)" stroke-width="1.5"/>');
      right.push({ y: Y(zoneH[z]), ax: X(rt), cls: r.cls, l1: Fit.ZONE_NAME[z] + ', ' + r.label, l2: Fit.zoneDetail(r) });
    });

    // hem line
    if (c.hem) {
      const hw = Geometry.halfWidthAt(g, c.hem.height) + 1.4;
      out.push(strongLine(X(-hw), Y(c.hem.height), X(hw), Y(c.hem.height), true));
      left.push({ y: Y(c.hem.height), ax: X(-hw), l1: 'Hem, ' + fmt(c.hem.height) + ' in up', l2: c.hem.short, l3: c.hemEstimated ? 'estimated' : '' });
    }

    // sleeve marker: a dashed line along the arm to the cuff, and a tick across the arm at the cuff, on both arms
    if (c.slv) {
      const p = cuffPoint(g, c.slv.len);
      const nx = -p.uh, nh = p.ux;                       // a direction across the arm
      const across = 1.8;                                // half-length of the tick, inches
      [1, -1].forEach(side => {
        const tipX = side * g.tip.x, cx = side * p.x, nxs = side * nx;
        out.push(strongLine(X(tipX), Y(g.tip.h), X(cx), Y(p.h), true));
        out.push(strongLine(X(cx - nxs * across), Y(p.h - nh * across), X(cx + nxs * across), Y(p.h + nh * across), false));
      });
      const labelSide = p.x < 0 ? left : right;           // label on the side the arm was marked
      labelSide.push({ y: Y(p.h), ax: X(p.x), l1: 'Sleeve, ' + fmt(c.slv.len) + ' in', l2: c.slv.short, l3: c.slvEstimated ? 'estimated' : '' });
    }

    spread(left);
    spread(right);
    left.forEach(it => out.push(tag('left', it)));
    right.forEach(it => out.push(tag('right', it)));
    return out.join('');
  }

  // ---------- main entry ----------

  /*
    Draw the figure into the <svg id="fig">.
      c.geo     result of Geometry.build
      c.person  the person (for the picture)
      c.gar     the garment
      c.rres    the result row for the size being shown (or null)
      c.hem, c.slv  hem and sleeve info (or null)
      c.overlay     the garment picture to show: { src, x0, w, topH, hemH, spans } (or null). x0 = its left edge in inches right of the
                    centre line, w = its width in inches, spans = { bust: { l, r }, ... } how far left and right the garment reaches at
                    each zone line (inches from the centre line), so the zone bar can be exactly as wide as the garment there
      c.hemEstimated, c.slvEstimated  true when that line rests on a mark that has not been clicked yet
  */
  function render(svg, c) {
    const g = c.geo;
    const top = Y(Math.max(g.H, 60)) - 30;
    svg.setAttribute('viewBox', '0 ' + f(top) + ' ' + WIDTH + ' ' + f(FLOOR + 34 - top));

    svg.querySelector('#fig-ruler').innerHTML = tape(g.H);

    const img = svg.querySelector('#fig-img');
    const pic = c.person.picture;
    if (pic && g.picture) {
      if (img.getAttribute('data-src') !== pic.src) { img.setAttribute('href', pic.src); img.setAttribute('data-src', pic.src); }
      img.setAttribute('x', f(X(g.picture.x)));
      img.setAttribute('y', f(Y(g.picture.top)));
      img.setAttribute('width', f(S * g.picture.w));
      img.setAttribute('height', f(S * g.picture.h));
      img.style.display = '';
      const gi = svg.querySelector('#fig-garment');
      if (c.overlay) {                                       // from the top edge down to the hem, centred on the body's centre line
        const o = c.overlay;
        gi.setAttribute('href', o.src);
        gi.setAttribute('x', f(X(o.x0)));
        gi.setAttribute('y', f(Y(o.topH)));
        gi.setAttribute('width', f(S * o.w));
        gi.setAttribute('height', f(S * (o.topH - o.hemH)));
        gi.style.display = '';
      } else gi.style.display = 'none';
      svg.querySelector('#fig-lines').innerHTML = linesLayer(c);
    } else {
      img.style.display = 'none';
      img.removeAttribute('data-src');
      svg.querySelector('#fig-garment').style.display = 'none';
      svg.querySelector('#fig-lines').innerHTML =
        '<text class="fig-t" x="' + CX + '" y="' + f((Y(g.H) + FLOOR) / 2) + '" text-anchor="middle" style="fill:var(--ink2);font-size:13px">No scan picture for this person yet.</text>' +
        '<text class="fig-t" x="' + CX + '" y="' + f((Y(g.H) + FLOOR) / 2 + 20) + '" text-anchor="middle" style="fill:var(--ink3);font-size:12px">Add a front view picture in the Body panel.</text>' +
        '<line x1="40" x2="' + (WIDTH - 12) + '" y1="' + FLOOR + '" y2="' + FLOOR + '" stroke="var(--ink)" stroke-opacity=".55" stroke-width="1.5"/>';
    }
  }

  return { render };
})();
