import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllMemories,
  createSecurityEvent,
  createSnapshot,
  deleteMemory,
  getAllMemories,
  getChangelog,
  getLatestSnapshot,
  getMemory,
  getSecurityEvents,
  getStats,
  initDatabase,
  resolveSecurityEvent,
  updateMemoryStatus,
  upsertMemory,
} from '../../src/core/db.js';

beforeEach(() => {
  initDatabase(':memory:');
});

describe('db — upsert and dedup', () => {
  it('creates a new entry with a changelog record', () => {
    const e = upsertMemory({ content: 'User likes tea', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    expect(e.id).toBeTruthy();
    expect(getChangelog()).toHaveLength(1);
    expect(getChangelog()[0].change_type).toBe('created');
  });

  it('deduplicates identical content by content_hash', () => {
    const a = upsertMemory({ content: 'User likes tea', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    const b = upsertMemory({ content: 'User likes tea', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    expect(a.id).toBe(b.id);
    expect(getAllMemories()).toHaveLength(1);
  });

  it('modifies same-source entries with a changelog and version bump', () => {
    const a = upsertMemory({ content: 'User works at A', source_type: 'conversation', source_platform: 'claude_code', source_detail: 'f#1' }, 'cli');
    const b = upsertMemory({ content: 'User works at B', source_type: 'conversation', source_platform: 'claude_code', source_detail: 'f#1' }, 'cli');
    expect(b.id).toBe(a.id);
    expect(b.version).toBe(2);
    expect(getChangelog().some((c) => c.change_type === 'modified')).toBe(true);
  });

  it('attaches analyzer flags and creates security events', () => {
    upsertMemory({ content: 'API key is sk_live_abc123', source_type: 'document', source_platform: 'local_file' }, 'cli');
    const e = getAllMemories()[0];
    expect(e.flags.map((f) => f.type)).toContain('contains_credential');
    expect(getSecurityEvents().length).toBeGreaterThan(0);
  });
});

describe('db — delete and status', () => {
  it('soft-deletes with a changelog record', () => {
    const e = upsertMemory({ content: 'x', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    deleteMemory(e.id, 'cli');
    expect(getMemory(e.id)?.status).toBe('deleted');
    expect(getChangelog().some((c) => c.change_type === 'deleted')).toBe(true);
  });

  it('changes status with a changelog record', () => {
    const e = upsertMemory({ content: 'x', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    updateMemoryStatus(e.id, 'quarantined', 'cli');
    expect(getMemory(e.id)?.status).toBe('quarantined');
    expect(getChangelog().some((c) => c.change_type === 'status_changed')).toBe(true);
  });

  it('clears all memories as soft-deletes', () => {
    upsertMemory({ content: 'a', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    upsertMemory({ content: 'b', source_type: 'document', source_platform: 'local_file' }, 'cli');
    const cleared = clearAllMemories('cli');
    expect(cleared).toBe(2);
    expect(getAllMemories().filter((m) => m.status !== 'deleted')).toHaveLength(0);
    expect(getChangelog().filter((c) => c.change_type === 'deleted')).toHaveLength(2);
  });
});

describe('db — snapshots', () => {
  it('creates and retrieves the latest snapshot', () => {
    const entries = getAllMemories();
    createSnapshot('claude_code', entries);
    createSnapshot('claude_code', entries);
    const latest = getLatestSnapshot('claude_code');
    expect(latest).toBeTruthy();
    expect(latest?.entry_count).toBe(entries.length);
  });
});

describe('db — security events', () => {
  it('creates and resolves events', () => {
    const ev = createSecurityEvent({ event_type: 'test', severity: 'info', title: 'T' });
    expect(ev.id).toBeTruthy();
    expect(getSecurityEvents({ resolved: false }).map((e) => e.id)).toContain(ev.id);
    resolveSecurityEvent(ev.id, 'user_dismissed');
    expect(getSecurityEvents({ resolved: true }).map((e) => e.id)).toContain(ev.id);
  });
});

describe('db — stats', () => {
  it('returns counts and groupings', () => {
    upsertMemory({ content: 'User likes tea', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    upsertMemory({ content: 'API key is sk_live_abc', source_type: 'document', source_platform: 'local_file' }, 'cli');
    const s = getStats();
    expect(s.total).toBe(2);
    expect(s.active).toBe(2);
    expect(s.by_platform.claude_code).toBe(1);
    expect(s.by_platform.local_file).toBe(1);
  });
});
