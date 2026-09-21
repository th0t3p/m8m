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
  chatgpt_web: 'ChatGPT', cursor: 'Cursor', dsh: 'DeepSeek Harness', local_file: 'Local file',
  manual_import: 'Manual import', mem0: 'mem0', unknown: 'Unknown',
  codebuddy: 'CodeBuddy', windsurf: 'Windsurf', cline: 'Cline', codex: 'Codex',
  aider: 'Aider', copilot: 'GitHub Copilot', continue_dev: 'Continue.dev', gemini: 'Gemini CLI',
  zed: 'Zed', trae: 'Trae', goose: 'Goose', qoder: 'Qoder',
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
  // Treat both snake_case and kebab-case (raw clientInfo.name like
  // "codex-cli", "github-copilot") as word separators.
  return String(value).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
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

// Quarantine takes a memory out of circulation, so it reads as the heavier of
// the two actions and needs a second click. It disarms on its own so a button
// can never be left primed.
const QUARANTINE_CONFIRM_MS = 3000;

function quarantineButton(event) {
  const critical = event.severity === 'critical';
  const rest = critical ? 'Quarantine memory' : 'Quarantine';
  const text = el('span', { text: rest });
  const button = el('button', { class: `btn danger${critical ? ' crit' : ''}` }, icon('alert', 14), text);

  let timer = null;
  const disarm = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    button.classList.remove('armed');
    text.textContent = rest;
  };

  button.addEventListener('click', () => {
    if (timer) {
      disarm();
      act(`/api/memories/${event.memory_id}/quarantine`, {}, 'Memory quarantined');
      return;
    }
    button.classList.add('armed');
    text.textContent = 'Confirm quarantine?';
    timer = setTimeout(disarm, QUARANTINE_CONFIRM_MS);
  });

  return button;
}

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
        class: 'btn ghost',
        onclick: () => act(`/api/events/${event.id}/resolve`, { resolution: 'user_dismissed' }, 'Event resolved'),
      }, icon('check', 14), 'Resolve'),
      event.memory_id ? quarantineButton(event) : null,
    ));
  }

  return card;
}

/** Consecutive events sharing a severity and title fold into one card, so a run
 *  of identical flags reads as a single item until it is opened. */
function eventGroupNode(events, cardFor) {
  const first = events[0];
  const body = el('div', { class: 'event-group-body', hidden: true });
  const toggle = el('button', {
    class: 'toggle',
    type: 'button',
    'aria-expanded': 'false',
    text: `Show all ${events.length}`,
  });
  const node = el('div', { class: `event ${first.severity} event-group${first.resolved_at ? ' resolved' : ''}` },
    el('div', { class: 'event-head' },
      badge(humanize(first.severity, SEVERITY_LABEL), SEVERITY_VARIANT[first.severity] || ''),
      el('span', { class: 'title', text: first.title }),
      badge(`×${events.length}`, 'accent'),
      el('span', {
        class: 'meta time',
        text: timeAgo(first.detected_at),
        title: new Date(first.detected_at).toLocaleString(),
      }),
      toggle,
    ),
    body,
  );

  let built = false;
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') !== 'true';
    if (expanded && !built) {
      for (const event of events) body.appendChild(cardFor(event));
      built = true;
    }
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = expanded ? 'Hide' : `Show all ${events.length}`;
    body.hidden = !expanded;
    if (expanded) decorateClamps(body);
  });

  return node;
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

    const cardFor = (event) => eventCard(
      event,
      event.memory_id ? byId.get(event.memory_id) : null,
      event.document_id ? byDocId.get(event.document_id) : null,
    );

    // Fold runs of identical flags. Only consecutive events group, so the
    // list keeps the severity/date order the API returned.
    let run = [];
    const flush = () => {
      if (!run.length) return;
      listHost.appendChild(run.length > 1 ? eventGroupNode(run, cardFor) : cardFor(run[0]));
      run = [];
    };
    for (const event of shown) {
      const prev = run[run.length - 1];
      if (prev && (prev.title !== event.title
        || prev.severity !== event.severity
        || Boolean(prev.resolved_at) !== Boolean(event.resolved_at))) flush();
      run.push(event);
    }
    flush();
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

