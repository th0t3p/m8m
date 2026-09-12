// m8m dashboard frontend — vanilla JS, no framework, no build step.
// Reads the REST routes in src/dashboard/api.ts. Route shapes are fixed;
// all filtering/sorting here happens client-side on the fetched payloads.

const $app = document.getElementById('app');
const $toast = document.getElementById('toast-region');

/* ------------------------------------------------------------------ icons */

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
};

function icon(name, size = 15) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

/* --------------------------------------------------------------- elements */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

function badge(text, variant, opts = {}) {
  return el('span', {
    class: `badge ${variant || ''}${opts.mono ? ' mono' : ''}`.trim(),
    text,
    title: opts.title,
  });
}

function pageHead(title, sub, actions = []) {
  const head = el('div', { class: 'page-head' });
  const left = el('div', {}, el('h1', { text: title }));
  if (sub) left.appendChild(el('div', { class: 'sub', text: sub }));
  head.appendChild(left);
  if (actions.length) head.appendChild(el('div', { class: 'actions' }, ...actions));
  return head;
}

function emptyState(iconName, title, hint, action) {
  const node = el('div', { class: 'empty' },
    icon(iconName, 22),
    el('div', { class: 'title', text: title }),
    el('div', { class: 'hint', text: hint }),
  );
  if (action) node.appendChild(action);
  return node;
}

function stat(value, label, variant = '') {
  return el('div', { class: `stat ${variant}`.trim() },
    el('div', { class: 'value', text: value }),
    el('div', { class: 'label' }, variant ? el('span', { class: 'mark' }) : null, label),
  );
}

/* ------------------------------------------------------- labels & formats */

const PLATFORM = {
  claude_code: 'Claude Code', claude_web: 'Claude Web', claude_desktop: 'Claude Desktop',
  chatgpt_web: 'ChatGPT', cursor: 'Cursor', local_file: 'Local file',
  manual_import: 'Manual import', mem0: 'mem0', unknown: 'Unknown',
};
const DETECTOR = {
  mcp_live: 'MCP', file_watcher: 'Watcher', periodic_snapshot: 'Snapshot',
  manual_import: 'Import', cli: 'CLI', dashboard: 'Dashboard',
};
const FLAG = {
  contains_instruction: 'Instruction', contains_url: 'URL', contains_email: 'Email',
  contains_credential: 'Credential', contradicts_existing: 'Contradiction',
  source_unknown: 'No source', hidden_character: 'Hidden chars',
};
const STATUS = { active: 'Active', quarantined: 'Quarantined', dismissed: 'Dismissed', deleted: 'Deleted' };
const CHANGE = { created: 'Added', modified: 'Modified', deleted: 'Deleted', status_changed: 'Status' };
const CATEGORY = {
  preference: 'Preference', fact: 'Fact', instruction: 'Instruction',
  relationship: 'Relationship', event: 'Event', credential: 'Credential', unknown: 'Unknown',
};
const SEVERITY_VARIANT = { critical: 'crit', warning: 'warn', info: 'info' };
const SEVERITY_LABEL = { critical: 'Critical', warning: 'Warning', info: 'Info' };

function humanize(value, map) {
  if (value == null || value === '') return '—';
  if (map && map[value]) return map[value];
  return String(value).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

const platform = (p) => humanize(p, PLATFORM);
const detector = (d) => humanize(d, DETECTOR);
const flagLabel = (t) => humanize(t, FLAG);
const statusLabel = (s) => humanize(s, STATUS);
const categoryLabel = (c) => humanize(c, CATEGORY);

function truncate(text, max = 220) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function clockTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso) {
  const date = new Date(iso);
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

const trustBand = (t) => (t >= 0.7 ? 'high' : t >= 0.3 ? 'medium' : 'low');

/* ------------------------------------------------------------- data layer */

const ui = { timeline: 'all', security: 'unresolved', memories: { q: '', status: 'all', platform: 'all' } };
const cache = new Map();

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.json();
}

