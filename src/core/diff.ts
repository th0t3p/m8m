// Memory diff engine — compare sets of memory entries or snapshots.

import { getAllMemories, getLatestSnapshot, getSnapshot } from './db.js';
import type { MemoryDiff, MemoryEntry } from './types.js';

/**
 * Compare two sets of memory entries.
 * - Match by id for modification detection.
 * - Match by content_hash for unchanged detection (handles id-less entries).
 */
export function diffMemories(before: MemoryEntry[], after: MemoryEntry[]): MemoryDiff {
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const afterById = new Map(after.map((e) => [e.id, e]));
  const beforeByHash = new Map(before.map((e) => [e.content_hash, e]));

  const added: MemoryEntry[] = [];
  const modified: { before: MemoryEntry; after: MemoryEntry }[] = [];
  const deleted: MemoryEntry[] = [];
  let unchangedCount = 0;

  const matchedBefore = new Set<string>();
  const matchedAfter = new Set<string>();

  // Match by id first.
  for (const [id, a] of afterById) {
    const b = beforeById.get(id);
    if (b) {
      matchedBefore.add(id);
      matchedAfter.add(id);
      if (b.content_hash === a.content_hash) unchangedCount++;
      else modified.push({ before: b, after: a });
    }
  }

  // Remaining: match by content_hash (unchanged across id-less entries).
  for (const a of after) {
    if (matchedAfter.has(a.id)) continue;
    const b = beforeByHash.get(a.content_hash);
    if (b && !matchedBefore.has(b.id)) {
      matchedBefore.add(b.id);
      matchedAfter.add(a.id);
      unchangedCount++;
    }
  }

  for (const a of after) if (!matchedAfter.has(a.id)) added.push(a);
  for (const b of before) if (!matchedBefore.has(b.id)) deleted.push(b);

  return { added, modified, deleted, unchanged_count: unchangedCount };
}

/** Diff the current database state against the latest snapshot for a platform. */
export function diffSinceSnapshot(platform: string): MemoryDiff {
  const snap = getLatestSnapshot(platform);
  const current = getAllMemories();
  return diffMemories(snap ? snap.snapshot_data : [], current);
}

/** Diff two snapshots by id. */
export function diffSnapshots(snapshotId1: string, snapshotId2: string): MemoryDiff {
  const s1 = getSnapshot(snapshotId1);
  const s2 = getSnapshot(snapshotId2);
  return diffMemories(s1 ? s1.snapshot_data : [], s2 ? s2.snapshot_data : []);
}
