// File system watcher for local memory files.

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import chokidar from 'chokidar';
import chalk from 'chalk';
import { getAllDocuments, getDb, getDocumentByPath } from '../core/db.js';
import { hashContent } from '../core/hasher.js';
import { importFileAsDocument } from '../core/importer.js';
import { expandHome } from '../core/config.js';
import type { M8mConfig, MemoryFlag, SourcePlatform } from '../core/types.js';
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
function firstAddedLine(oldContent: string, newContent: string): string {
  if (!oldContent) return newContent.split('\n')[0] ?? '';
  const oldLines = new Set(oldContent.split('\n'));
  for (const line of newContent.split('\n')) {
    if (!oldLines.has(line)) return line;
  }
  return '';
}

/** Most-severe flag, or null when the file is clean. */
function topFlag(flags: MemoryFlag[]): MemoryFlag | null {
  const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  let top: MemoryFlag | null = null;
  for (const f of flags) {
    if (!top || (order[f.severity ?? 'info'] ?? 2) < (order[top.severity ?? 'info'] ?? 2)) top = f;
  }
  return top;
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

  const flags = getDocumentByPath(path)?.flags_summary ?? [];
  const top = topFlag(flags);
  const added = firstAddedLine(oldContent, content);
  const file = basename(path);
  const provider = shortProvider(platform);

  console.error(`  ${chalk.dim(timeStamp())} │ ${chalk.bold.white(provider.padEnd(10))} ${file} modified`);
  if (added) console.error(`  ${' '.repeat(9)}│ ${chalk.green('+')}  "${chalk.dim(added.slice(0, 44))}"`);
  if (top?.severity === 'critical') {
    console.error(`  ${' '.repeat(9)}│ ${chalk.red.bold('🔴 CRITICAL')}${chalk.dim(` — ${top.type}`)}`);
  } else if (top?.severity === 'warning') {
    console.error(`  ${' '.repeat(9)}│ ${chalk.yellow('⚠ WARNING')}${chalk.dim(` — ${top.type}`)}`);
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

  return () => {
    void watcher.close();
  };
}
