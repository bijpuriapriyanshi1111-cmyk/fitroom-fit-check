/*
  geometry.js — works out where things are on the body, in inches.

  Two sources of truth, in this order:
    1. The calibration marks you clicked on the person's scan picture.
    2. Height proportions (the old guess), used only for a mark that has not been clicked yet.

  Everything here is in inches:
    "height" = inches above the floor
    "side"   = inches to the right of the centre line (negative = left of the centre line, as seen in the picture)
    "drop"   = inches below the high point of the shoulder (this is how brands measure garment length)
*/
FitRoom.Geometry = (function () {
  const { num } = FitRoom.Util;

  // The high point of the shoulder (next to the neck) sits about this far above the shoulder tip.
  // It matters because garment length is measured from the high point of the shoulder.
  const SHOULDER_SLOPE = 1.9;

  // How far the arm is held out from the body in the scan pictures, used only when the arm is not marked.
  const ARM_ANGLE_DEG = 25;

  /*
    The points the calibration step asks for, in this order.
    kind "line"  = only the height of the click matters (a horizontal line across the body)
    kind "point" = both left/right and height matter
  */
  const MARKS = [
    { key: 'head',     label: 'Head top',  kind: 'line',  hint: 'Click the very top of the head. This sets the scale: the head top becomes your entered height.' },
    { key: 'shoulder', label: 'Shoulder',  kind: 'point', hint: 'Click the tip of the shoulder, where the arm starts and a sleeve seam would sit. Use the left or the right shoulder, then use the same side for the wrist.' },
    { key: 'bust',     label: 'Bust',      kind: 'line',  hint: 'Click the fullest part of the bust.' },
    { key: 'waist',    label: 'Waist',     kind: 'line',  hint: 'Click the natural waist, the narrowest part of the torso.' },
    { key: 'hip',      label: 'Hip',       kind: 'line',  hint: 'Click the hip line, the widest part of the hips.' },
    { key: 'floor',    label: 'Floor',     kind: 'line',  hint: 'Click the floor, level with the bottom of the feet. This sets the scale too: the floor is 0 on the tape.' },
    { key: 'wrist',    label: 'Wrist',     kind: 'point', hint: 'Click the wrist bone on the SAME arm as the shoulder you marked.' }
  ];

  function markCount(person) {
    const marks = person.marks || {};
    return MARKS.filter(m => marks[m.key]).length;
  }

  /*
    Build everything the drawing and the hem/sleeve text need.
      person: { picture, marks, lens }
      body:   { h, bust, waist, hip, inseam }  (numbers or null)
  */
  function build(person, body) {
    const H = body.h || 64;                       // the height we scale the picture to
    const pic = person.picture || null;
    const marks = person.marks || {};
    const lens = person.lens || {};

    // ---- 1. Scale: head top = your height, floor = 0 ----
    // With no head or floor mark, assume the picture runs exactly from head to feet.
    let headY = marks.head ? marks.head.y : 0;
    let floorY = marks.floor ? marks.floor.y : (pic ? pic.h : 1);
    if (floorY - headY < 50) { headY = 0; floorY = pic ? pic.h : 1; }   // marks in a silly order: ignore them
    const pxPerIn = (floorY - headY) / H;
    const centreX = marks.head ? marks.head.x : (pic ? pic.w / 2 : 0);   // the head mark also sets the centre line
    const heightOf = y => (floorY - y) / pxPerIn;
    const sideOf = x => (x - centreX) / pxPerIn;

    // ---- 2. Landmark heights: from marks, otherwise from proportions ----
    const hps = marks.shoulder ? heightOf(marks.shoulder.y) + SHOULDER_SLOPE : 0.83 * H;
    const bustH = marks.bust ? heightOf(marks.bust.y) : hps - 0.145 * H;
    const waistH = marks.waist ? heightOf(marks.waist.y) : hps - (num(lens.waistD) || 0.21 * H);
    const hipH = marks.hip ? heightOf(marks.hip.y) : hps - 0.38 * H;

    const bustD = hps - bustH, waistD = hps - waistH, hipD = hps - hipH;

    // Lower body (no marks for these, proportions only). Used to describe where a hem lands.
    let crotchD = body.inseam != null ? hps - body.inseam + 0.8 : hipD + 1.6;
    crotchD = Math.min(Math.max(crotchD, hipD + 0.8), hipD + 4.5);
    const kneeD = Math.max(hps - 0.27 * H, crotchD + 6);
    const calfD = Math.max(hps - 0.16 * H, kneeD + 4);
    const ankleD = Math.max(hps - 0.03 * H, calfD + 4);

    // ---- 3. The arm: shoulder tip -> wrist ----
    // Which side of the picture the arm is on. Default: left side of the picture.
    const armSign = marks.shoulder ? (Math.sign(sideOf(marks.shoulder.x)) || -1)
                  : marks.wrist ? (Math.sign(sideOf(marks.wrist.x)) || -1) : -1;
    const tip = marks.shoulder
      ? { x: sideOf(marks.shoulder.x), h: heightOf(marks.shoulder.y) }
      : { x: armSign * (0.122 * H - 0.5), h: hps - SHOULDER_SLOPE };
    const angle = ARM_ANGLE_DEG * Math.PI / 180;
    const armGuess = num(lens.arm) || 0.345 * H;
    const wrist = marks.wrist
      ? { x: sideOf(marks.wrist.x), h: heightOf(marks.wrist.y) }
      : { x: tip.x + armSign * Math.sin(angle) * armGuess, h: tip.h - Math.cos(angle) * armGuess };
    const arm = Math.hypot(wrist.x - tip.x, wrist.h - tip.h);   // shoulder tip to wrist, along the arm

    // ---- 4. Half-widths of the body in the front view (inches), used to size the bands ----
    const half = {
      bust: (body.bust != null ? body.bust : 36) * 0.155,
      waist: (body.waist != null ? body.waist : 29) * 0.16,
      hip: (body.hip != null ? body.hip : 38) * 0.165
    };

    // ---- 5. Where the picture sits, in the same inches ----
    const picture = pic ? { x: sideOf(0), top: heightOf(0), w: pic.w / pxPerIn, h: pic.h / pxPerIn } : null;

    const missing = MARKS.filter(m => !marks[m.key]).map(m => m.label);
    const marked = {};                                   // marked.waist === true when the waist has been clicked
    MARKS.forEach(m => { marked[m.key] = !!marks[m.key]; });

    return {
      H, assumedH: !body.h, hps, bustD, waistD, hipD, crotchD, kneeD, calfD, ankleD,
      thighD: (crotchD + kneeD) / 2, arm, elbow: arm * 0.59,
      tip, wrist, half, picture, missing, marked,
      scaled: !!(marks.head && marks.floor)
    };
  }

  // Of the marks a result depends on, which are still missing? Gives names like ['shoulder', 'waist'].
  // An empty list means nothing in that result is a guess.
  function unmarked(g, keys) {
    return keys.filter(k => !g.marked[k]).map(k => MARKS.filter(m => m.key === k)[0].label.toLowerCase());
  }

  // Half-width of the body (inches) at a given height. Used to size the hem line.
  function halfWidthAt(g, height) {
    const H = g.H;
    const points = [
      [0, 0.08 * H],
      [0.27 * H, 0.095 * H],
      [g.hps - g.crotchD, g.half.hip * 0.9],
      [g.hps - g.hipD, g.half.hip],
      [g.hps - g.waistD, g.half.waist],
      [g.hps - g.bustD, g.half.bust],
      [g.hps, g.half.bust * 0.9]
    ].sort((a, b) => a[0] - b[0]);
    return FitRoom.Util.interp(points, height);
  }

  return { MARKS, markCount, build, unmarked, halfWidthAt, SHOULDER_SLOPE };
})();

if (typeof module !== 'undefined') module.exports = FitRoom.Geometry;