async function apiText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.text();
}

async function load(key, path) {
  if (!cache.has(key)) cache.set(key, await api(path));
  return cache.get(key);
}

const invalidate = () => cache.clear();

/* ------------------------------------------------------- feedback helpers */

let toastTimer;
function toast(message, kind = 'ok') {
  $toast.innerHTML = '';
  $toast.appendChild(el('div', { class: `toast ${kind}`, role: 'status' },
    icon(kind === 'error' ? 'alert' : 'check', 14),
    el('span', { text: message }),
  ));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.innerHTML = ''; }, 3200);
}

function loading(rows = 4) {
  $app.innerHTML = '';
  const wrap = el('div', { class: 'skeleton' });
  for (let i = 0; i < rows; i += 1) wrap.appendChild(el('div', { class: `sk-row${i % 3 === 2 ? ' short' : ''}` }));
  $app.appendChild(wrap);
}

function showError(err, retry) {
  $app.innerHTML = '';
  const banner = el('div', { class: 'banner', role: 'alert' },
    icon('alert'),
    el('span', { text: `Could not load this view — ${err.message}` }),
  );
  if (retry) banner.appendChild(el('button', { class: 'btn ghost', text: 'Retry', onclick: retry }));
  $app.appendChild(banner);
}

async function act(path, body, message) {
  try {
    await api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    invalidate();
    refresh();
    if (message) toast(message);
  } catch (err) {
    toast(`Action failed — ${err.message}`, 'error');
  }
}

/* --------------------------------------------------------------- timeline */

function timelineRow(change) {
  const kind = { created: 'added', modified: 'modified', deleted: 'deleted', status_changed: 'status' }[change.change_type] || 'modified';
  const isFile = change.kind === 'file';
  const variant = kind === 'added' ? 'ok' : kind === 'deleted' ? 'crit' : kind === 'status' ? '' : 'warn';
  const content = isFile
    ? (change.file_name || change.file_path || 'Memory file')
    : (change.change_type === 'deleted' ? change.old_content : change.content);

  const row = el('div', { class: `tl-row ${kind}` },
    el('div', { class: 'tl-time', text: clockTime(change.changed_at), title: new Date(change.changed_at).toLocaleString() }),
    el('div', { class: 'tl-mark' }, el('span', { class: `tl-dot ${kind}` })),
  );

  const body = el('div', { class: 'tl-body' });
  body.appendChild(el('div', { class: 'tl-content', text: truncate(content, 240) || 'Status change (content unchanged)' }));
  if (!isFile && change.change_type === 'modified' && change.old_content) {
    body.appendChild(el('div', { class: 'tl-was', text: truncate(change.old_content, 160) }));
  }

  const meta = el('div', { class: 'tl-meta' });
  meta.appendChild(badge(humanize(change.change_type, CHANGE), variant));
  if (isFile) {
    meta.appendChild(badge('file', 'accent'));
    meta.appendChild(badge(change.provider || platform(change.source_platform)));
    if (change.nodes_added || change.nodes_modified || change.nodes_deleted) {
      meta.appendChild(badge(`+${change.nodes_added} ~${change.nodes_modified} -${change.nodes_deleted}`, 'mono', { mono: true }));
    }
  } else {
    if (change.change_type === 'status_changed') {
      meta.appendChild(badge(`${statusLabel(change.old_status)} → ${statusLabel(change.new_status)}`, 'accent'));
    }
    meta.appendChild(badge(platform(change.source_platform)));
  }
  meta.appendChild(badge(detector(change.detected_by)));
  const refId = change.memory_id || change.document_id || '';
  meta.appendChild(el('span', { class: 'id', text: refId ? refId.slice(0, 8) : '—', title: refId }));
  body.appendChild(meta);

  row.appendChild(body);
  return row;
}

