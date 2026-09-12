// File system watcher for local memory files.

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import chokidar from 'chokidar';
import { getDb } from '../core/db.js';
import { hashContent } from '../core/hasher.js';
import { importFileAsDocument } from '../core/importer.js';
import { expandHome } from '../core/config.js';
import type { M8mConfig, SourcePlatform } from '../core/types.js';
import { detectFileFormat } from './parsers.js';

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
  if (p.includes('claude') || p.includes('claude.md')) return 'claude_code';
  if (p.includes('cursor')) return 'cursor';
  if (p.includes('.agent')) return 'local_file';
  return 'local_file';
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
  // Skip binary plugin state (e.g. SQLite DBs inside ~/.hindsight) and other
  // non-importable files so directory watches only import memory files.
  if (detectFileFormat(path) === 'sqlite') return;
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

  const format = detectFileFormat(path);
  const result = importFileAsDocument(path, null, platform as SourcePlatform, 'file_watcher');

  updateWatchTarget(path, hash);
  console.log(`[m8m watcher] ${path}: 1 document, ${result.total_nodes} nodes (platform=${platform}, format=${format})`);
}

/** Start watching configured memory files for changes. Long-running. */
export async function startWatcher(config: M8mConfig): Promise<void> {
  const paths = new Set<string>();
  for (const p of [...DEFAULT_WATCH_PATHS, ...HOME_WATCH_PATHS, ...config.watch_paths]) {
    paths.add(resolve(expandHome(p)));
  }

  const existingPaths = [...paths].filter((p) => existsSync(p));
  if (existingPaths.length === 0) {
    console.log('[m8m watcher] No watch paths exist. Nothing to monitor.');
    return;
  }

  for (const p of existingPaths) {
    const isDir = statSync(p).isDirectory();
    upsertWatchTarget(p, isDir ? 'directory' : 'file', detectFileFormat(p), inferPlatform(p));
    if (isDir) continue; // chokidar recurses into directories; no file snapshot needed
    // Initial snapshot of the file hash.
    try {
      const content = readFileSync(p, 'utf8');
      updateWatchTarget(p, hashContent(content, inferPlatform(p)));
    } catch {
      /* ignore unreadable initial snapshot */
    }
  }

  const watcher = chokidar.watch(existingPaths, { ignoreInitial: true, persistent: true });
  watcher.on('change', (p) => handleFileChange(p, inferPlatform(p)));
  watcher.on('add', (p) => handleFileChange(p, inferPlatform(p)));
  console.log(`[m8m watcher] Watching ${existingPaths.length} path(s). Ctrl-C to stop.`);
}
