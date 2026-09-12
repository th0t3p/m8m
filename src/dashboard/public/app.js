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

// Content is presented as a snippet by default, but the full string always stays
// in the DOM: the clamp is visual (CSS line-clamp), so nothing is ever cut in the
// data and the expanded state keeps the original line breaks.
function contentBlock(text, { class: cls = 'cell-content', lines = 3, query = '' } = {}) {
  const body = el('div', { class: `${cls} clamp`, style: `--clamp-lines:${lines}` });
  const value = String(text ?? '').trim();
  body.appendChild(value ? highlightMatches(value, query) : document.createTextNode('—'));
  return el('div', { class: 'content-block' }, body);
}

// Wraps query hits in <mark>. Built from text nodes rather than innerHTML, so
// memory content stays inert — it is untrusted input.
function highlightMatches(text, query) {
  const value = String(text ?? '');
  const fragment = document.createDocumentFragment();
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) {
    fragment.appendChild(document.createTextNode(value));
    return fragment;
  }
  const haystack = value.toLowerCase();
  let cursor = 0;
  let found = haystack.indexOf(needle);
  while (found !== -1) {
    if (found > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, found)));
    const mark = document.createElement('mark');
    mark.textContent = value.slice(found, found + needle.length);
    fragment.appendChild(mark);
    cursor = found + needle.length;
    found = haystack.indexOf(needle, cursor);
  }
  if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)));
  return fragment;
}

// Runs after a view renders: gives every clamped block that actually overflows a
// "Show full content" control. Measured, so short content gets no control.
function decorateClamps(root) {
  for (const node of root.querySelectorAll('.clamp:not([data-measured])')) {
    if (node.offsetParent === null) continue; // inside a hidden section: not laid out yet
    node.setAttribute('data-measured', '1');
    if (node.scrollHeight <= node.clientHeight + 2) continue;
    // A search hit below the visible snippet would be worse than useless, so
    // reveal it — the control stays, so it can be collapsed again.
    const nodeRect = node.getBoundingClientRect();
    const hiddenMatch = [...node.querySelectorAll('mark')]
      .some((mark) => mark.getBoundingClientRect().bottom > nodeRect.bottom + 1);
    const toggle = el('button', {
      class: 'toggle',
      type: 'button',
      'aria-expanded': String(hiddenMatch),
      onclick: () => {
        const expanded = node.classList.toggle('expanded');
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.textContent = expanded ? 'Show less' : 'Show full content';
      },
    }, hiddenMatch ? 'Show less' : 'Show full content');
    if (hiddenMatch) node.classList.add('expanded');
    node.after(toggle);
  }
}

/* ------------------------------------------------------- section jump bar */

/* ---------------------------------------------------------- global search */

function queryNeedle() {
  return ui.query.trim().toLowerCase();
}

/** True when any of the given values contains the current query. */
function matchesQuery(...values) {
  const needle = queryNeedle();
  if (!needle) return true;
  return values.some((value) => String(value ?? '').toLowerCase().includes(needle));
}

// The live search input, so "Clear search" can empty the box as well as the query.
let searchField = null;

/** Search box bound to the shared query; onChange re-renders that view's rows. */
function searchInput({ label, placeholder }, onChange) {
  const wrap = el('div', { class: 'search' });
  wrap.appendChild(icon('search', 14));
  searchField = el('input', {
    type: 'search',
    'aria-label': label,
    placeholder,
    value: ui.query,
    oninput: (event) => { ui.query = event.target.value; onChange(); },
    // the native clear (×) fires `search` in some browsers, `input` in others
    onsearch: (event) => { ui.query = event.target.value; onChange(); },
  });
  wrap.appendChild(searchField);
  return wrap;
}

function clearSearchButton(onChange) {
  return el('button', {
    class: 'btn ghost',
    text: 'Clear search',
    onclick: () => {
      ui.query = '';
      if (searchField) searchField.value = '';
      onChange();
    },
  });
}