async function renderTimeline() {
  loading(5);
  const changes = await load('timeline', '/api/timeline');
  $app.innerHTML = '';

  $app.appendChild(pageHead('Timeline', changes.length ? `${changes.length} memory changes, newest first` : 'Nothing captured yet', [
    el('button', { class: 'btn ghost', onclick: () => { invalidate(); refresh(); } }, icon('refresh'), 'Refresh'),
  ]));

  if (!changes.length) {
    $app.appendChild(emptyState('clock', 'Nothing recorded yet',
      'Import a memory file with "m8m import <file>", or start the watcher with "m8m watch" — every change it sees lands here.'));
    return;
  }

  const counts = changes.reduce((acc, c) => {
    acc[c.change_type] = (acc[c.change_type] || 0) + 1;
    return acc;
  }, {});
  const filters = [['all', 'All'], ['created', 'Added'], ['modified', 'Modified'], ['status_changed', 'Status'], ['deleted', 'Deleted']];
  const chips = el('div', { class: 'toolbar' });
  for (const [key, label] of filters) {
    const count = key === 'all' ? changes.length : counts[key] || 0;
    chips.appendChild(el('button', {
      class: 'chip',
      'aria-pressed': String(ui.timeline === key),
      onclick: () => { ui.timeline = key; renderTimeline().catch((e) => showError(e, refresh)); },
    }, label, el('span', { class: 'n', text: String(count) })));
  }
  $app.appendChild(chips);

  const rows = changes.filter((c) => ui.timeline === 'all' || c.change_type === ui.timeline);
  if (!rows.length) {
    $app.appendChild(emptyState('clock', 'No changes of this kind', 'Nothing has been recorded for this filter yet.',
      el('button', { class: 'btn ghost', text: 'Show all changes', onclick: () => { ui.timeline = 'all'; renderTimeline().catch((e) => showError(e, refresh)); } })));
    return;
  }

  let currentDay = null;
  for (const change of rows) {
    const day = dayLabel(change.changed_at);
    if (day !== currentDay) {
      currentDay = day;
      $app.appendChild(el('div', { class: 'tl-head' },
        el('span', { text: day }),
        el('span', { class: 'rule' }),
      ));
    }
    $app.appendChild(timelineRow(change));
  }
}

/* --------------------------------------------------------------- memories */

function trustCell(trust) {
  const band = trustBand(trust);
  return el('div', { class: `trust ${band}`, title: `Trust ${trust.toFixed(2)} — ${band}` },
    el('span', { class: 'trust-track' },
      el('span', { class: 'trust-fill', style: `width:${Math.round(Math.max(0, Math.min(1, trust)) * 100)}%` }),
    ),
    el('span', { class: 'trust-value', text: trust.toFixed(2) }),
  );
}

// The analyzer can emit the same flag type more than once for one entry;
// show each type once so the column stays scannable.
function flagBadges(flags) {
  const seen = new Set();
  const unique = flags.filter((f) => (seen.has(f.type) ? false : (seen.add(f.type), true)));
  const shown = unique.slice(0, 3);
  const nodes = shown.map((f) => badge(flagLabel(f.type), SEVERITY_VARIANT[f.severity] || '', { title: f.detail }));
  if (unique.length > shown.length) nodes.push(badge(`+${unique.length - shown.length}`, '', { title: unique.slice(3).map((f) => flagLabel(f.type)).join(', ') }));
  return nodes;
}

