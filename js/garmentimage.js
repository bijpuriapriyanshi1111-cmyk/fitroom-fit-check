/*
  garmentimage.js — the rough "put the garment picture on the figure" test.

  The idea (route 2 in the plan): take a flat photo of the garment, cut it out of its background, then stretch it
  sideways, row by row, until it is as wide as the size chart says it is at the bust, waist and hip. Put it on the
  scan at the same scale as the body, from the shoulder down to the hem.

  Two parts:
    1. Pixel functions that only work on lists of numbers (no page code), so tests can check them:
         removeBackground, crop, rowHalfWidths, planWarp, warp
       A picture is { data, w, h }, where data is the RGBA list a canvas gives (4 numbers per pixel).
    2. Small helpers that need the browser (canvas): prepare, toDataURL, decode, warpedURL.

  The wrap (what makes it look like it goes round the body instead of lying in front of it):
    - the garment's width at the bust, waist, hip (and hem) comes from the body's REAL outline in the scan, row by row, and the
      garment is centred on the body where it actually is, not on the head's centre line
    - the fabric is curved like a tube toward the sides, and a little darker there
    - the scan's own lighting is laid over the garment, so it picks up the shape of the body

  Two safety checks say when the photo is probably not "just the garment" (a person wearing it, a busy background):
    photoWarning  most of the photo was kept, so little background was removed
    shapeWarning  the photo's proportions do not match the chart, so it shows more or less than the garment

  How wide the garment is drawn, at a zone (bust, waist, hip):
    half the front-view width = the body's own front-view ratio x the larger of (garment measurement, body measurement)
  So a garment that is bigger than the body hangs wider than the body. A garment that is smaller than the body is
  drawn as wide as the body, because it has been stretched to fit (the zone colours say whether that is fine or tight).
*/
FitRoom.GarmentImage = (function () {

  const MAX_SIDE = 640;               // pictures are shrunk to this before they are cut out and saved (keeps the saved data small)
  const SOLID = 128;                  // an alpha above this counts as "garment"

  // ---------- 1. pixel functions ----------

  // The colour of the background: the middle value of the pixels along the four edges.
  function edgeColour(d, w, h) {
    const px = [];
    const add = (x, y) => { const i = (y * w + x) * 4; px.push([d[i], d[i + 1], d[i + 2]]); };
    for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
    const mid = c => { const a = px.map(p => p[c]).sort((p, q) => p - q); return a[a.length >> 1]; };
    return [mid(0), mid(1), mid(2)];
  }

  /*
    Make the background transparent. It floods in from the edges of the picture: a pixel is background if it is
    already transparent or its colour is within `tolerance` of the edge colour, and it touches the background.
    White inside the garment (a print, a white stripe) is never reached, so it stays.
    Returns the box around what is left, { x0, y0, x1, y1 } (x1 and y1 exclusive), or null if nothing is left.
  */
  function removeBackground(d, w, h, tolerance) {
    const bg = edgeColour(d, w, h);
    const tol2 = tolerance * tolerance;
    const isBg = p => {
      const i = p * 4;
      if (d[i + 3] < 16) return true;
      const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2];
      return dr * dr + dg * dg + db * db <= tol2;
    };
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let top = 0;
    const push = p => { if (!seen[p] && isBg(p)) { seen[p] = 1; stack[top++] = p; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (top) {
      const p = stack[--top], x = p % w, y = (p / w) | 0;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    for (let p = 0; p < w * h; p++) if (seen[p]) d[p * 4 + 3] = 0;

    // soften the cut edge a little: a garment pixel that touches the background becomes half see-through
    const edge = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (seen[p]) continue;
      if ((x > 0 && seen[p - 1]) || (x < w - 1 && seen[p + 1]) || (y > 0 && seen[p - w]) || (y < h - 1 && seen[p + w])) edge.push(p);
    }
    edge.forEach(p => { d[p * 4 + 3] = Math.min(d[p * 4 + 3], 150); });

    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x >= x1) x1 = x + 1; if (y < y0) y0 = y; if (y >= y1) y1 = y + 1; }
    }
    return x1 > x0 && y1 > y0 ? { x0: x0, y0: y0, x1: x1, y1: y1 } : null;
  }

  // Keep only the box. Returns a new picture.
  function crop(d, w, h, box) {
    const cw = box.x1 - box.x0, ch = box.y1 - box.y0;
    const out = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      const from = ((box.y0 + y) * w + box.x0) * 4;
      out.set(d.subarray(from, from + cw * 4), y * cw * 4);
    }
    return { data: out, w: cw, h: ch };
  }

  // For every row: how far the garment reaches from the centre line, in pixels (0 when the row is empty).
  // The measuring is done on the stretch of garment that runs through the centre line, so a gap between a sleeve and
  // the body (once the background is gone) is not counted. If the centre of the row is empty (a neckline), the whole row is used.
  function rowHalfWidths(pic) {
    const { data: d, w, h } = pic;
    const cx = w / 2;
    const solid = (x, y) => d[(y * w + x) * 4 + 3] > SOLID;
    const out = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let lo = -1, hi = -1;
      for (let x = 0; x < w; x++) if (solid(x, y)) { if (lo < 0) lo = x; hi = x; }
      if (lo < 0) continue;
      const mid = Math.min(w - 1, Math.max(0, Math.floor(cx)));
      if (solid(mid, y)) {
        let l = mid, r = mid, gap = 0;
        for (let x = mid - 1; x >= 0 && gap <= 2; x--) { if (solid(x, y)) { l = x; gap = 0; } else gap++; }
        gap = 0;
        for (let x = mid + 1; x < w && gap <= 2; x++) { if (solid(x, y)) { r = x; gap = 0; } else gap++; }
        lo = l; hi = r;
      }
      out[y] = Math.max(cx - lo, hi + 1 - cx);
    }
    return out;
  }

  // The average reach of a few rows around y (a single odd row should not decide the width).
  function smoothHalf(half, y, radius) {
    let sum = 0, n = 0;
    for (let i = Math.max(0, y - radius); i <= Math.min(half.length - 1, y + radius); i++) if (half[i] > 0) { sum += half[i]; n++; }
    return n ? sum / n : 0;
  }

  /*
    Work out how to stretch each row.
      pic      the cut-out garment (cropped to its box)
      topH     height (inches above the floor) the top edge of the garment sits at
      hemH     height the bottom edge sits at
      anchors  [{ h, half, shift, flat, atBottom }]
               at height h (inches) the garment must reach half inches each side of its centre, and that centre sits
               shift inches to the right of the figure's centre line (the body is not always exactly centred; it can be negative).
               flat (optional) = how far a garment of this size reaches from its centre when lying FLAT (a quarter of its
               circumference). It is only used to judge the photo's shape: see `shape` below.
               atBottom (optional) = the anchor is the hem: measure the photo's widest row in its lowest part instead of the row
               at height h, because a slanted hem has a narrow lowest row.
      fix      1 = as the chart says, 1.1 = ten percent wider (a hand correction)
      opts     optional. { floor, floorFrom }: a garment can never be narrower than the body it covers. floor(y) gives, for output
               row y, { half, shift } = how far the body reaches from its own centre and where that centre is (inches), or null when
               the scan cannot say. From row floorFrom downward each row is widened to at least the body's outline and centred on
               the body, so a fitted garment follows the waist curves instead of keeping the photo's own (narrower) shape.
    Returns { pxPerIn, k, halfPx, shift, x0, outW, x0In, widthIn, halfIn, shape }:
      pxPerIn  output pixels per inch (the picture keeps its height in pixels, so this is picture height / garment length)
      k        for each row, source pixels per output pixel, sideways (bigger = the row is squeezed more)
      halfPx   how far each output row reaches from its centre, in output pixels
      shift    for each row, where its centre is, in inches right of the figure's centre line
      x0       the left edge of the output picture in output pixels from the centre line, outW its width in pixels
      x0In, widthIn  the same two in inches (where the figure draws it)
      shape    for each anchor that has a flat width: how wide the photo's garment is compared with a flat garment of that size
               (1 = exactly right, 0.5 = the photo is half as wide as it should be for its length)
    Between anchors the sideways scale and the shift change smoothly; above the first and below the last they stay as they are.
    With no anchors the picture is only scaled to fit the length and keeps its own proportions (k is 1).
  */
  function planWarp(pic, topH, hemH, anchors, fix, opts) {
    const o = opts || {};
    const h = pic.h;
    const length = topH - hemH;
    const pxPerIn = h / length;
    const half = rowHalfWidths(pic);
    const points = [], shape = [];
    anchors.forEach(a => {
      let y, reach;
      if (a.atBottom) {
        y = h - 1; reach = 0;
        for (let i = Math.floor((h - 1) * 0.88); i < h; i++) if (half[i] > reach) { reach = half[i]; y = i; }
      } else {
        y = Math.round((topH - a.h) / length * (h - 1));
        if (y < 0 || y > h - 1) return;
        reach = smoothHalf(half, y, 3);
      }
      if (reach > 0 && a.half > 0) points.push({ y: y, k: reach / (a.half * (fix || 1) * pxPerIn), shift: a.shift || 0 });
      if (reach > 0 && a.flat > 0) shape.push(reach / (a.flat * pxPerIn));
    });
    points.sort((p, q) => p.y - q.y);
    const blend = (y, field, none) => {
      if (!points.length) return none;
      if (y <= points[0].y) return points[0][field];
      const last = points[points.length - 1];
      if (y >= last.y) return last[field];
      let i = 0;
      while (points[i + 1].y < y) i++;
      const a = points[i], b = points[i + 1];
      return a[field] + (b[field] - a[field]) * (y - a.y) / (b.y - a.y);
    };
    const k = new Float32Array(h), shift = new Float32Array(h), halfPx = new Float32Array(h);
    let left = 0, right = 0;
    for (let y = 0; y < h; y++) {
      k[y] = blend(y, 'k', 1);
      shift[y] = blend(y, 'shift', 0);
      halfPx[y] = half[y] / k[y];
      if (o.floor && half[y] > 0 && y >= (o.floorFrom || 0)) {           // never narrower than the body it covers
        const f = o.floor(y);
        if (f) {
          if (f.half * pxPerIn > halfPx[y]) { halfPx[y] = f.half * pxPerIn; k[y] = half[y] / halfPx[y]; }
          shift[y] = f.shift;
        }
      }
      const c = shift[y] * pxPerIn;
      if (c - halfPx[y] < left) left = c - halfPx[y];
      if (c + halfPx[y] > right) right = c + halfPx[y];
    }
    const x0 = Math.floor(left) - 1;
    const outW = Math.ceil(right) + 1 - x0;
    return { pxPerIn: pxPerIn, k: k, halfPx: halfPx, shift: shift, x0: x0, outW: outW, x0In: x0 / pxPerIn, widthIn: outW / pxPerIn, halfIn: outW / 2 / pxPerIn, shape: shape };
  }

  // ---------- safety checks: is this photo probably just the garment? ----------

  // How much of the photo (0 to 1) was kept after the background was removed. A garment alone on a plain background fills
  // roughly a third to a half of the frame. If most of it was kept, the background did not go: usually a person is wearing it.
  const KEPT_TOO_MUCH = 0.7;
  function photoWarning(kept) {
    if (typeof kept !== 'number' || kept <= KEPT_TOO_MUCH) return '';
    return 'Most of the photo (' + Math.round(kept * 100) + '%) was kept, so the background was not removed. This usually means a person is wearing the garment in the photo, or the background is busy. Use a flat photo of just the garment on a plain background.';
  }

  // The photo's garment against a flat garment of the size in the chart. A flat photo is close to 1 (a tee with sleeves is wider,
  // about 1.5). Far from that, the photo shows more than the garment (a head, legs) or only part of it.
  const SHAPE_MIN = 0.65, SHAPE_MAX = 1.8;
  function shapeWarning(shape) {
    if (!shape || !shape.length) return '';
    const worst = shape.reduce((w, s) => (Math.abs(Math.log(s)) > Math.abs(Math.log(w)) ? s : w), shape[0]);
    if (worst >= SHAPE_MIN && worst <= SHAPE_MAX) return '';
    const times = Math.max(worst, 1 / worst).toFixed(1);
    return 'The photo\'s proportions do not match the chart (it would have to be stretched sideways ' + (worst < 1 ? 'about ' + times + ' times to be as wide as' : 'about ' + times + ' times squeezed to be as narrow as') + ' a flat garment of this size), so it probably shows more than the garment alone, or only part of it.';
  }

  /*
    Stretch every row as planned. Returns a new picture, plan.outW wide and as tall as the original.
    opts, all optional, make the garment look wrapped around the body instead of pasted in front of it:
      wrap   0 to 1. How much the fabric is curved as if it went round a tube: the picture is squeezed toward the sides, the way
             a pattern bunches where the cloth turns away from you. 0 = flat, 1 = a full cylinder.
      edge   0 to 1. How much darker the cloth gets toward the sides.
      shade  a function (ox, y) that gives a brightness factor for each output pixel (the page uses the scan's own lighting).
  */
  function warp(pic, plan, opts) {
    const o = Object.assign({ wrap: 0, edge: 0, shade: null }, opts || {});
    const { data: d, w, h } = pic;
    const outW = plan.outW;
    const out = new Uint8ClampedArray(outW * h * 4);
    for (let y = 0; y < h; y++) {
      const centre = plan.shift[y] * plan.pxPerIn, hp = plan.halfPx[y], k = plan.k[y];
      for (let ox = 0; ox < outW; ox++) {
        const u = ox + 0.5 + plan.x0 - centre;                         // output pixels from this row's centre
        const t = hp > 0 ? u / hp : 0;                                 // -1 to 1 across the garment
        const inside = Math.abs(t) <= 1;
        // where in the source row this output pixel comes from. Wrapped: the source is laid on a tube, so equal steps along
        // the picture become smaller steps on screen near the edges.
        const s = inside && o.wrap > 0 ? (1 - o.wrap) * t + o.wrap * (2 / Math.PI) * Math.asin(t) : null;
        const sx = s === null ? w / 2 + u * k : w / 2 + s * hp * k;
        if (sx < 0 || sx > w) continue;
        const f = sx - 0.5;
        const x0 = Math.max(0, Math.min(w - 1, Math.floor(f)));
        const x1 = Math.min(w - 1, x0 + 1);
        const fr = Math.min(1, Math.max(0, f - Math.floor(f)));
        const i0 = (y * w + x0) * 4, i1 = (y * w + x1) * 4;
        const a0 = d[i0 + 3] * (1 - fr), a1 = d[i1 + 3] * fr, a = a0 + a1;
        if (a <= 0) continue;
        let light = 1;
        if (o.edge > 0 && inside) light *= 1 - o.edge * t * t;
        if (o.shade) light *= o.shade(ox, y);
        const q = (y * outW + ox) * 4;
        for (let c = 0; c < 3; c++) out[q + c] = (d[i0 + c] * a0 + d[i1 + c] * a1) / a * light;     // colours weighted by how solid each pixel is
        out[q + 3] = a;
      }
    }
    return { data: out, w: outW, h: h };
  }

  // ---------- the body in the scan (for the real outline and the lighting) ----------

  // Where the body is in the scan picture: true = body, false = background. The background is the colour along the picture's
  // edges, found the same way as for the garment. The scan sits on one flat colour, so this is clean.
  function bodyMask(d, w, h, tolerance) {
    const copy = new Uint8ClampedArray(d);
    removeBackground(copy, w, h, tolerance == null ? 30 : tolerance);
    const mask = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) mask[p] = copy[p * 4 + 3] > 0 ? 1 : 0;
    return mask;
  }

  // How far the body reaches left and right of column cx, in pixels, at row y (averaged over a few rows). The run starts at the
  // centre column and stops at the first background pixel, so the arms are left out wherever they are not touching the body.
  // Returns { left, right } as column positions, or null if the centre is not on the body.
  function bodyEdgesAt(mask, w, h, cx, y, radius) {
    let sl = 0, sr = 0, n = 0;
    const c = Math.round(cx);
    for (let r = Math.max(0, Math.round(y) - (radius || 0)); r <= Math.min(h - 1, Math.round(y) + (radius || 0)); r++) {
      if (c < 0 || c >= w || !mask[r * w + c]) continue;
      let l = c, rt = c;
      while (l > 0 && mask[r * w + l - 1]) l--;
      while (rt < w - 1 && mask[r * w + rt + 1]) rt++;
      sl += l; sr += rt + 1; n++;
    }
    return n ? { left: sl / n, right: sr / n } : null;
  }

  // Brightness (0 to 255) of a picture at a point, blended between the four pixels around it.
  function lumaAt(d, w, h, x, y) {
    const fx = Math.min(w - 1.001, Math.max(0, x - 0.5)), fy = Math.min(h - 1.001, Math.max(0, y - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const L = (xx, yy) => { const i = (yy * w + xx) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
    return (L(x0, y0) * (1 - tx) + L(x0 + 1, y0) * tx) * (1 - ty) + (L(x0, y0 + 1) * (1 - tx) + L(x0 + 1, y0 + 1) * tx) * ty;
  }

  // A smooth map of the body's brightness: the average brightness of each small square of the scan (body pixels only), blurred
  // over the squares around it. It keeps the broad lighting (lit in front, darker toward the sides) and drops sharp creases such
  // as the armpit, which look wrong on cloth. Squares with no body in them are NaN.
  function lumaGrid(d, mask, w, h, cell, radius) {
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    const sum = new Float32Array(gw * gh), count = new Float32Array(gw * gh);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const i = (y * w + x) * 4, c = ((y / cell) | 0) * gw + ((x / cell) | 0);
      sum[c] += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      count[c]++;
    }
    const v = new Float32Array(gw * gh).fill(NaN);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      let s = 0, n = 0;
      for (let yy = Math.max(0, gy - radius); yy <= Math.min(gh - 1, gy + radius); yy++) {
        for (let xx = Math.max(0, gx - radius); xx <= Math.min(gw - 1, gx + radius); xx++) { s += sum[yy * gw + xx]; n += count[yy * gw + xx]; }
      }
      if (n > 0 && count[gy * gw + gx] > 0) v[gy * gw + gx] = s / n;
    }
    return { gw: gw, gh: gh, cell: cell, v: v };
  }

  // The smooth brightness at a point (in scan pixels): blended between the four squares around it, skipping empty ones.
  // `fallback` is returned if there is no body around the point at all.
  function lumaSmoothAt(grid, x, y, fallback) {
    const fx = x / grid.cell - 0.5, fy = y / grid.cell - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    let s = 0, wsum = 0;
    [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]].forEach(q => {
      const gx = x0 + q[0], gy = y0 + q[1];
      if (gx < 0 || gy < 0 || gx >= grid.gw || gy >= grid.gh) return;
      const v = grid.v[gy * grid.gw + gx];
      if (v !== v) return;
      s += v * q[2]; wsum += q[2];
    });
    return wsum > 0 ? s / wsum : fallback;
  }

  // The brightness of a well lit part of the body: the 85th percentile of the body's pixels. The scan's lighting is measured
  // against this, so a lit part of the body gives a factor of about 1 and the shaded sides give less.
  function lumaReference(d, mask, w, h) {
    const values = [];
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
      if (!mask[y * w + x]) continue;
      const i = (y * w + x) * 4;
      values.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    }
    if (!values.length) return 255;
    values.sort((p, q) => p - q);
    return values[Math.floor(values.length * 0.85)] || 255;
  }

  // ---------- 2. browser helpers ----------

  // Shrink the picture to MAX_SIDE, cut the background out and crop to the garment.
  // `source` is a loaded <img> (or canvas). Returns { data, w, h } or null if nothing was left.
  function prepare(source, tolerance) {
    const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;
    const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const box = removeBackground(img.data, w, h, tolerance);
    if (!box) return null;
    const cut = crop(img.data, w, h, box);
    let opaque = 0;
    for (let i = 3; i < cut.data.length; i += 4) if (cut.data[i] > SOLID) opaque++;
    cut.kept = opaque / (w * h);                         // share of the whole photo that is garment
    return cut;
  }

  function toDataURL(pic) {
    const cv = document.createElement('canvas');
    cv.width = pic.w; cv.height = pic.h;
    cv.getContext('2d').putImageData(new ImageData(pic.data, pic.w, pic.h), 0, 0);
    return cv.toDataURL('image/png');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image'));
      img.src = src;
    });
  }

  // A saved cut-out (a data URL) turned back into pixels. Remembered, so it is only decoded once.
  const decoded = new Map();
  function cached(src) { return decoded.get(src) || null; }
  function decode(src) {
    if (decoded.has(src)) return Promise.resolve(decoded.get(src));
    return loadImage(src).then(img => {
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const pic = { data: ctx.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
      decoded.set(src, pic);
      return pic;
    });
  }

  // The scan picture, decoded, with the body mask and its reference brightness. Remembered per picture. If the browser will not let
  // the page read the picture's pixels (a built-in picture opened from a file), the result is { failed: true } and the page falls
  // back to the old fixed proportions without shading.
  const scans = new Map();
  function cachedScan(src) { return scans.get(src) || null; }
  function scan(src) {
    if (scans.has(src)) return Promise.resolve(scans.get(src));
    return loadImage(src).then(img => {
      let result;
      try {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const pic = { data: ctx.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
        const mask = bodyMask(pic.data, pic.w, pic.h, 30);
        result = { pic: pic, mask: mask, ref: lumaReference(pic.data, mask, pic.w, pic.h), grid: lumaGrid(pic.data, mask, pic.w, pic.h, 8, 4) };
      } catch (e) { result = { failed: true }; }
      scans.set(src, result);
      return result;
    }, () => { const r = { failed: true }; scans.set(src, r); return r; });
  }

  // The warped garment as a picture the figure can show. Remembered per cut-out and plan, so clicking between sizes is quick.
  const warped = new Map();
  function warpedURL(src, pic, plan, key, opts) {
    const id = src.length + ':' + src.slice(-24) + '|' + key;
    if (!warped.has(id)) {
      if (warped.size > 40) warped.clear();
      warped.set(id, toDataURL(warp(pic, plan, opts)));
    }
    return warped.get(id);
  }

  return { MAX_SIDE, removeBackground, crop, rowHalfWidths, planWarp, warp, bodyMask, bodyEdgesAt, lumaAt, lumaReference,
    lumaGrid, lumaSmoothAt, photoWarning, shapeWarning, prepare, toDataURL, loadImage, decode, cached, scan, cachedScan, warpedURL };
})();

if (typeof module !== 'undefined') module.exports = FitRoom.GarmentImage;
