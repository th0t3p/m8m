// Configuration management. Reads/writes ~/.m8m/config.json (or $M8M_HOME).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type { M8mConfig, SourceType } from './types.js';
import { DEFAULT_TRUST_LEVELS } from './types.js';

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

/** Directory holding m8m config + database. Overridable via $M8M_HOME. */
export function m8mHomeDir(): string {
  const override = process.env.M8M_HOME;
  if (override && override.trim().length > 0) return expandHome(override);
  return join(homedir(), '.m8m');
}

export function configPath(): string {
  return join(m8mHomeDir(), 'config.json');
}

export function defaultConfig(): M8mConfig {
  return {
    db_path: join(m8mHomeDir(), 'm8m.db'),
    watch_paths: [
      '~/.claude/memories',
      './.claude/MEMORY.md',
      './.cursor/memory',
      './AGENTS.md',
      './MEMORY.md',
    ],
    dashboard_port: 8808,
    auto_snapshot_interval_minutes: 60,
    trust_levels: { ...DEFAULT_TRUST_LEVELS },
  };
}

function isSourceType(s: string): s is SourceType {
  return Object.prototype.hasOwnProperty.call(DEFAULT_TRUST_LEVELS, s);
}

/** Normalize a raw parsed object into a M8mConfig, merging with defaults. */
function mergeWithDefaults(raw: unknown): M8mConfig {
  const base = defaultConfig();
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, unknown>;

  if (typeof r.db_path === 'string') base.db_path = r.db_path;
  if (Array.isArray(r.watch_paths)) {
    base.watch_paths = r.watch_paths.filter((x): x is string => typeof x === 'string');
  }
  if (typeof r.dashboard_port === 'number') base.dashboard_port = r.dashboard_port;
  if (typeof r.auto_snapshot_interval_minutes === 'number') {
    base.auto_snapshot_interval_minutes = r.auto_snapshot_interval_minutes;
  }
  if (typeof r.trust_levels === 'object' && r.trust_levels !== null) {
    const tl = r.trust_levels as Record<string, unknown>;
    for (const [k, v] of Object.entries(tl)) {
      if (isSourceType(k) && typeof v === 'number') base.trust_levels[k] = v;
    }
  }
  return base;
}

/** Read config from disk, creating it with defaults if absent. */
export function loadConfig(): M8mConfig {
  initConfigDir();
  const path = configPath();
  let raw: unknown = {};
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      raw = {};
    }
  }
  const merged = mergeWithDefaults(raw);
  merged.db_path = expandHome(merged.db_path);
  merged.watch_paths = merged.watch_paths.map(expandHome);
  return merged;
}

/** Merge partial config into the stored config and persist it. */
export function saveConfig(config: Partial<M8mConfig>): void {
  initConfigDir();
  const current = loadConfig();
  const next: M8mConfig = {
    ...current,
    ...config,
    trust_levels: { ...current.trust_levels, ...(config.trust_levels ?? {}) },
  };
  writeFileSync(configPath(), JSON.stringify(next, null, 2) + '\n', 'utf8');
}

/** Create the m8m home directory and a default config file if missing. */
export function initConfigDir(): void {
  const dir = m8mHomeDir();
  mkdirSync(dir, { recursive: true });
  const path = configPath();
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(defaultConfig(), null, 2) + '\n', 'utf8');
  }
}

/** Resolve an absolute path, expanding ~ against home. */
export function resolvePath(p: string): string {
  return isAbsolute(p) ? p : join(process.cwd(), p);
}

/** Ensure the parent directory of a file path exists. */
export function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}