function memoriesTable(rows) {
  const table = el('table');
  table.appendChild(el('thead', {},
    el('tr', {},
      el('th', { text: 'Content' }),
      el('th', { text: 'Platform' }),
      el('th', { class: 'num', text: 'Trust' }),
      el('th', { text: 'Flags' }),
      el('th', { text: 'Status' }),
      el('th', { class: 'num', text: 'Actions' }),
    ),
  ));

  const tbody = el('tbody');
  for (const m of rows) {
    const content = el('td', {},
      el('div', { class: 'cell-content', text: truncate(m.content, 260) }),
      el('div', { class: 'cell-sub' },
        el('span', { class: 'id', text: m.id.slice(0, 8), title: m.id }),
        el('span', { class: 'meta', text: `${categoryLabel(m.category)} · v${m.version} · seen ${timeAgo(m.last_seen)}` }),
      ),
    );

    const statusVariant = m.status === 'quarantined' ? 'crit' : m.status === 'deleted' ? '' : m.status === 'dismissed' ? '' : 'ok';

    tbody.appendChild(el('tr', {},
      content,
      el('td', {}, badge(platform(m.source_platform))),
      el('td', { class: 'num' }, trustCell(m.trust_level)),
      el('td', {}, el('div', { class: 'flag-list' },
        ...(m.flags.length ? flagBadges(m.flags) : [el('span', { class: 'meta', text: '—' })]),
      )),
      el('td', {}, badge(statusLabel(m.status), statusVariant)),
      el('td', { class: 'num' }, el('div', { class: 'row-actions' },
        m.status === 'quarantined'
          ? el('button', { class: 'btn ok', onclick: () => act(`/api/memories/${m.id}/restore`, {}, 'Memory restored') }, icon('check', 14), 'Restore')
          : el('button', { class: 'btn danger', onclick: () => act(`/api/memories/${m.id}/quarantine`, {}, 'Memory quarantined') }, 'Quarantine'),
      )),
    ));
  }
  table.appendChild(tbody);
  return el('div', { class: 'table-wrap' }, table);
}

