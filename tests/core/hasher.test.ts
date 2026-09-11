import { describe, expect, it } from 'vitest';
import { hashContent, hashSnapshot, verifyEntryIntegrity } from '../../src/core/hasher.js';
import type { MemoryEntry } from '../../src/core/types.js';

describe('hasher', () => {
  it('produces deterministic SHA-256 hex', () => {
    expect(hashContent('hello', 'conversation')).toBe(hashContent('hello', 'conversation'));
    expect(hashContent('hello', 'conversation')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('differs by content and source type', () => {
    expect(hashContent('a', 'conversation')).not.toBe(hashContent('b', 'conversation'));
    expect(hashContent('a', 'conversation')).not.toBe(hashContent('a', 'document'));
  });
  it('hashes snapshots', () => {
    expect(hashSnapshot('{}')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('verifies entry integrity', () => {
    const entry = { content: 'x', source_type: 'conversation', content_hash: hashContent('x', 'conversation') } as MemoryEntry;
    expect(verifyEntryIntegrity(entry)).toBe(true);
  });
});
