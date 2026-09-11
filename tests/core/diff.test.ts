import { describe, expect, it } from 'vitest';
import { diffMemories } from '../../src/core/diff.js';
import type { MemoryEntry } from '../../src/core/types.js';

function entry(id: string, content: string): MemoryEntry {
  return {
    id,
    content,
    content_hash: `hash-${content}`,
    source_type: 'conversation',
    source_platform: 'claude_code',
    trust_level: 0.7,
    anomaly_score: 0,
    status: 'active',
    flags: [],
    category: 'unknown',
    entities: [],
    first_seen: '',
    last_seen: '',
    version: 1,
    tags: [],
  };
}

describe('diffMemories', () => {
  it('detects additions from empty to populated', () => {
    const d = diffMemories([], [entry('a', 'one'), entry('b', 'two')]);
    expect(d.added).toHaveLength(2);
    expect(d.deleted).toHaveLength(0);
    expect(d.modified).toHaveLength(0);
  });

  it('detects modifications by id with changed content', () => {
    const before = [entry('a', 'old')];
    const after = [{ ...entry('a', 'old'), content: 'new', content_hash: 'hash-new' }];
    const d = diffMemories(before, after);
    expect(d.modified).toHaveLength(1);
    expect(d.modified[0].before.content).toBe('old');
    expect(d.modified[0].after.content).toBe('new');
  });

  it('detects deletions', () => {
    const d = diffMemories([entry('a', 'gone')], []);
    expect(d.deleted).toHaveLength(1);
    expect(d.added).toHaveLength(0);
  });

  it('counts unchanged entries', () => {
    const before = [entry('a', 'same'), entry('b', 'same2')];
    const after = [entry('a', 'same'), entry('b', 'same2')];
    const d = diffMemories(before, after);
    expect(d.unchanged_count).toBe(2);
    expect(d.added).toHaveLength(0);
    expect(d.modified).toHaveLength(0);
    expect(d.deleted).toHaveLength(0);
  });

  it('matches id-less entries by content_hash for unchanged detection', () => {
    const before = [entry('a', 'stable')];
    const after = [entry('b', 'stable')]; // different id, same content_hash
    const d = diffMemories(before, after);
    expect(d.unchanged_count).toBe(1);
    expect(d.added).toHaveLength(0);
    expect(d.deleted).toHaveLength(0);
  });
});