async function renderMemories() {
  loading(6);
  const [memories, files] = await Promise.all([
    load('memories', '/api/memories'),
    load('documents', '/api/documents'),
  ]);
  $app.innerHTML = '';

  const flagged = memories.filter((m) => m.flags.length);
  $app.appendChild(pageHead('Memories', memories.length || files.length
    ? `${memories.length} agent · ${files.length} file memories${flagged.length ? ` · ${flagged.length} flagged` : ''}`
    : 'Nothing stored yet'));

  if (!memories.length && !files.length) {
    $app.appendChild(emptyState('inbox', 'No memories stored yet',
      'Run "m8m scan" to discover memory files across your AI tools, or import one directly with "m8m import <file> --platform <name>".'));
    return;
  }

  // --- Agent memories (facts stored via the m8m MCP server) ---
  const agentSection = el('section', { class: 'mem-section' });
  agentSection.appendChild(el('h2', { class: 'section-title', text: `Agent memories (${memories.length})` }));

  if (memories.length) {
    const listHost = el('div', {});
    const chipButtons = new Map();

    const toolbar = el('div', { class: 'toolbar' });
    const search = el('div', { class: 'search' });
    search.appendChild(icon('search', 14));
    const input = el('input', {
      type: 'search',
      placeholder: 'Search content or id',
      'aria-label': 'Search agent memories',
      value: ui.memories.q,
      oninput: (event) => { ui.memories.q = event.target.value; renderList(); },
    });
    search.appendChild(input);
    toolbar.appendChild(search);

    const statuses = [['all', 'All'], ['active', 'Active'], ['quarantined', 'Quarantined'], ['flagged', 'Flagged']];
    for (const [key, label] of statuses) {
      const count = key === 'all' ? memories.length
        : key === 'flagged' ? flagged.length
          : memories.filter((m) => m.status === key).length;
      const button = el('button', {
        class: 'chip',
        'aria-pressed': String(ui.memories.status === key),
        onclick: () => {
          ui.memories.status = key;
          chipButtons.forEach((btn, k) => btn.setAttribute('aria-pressed', String(k === key)));
          renderList();
        },
      }, label, el('span', { class: 'n', text: String(count) }));
      chipButtons.set(key, button);
      toolbar.appendChild(button);
    }

    const platforms = [...new Set(memories.map((m) => m.source_platform))].sort();
    const select = el('select', {
      class: 'select',
      'aria-label': 'Filter by platform',
      onchange: (event) => { ui.memories.platform = event.target.value; renderList(); },
    },
      el('option', { value: 'all', text: 'All platforms' }),
      ...platforms.map((p) => el('option', { value: p, text: platform(p) })),
    );
    select.value = ui.memories.platform;
    toolbar.appendChild(select);
    agentSection.appendChild(toolbar);
    agentSection.appendChild(listHost);

    function filtered() {
      const q = ui.memories.q.trim().toLowerCase();
      return memories.filter((m) => {
        if (ui.memories.status === 'flagged' && !m.flags.length) return false;
        if (ui.memories.status !== 'all' && ui.memories.status !== 'flagged' && m.status !== ui.memories.status) return false;
        if (ui.memories.platform !== 'all' && m.source_platform !== ui.memories.platform) return false;
        if (q && !(m.content.toLowerCase().includes(q) || m.id.startsWith(q))) return false;
        return true;
      });
    }

    function renderList() {
      listHost.innerHTML = '';
      const rows = filtered();
      listHost.appendChild(el('div', { class: 'count', text: rows.length === memories.length
        ? `${rows.length} memories`
        : `${rows.length} of ${memories.length} memories` }));

      if (!rows.length) {
        listHost.appendChild(emptyState('search', 'No memories match', 'Try a different search term, or clear the filters to see everything.',
          el('button', {
            class: 'btn ghost',
            text: 'Clear filters',
            onclick: () => {
              ui.memories = { q: '', status: 'all', platform: 'all' };
              renderMemories().catch((e) => showError(e, refresh));
            },
          })));
        return;
      }
      listHost.appendChild(memoriesTable(rows));
    }

    renderList();
  } else {
    agentSection.appendChild(el('div', { class: 'meta', text: 'None yet — facts your agent stores through the m8m MCP server will appear here.' }));
  }
  $app.appendChild(agentSection);

  // --- File memories (local markdown/json imports) ---
  const fileSection = el('section', { class: 'mem-section' });
  fileSection.appendChild(el('h2', { class: 'section-title', text: `File memories (${files.length})` }));
  if (files.length) {
    const list = el('div', { class: 'doc-list' });
    for (const d of files) list.appendChild(documentCard(d));
    fileSection.appendChild(list);
  } else {
    fileSection.appendChild(el('div', { class: 'meta', text: 'None yet — imported markdown/json memory files land here. Run "m8m scan" or "m8m import <file>".' }));
  }
  $app.appendChild(fileSection);
}

/* --------------------------------------------------------------- security */

