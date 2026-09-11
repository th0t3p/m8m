// Mem8 dashboard frontend (vanilla JS, no framework).

const $app = document.getElementById('app');
const views = { timeline: renderTimeline, memories: renderMemories, security: renderSecurity, diff: renderDiff };

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function badge(text, cls) {
  return el('span', { class: `badge ${cls || ''}`, text });
}

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function renderTimeline() {
  const data = await api('/api/changelog');
  $app.innerHTML = '';
  $app.appendChild(el('h2', { text: 'Timeline' }));
  if (!data.length) {
    $app.appendChild(el('div', { class: 'empty', text: 'No changes recorded yet.' }));
    return;
  }
  for (const c of data.slice(0, 100)) {
    const kind = c.change_type === 'created' ? 'added' : c.change_type === 'deleted' ? 'deleted' : 'modified';
    const card = el('div', { class: `card ${kind}` });
    card.appendChild(el('div', { class: 'row' },
      badge(c.change_type, kind === 'added' ? 'sev-info' : kind === 'deleted' ? 'sev-critical' : 'sev-warning'),
      el('span', { class: 'meta', text: timeAgo(c.changed_at) }),
      badge(c.detected_by, 'platform'),
    ));
    const text = c.new_content || c.old_content || '';
    card.appendChild(el('div', { class: 'content', text }));
    card.appendChild(el('div', { class: 'meta', text: `memory: ${c.memory_id || '—'}` }));
    $app.appendChild(card);
  }
}

