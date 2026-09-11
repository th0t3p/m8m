// File system watcher for local memory files.

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import chokidar from 'chokidar';
import { deleteMemory, getAllMemories, getDb, upsertMemory } from '../core/db.js';
import { hashContent } from '../core/hasher.js';
import { expandHome } from '../core/config.js';
import type { M8mConfig, SourcePlatform } from '../core/types.js';
import { detectFileFormat, parseJsonMemoryFile, parseMarkdownMemoryFile } from './parsers.js';

const DEFAULT_WATCH_PATHS = [
  './.claude/MEMORY.md',
  './CLAUDE.md',
  './MEMORY.md',
  './AGENTS.md',
  './.agent/memory.json',
  './.cursor/rules',
];

const HOME_WATCH_PATHS = ['~/.claude/memories', '~/.claude/CLAUDE.md'];

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
  const parsed = format === 'json' ? parseJsonMemoryFile(content) : parseMarkdownMemoryFile(content);
  const base = basename(path);

  const newKeys = new Set<string>();
  for (let i = 0; i < parsed.length; i++) {
    const key = `${base}#${parsed[i].line_number ?? i}`;
    newKeys.add(key);
  }

  // Soft-delete entries from this file that no longer appear.
  const existing = getAllMemories().filter(
    (e) =>
      e.source_platform === platform &&
      (e.source_detail?.startsWith(`${base}#`) ?? false) &&
      e.status !== 'deleted',
  );
  for (const e of existing) {
    if (e.source_detail && !newKeys.has(e.source_detail)) deleteMemory(e.id, 'file_watcher');
  }

  // Upsert current entries.
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    upsertMemory(
      {
        content: p.content,
        source_type: 'document',
        source_platform: platform as SourcePlatform,
        source_detail: `${base}#${p.line_number ?? i}`,
        trust_level: 0.5,
      },
      'file_watcher',
    );
  }

  updateWatchTarget(path, hash);
  console.log(`[m8m watcher] ${path}: ${parsed.length} entries (platform=${platform})`);
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
    upsertWatchTarget(p, 'file', detectFileFormat(p), inferPlatform(p));
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
