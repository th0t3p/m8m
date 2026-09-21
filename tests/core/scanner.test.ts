import { describe, expect, it } from 'vitest';
import {
  groupByProvider,
  isImportablePath,
  type DiscoveredMemoryFile,
} from '../../src/core/scanner.js';

function file(path: string, provider = 'Test'): DiscoveredMemoryFile {
  return { path, platform: 'local_file', provider, description: 'd', size: 1000 };
}

describe('isImportablePath', () => {
  it('accepts .md, .json, .txt', () => {
    expect(isImportablePath('/x/CLAUDE.md')).toBe(true);
    expect(isImportablePath('/x/memory.json')).toBe(true);
    expect(isImportablePath('/x/notes.txt')).toBe(true);
  });
  it('rejects config files', () => {
    expect(isImportablePath('/x/config.json')).toBe(false);
    expect(isImportablePath('/x/settings.json')).toBe(false);
    expect(isImportablePath('/x/config.toml')).toBe(false);
    expect(isImportablePath('/x/.aider.conf.yml')).toBe(false);
    expect(isImportablePath('/x/claude_desktop_config.json')).toBe(false);
  });
  it('rejects non-importable extensions and extensionless dotfiles', () => {
    expect(isImportablePath('/x/rules.mdc')).toBe(false);
    expect(isImportablePath('/x/.cursorrules')).toBe(false);
  });
});

describe('groupByProvider', () => {
  it('groups by provider and sorts by name', () => {
    const files = [file('/z', 'B'), file('/a', 'A'), file('/m', 'B')];
    const groups = groupByProvider(files);
    expect([...groups.keys()]).toEqual(['A', 'B']);
    expect(groups.get('B')?.length).toBe(2);
  });
});
