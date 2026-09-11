// m8m dashboard frontend (vanilla JS + D3).

const $app = document.getElementById('app');

const PLATFORM_COLORS = {
  claude_code: '#7c3aed',
  claude_web: '#a78bfa',
  claude_desktop: '#6d28d9',
  chatgpt_web: '#10b981',
  cursor: '#3b82f6',
  local_file: '#f59e0b',
  manual_import: '#6b7280',
  unknown: '#ef4444',
};
const SEVERITY_COLORS = { critical: '#ef4444', warning: '#f59e0b', info: '#22d3ee' };
const ACCENT = '#7c3aed';

function platformColor(p) { return PLATFORM_COLORS[p] || PLATFORM_COLORS.unknown; }
function severityColor(s) { return SEVERITY_COLORS[s] || '#22d3ee'; }
function trustColor(t) { return t >= 0.7 ? '#22c55e' : t >= 0.3 ? '#f59e0b' : '#ef4444'; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function badge(text, cls) { return el('span', { class: `badge ${cls || ''}`, text }); }

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function act(path, body) {
  try {
    await api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    invalidateCache();
    refresh();
  } catch (err) {
    alert(`Action failed: ${err.message}`);
  }
}

// --- client-side cache ---
const cache = {};
async function cached(key, fn) {
  if (cache[key] !== undefined) return cache[key];
  const v = await fn();
  cache[key] = v;
  return v;
}
function invalidateCache() { for (const k of Object.keys(cache)) delete cache[k]; }

// --- tooltip ---
let tooltipEl = null;
function showTooltip(html, x, y) {
  if (!tooltipEl) {
    tooltipEl = el('div', { class: 'tooltip' });
    document.body.appendChild(tooltipEl);
  }
  tooltipEl.innerHTML = html;
  const w = tooltipEl.offsetWidth || 300;
  const h = tooltipEl.offsetHeight || 80;
  const left = Math.min(x + 14, window.innerWidth - w - 12);
  const top = Math.min(y + 14, window.innerHeight - h - 12);
  tooltipEl.style.left = `${Math.max(8, left)}px`;
  tooltipEl.style.top = `${Math.max(8, top)}px`;
  tooltipEl.style.display = 'block';
}
function hideTooltip() { if (tooltipEl) tooltipEl.style.display = 'none'; }

function emptyState(msg) { return el('div', { class: 'empty', text: msg }); }

function section(title, ...children) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', { text: title }));
  for (const c of children) card.appendChild(c);
  return card;
}

function d3Ready() { return typeof d3 !== 'undefined'; }

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------------------------------------------------------------------------
// Shared: memory detail panel
// ---------------------------------------------------------------------------

