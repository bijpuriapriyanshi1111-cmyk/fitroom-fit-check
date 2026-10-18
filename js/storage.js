/*
  storage.js — saving your data in this browser (localStorage) and backing it up as a JSON file.

  Everything lives in ONE entry in localStorage: people (with their scan pictures and
  calibration marks), the current garment chart, the fit rules and the prediction test log.
  The exported JSON file has exactly the same shape, so export and import are simple.
*/
FitRoom.Storage = (function () {

  const KEY = 'fitroom.fitcheck.v1';
  const BROKEN_KEY = 'fitroom.fitcheck.v1.unreadable';   // a copy of saved data we could not read
  const EXPORT_KEY = 'fitroom.fitcheck.lastExport';
  const APP_ID = 'fitroom-fit-check';

  // Browsers keep about 5 million characters per site. Used only to show "x MB of 5 MB".
  const LIMIT_CHARS = 5 * 1024 * 1024;

  // Returns { data, unreadable }. data is null when nothing is saved yet.
  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
      return { data: raw ? JSON.parse(raw) : null, unreadable: false };
    } catch (e) {
      // The saved text could not be parsed. Keep a copy so nothing is lost, then start fresh.
      try { if (raw) localStorage.setItem(BROKEN_KEY, raw); } catch (e2) { /* nothing more we can do */ }
      return { data: null, unreadable: true };
    }
  }

  // Write everything. Returns { ok, chars } or { ok: false } when the browser refuses (storage full or blocked).
  function save(data) {
    try {
      const json = JSON.stringify(data);
      localStorage.setItem(KEY, json);
      return { ok: true, chars: json.length };
    } catch (e) {
      return { ok: false, chars: 0 };
    }
  }

  // Does this browser allow saving at all? (Private windows sometimes do not.)
  function available() {
    try {
      localStorage.setItem('fitroom.test', '1');
      localStorage.removeItem('fitroom.test');
      return true;
    } catch (e) {
      return false;
    }
  }

  function percentUsed(chars) {
    return Math.round(100 * chars / LIMIT_CHARS);
  }

  // Download the data as a .json file, named with today's date.
  function exportFile(data) {
    const now = new Date();   // your local date, so the file name matches your calendar
    const two = n => String(n).padStart(2, '0');
    const stamp = now.getFullYear() + '-' + two(now.getMonth() + 1) + '-' + two(now.getDate());
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'fitroom-fit-check-' + stamp + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    try { localStorage.setItem(EXPORT_KEY, new Date().toISOString()); } catch (e) { /* not important */ }
  }

  function lastExport() {
    try { return localStorage.getItem(EXPORT_KEY); } catch (e) { return null; }
  }

  // Check that text from a file looks like one of our exports. Returns { data } or { error }.
  function parseImport(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { error: 'That file is not valid JSON.' }; }
    if (!data || data.app !== APP_ID) return { error: 'That file was not exported from FitRoom Fit Check.' };
    if (!Array.isArray(data.people) || !Array.isArray(data.log)) return { error: 'That file is missing the people or the test log.' };
    return { data: data };
  }

  return { APP_ID, KEY, load, save, available, percentUsed, exportFile, lastExport, parseImport };
})();