function eventCard(event, memory, doc) {
  const card = el('div', { class: `event ${event.severity}${event.resolved_at ? ' resolved' : ''}` });

  card.appendChild(el('div', { class: 'event-head' },
    badge(humanize(event.severity, SEVERITY_LABEL), SEVERITY_VARIANT[event.severity] || ''),
    el('span', { class: 'title', text: event.title }),
    el('span', { class: 'meta time', text: timeAgo(event.detected_at), title: new Date(event.detected_at).toLocaleString() }),
  ));

  if (doc) {
    const nodeContent = event.details && event.details.node_content ? String(event.details.node_content) : '';
    card.appendChild(el('div', { class: 'quote' },
      el('div', { class: 'text', text: truncate(nodeContent || doc.file_name, 260) }),
      el('div', { class: 'sub' },
        badge('file', 'accent'),
        el('span', { text: doc.file_name }),
        badge(doc.provider || platform(doc.source_platform)),
        event.details && event.details.node_heading ? el('span', { text: `§ ${event.details.node_heading}` }) : null,
        el('span', { class: 'id', text: doc.id.slice(0, 8), title: doc.id }),
      ),
    ));
  } else if (memory) {
    card.appendChild(el('div', { class: 'quote' },
      el('div', { class: 'text', text: truncate(memory.content, 260) }),
      el('div', { class: 'sub' },
        badge(platform(memory.source_platform)),
        el('span', { text: `trust ${memory.trust_level.toFixed(2)}` }),
        el('span', { text: categoryLabel(memory.category) }),
        memory.version > 1 ? el('span', { text: `v${memory.version}` }) : null,
        el('span', { class: 'id', text: memory.id.slice(0, 8), title: memory.id }),
      ),
    ));
  }

  if (event.details && event.details.detail) {
    card.appendChild(el('div', { class: 'detail', text: String(event.details.detail) }));
  }

  if (event.resolved_at) {
    card.appendChild(el('div', { class: 'event-actions' },
      badge(`Resolved ${timeAgo(event.resolved_at)} · ${humanize(event.resolution)}`, 'ok'),
    ));
  } else {
    card.appendChild(el('div', { class: 'event-actions' },
      el('button', {
        class: 'btn primary',
        onclick: () => act(`/api/events/${event.id}/resolve`, { resolution: 'user_dismissed' }, 'Event resolved'),
      }, icon('check', 14), 'Resolve'),
      event.memory_id
        ? el('button', {
          class: 'btn danger',
          onclick: () => act(`/api/memories/${event.memory_id}/quarantine`, {}, 'Memory quarantined'),
        }, 'Quarantine memory')
        : null,
    ));
  }

  return card;
}

async function renderSecurity() {
  loading(4);
  const [events, memories, docs] = await Promise.all([
    load('events', '/api/events'),
    load('memories', '/api/memories'),
    load('documents', '/api/documents'),
  ]);
  const byId = new Map(memories.map((m) => [m.id, m]));
  const byDocId = new Map(docs.map((d) => [d.id, d]));
  $app.innerHTML = '';

  const unresolved = events.filter((e) => !e.resolved_at);
  const unresolvedCritical = unresolved.filter((e) => e.severity === 'critical').length;
  const unresolvedWarnings = unresolved.filter((e) => e.severity === 'warning').length;

  $app.appendChild(pageHead('Security', 'Every flag the analyzer raised, most severe first'));
  $app.appendChild(el('div', { class: 'stat-strip' },
    stat(String(unresolved.length), unresolved.length === 1 ? 'unresolved event' : 'unresolved events'),
    stat(String(unresolvedCritical), 'unresolved critical', unresolvedCritical ? 'crit' : ''),
    stat(String(unresolvedWarnings), 'unresolved warnings', unresolvedWarnings ? 'warn' : ''),
    stat(String(events.length), 'events on record'),
  ));

  if (!events.length) {
    $app.appendChild(emptyState('inbox', 'No security events',
      'The analyzer raises an event whenever a memory looks like an instruction, a credential, a contradiction, or carries hidden characters.'));
    return;
  }

  const filters = [
    ['unresolved', 'Unresolved', unresolved.length],
    ['all', 'All', events.length],
    ['critical', 'Critical', events.filter((e) => e.severity === 'critical').length],
    ['warning', 'Warning', events.filter((e) => e.severity === 'warning').length],
    ['info', 'Info', events.filter((e) => e.severity === 'info').length],
  ];
  const chips = el('div', { class: 'toolbar' });
  for (const [key, label, count] of filters) {
    chips.appendChild(el('button', {
      class: 'chip',
      'aria-pressed': String(ui.security === key),
      onclick: () => { ui.security = key; renderSecurity().catch((e) => showError(e, refresh)); },
    }, label, el('span', { class: 'n', text: String(count) })));
  }
  $app.appendChild(chips);

  const shown = events.filter((e) => {
    if (ui.security === 'unresolved') return !e.resolved_at;
    if (ui.security === 'all') return true;
    return e.severity === ui.security;
  });

  if (!shown.length) {
    $app.appendChild(emptyState('inbox', 'Nothing to review', 'No security events match this filter. Resolved events stay on record under "All".',
      ui.security !== 'all' ? el('button', { class: 'btn ghost', text: 'Show all events', onclick: () => { ui.security = 'all'; renderSecurity().catch((e) => showError(e, refresh)); } }) : null));
    return;
  }

  for (const event of shown) {
    $app.appendChild(eventCard(
      event,
      event.memory_id ? byId.get(event.memory_id) : null,
      event.document_id ? byDocId.get(event.document_id) : null,
    ));
  }
}