async function renderMemories() {
  const data = await api('/api/memories');
  $app.innerHTML = '';
  $app.appendChild(el('h2', { text: 'Memories' }));
  if (!data.length) {
    $app.appendChild(el('div', { class: 'empty', text: 'No memories stored yet.' }));
    return;
  }
  const table = el('table');
  table.appendChild(el('thead', {},
    el('tr', {},
      el('th', { text: 'Content' }), el('th', { text: 'Platform' }), el('th', { text: 'Trust' }),
      el('th', { text: 'Flags' }), el('th', { text: 'Status' }), el('th', { text: 'Actions' }),
    ),
  ));
  const tbody = el('tbody');
  for (const m of data) {
    const tr = el('tr', { class: m.flags.length ? 'flagged' : '' });
    tr.appendChild(el('td', {}, el('div', { class: 'content', text: m.content }), el('div', { class: 'meta', text: m.id.slice(0, 8) })));
    tr.appendChild(el('td', {}, badge(m.source_platform, 'platform')));
    tr.appendChild(el('td', {}, badge(m.trust_level.toFixed(1), 'trust')));
    tr.appendChild(el('td', {}, m.flags.map((f) => badge(f.type.replace(/^contains_/, ''), 'flag')).join(' ') || ''));
    tr.appendChild(el('td', {}, badge(m.status, m.status === 'quarantined' ? 'sev-critical' : m.status === 'active' ? 'sev-info' : '')));
    const actions = el('td', {});
    if (m.status === 'quarantined') {
      actions.appendChild(el('button', { class: 'action ok', text: 'Restore', onclick: () => act(`/api/memories/${m.id}/restore`) }));
    } else {
      actions.appendChild(el('button', { class: 'action danger', text: 'Quarantine', onclick: () => act(`/api/memories/${m.id}/quarantine`) }));
    }
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  $app.appendChild(table);
}

async function renderSecurity() {
  const data = await api('/api/events');
  $app.innerHTML = '';
  $app.appendChild(el('h2', { text: 'Security Events' }));
  const unresolved = data.filter((e) => !e.resolved_at);
  const stats = { total: data.length, critical: data.filter((e) => e.severity === 'critical').length, warning: data.filter((e) => e.severity === 'warning').length };
  const grid = el('div', { class: 'stat-grid' },
    el('div', { class: 'stat' }, el('div', { class: 'value', text: String(unresolved.length) }), el('div', { class: 'label', text: 'Unresolved' })),
    el('div', { class: 'stat' }, el('div', { class: 'value', text: String(stats.critical) }), el('div', { class: 'label', text: 'Critical' })),
    el('div', { class: 'stat' }, el('div', { class: 'value', text: String(stats.warning) }), el('div', { class: 'label', text: 'Warnings' })),
  );
  $app.appendChild(grid);
  if (!data.length) {
    $app.appendChild(el('div', { class: 'empty', text: 'No security events.' }));
    return;
  }
  for (const e of data) {
    const card = el('div', { class: `card ${e.severity === 'critical' ? 'deleted' : e.severity === 'warning' ? 'modified' : ''}` });
    card.appendChild(el('div', { class: 'row' },
      badge(e.severity, `sev-${e.severity}`),
      el('strong', { text: e.title }),
      el('span', { class: 'meta', text: timeAgo(e.detected_at) }),
    ));
    if (e.details && e.details.detail) card.appendChild(el('div', { class: 'meta', text: String(e.details.detail) }));
    if (e.resolved_at) {
      card.appendChild(el('div', { class: 'meta', text: `Resolved ${timeAgo(e.resolved_at)} (${e.resolution || '—'})` }));
    } else {
      card.appendChild(el('div', { class: 'row', style: 'margin-top:8px' },
        el('button', { class: 'action ok', text: 'Resolve', onclick: () => act(`/api/events/${e.id}/resolve`, { resolution: 'user_dismissed' }) }),
        e.memory_id ? el('button', { class: 'action danger', text: 'Quarantine memory', onclick: () => act(`/api/memories/${e.memory_id}/quarantine`) }) : null,
      ));
    }
    $app.appendChild(card);
  }
}

async function renderDiff() {
  const data = await api('/api/diff');
  $app.innerHTML = '';
  $app.appendChild(el('h2', { text: 'Diff' }));
  $app.appendChild(el('div', { class: 'meta', text: data.snapshot ? `vs snapshot ${data.snapshot.slice(0, 8)} (${timeAgo(data.snapshot_taken_at)})` : 'vs empty state' }));
  if (!data.added.length && !data.modified.length && !data.deleted.length) {
    $app.appendChild(el('div', { class: 'empty', text: 'No differences.' }));
    return;
  }
  const summary = el('div', { class: 'card', text: `${data.added.length} added · ${data.modified.length} modified · ${data.deleted.length} deleted` });
  $app.appendChild(summary);
  for (const e of data.added) $app.appendChild(diffCard(e, 'added', '+'));
  for (const m of data.modified) $app.appendChild(diffCard(m.after, 'modified', '~', m.before.content));
  for (const e of data.deleted) $app.appendChild(diffCard(e, 'deleted', '−'));
}

function diffCard(entry, kind, sigil, beforeContent) {
  const card = el('div', { class: `card ${kind}` });
  card.appendChild(el('div', { class: 'row' },
    el('strong', { text: sigil }),
    el('span', { class: 'content', text: entry.content }),
  ));
  if (beforeContent) card.appendChild(el('div', { class: 'meta', text: `was: ${beforeContent}` }));
  card.appendChild(el('div', { class: 'row', style: 'margin-top:6px' },
    badge(entry.source_platform, 'platform'),
    el('span', { class: 'meta', text: entry.id.slice(0, 8) }),
  ));
  return card;
}

async function act(path, body) {
  try {
    await api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    refresh();
  } catch (err) {
    alert(`Action failed: ${err.message}`);
  }
}

function refresh() {
  const active = document.querySelector('.tab.active');
  if (active) views[active.dataset.view]().catch((e) => showError(e));
}

function showError(err) {
  $app.innerHTML = '';
  $app.appendChild(el('div', { class: 'empty', text: `Error: ${err.message}` }));
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    views[btn.dataset.view]().catch(showError);
  });
});

refresh();
