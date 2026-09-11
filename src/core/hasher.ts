// SHA-256 hashing utilities.

import { createHash } from 'node:crypto';
import type { MemoryEntry } from './types.js';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Hash a memory's content for deduplication.
 *
 * The same content from the same source type produces the same hash, which is
 * what allows identical observations arriving through different channels to be
 * deduplicated. `timestamp` is part of the spec signature and defaults to empty
 * so that the digest is stable across observations.
 */
export function hashContent(content: string, sourceType: string, timestamp = ''): string {
  return sha256(`${content}|${sourceType}|${timestamp}`);
}

/** Hash a full snapshot JSON payload. */
export function hashSnapshot(snapshotData: string): string {
  return sha256(snapshotData);
}

/** Recompute a memory's hash from its fields and compare against the stored value. */
export function verifyEntryIntegrity(entry: MemoryEntry): boolean {
  const recomputed = hashContent(entry.content, entry.source_type);
  return recomputed === entry.content_hash;
}
