(() => {
  const box = document.createElement('div');
  box.className = 'dp-detail-box';
  box.setAttribute('role', 'tooltip');
  document.body.appendChild(box);

  let activeEl = null;

  function moveBox(x, y) {
    const pad = 12, gap = 14;
    const r = box.getBoundingClientRect();
    const left = (x + gap + r.width + pad > window.innerWidth)
      ? Math.max(pad, x - r.width - gap)
      : x + gap;
    const top = (y + gap + r.height + pad > window.innerHeight)
      ? Math.max(pad, y - r.height - gap)
      : y + gap;
    box.style.left = left + 'px';
    box.style.top = top + 'px';
  }

  function renderBox(e, { title = '', subtitle = '', rows = [] }) {
    if (!title && !rows.length) return;
    box.innerHTML =
      (title ? `<div class="dp-head">${title}</div>` : '') +
      (subtitle ? `<div class="dp-sub">${subtitle}</div>` : '') +
      rows.map(r => `
        <div class="dp-row">
          <span class="dp-label">${r.color ? `<i class="dp-swatch" style="background:${r.color}"></i>` : ''}${r.label}</span>
          <span class="dp-val">${r.value}</span>
        </div>`).join('');
    box.style.display = 'block';
    moveBox(e.clientX, e.clientY);
  }

  function clearBox() {
    box.style.display = 'none';
    if (activeEl) {
      activeEl.style.stroke = activeEl.dataset._s || '';
      activeEl.style.strokeWidth = activeEl.dataset._sw || '';
      activeEl = null;
    }
  }

  document.addEventListener('pointermove', (e) => {
    const pt = e.target.closest('svg circle, svg rect, svg ellipse, .hm-cell');
    if (!pt || !pt.closest('.plot, .workout-feature, .recovery-trend, .heatmap')) {
      if (box.style.display === 'block') clearBox();
      return;
    }

    // Ignore background/grid rects without data or title
    const titleNode = pt.querySelector('title');
    if (titleNode && !pt.dataset._rawTitle) {
      pt.dataset._rawTitle = titleNode.textContent.trim();
      titleNode.remove();
    }

    const skip = new Set(['_s', '_sw', '_rawTitle', 'title', 'subtitle', 'tip']);
    const dataEntries = Object.entries(pt.dataset).filter(([k, v]) => !skip.has(k) && v !== '');
    const rawTitle = pt.dataset._rawTitle || pt.getAttribute('aria-label') || '';

    if (!dataEntries.length && !rawTitle && !pt.dataset.tip) {
      if (box.style.display === 'block') clearBox();
      return;
    }

    // Highlight hovered mark with a crisp ring instead of scaling
    if (activeEl !== pt && pt.tagName !== 'DIV') {
      clearBox();
      activeEl = pt;
      pt.dataset._s = pt.style.stroke || '';
      pt.dataset._sw = pt.style.strokeWidth || '';
      pt.style.stroke = '#FFFFFF';
      pt.style.strokeWidth = '2';
    }

    if (pt.dataset.tip) {
      try { renderBox(e, JSON.parse(pt.dataset.tip)); return; } catch (_) {}
    }

    const rows = dataEntries.map(([k, v]) => ({
      label: k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()),
      value: v
    }));

    let title = pt.dataset.title || '';
    if (!rows.length && rawTitle) {
      const parts = rawTitle.split(/\n|\s*[|·•]\s*/).map(s => s.trim()).filter(Boolean);
      title = title || parts[0] || 'Data Point';
      parts.slice(1).forEach(part => {
        const idx = part.indexOf(':');
        if (idx > -1) {
          rows.push({ label: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() });
        } else {
          rows.push({ label: 'Value', value: part });
        }
      });
    }

    renderBox(e, { title: title || 'Data Point', subtitle: pt.dataset.subtitle || '', rows });
  });
})();