/** Windows of ±context lines around each change, merged where they overlap. */
function diffHunks(lines, context = 2) {
  const ranges = [];
  lines.forEach(([sigil], index) => {
    if (sigil === ' ') return;
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  });
  return ranges;
}

/** Repaints the block with `ranges`; unchanged runs between them collapse to a gap. */
function renderDiffHunks(pre, lines, ranges) {
  pre.textContent = '';
  let previousEnd = -1;
  for (const range of ranges) {
    if (previousEnd !== -1 && range.start > previousEnd + 1) {
      pre.appendChild(el('span', {
        class: 'dl-gap',
        text: `⋯ ${range.start - previousEnd - 1} unchanged`,
      }));
    }
    for (let i = range.start; i <= range.end; i++) {
      const [sigil, line] = lines[i];
      const kind = sigil === '+' ? 'dl-add' : sigil === '-' ? 'dl-del' : 'dl-ctx';
      pre.appendChild(el('span', { class: `dl ${kind}`, text: `${sigil} ${line}` }));
    }
    previousEnd = range.end;
  }
}

/** Whole hunks up to `cap` changed lines, truncating the hunk that crosses it. */
function diffVisibleRanges(lines, hunks, cap) {
  const ranges = [];
  let used = 0;
  for (const hunk of hunks) {
    if (used >= cap) break;
    let end = hunk.start;
    for (let i = hunk.start; i <= hunk.end; i++) {
      end = i;
      if (lines[i][0] !== ' ') used++;
      if (used >= cap) break;
    }
    ranges.push({ start: hunk.start, end });
  }
  return ranges;
}

function countChanged(lines, ranges) {
  let n = 0;
  for (const range of ranges) {
    for (let i = range.start; i <= range.end; i++) if (lines[i][0] !== ' ') n++;
  }
  return n;
}

/** How many hunks stay visible before the "Show N more changes" control.
 *  A whole-file dump buries the signal, so changed lines carry the view. */
const DIFF_VISIBLE_CHANGES = 5;

/** A diff rendered in full. Callers that gate a destructive action on it need
 *  every line visible, so only diffBlock collapses. */
function diffPre(oldText, newText) {
  const pre = el('pre', { class: 'diff-lines' });
  const lines = diffLines(oldText, newText);
  const hunks = diffHunks(lines);
  if (!hunks.length) {
    pre.appendChild(el('span', { class: 'dl dl-ctx', text: 'No line-level changes.' }));
    return pre;
  }
  renderDiffHunks(pre, lines, hunks);
  return pre;
}

function diffBlock(oldText, newText) {
  const lines = diffLines(oldText, newText);
  const hunks = diffHunks(lines);
  const pre = el('pre', { class: 'diff-lines' });
  const wrap = el('div', { class: 'diff-block' }, pre);

  if (!hunks.length) {
    pre.appendChild(el('span', { class: 'dl dl-ctx', text: 'No line-level changes.' }));
    return wrap;
  }

  const collapsed = diffVisibleRanges(lines, hunks, DIFF_VISIBLE_CHANGES);
  const total = countChanged(lines, [{ start: 0, end: lines.length - 1 }]);
  const remaining = total - countChanged(lines, collapsed);

  renderDiffHunks(pre, lines, collapsed);
  if (remaining <= 0) return wrap;

  const collapsedLabel = `Show ${remaining} more change${remaining === 1 ? '' : 's'}`;
  const toggle = el('button', {
    class: 'toggle',
    type: 'button',
    'aria-expanded': 'false',
    onclick: () => {
      const expanded = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? 'Show fewer changes' : collapsedLabel;
      renderDiffHunks(pre, lines, expanded ? hunks : collapsed);
    },
  }, collapsedLabel);

  wrap.appendChild(toggle);
  return wrap;
}

