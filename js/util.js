/*
  util.js — small helpers used by every other file.
  Nothing in here knows about fit, sizes or the page layout.

  All the JS files share one global object called FitRoom.
  Each file adds one part to it (FitRoom.Util, FitRoom.Fit, ...).
*/
window.FitRoom = window.FitRoom || {};

FitRoom.Util = (function () {

  // Read a number from text. Accepts "36", "36.5" and "36,5".
  // Returns null when the text is empty or is not a number.
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const x = parseFloat(String(v).replace(',', '.'));
    return isFinite(x) ? x : null;
  }

  // Show a number with at most 2 decimals and no trailing zeros: 1.5 -> "1.5", 36 -> "36", 0.333 -> "0.33"
  function fmt(x) {
    return String(Math.round(x * 100) / 100);
  }

  // Make text safe to put inside HTML.
  function esc(s) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => map[c]);
  }

  // A full independent copy of plain data (objects, arrays, strings, numbers).
  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  // Straight-line interpolation through a list of [x, y] points that goes up in x.
  // Below the first x or above the last x it returns the end value.
  function interp(points, x) {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      if (x <= points[i][0]) {
        const a = points[i - 1], b = points[i];
        return a[1] + (b[1] - a[1]) * ((x - a[0]) / ((b[0] - a[0]) || 1));
      }
    }
    return points[points.length - 1][1];
  }

  // Size charts can be typed in inches or in centimetres. All the maths happens in inches.
  function toInches(value, unit) {
    return unit === 'cm' ? value / 2.54 : value;
  }
  function fromInches(value, unit) {
    return unit === 'cm' ? value * 2.54 : value;
  }

  // "M" -> "M"; ["M","L"] -> "M and L"; ["S","M","L"] -> "S, M and L"
  function joinList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function capitalise(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Turn what was typed in a "link" box into a safe web address, or '' if it is not one.
  // "www.zara.com/shirt" -> "https://www.zara.com/shirt". Only http and https links are allowed,
  // so nothing odd (like a script) can ever be opened from a saved or imported file.
  function safeLink(text) {
    let t = String(text == null ? '' : text).trim();
    if (!t) return '';
    if (!/^[a-z][a-z0-9+.\-]*:/i.test(t)) t = 'https://' + t;
    try {
      const u = new URL(t);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.indexOf('.') > 0 ? u.href : '';
    } catch (e) {
      return '';
    }
  }

  return { num, fmt, esc, clone, interp, toInches, fromInches, joinList, capitalise, safeLink };
})();

// Lets the test script (node tests/fit.test.js) load this file. Has no effect in the browser.
if (typeof module !== 'undefined') module.exports = FitRoom.Util;