async function renderMemoryDetail(id, container) {
  const m = await api(`/api/memories/${id}`);
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'row' }, badge(m.status, m.status === 'quarantined' ? 'sev-critical' : 'sev-info'), badge(m.source_platform, 'platform')));
  container.appendChild(el('div', { class: 'content', text: m.content }));
  container.appendChild(el('div', { class: 'meta', text: `trust ${m.trust_level.toFixed(2)} · category ${m.category} · v${m.version}` }));
  if (m.entities && m.entities.length) container.appendChild(el('div', { class: 'meta', text: `entities: ${m.entities.join(', ')}` }));
  if (m.flags && m.flags.length) container.appendChild(el('div', { class: 'meta', text: 'flags: ' + m.flags.map((f) => f.type).join(', ') }));
  const actions = el('div', { class: 'row', style: 'margin-top:10px' });
  if (m.status === 'quarantined') {
    actions.appendChild(el('button', { class: 'action ok', text: 'Restore', onclick: () => act(`/api/memories/${m.id}/restore`) }));
  } else {
    actions.appendChild(el('button', { class: 'action danger', text: 'Quarantine', onclick: () => act(`/api/memories/${m.id}/quarantine`) }));
    actions.appendChild(el('button', { class: 'action', text: 'Flag', onclick: () => act(`/api/memories/${m.id}/flag`, { reason: 'Flagged from dashboard' }) }));
    actions.appendChild(el('button', { class: 'action', text: 'Dismiss', onclick: () => act(`/api/memories/${m.id}/dismiss`) }));
  }
  container.appendChild(actions);
  if (m.changelog && m.changelog.length) {
    container.appendChild(el('h3', { text: 'History' }));
    for (const c of m.changelog.slice(0, 12)) {
      container.appendChild(el('div', { class: 'meta', text: `${c.changed_at} · ${c.change_type}` }));
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Overview
// ---------------------------------------------------------------------------

async function overview() {
  const [stats, changelog, events, memories] = await Promise.all([
    cached('stats', () => api('/api/memories/stats')),
    cached('changelog', () => api('/api/changelog')),
    cached('events', () => api('/api/events')),
    cached('memories', () => api('/api/memories')),
  ]);
  const unresolved = events.filter((e) => !e.resolved_at);
  const bySev = { critical: 0, warning: 0, info: 0 };
  for (const e of unresolved) bySev[e.severity] = (bySev[e.severity] || 0) + 1;

  $app.innerHTML = '';
  const wrap = el('div', { class: 'view' });

  const grid = el('div', { class: 'stat-grid' },
    el('div', { class: 'stat' }, el('div', { class: 'value', text: String(stats.total) }), el('div', { class: 'label', text: 'Total memories' })),
    el('div', { class: 'stat' }, el('div', { class: 'value small', text: String(stats.active) }), el('div', { class: 'label', text: 'Active' })),
    el('div', { class: 'stat' }, el('div', { class: 'value small', text: String(stats.quarantined) }), el('div', { class: 'label', text: 'Quarantined' })),
    el('div', { class: 'stat' }, el('div', { class: 'value small', text: String(stats.flagged) }), el('div', { class: 'label', text: 'Flagged' })),
    el('div', { class: 'stat' },
      el('div', { class: 'value accent', text: String(unresolved.length) }),
      el('div', { class: 'label', text: `Unresolved (${bySev.critical} crit · ${bySev.warning} warn · ${bySev.info} info)`) },
    ),
  );
  wrap.appendChild(grid);

  const total = Object.values(stats.by_platform).reduce((a, b) => a + b, 0) || 1;
  const bar = el('div', { class: 'stacked-bar' });
  for (const [p, c] of Object.entries(stats.by_platform)) {
    bar.appendChild(el('div', { style: `width:${(c / total) * 100}%; background:${platformColor(p)}` }));
  }
  const legend = el('div', { class: 'legend' });
  for (const [p, c] of Object.entries(stats.by_platform)) {
    legend.appendChild(el('div', { class: 'legend-item' }, el('span', { class: 'legend-swatch', style: `background:${platformColor(p)}` }), `${p} · ${c}`));
  }
  wrap.appendChild(section('Memory sources', bar, legend));

  const cl = section('Recent changes');
  if (!changelog.length) cl.appendChild(emptyState('No changes recorded yet.'));
  for (const c of changelog.slice(0, 20)) {
    const kind = c.change_type === 'created' ? 'added' : c.change_type === 'deleted' ? 'deleted' : 'modified';
    const card = el('div', { class: `card ${kind}`, style: 'padding:8px 12px; margin-bottom:6px' });
    card.appendChild(el('div', { class: 'row' },
      badge(c.change_type, kind === 'added' ? 'sev-info' : kind === 'deleted' ? 'sev-critical' : 'sev-warning'),
      el('span', { class: 'meta', text: timeAgo(c.changed_at) }),
      badge(c.detected_by, 'platform'),
      el('span', { class: 'meta', text: truncate(c.new_content || c.old_content || '', 80), style: 'flex:1' }),
    ));
    cl.appendChild(card);
  }
  wrap.appendChild(cl);

  const flagged = memories.filter((m) => m.flags && m.flags.length);
  const qa = section('Quick actions');
  if (flagged.length || unresolved.length) {
    for (const m of flagged.slice(0, 8)) {
      qa.appendChild(el('div', { class: 'row', style: 'margin:4px 0' },
        el('span', { class: 'meta', text: truncate(m.content, 60), style: 'flex:1' }),
        badge(m.flags.length + ' flag' + (m.flags.length > 1 ? 's' : ''), 'flag'),
        el('button', { class: 'action danger', text: 'Quarantine', onclick: () => act(`/api/memories/${m.id}/quarantine`) }),
        el('button', { class: 'action', text: 'Dismiss', onclick: () => act(`/api/memories/${m.id}/dismiss`) }),
      ));
    }
    for (const e of unresolved.slice(0, 5)) {
      qa.appendChild(el('div', { class: 'row', style: 'margin:4px 0' },
        badge(e.severity, `sev-${e.severity}`),
        el('span', { class: 'meta', text: e.title, style: 'flex:1' }),
        el('button', { class: 'action ok', text: 'Resolve', onclick: () => act(`/api/events/${e.id}/resolve`, { resolution: 'user_dismissed' }) }),
      ));
    }
  } else {
    qa.appendChild(emptyState('All clear — no flags or unresolved events.'));
  }
  wrap.appendChild(qa);

  $app.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// 2. Constellation
// ---------------------------------------------------------------------------

async function constellation() {
  if (!d3Ready()) return showD3Missing();
  const memories = await cached('memories', () => api('/api/memories'));

  $app.innerHTML = '';
  const wrap = el('div', { class: 'view' });
  wrap.appendChild(el('h2', { text: 'Memory Constellation' }));

  const state = { platform: 'all', trust: 'all', showQuarantined: true };

  const filters = el('div', { class: 'filters' });
  const platforms = ['all', ...new Set(memories.map((m) => m.source_platform))];
  const platformF = el('div', { class: 'filters', style: 'display:inline-flex' });
  for (const p of platforms) {
    platformF.appendChild(el('button', { class: 'filter-btn' + (p === 'all' ? ' active' : ''), text: p, onclick: (ev) => { state.platform = p; setActive(ev.target); renderGraph(); } }));
  }
  const trustF = el('div', { class: 'filters', style: 'display:inline-flex' });
  for (const t of ['all', 'high', 'medium', 'low']) {
    trustF.appendChild(el('button', { class: 'filter-btn' + (t === 'all' ? ' active' : ''), text: t, onclick: (ev) => { state.trust = t; setActive(ev.target); renderGraph(); } }));
  }
  const qToggle = el('button', { class: 'filter-btn active', text: 'Show quarantined', onclick: (ev) => { state.showQuarantined = !state.showQuarantined; ev.target.classList.toggle('active'); renderGraph(); } });

  function setActive(btn) { for (const b of btn.parentNode.children) b.classList.remove('active'); btn.classList.add('active'); }

  filters.appendChild(el('span', { class: 'muted', text: 'Platform ' }), platformF, el('span', { class: 'muted', text: ' Trust ' }), trustF, qToggle);
  wrap.appendChild(filters);

  const cwrap = el('div', { class: 'constellation-wrap' });
  const main = el('div', { class: 'constellation-main' });
  const svg = el('svg', { class: 'constellation-svg' });
  main.appendChild(svg);
  const panel = el('div', { class: 'detail-panel' });
  cwrap.appendChild(main);
  cwrap.appendChild(panel);
  wrap.appendChild(cwrap);

  const legend = el('div', { class: 'legend' },
    el('div', { class: 'legend-item' }, el('span', { class: 'legend-swatch', style: 'background:#22c55e' }), 'high trust'),
    el('div', { class: 'legend-item' }, el('span', { class: 'legend-swatch', style: 'background:#f59e0b' }), 'medium'),
    el('div', { class: 'legend-item' }, el('span', { class: 'legend-swatch', style: 'background:#ef4444' }), 'low'),
    el('div', { class: 'legend-item' }, el('span', { class: 'legend-swatch', style: 'background:#7c3aed' }), 'stroke = platform'),
  );
  wrap.appendChild(legend);

  $app.appendChild(wrap);

  function filtered() {
    return memories.filter((m) => {
      if (m.status === 'deleted') return false;
      if (!state.showQuarantined && m.status === 'quarantined') return false;
      if (state.platform !== 'all' && m.source_platform !== state.platform) return false;
      if (state.trust === 'high' && m.trust_level < 0.7) return false;
      if (state.trust === 'medium' && (m.trust_level < 0.3 || m.trust_level >= 0.7)) return false;
      if (state.trust === 'low' && m.trust_level >= 0.3) return false;
      return true;
    });
  }

  function renderGraph() {
    svg.innerHTML = '';
    panel.classList.remove('open');
    panel.innerHTML = '';
    const nodes = filtered().map((m) => ({
      ...m,
      r: Math.max(4, Math.min(16, String(m.content).length * 0.2)),
      x: Math.random() * 800,
      y: Math.random() * 560,
    }));
    if (nodes.length === 0) { svg.parentNode.replaceChild(emptyState('No memories to map yet.'), svg); return; }

    const links = [];
    const seen = new Set();
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const shared = (a.entities || []).filter((e) => (b.entities || []).includes(e)).length;
        if (shared > 0) {
          const key = [a.id, b.id].sort().join('|');
          if (!seen.has(key)) { seen.add(key); links.push({ source: a.id, target: b.id, weight: shared }); }
        }
      }
    }

    const w = main.clientWidth || 800;
    const h = 560;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    if (!svg.parentNode) return;

    const g = d3.select(svg).append('g');
    const zoom = d3.zoom().scaleExtent([0.3, 5]).on('zoom', (ev) => g.attr('transform', ev.transform));
    d3.select(svg).call(zoom);

    const sim = d3.forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(-140))
      .force('center', d3.forceCenter(w / 2, h / 2))
      .force('collide', d3.forceCollide().radius((d) => d.r + 6));
    if (links.length) {
      sim.force('link', d3.forceLink(links).id((d) => d.id).distance(70).strength((l) => 0.2 + Math.min(1, l.weight) * 0.4));
    } else {
      const plats = [...new Set(nodes.map((n) => n.source_platform))];
      const pos = {};
      plats.forEach((p, i) => { const a = (i / plats.length) * Math.PI * 2; pos[p] = { x: w / 2 + Math.cos(a) * Math.min(w, h) / 3, y: h / 2 + Math.sin(a) * Math.min(w, h) / 3 }; });
      sim.force('x', d3.forceX((d) => pos[d.source_platform].x).strength(0.2))
        .force('y', d3.forceY((d) => pos[d.source_platform].y).strength(0.2));
    }

    const linkSel = g.append('g').selectAll('line').data(links).join('line')
      .attr('class', 'link')
      .attr('stroke-opacity', (d) => 0.15 + Math.min(1, d.weight) * 0.4);

    const nodeSel = g.append('g').selectAll('g').data(nodes).join('g')
      .attr('class', (d) => 'node' + (d.flags && d.flags.length ? ' node-flagged' : ''))
      .on('mouseover', (ev, d) => {
        showTooltip(
          `<div style="font-weight:600">${escapeHtml(truncate(d.content, 80))}</div>` +
          `<div class="muted">trust ${d.trust_level.toFixed(2)} · ${d.source_platform} · ${d.flags.length} flags</div>`,
          ev.clientX, ev.clientY,
        );
      })
      .on('mousemove', (ev) => { if (tooltipEl && tooltipEl.style.display !== 'none') showTooltip(tooltipEl.innerHTML, ev.clientX, ev.clientY); })
      .on('mouseout', hideTooltip)
      .on('click', (_ev, d) => { panel.classList.add('open'); panel.innerHTML = ''; panel.appendChild(el('div', { class: 'meta', text: 'Loading…' })); renderMemoryDetail(d.id, panel); })
      .call(d3.drag()
        .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

    nodeSel.each(function (d) {
      const sel = d3.select(this);
      const fill = trustColor(d.trust_level);
      const stroke = platformColor(d.source_platform);
      const sw = d.flags && d.flags.length ? 4 : 2;
      if (d.status === 'quarantined') {
        sel.append('path')
          .attr('d', d3.symbol().type(d3.symbolDiamond).size(d.r * d.r * 4)())
          .attr('fill', fill).attr('stroke', stroke).attr('stroke-width', sw);
      } else {
        sel.append('circle').attr('r', d.r).attr('fill', fill).attr('stroke', stroke).attr('stroke-width', sw);
      }
    });

    sim.on('tick', () => {
      linkSel.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
      nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });
  }

  renderGraph();
}

// ---------------------------------------------------------------------------
// 3. River
// ---------------------------------------------------------------------------

async function river() {
  if (!d3Ready()) return showD3Missing();
  const data = await cached('timeline', () => api('/api/memories/timeline-data'));
  const rv = data.river;

  $app.innerHTML = '';
  const wrap = el('div', { class: 'view' });
  wrap.appendChild(el('h2', { text: 'Temporal River' }));

  const total = rv.buckets.reduce((s, b) => s + Object.values(b.counts).reduce((a, c) => a + c, 0), 0);
  if (total < 10) {
    wrap.appendChild(emptyState('Fewer than 10 memories — import more data to see the river.'));
    $app.appendChild(wrap);
    return;
  }

  const card = el('div', { class: 'card chart-card' });
  const svg = el('svg');
  card.appendChild(svg);
  wrap.appendChild(card);
  $app.appendChild(wrap);

  const w = card.clientWidth || 1000;
  const h = 360;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const margin = { top: 10, right: 20, bottom: 30, left: 20 };

  const platforms = rv.platforms;
  const x = d3.scaleTime()
    .domain([new Date(rv.buckets[0].start), new Date(rv.buckets[rv.buckets.length - 1].end)])
    .range([margin.left, w - margin.right]);
  const stack = d3.stack().keys(platforms).offset(d3.stackOffsetSilhouette).value((b, key) => b.counts[key] || 0);
  const series = stack(rv.buckets);
  const yMax = d3.max(series, (s) => d3.max(s, (d) => d[1]));
  const y = d3.scaleLinear().domain([-yMax, yMax]).range([h - margin.bottom, margin.top]);

  const area = d3.area()
    .x((d) => x(new Date(d.data.start)))
    .y0((d) => y(d[0]))
    .y1((d) => y(d[1]))
    .curve(d3.curveBasis);

  const g = d3.select(svg).append('g');
  g.selectAll('path').data(series).join('path')
    .attr('class', 'river-layer')
    .attr('d', area)
    .attr('fill', (d) => platformColor(d.key))
    .attr('opacity', 0.85)
    .on('mouseover', function () { d3.selectAll('.river-layer').attr('opacity', 0.2); d3.select(this).attr('opacity', 1); })
    .on('mouseout', () => d3.selectAll('.river-layer').attr('opacity', 0.85));

  const counts = rv.buckets.map((b) => Object.values(b.counts).reduce((a, c) => a + c, 0));
  const avg = counts.reduce((a, c) => a + c, 0) / Math.max(1, counts.length);
  rv.buckets.forEach((b, i) => {
    if (counts[i] > avg * 3 && avg > 0) {
      g.append('line')
        .attr('x1', x(new Date(b.start))).attr('x2', x(new Date(b.start)))
        .attr('y1', margin.top).attr('y2', h - margin.bottom)
        .attr('stroke', '#ef4444').attr('stroke-dasharray', '4 4').attr('stroke-width', 1.5)
        .append('title').text(`Spike: ${counts[i]} memories (avg ${avg.toFixed(1)})`);
    }
  });

  g.append('g').attr('transform', `translate(0,${h - margin.bottom})`).call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));
  g.append('line').attr('x1', margin.left).attr('x2', w - margin.right).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', 'rgba(255,255,255,0.2)').attr('stroke-width', 1);

  const legend = el('div', { class: 'legend' });
  for (const p of platforms) legend.appendChild(el('div', { class: 'legend-item' }, el('span', { class: 'legend-swatch', style: `background:${platformColor(p)}` }), p));
  wrap.appendChild(legend);
}

