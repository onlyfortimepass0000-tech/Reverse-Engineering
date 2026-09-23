(function () {
  var body = document.body;

  // ---- plan toggle (Free vs Alocana Plus) ----
  function setPlan(plan) {
    body.dataset.plan = plan;
    document.querySelectorAll('.plan-switch [role="radio"]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.setPlan === plan));
    });
    try { localStorage.setItem('alocana-plan', plan); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-set-plan]');
    if (!t) return;
    setPlan(t.dataset.setPlan);
    if (t.closest('.hero') || t.closest('.plan')) {
      document.getElementById(t.closest('.plan') && t.dataset.setPlan === 'plus' ? 'dashboard' : 'app').scrollIntoView({ behavior: 'smooth' });
    }
  });
  var saved = null;
  try { saved = localStorage.getItem('alocana-plan'); } catch (e) {}
  var qp = new URLSearchParams(location.search).get('plan');
  setPlan(qp === 'plus' || qp === 'free' ? qp : (saved === 'plus' ? 'plus' : 'free'));

  // ---- phone tabs ----
  var tabs = document.querySelectorAll('.tabbar button');
  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      tabs.forEach(function (b) { b.classList.toggle('on', b === btn); });
      document.querySelectorAll('.tab-view').forEach(function (v) {
        v.hidden = v.dataset.view !== btn.dataset.tab;
      });
      document.querySelector('.app-body').scrollTop = 0;
    });
  });

  // ---- dashboard range buttons (visual only) ----
  document.querySelectorAll('.range button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.range button').forEach(function (x) { x.classList.toggle('on', x === b); });
    });
  });

  // ---- table toggles ----
  document.querySelectorAll('.tbl-toggle').forEach(function (b) {
    b.addEventListener('click', function () {
      var tbl = document.getElementById(b.dataset.table);
      var chart = b.closest('.panel').querySelector('.chart');
      var showTable = tbl.hidden;
      tbl.hidden = !showTable;
      chart.hidden = showTable;
      b.textContent = showTable ? 'Chart' : 'Table';
    });
  });

  // ---- charts (sample data) ----
  var days = ['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'];
  var hazards = [4, 6, 5, 8, 3, 2, 9];
  var resp = [12, 10, 13, 9, 11, 14, 8];
  var NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function fillTable(id, unit, data) {
    var tb = document.querySelector('#' + id + ' tbody');
    tb.innerHTML = days.map(function (d, i) { return '<tr><td>' + d + '</td><td>' + data[i] + unit + '</td></tr>'; }).join('');
  }
  function tipAt(host, x, y, html) {
    var t = host.querySelector('.tip');
    if (!t) { t = document.createElement('div'); t.className = 'tip'; host.appendChild(t); }
    t.innerHTML = html; t.style.left = x + 'px'; t.style.top = y + 'px'; t.hidden = false;
  }
  function hideTip(host) { var t = host.querySelector('.tip'); if (t) t.hidden = true; }

  var W, H = 200, P = { l: 34, r: 8, t: 12, b: 24 }, iw, ih = H - P.t - P.b;
  function size(host) { W = Math.max(260, host.clientWidth || 460); iw = W - P.l - P.r; }

  function barChart() {
    var host = document.getElementById('c-haz');
    size(host);
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' }, host);
    var max = 10;
    [0, 5, 10].forEach(function (v) {
      var y = P.t + ih - (v / max) * ih;
      el('line', { x1: P.l, x2: W - P.r, y1: y, y2: y, class: 'grid-l' }, svg);
      el('text', { x: P.l - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-t' }, svg).textContent = v;
    });
    var step = iw / days.length, bw = Math.min(28, step * 0.5), bars = [];
    days.forEach(function (d, i) {
      var cx = P.l + step * i + step / 2;
      var h = (hazards[i] / max) * ih, y = P.t + ih - h;
      var r = Math.min(4, h / 2);
      var path = 'M' + (cx - bw / 2) + ',' + (P.t + ih) + 'V' + (y + r) + 'q0,-' + r + ' ' + r + ',-' + r + 'H' + (cx + bw / 2 - r) + 'q' + r + ',0 ' + r + ',' + r + 'V' + (P.t + ih) + 'Z';
      bars.push(el('path', { d: path, class: 'bar' }, svg));
      el('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'axis-t' }, svg).textContent = d;
      var hit = el('rect', { x: cx - step / 2, y: P.t, width: step, height: ih, class: 'hit' }, svg);
      hit.addEventListener('mouseenter', function () {
        bars.forEach(function (b, j) { b.classList.toggle('dim', j !== i); });
        var rect = host.getBoundingClientRect();
        tipAt(host, (cx / W) * rect.width, (y / H) * rect.height, d + ' · <b>' + hazards[i] + '</b> hazards');
      });
    });
    svg.addEventListener('mouseleave', function () { bars.forEach(function (b) { b.classList.remove('dim'); }); hideTip(host); });
    fillTable('t-haz', '', hazards);
  }

  function lineChart() {
    var host = document.getElementById('c-resp');
    size(host);
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' }, host);
    var defs = el('defs', {}, svg);
    var g = el('linearGradient', { id: 'respFill', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': '#22D3C5', 'stop-opacity': '.28' }, g);
    el('stop', { offset: '100%', 'stop-color': '#22D3C5', 'stop-opacity': '0' }, g);
    var max = 20;
    [0, 10, 20].forEach(function (v) {
      var y = P.t + ih - (v / max) * ih;
      el('line', { x1: P.l, x2: W - P.r, y1: y, y2: y, class: 'grid-l' }, svg);
      el('text', { x: P.l - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-t' }, svg).textContent = v + 's';
    });
    var ty = P.t + ih - (15 / max) * ih;
    el('line', { x1: P.l, x2: W - P.r, y1: ty, y2: ty, class: 'target' }, svg);
    el('text', { x: W - P.r, y: ty - 6, 'text-anchor': 'end', class: 'target-t' }, svg).textContent = 'Target 15 s';
    var step = iw / (days.length - 1);
    var pts = resp.map(function (v, i) { return [P.l + step * i, P.t + ih - (v / max) * ih]; });
    el('path', { d: 'M' + pts.map(function (p) { return p.join(','); }).join('L') + 'L' + pts[pts.length - 1][0] + ',' + (P.t + ih) + 'L' + P.l + ',' + (P.t + ih) + 'Z', class: 'area' }, svg);
    el('path', { d: 'M' + pts.map(function (p) { return p.join(','); }).join('L'), class: 'ln' }, svg);
    days.forEach(function (d, i) {
      el('text', { x: pts[i][0], y: H - 6, 'text-anchor': i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle', class: 'axis-t' }, svg).textContent = d;
    });
    var xh = el('line', { y1: P.t, y2: P.t + ih, class: 'xhair', visibility: 'hidden' }, svg);
    var mk = el('circle', { r: 5, class: 'mk', visibility: 'hidden' }, svg);
    var hit = el('rect', { x: P.l, y: P.t, width: iw, height: ih, class: 'hit' }, svg);
    hit.addEventListener('mousemove', function (e) {
      var rect = host.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / rect.width) * W;
      var i = Math.max(0, Math.min(days.length - 1, Math.round((x - P.l) / step)));
      var p = pts[i];
      xh.setAttribute('x1', p[0]); xh.setAttribute('x2', p[0]); xh.setAttribute('visibility', 'visible');
      mk.setAttribute('cx', p[0]); mk.setAttribute('cy', p[1]); mk.setAttribute('visibility', 'visible');
      tipAt(host, (p[0] / W) * rect.width, (p[1] / H) * rect.height, days[i] + ' · <b>' + resp[i] + ' s</b> avg pickup');
    });
    hit.addEventListener('mouseleave', function () { xh.setAttribute('visibility', 'hidden'); mk.setAttribute('visibility', 'hidden'); hideTip(host); });
    fillTable('t-resp', ' s', resp);
  }

  function draw() {
    ['c-haz', 'c-resp'].forEach(function (id) { document.getElementById(id).innerHTML = ''; });
    barChart();
    lineChart();
  }
  draw();
  var lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(draw.t); draw.t = setTimeout(draw, 150);
  });
})();