/* ------------------------------------------------------------------- diff */

function diffRow(kind, sigil, after, before, entry) {
  const row = el('div', { class: `diff-row ${kind}` }, el('div', { class: 'sigil', text: sigil }));
  const body = el('div', {});
  if (before) body.appendChild(el('div', { class: 'diff-before', text: truncate(before, 200) }));
  body.appendChild(el('div', { class: 'diff-after', text: truncate(after, 280) }));
  body.appendChild(el('div', { class: 'diff-meta' },
    badge(platform(entry.source_platform)),
    el('span', { class: 'meta', text: timeAgo(entry.last_seen || entry.last_modified || entry.first_seen) }),
    el('span', { class: 'id', text: entry.id.slice(0, 8), title: entry.id }),
  ));
  row.appendChild(body);
  return row;
}

async function renderDiff() {
  loading(3);
  const data = await load('diff', '/api/diff');
  $app.innerHTML = '';

  $app.appendChild(pageHead('Diff',
    data.snapshot
      ? `Against snapshot ${data.snapshot.slice(0, 8)}, taken ${timeAgo(data.snapshot_taken_at)}`
      : 'No baseline snapshot yet — take one to start tracking drift',
    [
      el('button', { class: 'btn primary', onclick: () => act('/api/snapshot', {}, 'Snapshot taken') }, icon('camera', 14), 'Take snapshot'),
      el('button', { class: 'btn ghost', onclick: () => { invalidate(); refresh(); } }, icon('refresh'), 'Refresh'),
    ]));

  $app.appendChild(el('div', { class: 'diff-summary' },
    badge(`${data.added.length} added`, 'ok'),
    badge(`${data.modified.length} modified`, 'warn'),
    badge(`${data.deleted.length} deleted`, data.deleted.length ? 'crit' : ''),
  ));

  if (!data.added.length && !data.modified.length && !data.deleted.length) {
    $app.appendChild(emptyState('check', 'No drift',
      data.snapshot
        ? 'Every memory matches the baseline snapshot.'
        : 'Take a snapshot to record a baseline; later changes will be listed here.'));
    return;
  }

  for (const entry of data.added) $app.appendChild(diffRow('added', '+', entry.content, null, entry));
  for (const item of data.modified) $app.appendChild(diffRow('modified', '~', item.after.content, item.before.content, item.after));
  for (const entry of data.deleted) $app.appendChild(diffRow('deleted', '−', entry.content, null, entry));
}

/* -------------------------------------------------------------- documents */

function documentCard(d) {
  const card = el('div', { class: 'card doc-card' });
  const titleLine = el('div', { class: 'doc-titleline' });
  titleLine.appendChild(el('strong', { text: d.file_name }));
  const meta = [platform(d.source_platform), `v${d.version}`];
  if (d.flags_summary && d.flags_summary.length) meta.push(`${d.flags_summary.length} flagged`);
  titleLine.appendChild(el('span', { class: 'meta', text: meta.join(' · ') }));
  card.appendChild(titleLine);
  card.appendChild(el('div', { class: 'meta', text: `${d.file_path} · ${timeAgo(d.last_modified || d.last_seen)}` }));

  const body = el('div', { class: 'doc-body' });
  const actions = el('div', { class: 'row', style: 'margin-top:8px' },
    el('button', { class: 'btn ghost doc-toggle', onclick: (e) => toggleDocView(d, body, 'tree', e.currentTarget) }, 'Tree'),
    el('button', { class: 'btn ghost doc-toggle', onclick: (e) => toggleDocView(d, body, 'raw', e.currentTarget) }, 'Raw'),
  );
  card.appendChild(actions);
  card.appendChild(body);
  return card;
}