// Views that stack several long sections (Memories = agent + file) get a sticky
// jump bar. The app routes on location.hash, so these are buttons that call
// scrollIntoView — a plain `#anchor` link would be read as a route change.
let sectionObserver = null;

function syncTopbarHeight() {
  const bar = document.querySelector('.topbar');
  if (bar) document.documentElement.style.setProperty('--topbar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
}

function jumpToSection(section, button) {
  if (!section) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  const heading = section.querySelector('.section-title');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  if (button) {
    for (const sibling of button.parentElement.querySelectorAll('.chip')) {
      sibling.setAttribute('aria-current', String(sibling === button));
    }
  }
}

function watchSections(sections, buttons) {
  if (sectionObserver) sectionObserver.disconnect();
  if (!('IntersectionObserver' in window)) return;
  sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!visible) return;
    const index = sections.indexOf(visible.target);
    buttons.forEach((btn, i) => btn.setAttribute('aria-current', String(i === index)));
  }, { rootMargin: '-130px 0px -60% 0px' });
  for (const section of sections) sectionObserver.observe(section);
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

// `query` is global: shared by every view, so a search started on Timeline still
// applies when you move to Memories, Diff or Security.
const ui = { query: '', timeline: 'all', security: 'unresolved', memories: { status: 'all', platform: 'all' } };
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
  body.appendChild(contentBlock(content || 'Status change (content unchanged)', { class: 'tl-content', lines: 2, query: ui.query }));
  if (!isFile && change.change_type === 'modified' && change.old_content) {
    body.appendChild(contentBlock(change.old_content, { class: 'tl-was', lines: 1, query: ui.query }));
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

  const listHost = el('div', {});
  const toolbar = el('div', { class: 'toolbar' });
  toolbar.appendChild(searchInput({ label: 'Search changes', placeholder: 'Search changes' }, renderRows));

  const filters = [['all', 'All'], ['created', 'Added'], ['modified', 'Modified'], ['status_changed', 'Status'], ['deleted', 'Deleted']];
  const chipButtons = new Map();
  for (const [key, label] of filters) {
    const button = el('button', {
      class: 'chip',
      'aria-pressed': String(ui.timeline === key),
      onclick: () => {
        ui.timeline = key;
        chipButtons.forEach((btn, k) => btn.setAttribute('aria-pressed', String(k === key)));
        renderRows();
      },
    }, label, el('span', { class: 'n', text: '0' }));
    chipButtons.set(key, button);
    toolbar.appendChild(button);
  }
  $app.appendChild(toolbar);
  $app.appendChild(listHost);

  function renderRows() {
    listHost.innerHTML = '';
    const matching = changes.filter((c) => matchesQuery(c.content, c.old_content, c.file_name, c.file_path, c.provider));
    const counts = matching.reduce((acc, c) => {
      acc[c.change_type] = (acc[c.change_type] || 0) + 1;
      return acc;
    }, {});
    chipButtons.forEach((btn, key) => {
      btn.querySelector('.n').textContent = String(key === 'all' ? matching.length : counts[key] || 0);
    });

    const rows = matching.filter((c) => ui.timeline === 'all' || c.change_type === ui.timeline);
    listHost.appendChild(el('div', { class: 'count', text: rows.length === changes.length
      ? `${rows.length} changes`
      : `${rows.length} of ${changes.length} changes` }));

    if (!rows.length) {
      listHost.appendChild(queryNeedle()
        ? emptyState('search', 'No changes match', `Nothing matches "${ui.query.trim()}".`, clearSearchButton(renderRows))
        : emptyState('clock', 'No changes of this kind', 'Nothing has been recorded for this filter yet.',
          el('button', {
            class: 'btn ghost',
            text: 'Show all changes',
            onclick: () => {
              ui.timeline = 'all';
              chipButtons.forEach((btn, k) => btn.setAttribute('aria-pressed', String(k === 'all')));
              renderRows();
            },
          })));
      return;
    }

    let currentDay = null;
    for (const change of rows) {
      const day = dayLabel(change.changed_at);
      if (day !== currentDay) {
        currentDay = day;
        listHost.appendChild(el('div', { class: 'tl-head' },
          el('span', { text: day }),
          el('span', { class: 'rule' }),
        ));
      }
      listHost.appendChild(timelineRow(change));
    }
    decorateClamps(listHost);
  }

  renderRows();
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
      contentBlock(m.content, { class: 'cell-content', lines: 2, query: ui.query }),
      el('div', { class: 'cell-sub' },
        el('span', { class: 'id', title: m.id }, highlightMatches(m.id.slice(0, 8), ui.query)),
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

  // Search and the section switches share one sticky row. Search lives at page
  // level (not inside a section) so it survives when a section hides itself —
  // otherwise a query matching only file memories would take the box away with
  // the agent section. The row itself always stays, so the box is always there.
  const controlBar = el('div', { class: 'subnav' });
  controlBar.appendChild(searchInput({ label: 'Search memories', placeholder: 'Search agent and file memories' }, () => {
    renderAgentList();
    renderFiles();
    syncSections();
    decorateClamps($app);
  }));
  $app.appendChild(controlBar);

  const noMatchHost = el('div', {});
  $app.appendChild(noMatchHost);

  let renderAgentList = () => {};

  const agentButton = el('button', {
    class: 'chip',
    type: 'button',
    'aria-current': 'true',
    onclick: () => jumpToSection(agentSection, agentButton),
  }, 'Agent memories', el('span', { class: 'n', text: String(memories.length) }));
  const fileButton = el('button', {
    class: 'chip',
    type: 'button',
    onclick: () => jumpToSection(fileSection, fileButton),
  }, 'File memories', el('span', { class: 'n', text: String(files.length) }));
  controlBar.appendChild(el('div', { class: 'switch', role: 'group', 'aria-label': 'Jump to section' }, agentButton, fileButton));

  // --- Agent memories (facts stored via the m8m MCP server) ---
  const agentSection = el('section', { class: 'mem-section' });
  agentSection.appendChild(el('h2', { class: 'section-title', text: `Agent memories (${memories.length})` }));

  if (memories.length) {
    const listHost = el('div', {});
    const chipButtons = new Map();

    const toolbar = el('div', { class: 'toolbar' });

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
      return memories.filter((m) => {
        if (ui.memories.status === 'flagged' && !m.flags.length) return false;
        if (ui.memories.status !== 'all' && ui.memories.status !== 'flagged' && m.status !== ui.memories.status) return false;
        if (ui.memories.platform !== 'all' && m.source_platform !== ui.memories.platform) return false;
        return matchesQuery(m.content, m.id);
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
              ui.memories = { status: 'all', platform: 'all' };
              ui.query = '';
              renderMemories().catch((e) => showError(e, refresh));
            },
          })));
        return;
      }
      listHost.appendChild(memoriesTable(rows));
      // On filter re-renders the host is already attached, so measure now;
      // on first paint the section is not in the document yet and the
      // end-of-render decorateClamps($app) pass covers it instead.
      if (listHost.isConnected) decorateClamps(listHost);
    }

    renderAgentList = renderList;
    renderList();
  } else {
    agentSection.appendChild(el('div', { class: 'meta', text: 'None yet — facts your agent stores through the m8m MCP server will appear here.' }));
  }
  $app.appendChild(agentSection);

  // --- File memories (local markdown/json imports) ---
  const fileSection = el('section', { class: 'mem-section' });
  const fileTitle = el('h2', { class: 'section-title', text: `File memories (${files.length})` });
  const fileHost = el('div', {});
  fileSection.appendChild(fileTitle);
  fileSection.appendChild(fileHost);
  $app.appendChild(fileSection);

  function renderFiles() {
    fileHost.innerHTML = '';
    const rows = files.filter((d) => matchesQuery(d.file_name, d.file_path, d.provider));
    fileTitle.textContent = `File memories (${rows.length === files.length ? rows.length : `${rows.length} of ${files.length}`})`;
    if (!files.length) {
      fileHost.appendChild(el('div', { class: 'meta', text: 'None yet — imported markdown/json memory files land here. Run "m8m scan" or "m8m import <file>".' }));
      return;
    }
    if (!rows.length) return; // nothing matches: syncSections() hides the section
    fileHost.appendChild(fileMemoriesTable(rows));
  }

  // A section drops out when the search matches nothing inside it, so a query
  // that only hits agent memories never leaves a table of unrelated file rows.
  function syncSections() {
    const needle = queryNeedle();
    const agentHits = needle ? memories.filter((m) => matchesQuery(m.content, m.id)).length : memories.length;
    const fileHits = needle ? files.filter((d) => matchesQuery(d.file_name, d.file_path, d.provider)).length : files.length;
    const showAgent = !needle || agentHits > 0;
    const showFile = !needle || fileHits > 0;

    agentSection.hidden = !showAgent;
    fileSection.hidden = !showFile;
    agentButton.hidden = !showAgent;
    fileButton.hidden = !showFile;
    agentButton.querySelector('.n').textContent = String(agentHits);
    fileButton.querySelector('.n').textContent = String(fileHits);
    noMatchHost.innerHTML = '';
    if (!showAgent && !showFile) {
      noMatchHost.appendChild(emptyState('search', 'No memories match',
        `Nothing matches "${ui.query.trim()}" in agent or file memories.`,
        clearSearchButton(() => { renderAgentList(); renderFiles(); syncSections(); })));
    }

    watchSections(
      [agentSection, fileSection].filter((section) => !section.hidden),
      [agentButton, fileButton].filter((button) => !button.hidden),
    );
  }

  renderFiles();
  syncSections();
  decorateClamps($app);
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
      contentBlock(nodeContent || doc.file_name, { class: 'text', lines: 3, query: ui.query }),
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
      contentBlock(memory.content, { class: 'text', lines: 3, query: ui.query }),
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
    card.appendChild(contentBlock(String(event.details.detail), { class: 'detail', lines: 2, query: ui.query }));
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
    ['unresolved', 'Unresolved'],
    ['all', 'All'],
    ['critical', 'Critical'],
    ['warning', 'Warning'],
    ['info', 'Info'],
  ];
  const chips = el('div', { class: 'toolbar' });
  chips.appendChild(searchInput({ label: 'Search security events', placeholder: 'Search events' }, renderRows));
  const chipButtons = new Map();
  for (const [key, label] of filters) {
    const button = el('button', {
      class: 'chip',
      'aria-pressed': String(ui.security === key),
      onclick: () => {
        ui.security = key;
        chipButtons.forEach((btn, k) => btn.setAttribute('aria-pressed', String(k === key)));
        renderRows();
      },
    }, label, el('span', { class: 'n', text: '0' }));
    chipButtons.set(key, button);
    chips.appendChild(button);
  }
  $app.appendChild(chips);
  const listHost = el('div', {});
  $app.appendChild(listHost);

  function eventMatches(event) {
    const memory = event.memory_id ? byId.get(event.memory_id) : null;
    const doc = event.document_id ? byDocId.get(event.document_id) : null;
    return matchesQuery(
      event.title,
      event.details && event.details.detail,
      event.details && event.details.node_content,
      memory && memory.content,
      doc && doc.file_name,
    );
  }

  function renderRows() {
    listHost.innerHTML = '';
    const matching = events.filter(eventMatches);
    const counts = {
      unresolved: matching.filter((e) => !e.resolved_at).length,
      all: matching.length,
      critical: matching.filter((e) => e.severity === 'critical').length,
      warning: matching.filter((e) => e.severity === 'warning').length,
      info: matching.filter((e) => e.severity === 'info').length,
    };
    chipButtons.forEach((btn, key) => { btn.querySelector('.n').textContent = String(counts[key]); });

    const shown = matching.filter((e) => {
      if (ui.security === 'unresolved') return !e.resolved_at;
      if (ui.security === 'all') return true;
      return e.severity === ui.security;
    });
    listHost.appendChild(el('div', { class: 'count', text: shown.length === events.length
      ? `${shown.length} events`
      : `${shown.length} of ${events.length} events` }));

    if (!shown.length) {
      listHost.appendChild(queryNeedle()
        ? emptyState('search', 'No events match', `Nothing matches "${ui.query.trim()}".`, clearSearchButton(renderRows))
        : emptyState('inbox', 'Nothing to review', 'No security events match this filter. Resolved events stay on record under "All".',
          ui.security !== 'all' ? el('button', {
            class: 'btn ghost',
            text: 'Show all events',
            onclick: () => {
              ui.security = 'all';
              chipButtons.forEach((btn, k) => btn.setAttribute('aria-pressed', String(k === 'all')));
              renderRows();
            },
          }) : null));
      return;
    }

    for (const event of shown) {
      listHost.appendChild(eventCard(
        event,
        event.memory_id ? byId.get(event.memory_id) : null,
        event.document_id ? byDocId.get(event.document_id) : null,
      ));
    }
    decorateClamps(listHost);
  }

  renderRows();
}