// ---------------------------------------------------------------------------
// 4. Heatmap
// ---------------------------------------------------------------------------

const PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'older'];
const PERIOD_LABELS = ['Today', 'Yesterday', 'This week', 'Last week', 'This month', 'Last month', 'Older'];

async function heatmap() {
  const data = await cached('timeline', () => api('/api/memories/timeline-data'));
  const hm = data.heatmap;

  $app.innerHTML = '';
  const wrap = el('div', { class: 'view' });
  wrap.appendChild(el('h2', { text: 'Trust Heatmap' }));
  if (!hm.source_types.length) {
    wrap.appendChild(emptyState('No memories yet.'));
    $app.appendChild(wrap);
    return;
  }

  const cells = new Map(hm.cells.map((c) => [`${c.source_type}|${c.period}`, c]));
  const colTotals = PERIODS.map((p) => hm.cells.filter((c) => c.period === p).reduce((s, c) => s + c.count, 0));
  const rowTotals = hm.source_types.map((st) => hm.cells.filter((c) => c.source_type === st).reduce((s, c) => s + c.count, 0));

  const scroll = el('div', { class: 'heatmap-scroll' });
  const grid = el('div', { class: 'heatmap-grid', style: `grid-template-columns: 130px repeat(${PERIODS.length}, minmax(64px,1fr)) 70px` });

  grid.appendChild(el('div', { class: 'heatmap-label', text: 'source \\ time' }));
  for (const pl of PERIOD_LABELS) grid.appendChild(el('div', { class: 'heatmap-label', style: 'justify-content:center', text: pl }));
  grid.appendChild(el('div', { class: 'heatmap-label', style: 'justify-content:flex-end', text: 'Σ' }));

  for (const st of hm.source_types) {
    grid.appendChild(el('div', { class: 'heatmap-label', text: st }));
    for (const p of PERIODS) {
      const c = cells.get(`${st}|${p}`);
      const count = c ? c.count : 0;
      const hue = c ? trustColor(c.avg_trust) : '#888';
      const cell = el('div', {
        class: 'heatmap-cell',
        text: count > 0 ? String(count) : '',
        style: `background:${count ? hexAlpha(hue, 0.18 + Math.min(1, count / 8) * 0.82) : 'rgba(255,255,255,0.03)'}; color:${count ? '#fff' : 'transparent'}`,
      });
      if (c) cell.setAttribute('title', `${st} · ${PERIOD_LABELS[PERIODS.indexOf(p)]}: ${c.count} memories, avg trust ${c.avg_trust.toFixed(2)}, ${c.flagged_count} flagged`);
      cell.onclick = async () => {
        if (!count) return;
        const mems = (await cached('memories', () => api('/api/memories'))).filter((m) => m.source_type === st && periodOfLocal(new Date(m.first_seen)) === p);
        showTooltip(mems.map((m) => `<div>${escapeHtml(truncate(m.content, 42))} <span class="muted">t${m.trust_level.toFixed(2)}</span></div>`).join(''), event.clientX, event.clientY);
      };
      grid.appendChild(cell);
    }
    grid.appendChild(el('div', { class: 'heatmap-label', style: 'justify-content:flex-end', text: String(rowTotals[hm.source_types.indexOf(st)]) }));
  }

  grid.appendChild(el('div', { class: 'heatmap-label', text: 'Total' }));
  for (const t of colTotals) grid.appendChild(el('div', { class: 'heatmap-label', style: 'justify-content:center', text: String(t) }));
  grid.appendChild(el('div', { class: 'heatmap-label', style: 'justify-content:flex-end', text: String(hm.cells.reduce((s, c) => s + c.count, 0)) }));

  scroll.appendChild(grid);
  wrap.appendChild(scroll);

  const legend = el('div', { class: 'legend' },
    el('div', { class: 'legend-item' }, el('span', { class: 'legend-swatch', style: 'background:#22c55e' }), 'high trust'),
    el('div', { class: 'legend-item' }, el('span', { class: 'legend-swatch', style: 'background:#f59e0b' }), 'medium'),
    el('div', { class: 'legend-item' }, el('span', { class: 'legend-swatch', style: 'background:#ef4444' }), 'low'),
  );
  wrap.appendChild(legend);
  $app.appendChild(wrap);
}

function hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function periodOfLocal(d) {
  const now = new Date();
  const day = 86400000;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const t = d.getTime();
  if (t >= today.getTime()) return 'today';
  if (t >= today.getTime() - day) return 'yesterday';
  const week = startOfWeekLocal(now).getTime();
  if (t >= week) return 'this_week';
  if (t >= week - 7 * day) return 'last_week';
  if (t >= new Date(now.getFullYear(), now.getMonth(), 1).getTime()) return 'this_month';
  if (t >= new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()) return 'last_month';
  return 'older';
}
function startOfWeekLocal(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }

// ---------------------------------------------------------------------------
// 5. Radar
// ---------------------------------------------------------------------------

const RADAR_AXES = [
  { key: 'instruction_detected', label: 'Instructions', sev: 'warning' },
  { key: 'credential_detected', label: 'Credentials', sev: 'critical' },
  { key: 'source_unknown', label: 'Unknown source', sev: 'info' },
  { key: 'contradiction_detected', label: 'Contradictions', sev: 'warning' },
  { key: 'url_detected', label: 'URLs / emails', sev: 'info' },
  { key: 'hidden_chars', label: 'Hidden chars', sev: 'warning' },
];

async function radar() {
  if (!d3Ready()) return showD3Missing();
  const [data, events] = await Promise.all([
    cached('timeline', () => api('/api/memories/timeline-data')),
    cached('events', () => api('/api/events')),
  ]);
  const rd = data.radar;

  $app.innerHTML = '';
  const wrap = el('div', { class: 'view' });
  wrap.appendChild(el('h2', { text: 'Security Radar' }));

  const allZero = RADAR_AXES.every((a) => rd[a.key] === 0);

  const rwrap = el('div', { class: 'radar-wrap' });
  const svg = el('svg', { class: 'radar-svg' });
  rwrap.appendChild(svg);

  const bars = el('div', { style: 'flex:1; min-width:260px' });
  for (const a of RADAR_AXES) {
    const v = rd[a.key];
    const max = Math.max(1, ...RADAR_AXES.map((x) => rd[x.key]));
    bars.appendChild(el('div', { class: 'bar-row' },
      el('span', { class: 'bar-label', text: a.label }),
      el('span', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: `width:${(v / max) * 100}%; background:${severityColor(a.sev)}` })),
      el('span', { class: 'muted', text: String(v) }),
    ));
  }
  rwrap.appendChild(bars);
  wrap.appendChild(rwrap);

  const size = 420, cx = size / 2, cy = size / 2, radius = size / 2 - 70;
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const max = Math.max(1, ...RADAR_AXES.map((a) => rd[a.key]));
  const angle = (i) => (Math.PI * 2 * i) / RADAR_AXES.length - Math.PI / 2;
  const scale = (v) => (v / max) * radius;

  const sd = d3.select(svg);
  for (let ring = 1; ring <= 4; ring++) {
    sd.append('circle').attr('cx', cx).attr('cy', cy).attr('r', (radius * ring) / 4)
      .attr('fill', 'none').attr('stroke', 'rgba(255,255,255,0.08)').attr('stroke-width', 1);
  }
  RADAR_AXES.forEach((a, i) => {
    sd.append('line').attr('x1', cx).attr('y1', cy).attr('x2', cx + Math.cos(angle(i)) * radius).attr('y2', cy + Math.sin(angle(i)) * radius).attr('stroke', 'rgba(255,255,255,0.08)');
    sd.append('text').attr('x', cx + Math.cos(angle(i)) * (radius + 22)).attr('y', cy + Math.sin(angle(i)) * (radius + 22))
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle').attr('fill', '#999').attr('font-size', 11).text(a.label);
  });

  const points = RADAR_AXES.map((a, i) => ({ angle: angle(i), radius: scale(rd[a.key]) }));
  const line = d3.lineRadial().angle((d) => d.angle).radius((d) => d.radius).curve(d3.curveLinearClosed);
  sd.append('path').attr('d', line(points)).attr('fill', ACCENT).attr('fill-opacity', 0.2).attr('stroke', ACCENT).attr('stroke-width', 2);
  RADAR_AXES.forEach((a, i) => {
    sd.append('circle').attr('cx', cx + Math.cos(angle(i)) * scale(rd[a.key])).attr('cy', cy + Math.sin(angle(i)) * scale(rd[a.key]))
      .attr('r', 3).attr('fill', ACCENT)
      .on('mouseover', (ev) => showTooltip(`<b>${a.label}</b>: ${rd[a.key]}`, ev.clientX, ev.clientY))
      .on('mouseout', hideTooltip);
  });

  if (allZero) {
    sd.append('text').attr('x', cx).attr('y', cy).attr('text-anchor', 'middle').attr('fill', '#22c55e').attr('font-size', 13).text('No threats detected');
  }

  const unresolved = events.filter((e) => !e.resolved_at);
  const ev = section('Unresolved security events');
  if (!unresolved.length) ev.appendChild(emptyState('All clear.'));
  for (const e of unresolved) {
    const card = el('div', { class: `card ${e.severity === 'critical' ? 'deleted' : 'modified'}`, style: 'padding:8px 12px; margin-bottom:6px' });
    card.appendChild(el('div', { class: 'row' },
      badge(e.severity, `sev-${e.severity}`),
      el('strong', { text: e.title }),
      el('span', { class: 'meta', text: timeAgo(e.detected_at) }),
      el('button', { class: 'action ok', text: 'Resolve', onclick: () => act(`/api/events/${e.id}/resolve`, { resolution: 'user_dismissed' }) }),
    ));
    ev.appendChild(card);
  }
  wrap.appendChild(ev);
  $app.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// 6. Butterfly (diff)