function fileDiffRow(change) {
  const isAdd = change.change_type === 'created';
  const row = el('div', { class: `diff-row ${isAdd ? 'added' : 'modified'}` }, el('div', { class: 'sigil', text: isAdd ? '+' : '~' }));
  const body = el('div', {});
  body.appendChild(contentBlock(change.file_name, { class: 'cell-content', lines: 2, query: ui.query }));
  body.appendChild(el('div', { class: 'meta' }, highlightMatches(change.file_path, ui.query)));

  if (change.old_content !== undefined && change.new_content !== undefined) {
    body.appendChild(diffBlock(change.old_content, change.new_content));
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

/* ------------------------------------------------------ snapshot rollback */

function snapshotRow(snapshot) {
  return el('div', { class: 'snap-row' },
    el('span', { class: 'id', text: snapshot.id.slice(0, 8), title: snapshot.id }),
    badge(snapshot.platform || 'manual'),
    el('span', { class: 'meta', text: `${snapshot.entry_count} ${snapshot.entry_count === 1 ? 'memory' : 'memories'}` }),
    el('span', { class: 'meta', text: timeAgo(snapshot.taken_at), title: new Date(snapshot.taken_at).toLocaleString() }),
    el('div', { class: 'row-actions' },
      el('button', {
        class: 'btn ghost',
        type: 'button',
        onclick: (event) => openSnapshotPreview(snapshot, event.currentTarget),
      }, 'Preview…'),
      el('button', {
        class: 'btn danger',
        type: 'button',
        onclick: (event) => openSnapshotRollback(snapshot, event.currentTarget),
      }, 'Rollback…'),
    ),
  );
}

// Browse what a snapshot holds. GET /api/snapshots already ships the captured
// entries and documents, so this needs no extra request and changes nothing.
function openSnapshotPreview(snapshot, button) {
  const row = button.closest('.snap-row');
  const open = row && row.nextElementSibling;
  if (open && open.classList.contains('snapshot-panel')) { open.remove(); return; }
  for (const stale of document.querySelectorAll('.rollback-panel, .snapshot-panel')) stale.remove();

  const panel = el('div', { class: 'snapshot-panel' });
  renderSnapshotPreview(panel, snapshot);
  row.after(panel);
}

function renderSnapshotPreview(panel, snapshot) {
  const entries = snapshot.snapshot_data ?? [];
  const docs = snapshot.documents_data;

  panel.appendChild(el('div', { class: 'rollback-head' },
    icon('clock', 16),
    el('span', { class: 'title', text: `Snapshot ${snapshot.id.slice(0, 8)}` }),
    badge(snapshot.platform || 'manual'),
    el('span', { class: 'meta', text: `${entries.length} ${entries.length === 1 ? 'memory' : 'memories'}` }),
    el('span', { class: 'meta', text: timeAgo(snapshot.taken_at), title: new Date(snapshot.taken_at).toLocaleString() }),
  ));
  panel.appendChild(el('div', { class: 'rollback-note', text: 'What the store held at this point. Nothing changes until you confirm a rollback.' }));

  panel.appendChild(el('div', { class: 'rollback-group', text: `Agent memories (${entries.length})` }));
  if (entries.length) {
    const list = el('div', { class: 'bucket-list' });
    for (const entry of entries) {
      list.appendChild(el('div', { class: 'bucket-item' },
        contentBlock(entry.content, { lines: 2, query: ui.query }),
        el('div', { class: 'snap-meta' },
          badge(platform(entry.source_platform)),
          el('span', { class: 'meta', text: `trust ${Number(entry.trust_level ?? 0).toFixed(2)}` }),
          entry.status && entry.status !== 'active'
            ? badge(statusLabel(entry.status), entry.status === 'quarantined' ? 'crit' : '')
            : null,
          el('span', { class: 'id', text: entry.id.slice(0, 8), title: entry.id }),
        ),
      ));
    }
    panel.appendChild(list);
  } else {
    panel.appendChild(el('div', { class: 'rollback-note', text: 'No agent memories were captured in this snapshot.' }));
  }

  panel.appendChild(el('div', { class: 'rollback-group', text: 'File memories' }));
  if (!docs) {
    panel.appendChild(el('div', { class: 'rollback-note', text: 'This snapshot predates file-memory capture, so it holds no record of them — rolling back to it would remove every file memory in the store. The rollback preview lists exactly what it would remove.' }));
  } else if (!docs.length) {
    panel.appendChild(el('div', { class: 'rollback-note', text: 'No file memories were captured in this snapshot.' }));
  } else {
    const list = el('div', { class: 'bucket-list' });
    for (const doc of docs) {
      list.appendChild(el('div', { class: 'bucket-item' },
        el('div', { class: 'cell-content', text: doc.file_name }),
        el('div', { class: 'snap-meta' },
          el('span', { class: 'meta', text: doc.file_path }),
          badge(`${doc.node_count ?? 0} nodes`, 'mono', { mono: true }),
          badge(`v${doc.version}`, 'mono', { mono: true }),
        ),
      ));
    }
    panel.appendChild(list);
  }

  panel.appendChild(el('div', { class: 'rollback-actions' },
    el('button', {
      class: 'btn danger',
      type: 'button',
      onclick: () => {
        const row = panel.previousElementSibling;
        const rollbackButton = row && row.querySelector('.row-actions .btn.danger');
        panel.remove();
        if (rollbackButton) openSnapshotRollback(snapshot, rollbackButton);
      },
    }, 'Roll back to this snapshot'),
    el('button', { class: 'btn ghost', type: 'button', text: 'Close', onclick: () => panel.remove() }),
  ));
}

// Preview first, confirm second: rolling back rewrites the agent memory store,
// so the destructive call never happens straight off a single click.
async function openSnapshotRollback(snapshot, button) {
  const row = button.closest('.snap-row');
  const open = row && row.nextElementSibling;
  if (open && open.classList.contains('rollback-panel')) { open.remove(); return; }
  for (const stale of document.querySelectorAll('.rollback-panel, .snapshot-panel')) stale.remove();

  const panel = el('div', { class: 'rollback-panel' });
  panel.appendChild(el('div', { class: 'meta', text: 'Building preview…' }));
  row.after(panel);
  try {
    const diff = await api(`/api/snapshots/${snapshot.id}/rollback/preview`, { method: 'POST' });
    panel.innerHTML = '';
    renderSnapshotRollback(panel, snapshot, diff);
  } catch (err) {
    panel.innerHTML = '';
    panel.appendChild(el('div', { class: 'rollback-note', text: `Could not build the preview — ${err.message}` }));
  }
}

function rollbackBucket(variant, label, count) {
  const box = el('div', { class: 'bucket' },
    el('div', { class: 'bucket-head' }, badge(label, variant), el('span', { class: 'meta', text: String(count) })),
  );
  const list = el('div', { class: 'bucket-list' });
  box.appendChild(list);
  return { box, list };
}

function renderSnapshotRollback(panel, snapshot, preview) {
  // Preview shape: { entries: MemoryDiff, documents: { restored, removed } }.
  const diff = preview.entries ?? { added: [], modified: [], deleted: [], unchanged_count: 0 };
  const docs = preview.documents ?? { restored: [], removed: [] };
  // An entry the snapshot itself recorded as deleted is not "restored" — that is
  // a no-op, so keep it out of the count and out of the list.
  const restorable = diff.added.filter((entry) => entry.status !== 'deleted');
  const agentTotal = restorable.length + diff.modified.length + diff.deleted.length;
  const fileTotal = docs.restored.length + docs.removed.length;
  const total = agentTotal + fileTotal;

  panel.appendChild(el('div', { class: 'rollback-head' },
    icon('alert', 16),
    el('span', { class: 'title', text: `Roll back to snapshot ${snapshot.id.slice(0, 8)}?` }),
  ));
  panel.appendChild(el('div', { class: 'rollback-note', text: total
    ? `Agent memories and file memories are rewound to the snapshot taken ${timeAgo(snapshot.taken_at)}. Restoring a file memory writes its earlier content back to the file on disk. ${diff.unchanged_count} agent memories already match and stay untouched.`
    : 'Nothing to change — the store already matches this snapshot.' }));

  if (agentTotal) {
    panel.appendChild(el('div', { class: 'rollback-group', text: 'Agent memories' }));

    if (restorable.length) {
      const { box, list } = rollbackBucket('ok', 'Will be restored', restorable.length);
      for (const entry of restorable) {
        list.appendChild(el('div', { class: 'bucket-item' }, contentBlock(entry.content, { lines: 2 })));
      }
      panel.appendChild(box);
    }

    if (diff.modified.length) {
      const { box, list } = rollbackBucket('warn', 'Will be reverted', diff.modified.length);
      for (const item of diff.modified) {
        list.appendChild(el('div', { class: 'bucket-item' },
          el('span', { class: 'label', text: 'now' }),
          contentBlock(item.before.content, { class: 'diff-before', lines: 2 }),
          el('span', { class: 'label', text: 'after rollback' }),
          contentBlock(item.after.content, { class: 'diff-after', lines: 2 }),
        ));
      }
      panel.appendChild(box);
    }

    if (diff.deleted.length) {
      const { box, list } = rollbackBucket('crit', 'Will be removed', diff.deleted.length);
      for (const entry of diff.deleted) {
        list.appendChild(el('div', { class: 'bucket-item' },
          el('span', { class: 'label', text: 'now' }),
          contentBlock(entry.content, { class: 'diff-before', lines: 2 }),
        ));
      }
      panel.appendChild(box);
    }
  }

  if (fileTotal) {
    panel.appendChild(el('div', { class: 'rollback-group', text: 'File memories' }));

    if (docs.restored.length) {
      const { box, list } = rollbackBucket('ok', 'Written back to disk', docs.restored.length);
      for (const doc of docs.restored) {
        list.appendChild(el('div', { class: 'bucket-item' },
          el('div', { class: 'cell-content', text: doc.file_name }),
          el('div', { class: 'meta', text: doc.file_path }),
        ));
      }
      panel.appendChild(box);
    }

    if (docs.removed.length) {
      const { box, list } = rollbackBucket('crit', 'Removed from the store', docs.removed.length);
      for (const doc of docs.removed) {
        list.appendChild(el('div', { class: 'bucket-item' },
          el('div', { class: 'cell-content', text: doc.file_name }),
          el('div', { class: 'meta', text: doc.file_path }),
        ));
      }
      panel.appendChild(box);
    }
  }

  panel.appendChild(el('div', { class: 'rollback-actions' },
    total ? el('button', {
      class: 'btn danger',
      type: 'button',
      onclick: async (event) => {
        const confirmButton = event.currentTarget;
        confirmButton.disabled = true;
        confirmButton.textContent = 'Rolling back…';
        try {
          await api(`/api/snapshots/${snapshot.id}/rollback`, { method: 'POST' });
          invalidate();
          toast(`Rolled back to snapshot ${snapshot.id.slice(0, 8)}`);
          refresh();
        } catch (err) {
          confirmButton.disabled = false;
          confirmButton.textContent = 'Confirm rollback';
          toast(`Rollback failed — ${err.message}`, 'error');
        }
      },
    }, 'Confirm rollback') : null,
    el('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: () => panel.remove() }),
  ));
}

async function renderDiff() {
  loading(3);
  // The snapshot list is optional: a dashboard process from before the rollback
  // routes existed would 404 here, and that must not take down the whole view.
  const [data, snapshotFeed] = await Promise.all([
    load('diff', '/api/diff'),
    load('snapshots', '/api/snapshots')
      .then((list) => ({ ok: true, list }))
      .catch((error) => ({ ok: false, error })),
  ]);
  const snapshots = snapshotFeed.ok ? snapshotFeed.list : [];
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
  let snapBlock = null;
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
  const snapsButton = el('button', {
    class: 'chip',
    type: 'button',
    onclick: () => jumpToSection(snapBlock, snapsButton),
  }, 'Snapshots', el('span', { class: 'n', text: String(snapshots.length) }));
  controlBar.appendChild(el('div', { class: 'switch', role: 'group', 'aria-label': 'Jump to section' }, changesButton, filesButton, snapsButton));
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
    snapsButton.querySelector('.n').textContent = snapshotFeed.ok ? String(snapshots.length) : '—';
    changesButton.hidden = agentCount === 0;
    filesButton.hidden = fileRows.length === 0;
    snapsButton.hidden = snapshotFeed.ok && snapshots.length === 0;
    agentBlock = null;
    fileBlock = null;
    snapBlock = null;

    // No drift is a state of the changes, not of the page: snapshots still list.
    if (!added.length && !modified.length && !deleted.length && !fileRows.length) {
      listHost.appendChild(queryNeedle()
        ? emptyState('search', 'No changes match', `Nothing matches "${ui.query.trim()}".`, clearSearchButton(renderRows))
        : emptyState('check', 'No drift',
          data.snapshot
            ? 'Every memory matches the baseline snapshot.'
            : 'Take a snapshot to record a baseline; later changes will be listed here.'));
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

    if (snapshots.length) {
      snapBlock = el('section', { class: 'mem-section' });
      snapBlock.appendChild(el('h2', { class: 'section-title', text: `Snapshots (${snapshots.length})` }));
      snapBlock.appendChild(el('div', { class: 'meta', text: 'Rolling back rewinds agent memories and file memories to a snapshot — files are written back to disk. Preview before you confirm.' }));
      for (const snapshot of snapshots) snapBlock.appendChild(snapshotRow(snapshot));
      listHost.appendChild(snapBlock);
    } else if (!snapshotFeed.ok) {
      snapBlock = el('section', { class: 'mem-section' });
      snapBlock.appendChild(el('h2', { class: 'section-title', text: 'Snapshots' }));
      snapBlock.appendChild(el('div', { class: 'rollback-note', text: `Can't list snapshots — ${snapshotFeed.error.message}. A dashboard process started before the rollback routes existed will keep returning 404 for them; restart the dashboard and reload.` }));
      listHost.appendChild(snapBlock);
    }

    watchSections(
      [agentBlock, fileBlock, snapBlock].filter(Boolean),
      [changesButton, filesButton, snapsButton].filter((button) => !button.hidden),
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
      d.version > 1
        ? el('button', { class: 'btn danger', type: 'button', onclick: (e) => openFileRollback(d, body, detailRow, e.currentTarget) }, 'Rollback…')
        : null,
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

// File memories roll back from their own history: preview the line diff, then
// write the previous content back to the file on disk and re-import it.
async function openFileRollback(doc, body, detailRow, button) {
  if (body.dataset.view === 'rollback') {
    body.innerHTML = '';
    delete body.dataset.view;
    if (detailRow) detailRow.style.display = 'none';
    return;
  }
  for (const other of button.parentElement.querySelectorAll('.doc-toggle')) other.classList.remove('active');
  body.dataset.view = 'rollback';
  if (detailRow) detailRow.style.display = '';
  body.innerHTML = '';

  const panel = el('div', { class: 'rollback-panel' });
  panel.appendChild(el('div', { class: 'meta', text: 'Building preview…' }));
  body.appendChild(panel);

  try {
    const preview = await api(`/api/documents/${doc.id}/rollback/preview`, { method: 'POST' });
    panel.innerHTML = '';
    panel.appendChild(el('div', { class: 'rollback-head' },
      badge('file', 'accent'),
      el('span', { class: 'title', text: `Restore the previous version of ${preview.file_name}` }),
    ));
    panel.appendChild(el('div', { class: 'rollback-note', text: 'The earlier content is written back to the file on disk and re-imported. Lines marked − are dropped, + are restored.' }));

    panel.appendChild(diffPre(preview.before, preview.after));

    panel.appendChild(el('div', { class: 'rollback-actions' },
      el('button', {
        class: 'btn danger',
        type: 'button',
        onclick: async (event) => {
          const confirmButton = event.currentTarget;
          confirmButton.disabled = true;
          confirmButton.textContent = 'Restoring…';
          try {
            await api(`/api/documents/${doc.id}/rollback`, { method: 'POST' });
            invalidate();
            toast(`Restored the previous version of ${preview.file_name}`);
            refresh();
          } catch (err) {
            confirmButton.disabled = false;
            confirmButton.textContent = 'Confirm restore';
            toast(`Restore failed — ${err.message}`, 'error');
          }
        },
      }, 'Confirm restore'),
      el('button', {
        class: 'btn ghost',
        type: 'button',
        text: 'Cancel',
        onclick: () => {
          body.innerHTML = '';
          delete body.dataset.view;
          if (detailRow) detailRow.style.display = 'none';
        },
      }),
    ));
  } catch (err) {
    panel.innerHTML = '';
    panel.appendChild(el('div', { class: 'rollback-note', text: `Could not build the preview — ${err.message}` }));
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
  renderStats();
}

/* ---------------------------------------------------------- global stats */

// The unresolved critical count has to be readable from every tab, not just
// Security. Each source is optional, so a dashboard process missing one of the
// routes still reports the numbers it does have.
async function renderStats() {
  const host = document.getElementById('stats-bar');
  if (!host) return;

  const [stats, timeline, events] = await Promise.all([
    load('memories/stats', '/api/memories/stats').catch(() => null),
    load('timeline', '/api/timeline').catch(() => null),
    load('events', '/api/events').catch(() => null),
  ]);

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const items = [];
  if (stats) items.push({ text: plural(stats.total, 'memory', 'memories') });
  if (timeline) items.push({ text: plural(timeline.length, 'change', 'changes') });

  let critical = 0;
  if (events) {
    const open = events.filter((e) => !e.resolved_at);
    critical = open.filter((e) => e.severity === 'critical').length;
    const warnings = open.filter((e) => e.severity === 'warning').length;
    items.push({ text: `${critical} critical`, variant: 'crit', marked: critical > 0 });
    items.push({ text: plural(warnings, 'warning', 'warnings'), variant: 'warn', marked: warnings > 0 });
  }

  host.textContent = '';
  host.hidden = !items.length;
  items.forEach((item, index) => {
    if (index) host.appendChild(el('span', { class: 'sep', text: '·' }));
    host.appendChild(el('span', { class: `stat-item${item.variant ? ` ${item.variant}` : ''}` },
      item.marked ? el('span', { class: 'mark' }) : null,
      el('span', { text: item.text }),
    ));
  });
  host.classList.toggle('has-critical', critical > 0);
  syncTopbarHeight();
}

/* ------------------------------------------------------ keyboard shortcuts */

const SHORTCUT_VIEWS = ['timeline', 'memories', 'security', 'diff'];
const $help = document.getElementById('help-dialog');

function isTyping(node) {
  return node instanceof HTMLElement
    && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA'
      || node.tagName === 'SELECT' || node.isContentEditable);
}

document.getElementById('help-btn').addEventListener('click', () => $help.showModal());

// One listener for the whole app. Shortcuts stay out of the way while a field
// has focus, where the same keys are ordinary typing.
window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (isTyping(event.target)) {
    if (event.key === 'Escape') event.target.blur();
    return;
  }
  if ($help.open) return; // the dialog owns Escape and tabbing while it is up

  if (event.key === '?') {
    event.preventDefault();
    $help.showModal();
    return;
  }
  if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    invalidate();
    refresh();
    return;
  }
  if (event.key === 's' || event.key === 'S') {
    const field = $app.querySelector('input');
    if (field) {
      event.preventDefault();
      field.focus();
      field.select();
    }
    return;
  }
  const index = Number(event.key);
  if (Number.isInteger(index) && index >= 1 && index <= SHORTCUT_VIEWS.length) {
    event.preventDefault();
    location.hash = `#/${SHORTCUT_VIEWS[index - 1]}`;
  }
});

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
