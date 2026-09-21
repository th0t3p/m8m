// Auto-discovery of AI memory files across providers.

import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import type { ProviderConfig, SourcePlatform } from './types.js';
import { DEFAULT_PROVIDERS } from './providers.js';

export interface DiscoveredMemoryFile {
  path: string;
  platform: SourcePlatform;
  provider: string;
  description: string;
  size: number;
}

function resolvePath(p: string): string {
  const expanded = p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
  return resolve(expanded);
}

export function scanForMemoryFiles(providers: ProviderConfig[] = DEFAULT_PROVIDERS): DiscoveredMemoryFile[] {
  const seen = new Set<string>();
  const results: DiscoveredMemoryFile[] = [];
  const push = (file: DiscoveredMemoryFile) => {
    if (seen.has(file.path)) return;
    seen.add(file.path);
    results.push(file);
  };

  const scanTarget = (providerName: string, platform: SourcePlatform, target: ProviderConfig['targets'][number]): void => {
    const resolved = resolvePath(target.path);
    if (target.isDir) {
      let entries: string[] = [];
      try {
        if (!statSync(resolved).isDirectory()) return;
        entries = readdirSync(resolved).map((f) => join(resolved, f));
      } catch {
        return;
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
          platform,
          provider: providerName,
          description: `${target.description} — ${basename(entry)}`,
          size,
        });
      }
    } else {
      let size = 0;
      try {
        const st = statSync(resolved);
        if (!st.isFile()) return;
        size = st.size;
      } catch {
        return;
      }
      push({
        path: resolved,
        platform,
        provider: providerName,
        description: target.description,
        size,
      });
    }
  };

  for (const provider of providers) {
    for (const target of provider.targets) {
      scanTarget(provider.name, provider.platform, target);
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

const IMPORTABLE_EXTENSIONS = new Set(['.md', '.json', '.txt']);

/** True if a discovered file should be auto-imported (memory file, not config). */
export function isImportablePath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (!IMPORTABLE_EXTENSIONS.has(ext)) return false;
  const base = basename(filePath).toLowerCase();
  if (/(^|[_.-])(config|settings)([_.-]|$)/.test(base)) return false;
  return true;
}
