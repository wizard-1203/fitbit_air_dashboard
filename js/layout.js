/* Consolidated from layout.js */
/* layout.js — card layout contract (loads after the main script).
   - assigns data-span / --ratio to every card (override table below)
   - makes drawChart size itself from the plot box instead of cfg.h
   - redraws charts when only the HEIGHT changes (the old observer ignored that)
   - optional overflow linter: open /?lint=1                                   */
(function () {
  'use strict';

  /* ---- the only place sizing lives: id -> span (3/4/6/8/12) and ratio ---- */
  var SPAN = { sleepdebt: 4, sleephr: 8, sleepStageTrend: 4, 'available-later': 12, deviceHealth: 12,
               sleepinghrv: 6, spo2samples: 6, hrvscatter: 6 };
  var RATIO = { hr24: '18/8', sleepdebt: '16/9', sleepStageTrend: '16/9' };
  var ROWS  = { sleephr: 2 };   /* tall card that two short cards stack beside */
  var DEFAULT_RATIO = '16/7', WIDE_RATIO = '18/5';

  var ROOTS = ['#charts', '#overviewCharts'];

  function applyLayout() {
    ROOTS.forEach(function (sel) {
      var root = document.querySelector(sel);
      if (!root) return;
      Array.prototype.forEach.call(root.children, function (card) {
        if (!card.classList || !card.classList.contains('card')) return;
        var id = (card.id || '').replace(/^card-/, '');
        var span = String(SPAN[id] || (card.classList.contains('wide') ? 12 : 6));
        var ratio = RATIO[id] || (span === '12' ? WIDE_RATIO : DEFAULT_RATIO);
        if (card.dataset.span !== span) card.dataset.span = span;
        if (ROWS[id]) { if (card.dataset.rows !== String(ROWS[id])) card.dataset.rows = String(ROWS[id]); }
        else if (card.dataset.rows) delete card.dataset.rows;
        if (card.style.getPropertyValue('--ratio') !== ratio) card.style.setProperty('--ratio', ratio);
        if (sel === '#charts') observePlot(card);
      });
    });
  }

  /* ---- drawChart: measure the real box, never trust cfg.h ---- */
  var origDraw = window.drawChart;
  if (typeof origDraw === 'function') {
    window.drawChart = function (host, cfg) {
      if (!host || !host.isConnected || !cfg) return origDraw.apply(this, arguments);
      host.classList.add('plot-chart');
      var h = Math.floor(host.getBoundingClientRect().height);
      var c = h >= 120 ? Object.assign({}, cfg, { h: h }) : cfg;
      var out = origDraw.call(this, host, c);
      if (!host.querySelector(':scope > svg')) host.classList.remove('plot-chart'); // empty-state message
      return out;
    };
  }

  /* ---- renderCardByElement: drop the chart box before html builders run,
          restore it if the call was a cache hit that kept the old SVG ---- */
  var origRender = window.renderCardByElement;
  if (typeof origRender === 'function') {
    window.renderCardByElement = function (card, force) {
      var host = card && card.querySelector && card.querySelector('.plot');
      var had = !!(host && host.classList.contains('plot-chart'));
      if (had) host.classList.remove('plot-chart');
      var out = origRender.apply(this, arguments);
      if (had && host && !host.classList.contains('plot-chart') &&
          !host.dataset.renderedHtml && host.querySelector(':scope > svg')) {
        host.classList.add('plot-chart');
      }
      return out;
    };
  }

  /* ---- redraw on HEIGHT-only changes (width changes are handled by the
          existing observer). Redrawing never changes the plot size => no loop. ---- */
  var seen = new WeakMap(), timers = new WeakMap(), ro = null;
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(function (entries) {
      entries.forEach(function (e) {
        var el = e.target, w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height);
        var p = seen.get(el); seen.set(el, { w: w, h: h });
        if (!p || p.w !== w || Math.abs(p.h - h) <= 6 || !el.classList.contains('plot-chart')) return;
        clearTimeout(timers.get(el));
        timers.set(el, setTimeout(function () {
          var card = el.closest('.card');
          if (card && typeof window.renderCardByElement === 'function') window.renderCardByElement(card, true);
        }, 120));
      });
    });
  }
  function observePlot(card) {
    var plot = card.querySelector('.plot');
    if (ro && plot) ro.observe(plot);
  }

  /* ---- re-apply whenever cards are (re)built ---- */
  if ('MutationObserver' in window) {
    var mo = new MutationObserver(applyLayout);
    ROOTS.forEach(function (sel) {
      var root = document.querySelector(sel);
      if (root) mo.observe(root, { childList: true });
    });
  }
  applyLayout();

  /* ---- ?lint=1: outline any card whose content spills outside it ---- */
  function lint() {
    document.querySelectorAll('.card').forEach(function (c) {
      if (!c.offsetParent) return;
      var box = c.getBoundingClientRect(), bad = null;
      c.querySelectorAll('.plot, .plot *').forEach(function (n) {
        if (bad || n.closest('.tip') || n.closest('.spo2-tip')) return;
        var r = n.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (r.right > box.right + 2 || r.left < box.left - 2)) bad = n;
      });
      var tooWide = c.scrollWidth > c.clientWidth + 2;
      c.classList.toggle('layout-bad', !!(bad || tooWide));
      if (bad || tooWide) console.warn('[layout] overflow in', c.id, bad || '(card scrollWidth)');
    });
  }
  if (/[?&]lint=1/.test(location.search)) {
    window.addEventListener('resize', lint);
    setInterval(lint, 2000);
  }
})();