async function toggleDocView(d, body, kind, btn) {
  // Clicking the currently-open view hides it; clicking the other switches.
  if (body.dataset.view === kind) {
    body.innerHTML = '';
    delete body.dataset.view;
    btn.classList.remove('active');
    return;
  }
  body.innerHTML = '';
  body.dataset.view = kind;
  for (const b of btn.parentElement.querySelectorAll('.doc-toggle')) b.classList.remove('active');
  btn.classList.add('active');

  if (kind === 'tree') {
    try {
      const doc = await api(`/api/documents/${d.id}`);
      body.appendChild(renderDocTree(doc.nodes || []));
    } catch (err) {
      body.appendChild(el('div', { class: 'meta', text: `Could not load tree: ${err.message}` }));
    }
  } else {
    try {
      const raw = await apiText(`/api/documents/${d.id}/raw`);
      body.appendChild(el('pre', { class: 'doc-raw', text: raw }));
    } catch (err) {
      body.appendChild(el('div', { class: 'meta', text: `Could not load raw: ${err.message}` }));
    }
  }
}

function renderDocTree(nodes) {
  const ul = el('ul', { class: 'doc-tree' });
  for (const n of nodes) {
    const li = el('li', { class: 'doc-node' });
    const row = el('div', { class: 'row doc-node-row' });
    row.appendChild(badge(n.node_type, 'mono', { mono: true }));
    row.appendChild(el('span', { class: 'doc-node-content', text: truncate(n.heading || n.content.replace(/\s+/g, ' '), 120) }));
    if (n.flags && n.flags.length) row.appendChild(badge(String(n.flags.length), 'warn'));
    li.appendChild(row);
    if (n.children && n.children.length) li.appendChild(renderDocTree(n.children));
    ul.appendChild(li);
  }
  return ul;
}

/* --------------------------------------------------------------- bootstrap */

const views = { timeline: renderTimeline, memories: renderMemories, security: renderSecurity, diff: renderDiff };
const DEFAULT_VIEW = 'timeline';

// Hash-based routing: each tab maps to a URL path (#/timeline, #/memories, …)
// so a view can be opened directly and browser back/forward works.
function viewFromHash() {
  const key = location.hash.replace(/^#\/?/, '');
  if (key === 'documents') return 'memories'; // legacy route: documents → memories
  return views[key] ? key : DEFAULT_VIEW;
}

function activateTab(key) {
  document.querySelectorAll('.tab').forEach((b) => {
    if (b.dataset.view === key) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

function refresh() {
  const active = document.querySelector('.tab[aria-current="page"]') || document.querySelector('.tab');
  const view = views[active?.dataset.view] || renderTimeline;
  $app.setAttribute('aria-busy', 'true');
  view()
    .catch((err) => showError(err, refresh))
    .finally(() => $app.removeAttribute('aria-busy'));
}

function renderRoute() {
  activateTab(viewFromHash());
  refresh();
}

// Tab links use native hash navigation (href="#/…"), which fires `hashchange`;
// only a re-click on the already-active route needs manual rendering.
document.querySelectorAll('.tab').forEach((link) => {
  link.addEventListener('click', () => {
    const key = link.dataset.view;
    if (location.hash === `#/${key}` || location.hash === `#${key}`) renderRoute();
  });
});

window.addEventListener('hashchange', renderRoute);

// Initial load: honor the URL hash, normalizing an empty one to #/timeline.
if (!location.hash) history.replaceState(null, '', `#/${DEFAULT_VIEW}`);
renderRoute();
