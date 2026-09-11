// Auto-discovery of AI memory files across providers.

import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import type { SourcePlatform } from './types.js';

export interface DiscoveredMemoryFile {
  path: string;
  platform: SourcePlatform;
  provider: string;
  description: string;
  size: number;
}

interface MemoryFileTarget {
  path: string;
  platform: SourcePlatform;
  provider: string;
  description: string;
  isDir?: boolean;
  extensions?: string[];
}

const TARGETS: MemoryFileTarget[] = [
  // Claude Code
  { path: '~/.claude/CLAUDE.md', platform: 'claude_code', provider: 'Claude Code', description: 'User-level instructions' },
  { path: '~/.claude/memories', platform: 'claude_code', provider: 'Claude Code', description: 'User memories directory', isDir: true, extensions: ['.md', '.json', '.txt'] },
  { path: './CLAUDE.md', platform: 'claude_code', provider: 'Claude Code', description: 'Project-level instructions' },
  { path: './.claude/MEMORY.md', platform: 'claude_code', provider: 'Claude Code', description: 'Project-level memory' },
  { path: './.claude/settings.json', platform: 'claude_code', provider: 'Claude Code', description: 'Project settings' },
  // Claude Desktop
  { path: '~/.config/Claude/claude_desktop_config.json', platform: 'claude_desktop', provider: 'Claude Desktop', description: 'Desktop config' },
  { path: '~/Library/Application Support/Claude/claude_desktop_config.json', platform: 'claude_desktop', provider: 'Claude Desktop', description: 'Desktop config' },
  // Cursor
  { path: './.cursor/rules', platform: 'cursor', provider: 'Cursor', description: 'Project rules directory', isDir: true, extensions: ['.md', '.txt', '.mdc'] },
  { path: './.cursorrules', platform: 'cursor', provider: 'Cursor', description: 'Project rules' },
  { path: '~/.cursor/rules', platform: 'cursor', provider: 'Cursor', description: 'User rules directory', isDir: true, extensions: ['.md', '.txt', '.mdc'] },
  // Windsurf
  { path: './.windsurfrules', platform: 'local_file', provider: 'Windsurf', description: 'Project rules' },
  { path: '~/.codeium/windsurf/memories', platform: 'local_file', provider: 'Windsurf', description: 'Memories directory', isDir: true, extensions: ['.md', '.json', '.txt'] },
  // Cline
  { path: './.clinerules', platform: 'local_file', provider: 'Cline', description: 'Project rules' },
  { path: '~/.cline/memory', platform: 'local_file', provider: 'Cline', description: 'Memory directory', isDir: true, extensions: ['.md', '.json', '.txt'] },
  // Codex
  { path: '~/.codex/config.toml', platform: 'local_file', provider: 'Codex', description: 'Config' },
  { path: '~/.codex/instructions.md', platform: 'local_file', provider: 'Codex', description: 'Global instructions' },
  { path: '~/.codex/AGENTS.md', platform: 'local_file', provider: 'Codex', description: 'Global agent rules' },
  { path: './codex.md', platform: 'local_file', provider: 'Codex', description: 'Project instructions' },
  // Aider
  { path: './.aider.conf.yml', platform: 'local_file', provider: 'Aider', description: 'Project config' },
  { path: '~/.aider.conf.yml', platform: 'local_file', provider: 'Aider', description: 'User config' },
  // GitHub Copilot
  { path: './.github/copilot-instructions.md', platform: 'local_file', provider: 'GitHub Copilot', description: 'Project instructions' },
  // Continue.dev
  { path: './.continue/config.json', platform: 'local_file', provider: 'Continue.dev', description: 'Project config' },
  { path: '~/.continue/config.json', platform: 'local_file', provider: 'Continue.dev', description: 'User config' },
  // Generic agents
  { path: './MEMORY.md', platform: 'local_file', provider: 'Generic', description: 'Project memory' },
  { path: './AGENTS.md', platform: 'local_file', provider: 'Generic', description: 'Project instructions' },
  { path: './.agent/memory.json', platform: 'local_file', provider: 'Generic', description: 'Agent memory' },
];

function resolvePath(p: string): string {
  const expanded = p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
  return resolve(expanded);
}

export function scanForMemoryFiles(): DiscoveredMemoryFile[] {
  const seen = new Set<string>();
  const results: DiscoveredMemoryFile[] = [];
  const push = (file: DiscoveredMemoryFile) => {
    if (seen.has(file.path)) return;
    seen.add(file.path);
    results.push(file);
  };

  for (const target of TARGETS) {
    const resolved = resolvePath(target.path);
    if (target.isDir) {
      let entries: string[] = [];
      try {
        if (!statSync(resolved).isDirectory()) continue;
        entries = readdirSync(resolved).map((f) => join(resolved, f));
      } catch {
        continue;
      }
      for (const entry of entries) {
        const ext = extname(entry).toLowerCase();
        if (target.extensions && !target.extensions.includes(ext)) continue;
        let size = 0;
        try {
          const st = statSync(entry);
          if (!st.isFile()) continue;
          size = st.size;
        } catch {
          continue;
        }
        push({
          path: entry,
          platform: target.platform,
          provider: target.provider,
          description: `${target.description} — ${basename(entry)}`,
          size,
        });
      }
    } else {
      let size = 0;
      try {
        const st = statSync(resolved);
        if (!st.isFile()) continue;
        size = st.size;
      } catch {
        continue;
      }
      push({
        path: resolved,
        platform: target.platform,
        provider: target.provider,
        description: target.description,
        size,
      });
    }
  }

  results.sort((a, b) =>
    a.provider === b.provider ? a.path.localeCompare(b.path) : a.provider.localeCompare(b.provider),
  );
  return results;
}

export function groupByProvider(files: DiscoveredMemoryFile[]): Map<string, DiscoveredMemoryFile[]> {
  const map = new Map<string, DiscoveredMemoryFile[]>();
  for (const f of files) {
    const list = map.get(f.provider) ?? [];
    list.push(f);
    map.set(f.provider, list);
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function formatDiscovery(files: DiscoveredMemoryFile[]): string {
  const groups = groupByProvider(files);
  const lines: string[] = [
    '  m8m — Memory Scanner',
    '  ─────────────────────',
    `  Found ${files.length} file(s) across ${groups.size} provider(s)`,
  ];
  for (const [provider, providerFiles] of groups) {
    lines.push('');
    lines.push(`  ${provider}:`);
    for (const f of providerFiles) {
      lines.push(`    ${f.path}`);
      lines.push(`      ${f.description} (${formatBytes(f.size)})`);
    }
  }
  return lines.join('\n');
}

const IMPORTABLE_EXTENSIONS = new Set(['.md', '.json', '.txt']);

/** True if a discovered file should be auto-imported (memory file, not config). */
export function isImportablePath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (!IMPORTABLE_EXTENSIONS.has(ext)) return false;
  const base = basename(filePath).toLowerCase();
  if (/(^|[_.-])(config|settings)([_.-]|$)/.test(base)) return false;
  return true;
}
