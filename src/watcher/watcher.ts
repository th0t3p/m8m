// File system watcher for local memory files.

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import chokidar from 'chokidar';
import chalk from 'chalk';
import { getAllDocuments, getChangelog, getDb, getDocumentByPath, getMemory } from '../core/db.js';
import { hashContent } from '../core/hasher.js';
import { importFileAsDocument } from '../core/importer.js';
import { analyzeEntry } from '../core/analyzer.js';
import { expandHome } from '../core/config.js';
import type { M8mConfig, MemoryEntry, MemoryFlag, SourcePlatform } from '../core/types.js';
import { detectFileFormat } from './parsers.js';
import { header, watching } from '../cli/ui.js';

const DEFAULT_WATCH_PATHS = [
  './.claude/MEMORY.md',
  './CLAUDE.md',
  './MEMORY.md',
  './AGENTS.md',
  './.agent/memory.json',
  './.cursor/rules',
];

const HOME_WATCH_PATHS = [
  '~/.claude/memories',
  '~/.claude/CLAUDE.md',
  '~/.codex/memories', // Codex native
  '~/.hindsight', // Hindsight state
  '~/.basic-memory', // Basic Memory
];

function inferPlatform(path: string): string {
  const p = path.toLowerCase();
  if (p.includes('codebuddy')) return 'codebuddy';
  if (p.includes('claude') || p.includes('claude.md')) return 'claude_code';
  if (p.includes('cursor')) return 'cursor';
  if (p.includes('windsurf') || p.includes('codeium')) return 'windsurf';
  if (p.includes('cline')) return 'cline';
  if (p.includes('codex')) return 'codex';
  if (p.includes('aider')) return 'aider';
  if (p.includes('copilot')) return 'copilot';
  if (p.includes('continue')) return 'continue_dev';
  if (p.includes('gemini')) return 'gemini';
  if (p.includes('zed')) return 'zed';
  if (p.includes('trae')) return 'trae';
  if (p.includes('goose')) return 'goose';
  if (p.includes('qoder') || p.includes('qwen')) return 'qoder';
  return 'local_file';
}

/** Config files (config.json, settings.json, config.toml, *.conf.yml) aren't memories. */
function isConfigFile(path: string): boolean {
  const base = basename(path).toLowerCase();
  return /(^|[_.-])(config|settings)([_.-]|$)/.test(base) || /\.conf([_.-]|$)/.test(base);
}

function shortProvider(platform: string): string {
  const labels: Record<string, string> = {
    claude_code: 'Claude', claude_desktop: 'Claude', claude_web: 'Claude',
    cursor: 'Cursor', chatgpt_web: 'ChatGPT', dsh: 'DeepSeek',
    codebuddy: 'CodeBuddy', windsurf: 'Windsurf', cline: 'Cline',
    codex: 'Codex', aider: 'Aider', copilot: 'Copilot', continue_dev: 'Continue',
    gemini: 'Gemini', zed: 'Zed', trae: 'Trae', goose: 'Goose', qoder: 'Qoder',
    local_file: 'file', manual_import: 'import', mem0: 'mem0', unknown: 'unknown',
  };
  return labels[platform] ?? 'file';
}