// ---------------------------------------------------------------------------

async function butterfly() {
  const [data, tl] = await Promise.all([
    api('/api/diff'),
    cached('timeline', () => api('/api/memories/timeline-data')),
  ]);

  $app.innerHTML = '';
  const wrap = el('div', { class: 'view' });
  wrap.appendChild(el('h2', { text: 'Diff Butterfly' }));

  if (!data.added && !data.modified && !data.deleted && !data.snapshot && !data.changelog) {
    wrap.appendChild(emptyState('Take a snapshot first with `m8m snapshot`, then changes will appear here.'));
    $app.appendChild(wrap);
    return;
  }

  const baseSel = el('select', { class: 'action' });
  baseSel.appendChild(el('option', { value: 'latest', text: 'Base: last snapshot' }));
  for (const s of tl.snapshots || []) {
    baseSel.appendChild(el('option', { value: s.id, text: `Snapshot ${s.id.slice(0, 8)} (${s.platform})` }));
  }
  const controls = el('div', { class: 'row', style: 'margin-bottom:12px' }, baseSel, el('span', { class: 'meta', text: '→ current state' }));
  baseSel.onchange = async () => {
    const v = baseSel.value;
    const d = v === 'latest' ? await api('/api/diff') : await api(`/api/diff?snapshot=${v}`);
    renderButterfly(d);
  };
  wrap.appendChild(controls);

  const target = el('div');
  wrap.appendChild(target);
  $app.appendChild(wrap);

  function renderButterfly(d) {
    target.innerHTML = '';
    if (!d.added && !d.modified && !d.deleted) {
      target.appendChild(emptyState('No differences since that point.'));
      return;
    }
    target.appendChild(el('div', { class: 'meta', style: 'margin-bottom:10px' },
      `${d.added.length} added · ${d.modified.length} modified · ${d.deleted.length} deleted · ${d.unchanged_count ?? 0} unchanged`,
    ));

    const leftItems = [...d.deleted.map((m) => ({ m, kind: 'deleted' })), ...d.modified.map((m) => ({ m: m.before, kind: 'modified' }))];
    const rightItems = [...d.added.map((m) => ({ m, kind: 'added' })), ...d.modified.map((m) => ({ m: m.after, kind: 'modified' }))];

    const rows = Math.max(leftItems.length, rightItems.length);
    for (let i = 0; i < rows; i++) {
      const row = el('div', { class: 'butterfly-row' });
      const leftSide = el('div', { class: 'butterfly-side left' });
      const rightSide = el('div', { class: 'butterfly-side' });
      const spine = el('div', { class: 'butterfly-spine', text: i === 0 ? String(d.unchanged_count ?? 0) : '' });
      if (leftItems[i]) {
        const it = leftItems[i];
        const bar = el('div', { class: `butterfly-bar left ${it.kind === 'modified' ? 'modified' : ''}`, text: truncate(it.m.content, 40) });
        bar.onmouseover = (ev) => showTooltip(`<b>${it.kind}</b><div>${escapeHtml(it.m.content)}</div><div class="muted">${it.m.source_platform} · trust ${it.m.trust_level.toFixed(2)}</div>`, ev.clientX, ev.clientY);
        bar.onmouseout = hideTooltip;
        leftSide.appendChild(bar);
      }
      if (rightItems[i]) {
        const it = rightItems[i];
        const bar = el('div', { class: 'butterfly-bar right', text: truncate(it.m.content, 40) });
        bar.onmouseover = (ev) => showTooltip(`<b>${it.kind === 'modified' ? 'new version' : 'added'}</b><div>${escapeHtml(it.m.content)}</div><div class="muted">${it.m.source_platform} · trust ${it.m.trust_level.toFixed(2)}</div>`, ev.clientX, ev.clientY);
        bar.onmouseout = hideTooltip;
        rightSide.appendChild(bar);
      }
      row.appendChild(leftSide);
      row.appendChild(spine);
      row.appendChild(rightSide);
      target.appendChild(row);
    }
  }

  renderButterfly(data);
}

