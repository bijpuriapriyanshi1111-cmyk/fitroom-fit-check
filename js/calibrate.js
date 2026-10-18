/*
  calibrate.js — the calibration step.

  Opens a large view of the person's scan picture. You click on the picture to mark the points listed in
  FitRoom.Geometry.MARKS (head top, shoulder, bust, waist, hip, floor, wrist). The marks are saved with the person
  as pixel positions on the picture, like this:  person.marks.waist = { x: 556, y: 560 }

  Because marks are pixel positions on the picture itself, they stay correct when the entered height changes.
*/
FitRoom.Calibrate = (function () {
  const { esc } = FitRoom.Util;
  const MARKS = FitRoom.Geometry.MARKS;

  // One colour per mark so you can tell them apart on the picture.
  const COLOUR = { head: '#2B4FD0', shoulder: '#D4351C', bust: '#E07B00', waist: '#1F8A4C', hip: '#9B3FC4', floor: '#0F8EA3', wrist: '#D4351C' };

  let dlg, svg, list, hint, msg;
  let person = null, active = 'head', onChange = function () {};

  function init() {
    dlg = document.getElementById('calDlg');
    svg = document.getElementById('calSvg');
    list = document.getElementById('calList');
    hint = document.getElementById('calHint');
    msg = document.getElementById('calMsg');

    svg.addEventListener('click', onPictureClick);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerleave', function () { svg.querySelector('#cal-guide').innerHTML = ''; });
    document.getElementById('calDone').onclick = function () { dlg.close(); };
    document.getElementById('calClear').onclick = function () {
      if (!Object.keys(person.marks).length) return;
      if (!confirm('Clear all the marks for ' + person.name + '? Lines go back to height proportions.')) return;
      person.marks = {};
      active = 'head';
      changed();
    };
    list.addEventListener('click', function (ev) {
      const clear = ev.target.closest('[data-clear]');
      if (clear) { delete person.marks[clear.getAttribute('data-clear')]; active = clear.getAttribute('data-clear'); changed(); return; }
      const pick = ev.target.closest('[data-key]');
      if (pick) { active = pick.getAttribute('data-key'); render(); }
    });
  }

  // Open the dialog for a person. onChangeFn is called every time a mark changes (so the page can save and redraw).
  function open(p, onChangeFn) {
    person = p;
    person.marks = person.marks || {};
    onChange = onChangeFn;
    const pic = person.picture;
    svg.setAttribute('viewBox', '0 0 ' + pic.w + ' ' + pic.h);
    const img = svg.querySelector('#cal-img');
    img.setAttribute('href', pic.src);
    img.setAttribute('width', pic.w);
    img.setAttribute('height', pic.h);
    document.getElementById('calName').textContent = person.name;
    active = nextUnmarked() || 'head';
    render();
    dlg.showModal();
  }

  function changed() {
    onChange();
    render();
  }

  function nextUnmarked() {
    const m = MARKS.filter(x => !person.marks[x.key])[0];
    return m ? m.key : null;
  }

  // ---------- clicking ----------

  // Turn a mouse position into a position on the picture (in picture pixels).
  function toPicture(ev) {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const pic = person.picture;
    return { x: Math.round(Math.min(Math.max(p.x, 0), pic.w)), y: Math.round(Math.min(Math.max(p.y, 0), pic.h)) };
  }

  function onPictureClick(ev) {
    person.marks[active] = toPicture(ev);
    const next = nextUnmarked();
    if (next) active = next;       // move on to the next mark that is still missing
    changed();
  }

  // A thin guide that follows the pointer, so horizontal marks are easy to line up.
  function onPointerMove(ev) {
    const p = toPicture(ev), pic = person.picture;
    svg.querySelector('#cal-guide').innerHTML =
      '<line x1="0" x2="' + pic.w + '" y1="' + p.y + '" y2="' + p.y + '" stroke="#fff" stroke-opacity=".9" stroke-width="1" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>' +
      '<line y1="0" y2="' + pic.h + '" x1="' + p.x + '" x2="' + p.x + '" stroke="#fff" stroke-opacity=".5" stroke-width="1" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>';
  }

  // ---------- drawing ----------

  // Gentle warnings when marks are in an odd order (it is easy to click the wrong spot).
  function orderWarning() {
    const m = person.marks;
    const above = (a, b) => m[a] && m[b] && m[a].y >= m[b].y;     // true when "a" is NOT above "b"
    if (above('head', 'shoulder')) return 'The head top should be above the shoulder.';
    if (above('shoulder', 'bust')) return 'The shoulder should be above the bust.';
    if (above('bust', 'waist')) return 'The bust should be above the waist.';
    if (above('waist', 'hip')) return 'The waist should be above the hip line.';
    if (above('hip', 'floor')) return 'The hip line should be above the floor.';
    if (above('shoulder', 'wrist')) return 'The wrist should be below the shoulder.';
    if (m.shoulder && m.wrist && (m.shoulder.x < (m.head ? m.head.x : person.picture.w / 2)) !== (m.wrist.x < (m.head ? m.head.x : person.picture.w / 2))) {
      return 'The shoulder and the wrist look like they are on different arms. Use the same arm for both.';
    }
    return '';
  }

  function markGraphics() {
    const pic = person.picture, size = pic.h / 55, s = [];
    const m = person.marks;
    MARKS.forEach(mk => {
      const at = m[mk.key];
      if (!at) return;
      const c = COLOUR[mk.key];
      if (mk.kind === 'line') {
        s.push('<line x1="0" x2="' + pic.w + '" y1="' + at.y + '" y2="' + at.y + '" stroke="#fff" stroke-opacity=".85" stroke-width="5" vector-effect="non-scaling-stroke"/>');
        s.push('<line x1="0" x2="' + pic.w + '" y1="' + at.y + '" y2="' + at.y + '" stroke="' + c + '" stroke-width="2" vector-effect="non-scaling-stroke"/>');
        s.push('<text x="8" y="' + (at.y - size * 0.35) + '" font-size="' + size + '" font-weight="700" fill="' + c + '" stroke="#fff" stroke-width="' + size / 5 + '" paint-order="stroke">' + esc(mk.label) + '</text>');
      } else {
        const r = size * 0.55;
        s.push('<circle cx="' + at.x + '" cy="' + at.y + '" r="' + r + '" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="5" vector-effect="non-scaling-stroke"/>');
        s.push('<circle cx="' + at.x + '" cy="' + at.y + '" r="' + r + '" fill="none" stroke="' + c + '" stroke-width="2" vector-effect="non-scaling-stroke"/>');
        s.push('<circle cx="' + at.x + '" cy="' + at.y + '" r="' + size * 0.12 + '" fill="' + c + '"/>');
        s.push('<text x="' + (at.x + r + 6) + '" y="' + (at.y - r * 0.4) + '" font-size="' + size + '" font-weight="700" fill="' + c + '" stroke="#fff" stroke-width="' + size / 5 + '" paint-order="stroke">' + esc(mk.label) + '</text>');
      }
    });
    if (m.shoulder && m.wrist) {      // the arm line the sleeve will follow
      s.push('<line x1="' + m.shoulder.x + '" y1="' + m.shoulder.y + '" x2="' + m.wrist.x + '" y2="' + m.wrist.y + '" stroke="' + COLOUR.wrist + '" stroke-width="2" stroke-dasharray="8 6" vector-effect="non-scaling-stroke"/>');
    }
    return s.join('');
  }

  function render() {
    svg.querySelector('#cal-marks').innerHTML = markGraphics();

    const done = MARKS.filter(m => person.marks[m.key]).length;
    list.innerHTML = MARKS.map((m, i) => {
      const marked = !!person.marks[m.key];
      return '<li class="mk-item"><button type="button" class="mk' + (m.key === active ? ' on' : '') + '" data-key="' + m.key + '" aria-pressed="' + (m.key === active) + '">' +
        '<span class="swatch" style="background:' + COLOUR[m.key] + '"></span><span class="mk-name">' + (i + 1) + '. ' + esc(m.label) + '</span>' +
        '<span class="mk-state">' + (marked ? 'marked' : 'not marked') + '</span></button>' +
        (marked ? '<button type="button" class="x" data-clear="' + m.key + '" aria-label="Clear the ' + esc(m.label) + ' mark" title="Clear this mark">&times;</button>' : '') + '</li>';
    }).join('');

    const current = MARKS.filter(m => m.key === active)[0];
    hint.textContent = current.hint;
    const warning = orderWarning();
    msg.textContent = warning || (done === MARKS.length ? 'All ' + done + ' points are marked. Click a point in the list, then the picture, to redo it.' : done + ' of ' + MARKS.length + ' points marked. Anything not marked uses height proportions.');
    msg.classList.toggle('warn', !!warning);
  }

  return { init, open };
})();