function timeStamp(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** First line in the new content that isn't in the old content (rough "added" preview). */
export function firstAddedLine(oldContent: string, newContent: string): string {
  if (!oldContent) return newContent.split('\n')[0] ?? '';
  const oldLines = new Set(oldContent.split('\n'));
  for (const line of newContent.split('\n')) {
    if (!oldLines.has(line)) return line;
  }
  return '';
}

/** First line in the old content that isn't in the new content (rough "removed" preview). */
export function firstRemovedLine(oldContent: string, newContent: string): string {
  if (!newContent) return oldContent.split('\n')[0] ?? '';
  const newLines = new Set(newContent.split('\n'));
  for (const line of oldContent.split('\n')) {
    if (!newLines.has(line)) return line;
  }
  return '';
}

/** Most-severe flag, or null when the file is clean. */
export function topFlag(flags: MemoryFlag[]): MemoryFlag | null {
  const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  let top: MemoryFlag | null = null;
  for (const f of flags) {
    if (!top || (order[f.severity ?? 'info'] ?? 2) < (order[top.severity ?? 'info'] ?? 2)) top = f;
  }
  return top;
}

/** Humanize a flag type ("contains_credential" → "credential detected"). */
export function flagLabel(type: string): string {
  const labels: Record<string, string> = {
    contains_credential: 'credential detected',
    contains_email: 'email detected',
    contains_url: 'URL detected',
    contains_instruction: 'instruction detected',
    contradicts_existing: 'contradiction detected',
    hidden_character: 'hidden character detected',
    source_unknown: 'unknown source',
  };
  return labels[type] ?? type;
}

/** Mask any secret/email in an added line so the watcher never re-prints plaintext. */
export function maskAddedLine(line: string): string {
  const patterns = [
    /\bAKIA[0-9A-Z]{16}\b/,
    /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{8,}/,
    /\bgh[pous]_[A-Za-z0-9]{20,}\b/,
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  ];
  for (const p of patterns) {
    line = line.replace(p, (m) => {
      if (m.includes('@')) {
        const at = m.indexOf('@');
        return `${m.slice(0, Math.min(2, at))}****@${m.slice(at + 1)}`;
      }
      if (m.length <= 8) return `${m.slice(0, 2)}****`;
      return `${m.slice(0, 6)}****…${m.slice(-4)}`;
    });
  }
  return line;
}

function upsertWatchTarget(path: string, targetType: 'file' | 'directory', format: string, platform: string): void {
  const d = getDb();
  const existing = d.prepare(`SELECT id FROM watch_targets WHERE path = ?`).get(path);
  if (existing) return;
  d.prepare(
    `INSERT INTO watch_targets (id, path, target_type, file_format, platform, active) VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(randomUUID(), path, targetType, format, platform);
}

function updateWatchTarget(path: string, hash: string): void {
  getDb()
    .prepare(`UPDATE watch_targets SET last_hash = ?, last_checked = ? WHERE path = ?`)
    .run(hash, new Date().toISOString(), path);
}

/** Log a direct agent-memory write/delete (via the MCP server) to stderr, mirroring file-change output. */
function logDirectMemory(entry: MemoryEntry, verb: string, sign: '+' | '-' = '+'): void {
  const top = topFlag(entry.flags);
  const marker = sign === '+' ? chalk.green('+') : chalk.red('-');
  console.error(`  ${chalk.dim(timeStamp())} │ ${chalk.bold.white('mcp'.padEnd(10))} memory ${verb}`);
  console.error(`  ${' '.repeat(9)}│ ${marker}  "${chalk.dim(maskAddedLine(entry.content).slice(0, 44))}"`);
  if (top?.severity === 'critical') {
    console.error(`  ${' '.repeat(9)}│ ${chalk.red.bold(`▲ CRITICAL — ${flagLabel(top.type)}`)}`);
  } else if (top?.severity === 'warning') {
    console.error(`  ${' '.repeat(9)}│ ${chalk.yellow(`▲ WARNING — ${flagLabel(top.type)}`)}`);
  } else {
    console.error(`  ${' '.repeat(9)}│ ${chalk.dim('○ clean')}`);
  }
  console.error(`  ${' '.repeat(9)}│`);
}

function handleFileChange(path: string, platform: string): void {
  // Skip binary plugin state (SQLite DBs) and config files — only memory files
  // (markdown/json/txt/rules files) should be imported on change.
  if (detectFileFormat(path) === 'sqlite' || isConfigFile(path)) return;
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  const hash = hashContent(content, platform);
  const target = getDb().prepare(`SELECT last_hash FROM watch_targets WHERE path = ?`).get(path) as
    | { last_hash?: string }
    | undefined;
  if (target?.last_hash === hash) return;

  const oldContent = getDocumentByPath(path)?.raw_content ?? '';
  const result = importFileAsDocument(path, null, platform as SourcePlatform, 'file_watcher');
  updateWatchTarget(path, hash);

  const added = firstAddedLine(oldContent, content);
  const removed = firstRemovedLine(oldContent, content);
  const file = basename(path);
  const provider = shortProvider(platform);

  // Severity of the *edit*, not the whole file — files like AGENTS.md are full
  // of rules, so their aggregate flag always reads "instruction detected" even
  // for a benign edit.
  const changedFlags: MemoryFlag[] = [];
  for (const line of [added, removed]) {
    if (!line) continue;
    changedFlags.push(...analyzeEntry(line, [], undefined, platform).flags);
  }
  const top = topFlag(changedFlags);

  console.error(`  ${chalk.dim(timeStamp())} │ ${chalk.bold.white(provider.padEnd(10))} ${file} modified`);
  if (added) console.error(`  ${' '.repeat(9)}│ ${chalk.green('+')}  "${chalk.dim(maskAddedLine(added).slice(0, 44))}"`);
  if (removed) console.error(`  ${' '.repeat(9)}│ ${chalk.red('-')}  "${chalk.dim(maskAddedLine(removed).slice(0, 44))}"`);
  if (top?.severity === 'critical') {
    console.error(`  ${' '.repeat(9)}│ ${chalk.red.bold(`▲ CRITICAL — ${flagLabel(top.type)}`)}`);
  } else if (top?.severity === 'warning') {
    console.error(`  ${' '.repeat(9)}│ ${chalk.yellow(`▲ WARNING — ${flagLabel(top.type)}`)}`);
  } else {
    console.error(`  ${' '.repeat(9)}│ ${chalk.dim('○ clean')}`);
  }
  console.error(`  ${' '.repeat(9)}│`);
}

/** Start watching configured memory files for changes. Long-running. */
export async function startWatcher(config: M8mConfig): Promise<() => void> {
  const paths = new Set<string>();
  for (const p of [...DEFAULT_WATCH_PATHS, ...HOME_WATCH_PATHS, ...config.watch_paths]) {
    paths.add(resolve(expandHome(p)));
  }
  // Watch every scan-provider target too, so `m8m watch` and `m8m scan` agree
  // on which files count as memory (this covers single files like
  // ~/.codex/AGENTS.md, not just the directories above).
  for (const provider of config.providers) {
    for (const target of provider.targets) {
      paths.add(resolve(expandHome(target.path)));
    }
  }
  // Also watch every file already imported as a file memory, so edits to any
  // loaded markdown/json are picked up and re-imported as a new version.
  for (const doc of getAllDocuments()) {
    paths.add(resolve(expandHome(doc.file_path)));
  }

  const existingPaths = [...paths].filter((p) => existsSync(p));
  if (existingPaths.length === 0) {
    console.error(header('File Watcher'));
    console.error('');
    console.error('  No watch paths exist. Nothing to monitor.');
    return () => {};
  }

  for (const p of existingPaths) {
    const isDir = statSync(p).isDirectory();
    upsertWatchTarget(p, isDir ? 'directory' : 'file', detectFileFormat(p), inferPlatform(p));
    if (isDir) continue; // chokidar recurses into directories; no file snapshot needed
    // Startup sync: re-import so edits made while the watcher was offline are
    // picked up. upsertDocument dedups by content hash, so unchanged files are
    // a no-op (just refresh last_seen).
    try {
      if (detectFileFormat(p) !== 'sqlite' && !isConfigFile(p)) {
        importFileAsDocument(p, null, inferPlatform(p) as SourcePlatform, 'file_watcher');
      }
      const content = readFileSync(p, 'utf8');
      updateWatchTarget(p, hashContent(content, inferPlatform(p)));
    } catch {
      /* ignore unreadable initial snapshot */
    }
  }

  const watcher = chokidar.watch(existingPaths, { ignoreInitial: true, persistent: true });
  watcher.on('change', (p) => handleFileChange(p, inferPlatform(p)));
  watcher.on('add', (p) => handleFileChange(p, inferPlatform(p)));

  const providerCount = new Set(existingPaths.map((p) => shortProvider(inferPlatform(p)))).size;
  console.error(header('File Watcher'));
  console.error('');
  console.error(`  ${chalk.dim(`Watching ${existingPaths.length} path(s) across ${providerCount} providers. Ctrl-C to stop.`)}`);
  console.error('');
  console.error(watching('watching...'));

  // Poll the changelog so direct agent-memory writes (via the MCP server) also
  // show up here — the standalone watcher and the MCP server share one DB.
  let lastSeen = new Date().toISOString();
  const poll = setInterval(() => {
    const changes = getChangelog({ since: lastSeen });
    if (changes.length > 0) {
      lastSeen = new Date(new Date(changes[0].changed_at).getTime() + 1).toISOString();
    }
    for (const c of changes) {
      if (c.detected_by !== 'mcp_live') continue;
      const mem = c.memory_id ? getMemory(c.memory_id) : null;
      if (!mem) continue;
      if (c.change_type === 'created') logDirectMemory(mem, 'stored', '+');
      else if (c.change_type === 'modified') logDirectMemory(mem, 'updated', '+');
      else if (c.change_type === 'deleted') logDirectMemory(mem, 'deleted', '-');
    }
  }, 2000);

  return () => {
    clearInterval(poll);
    void watcher.close();
  };
}