// ---------------------------------------------------------------------------
// 7. Decay timeline
// ---------------------------------------------------------------------------

async function decay() {
  if (!d3Ready()) return showD3Missing();
  const memories = await cached('memories', () => api('/api/memories'));

  $app.innerHTML = '';
  const wrap = el('div', { class: 'view' });
  wrap.appendChild(el('h2', { text: 'Memory Decay Timeline' }));
  if (!memories.length) {
    wrap.appendChild(emptyState('No memories yet.'));
    $app.appendChild(wrap);
    return;
  }

  const shown = memories.filter((m) => m.status !== 'deleted').slice(0, 50);
  const svg = el('svg', { class: 'decay-svg' });
  wrap.appendChild(el('div', { class: 'decay-scroll' }, svg));
  $app.appendChild(wrap);

  const times = shown.map((m) => new Date(m.first_seen).getTime()).filter((t) => !Number.isNaN(t));
  const minT = Math.min(...times);
  const maxT = Date.now();
  const w = 900, rowH = 22, labelW = 240, chartW = w - labelW - 10;
  const h = shown.length * rowH + 24;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', '100%');

  const x = d3.scaleLinear().domain([minT, maxT]).range([0, chartW]);
  const sd = d3.select(svg);
  const chartG = sd.append('g').attr('transform', `translate(${labelW},14)`);

  chartG.append('g').call(d3.axisTop(x).ticks(6).tickFormat((d) => { const dt = new Date(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; })).attr('font-size', 10).attr('color', '#666');

  shown.forEach((m, i) => {
    const y = i * rowH;
    const start = x(new Date(m.first_seen).getTime());
    const endT = m.last_seen ? new Date(m.last_seen).getTime() : maxT;
    const end = Math.max(start + 2, x(endT));
    const g = chartG.append('g');
    const rect = g.append('rect')
      .attr('x', start).attr('y', y).attr('width', end - start).attr('height', rowH - 5)
      .attr('fill', trustColor(m.trust_level)).attr('rx', 3).attr('opacity', 0.85);
    if (m.status === 'quarantined') rect.attr('class', 'striped');
    if (m.version > 1 && m.last_modified) {
      g.append('line').attr('x1', x(new Date(m.last_modified).getTime())).attr('x2', x(new Date(m.last_modified).getTime()))
        .attr('y1', y - 1).attr('y2', y + rowH - 4).attr('stroke', '#fff').attr('stroke-width', 1).attr('opacity', 0.6);
    }
    const label = g.append('text').attr('x', -8).attr('y', y + rowH / 2 + 4).attr('text-anchor', 'end').attr('fill', '#c0c0d0').attr('font-size', 11)
      .text(truncate(m.content, 34));
    if (m.flags && m.flags.length) label.append('tspan').attr('fill', '#f59e0b').text(' ⚠');
    if (m.status === 'quarantined') label.append('tspan').text(' 🔒');

    rect.on('mouseover', (ev) => showTooltip(`<div>${escapeHtml(truncate(m.content, 80))}</div><div class="muted">trust ${m.trust_level.toFixed(2)} · ${m.source_platform} · v${m.version}</div>`, ev.clientX, ev.clientY))
      .on('mouseout', hideTooltip)
      .on('click', () => { const old = wrap.querySelector('.detail-panel'); if (old) old.remove(); const p = el('div', { class: 'detail-panel open', style: 'width:100%' }); wrap.appendChild(p); renderMemoryDetail(m.id, p); });
  });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function showD3Missing() {
  $app.innerHTML = '';
  $app.appendChild(emptyState('D3.js could not be loaded (check your network connection to the CDN).'));
}

const views = { overview, constellation, river, heatmap, security: radar, diff: butterfly, decay };

function refresh() {
  const active = document.querySelector('.tab.active');
  const key = active ? active.dataset.view : 'overview';
  $app.innerHTML = '';
  (views[key] || overview)().catch(showError);
}

function showError(err) {
  $app.innerHTML = '';
  $app.appendChild(el('div', { class: 'empty', text: `Error: ${err.message}` }));
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $app.innerHTML = '';
    (views[btn.dataset.view] || overview)().catch(showError);
  });
});

refresh();