/* ------------------------------------------------------------------- diff */

function diffRow(kind, sigil, after, before, entry) {
  const row = el('div', { class: `diff-row ${kind}` }, el('div', { class: 'sigil', text: sigil }));
  const body = el('div', {});
  if (before) body.appendChild(contentBlock(before, { class: 'diff-before', lines: 2, query: ui.query }));
  body.appendChild(contentBlock(after, { class: 'diff-after', lines: 3, query: ui.query }));
  body.appendChild(el('div', { class: 'diff-meta' },
    badge(platform(entry.source_platform)),
    el('span', { class: 'meta', text: timeAgo(entry.last_seen || entry.last_modified || entry.first_seen) }),
    el('span', { class: 'id', text: entry.id.slice(0, 8), title: entry.id }),
  ));
  row.appendChild(body);
  return row;
}

/** Minimal LCS line diff, returned as `[sigil, line]` pairs (`+`, `-`, ` `). */
function diffLines(oldText, newText) {
  const a = String(oldText ?? '').split('\n');
  const b = String(newText ?? '').split('\n');
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([' ', a[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(['-', a[i]]); i++; }
    else { out.push(['+', b[j]]); j++; }
  }
  while (i < n) out.push(['-', a[i++]]);
  while (j < m) out.push(['+', b[j++]]);
  return out;
}

function fileDiffRow(change) {
  const isAdd = change.change_type === 'created';
  const row = el('div', { class: `diff-row ${isAdd ? 'added' : 'modified'}` }, el('div', { class: 'sigil', text: isAdd ? '+' : '~' }));
  const body = el('div', {});
  body.appendChild(contentBlock(change.file_name, { class: 'cell-content', lines: 2, query: ui.query }));
  body.appendChild(el('div', { class: 'meta' }, highlightMatches(change.file_path, ui.query)));

  if (change.old_content !== undefined && change.new_content !== undefined) {
    const pre = el('pre', { class: 'doc-raw diff-lines' });
    for (const [sigil, line] of diffLines(change.old_content, change.new_content)) {
      pre.appendChild(el('span', {
        class: sigil === '-' ? 'diff-del' : sigil === '+' ? 'diff-add' : '',
        text: `${sigil === ' ' ? ' ' : sigil} ${line}\n`,
      }));
    }
    body.appendChild(pre);
  } else {
    body.appendChild(el('div', { class: 'diff-after', text: `+${change.nodes_added} ~${change.nodes_modified} -${change.nodes_deleted} nodes` }));
  }

  body.appendChild(el('div', { class: 'diff-meta' },
    badge('file', 'accent'),
    badge(change.provider || platform(change.source_platform)),
    el('span', { class: 'meta', text: timeAgo(change.changed_at) }),
    el('span', { class: 'id', text: (change.document_id || '').slice(0, 8), title: change.document_id }),
  ));
  row.appendChild(body);
  return row;
}

async function renderDiff() {
  loading(3);
  const data = await load('diff', '/api/diff');
  const fileChanges = data.file_changes || [];
  $app.innerHTML = '';

  $app.appendChild(pageHead('Diff',
    data.snapshot
      ? `Against snapshot ${data.snapshot.slice(0, 8)}, taken ${timeAgo(data.snapshot_taken_at)}`
      : 'No baseline snapshot yet — take one to start tracking drift',
    [
      el('button', { class: 'btn primary', onclick: () => act('/api/snapshot', {}, 'Snapshot taken') }, icon('camera', 14), 'Take snapshot'),
      el('button', { class: 'btn ghost', onclick: () => { invalidate(); refresh(); } }, icon('refresh'), 'Refresh'),
    ]));

  // Same control row as Memories: search on the left, section switch beside it.
  const controlBar = el('div', { class: 'subnav' });
  controlBar.appendChild(searchInput({ label: 'Search diff', placeholder: 'Search changes' }, renderRows));
  let agentBlock = null;
  let fileBlock = null;
  const changesButton = el('button', {
    class: 'chip',
    type: 'button',
    'aria-current': 'true',
    onclick: () => jumpToSection(agentBlock, changesButton),
  }, 'Memory changes', el('span', { class: 'n', text: '0' }));
  const filesButton = el('button', {
    class: 'chip',
    type: 'button',
    onclick: () => jumpToSection(fileBlock, filesButton),
  }, 'File memories', el('span', { class: 'n', text: '0' }));
  controlBar.appendChild(el('div', { class: 'switch', role: 'group', 'aria-label': 'Jump to section' }, changesButton, filesButton));
  $app.appendChild(controlBar);

  const listHost = el('div', {});
  $app.appendChild(listHost);

  function renderRows() {
    listHost.innerHTML = '';
    const added = data.added.filter((entry) => matchesQuery(entry.content, entry.source_platform));
    const modified = data.modified.filter((item) => matchesQuery(item.after && item.after.content, item.before && item.before.content));
    const deleted = data.deleted.filter((entry) => matchesQuery(entry.content));
    const fileRows = fileChanges.filter((change) => matchesQuery(change.file_name, change.file_path, change.provider));

    listHost.appendChild(el('div', { class: 'diff-summary' },
      badge(`${added.length} added`, 'ok'),
      badge(`${modified.length} modified`, 'warn'),
      badge(`${deleted.length} deleted`, deleted.length ? 'crit' : ''),
      badge(`${fileRows.length} file changes`, 'accent'),
    ));

    const agentCount = added.length + modified.length + deleted.length;
    changesButton.querySelector('.n').textContent = String(agentCount);
    filesButton.querySelector('.n').textContent = String(fileRows.length);
    changesButton.hidden = agentCount === 0;
    filesButton.hidden = fileRows.length === 0;
    agentBlock = null;
    fileBlock = null;

    if (!added.length && !modified.length && !deleted.length && !fileRows.length) {
      listHost.appendChild(queryNeedle()
        ? emptyState('search', 'No changes match', `Nothing matches "${ui.query.trim()}".`, clearSearchButton(renderRows))
        : emptyState('check', 'No drift',
          data.snapshot
            ? 'Every memory matches the baseline snapshot.'
            : 'Take a snapshot to record a baseline; later changes will be listed here.'));
      return;
    }

    if (agentCount) {
      agentBlock = el('section', { class: 'mem-section' });
      agentBlock.appendChild(el('h2', { class: 'section-title', text: `Memory changes (${agentCount})` }));
      for (const entry of added) agentBlock.appendChild(diffRow('added', '+', entry.content, null, entry));
      for (const item of modified) agentBlock.appendChild(diffRow('modified', '~', item.after.content, item.before.content, item.after));
      for (const entry of deleted) agentBlock.appendChild(diffRow('deleted', '−', entry.content, null, entry));
      listHost.appendChild(agentBlock);
    }

    if (fileRows.length) {
      fileBlock = el('section', { class: 'mem-section' });
      fileBlock.appendChild(el('h2', {
        class: 'section-title',
        text: `File memories (${fileRows.length === fileChanges.length ? fileRows.length : `${fileRows.length} of ${fileChanges.length}`} changes)`,
      }));
      for (const change of fileRows) fileBlock.appendChild(fileDiffRow(change));
      listHost.appendChild(fileBlock);
    }

    watchSections(
      [agentBlock, fileBlock].filter(Boolean),
      [changesButton, filesButton].filter((button) => !button.hidden),
    );
    decorateClamps(listHost);
  }

  renderRows();
}

/* -------------------------------------------------------------- documents */

function fileMemoriesTable(files) {
  const table = el('table');
  table.appendChild(el('thead', {},
    el('tr', {},
      el('th', { text: 'File' }),
      el('th', { text: 'Provider' }),
      el('th', { class: 'num', text: 'Nodes' }),
      el('th', { text: 'Flags' }),
      el('th', { text: 'Version' }),
      el('th', { text: 'Modified' }),
      el('th', { class: 'num', text: 'Actions' }),
    ),
  ));

  const tbody = el('tbody');
  for (const d of files) {
    const body = el('div', { class: 'doc-body' });
    const detailRow = el('tr', { class: 'doc-detail-row', style: 'display:none' },
      el('td', { colspan: '7' }, body),
    );

    const actions = el('div', { class: 'row-actions' },
      el('button', { class: 'btn ghost doc-toggle', onclick: (e) => toggleDocView(d, body, 'tree', e.currentTarget, detailRow) }, 'Tree'),
      el('button', { class: 'btn ghost doc-toggle', onclick: (e) => toggleDocView(d, body, 'raw', e.currentTarget, detailRow) }, 'Raw'),
    );

    tbody.appendChild(el('tr', {},
      el('td', {},
        contentBlock(d.file_name, { class: 'cell-content', lines: 2, query: ui.query }),
        el('div', { class: 'cell-sub' },
          el('span', { class: 'id', text: d.id.slice(0, 8), title: d.id }),
          el('span', { class: 'meta' }, highlightMatches(d.file_path, ui.query)),
        ),
      ),
      el('td', {}, badge(d.provider || platform(d.source_platform))),
      el('td', { class: 'num', text: String(d.node_count ?? 0) }),
      el('td', {}, el('div', { class: 'flag-list' },
        ...(d.flags_summary && d.flags_summary.length ? flagBadges(d.flags_summary) : [el('span', { class: 'meta', text: '—' })]),
      )),
      el('td', {}, badge(`v${d.version}`, 'mono', { mono: true })),
      el('td', { class: 'meta', text: timeAgo(d.last_modified || d.last_seen) }),
      el('td', { class: 'num' }, actions),
    ));
    tbody.appendChild(detailRow);
  }
  table.appendChild(tbody);
  return el('div', { class: 'table-wrap' }, table);
}

async function toggleDocView(d, body, kind, btn, detailRow) {
  // Clicking the currently-open view hides it; clicking the other switches.
  if (body.dataset.view === kind) {
    body.innerHTML = '';
    delete body.dataset.view;
    btn.classList.remove('active');
    if (detailRow) detailRow.style.display = 'none';
    return;
  }
  body.innerHTML = '';
  body.dataset.view = kind;
  if (detailRow) detailRow.style.display = '';
  for (const b of btn.parentElement.querySelectorAll('.doc-toggle')) b.classList.remove('active');
  btn.classList.add('active');

  if (kind === 'tree') {
    try {
      const doc = await api(`/api/documents/${d.id}`);
      body.appendChild(renderDocTree(doc.nodes || []));
      decorateClamps(body);
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
    row.appendChild(contentBlock(n.heading || n.content.replace(/\s+/g, ' '), { class: 'doc-node-content', lines: 1 }));
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
  syncTopbarHeight();
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
window.addEventListener('resize', syncTopbarHeight);

// Initial load: honor the URL hash, normalizing an empty one to #/timeline.
if (!location.hash) history.replaceState(null, '', `#/${DEFAULT_VIEW}`);
renderRoute();
