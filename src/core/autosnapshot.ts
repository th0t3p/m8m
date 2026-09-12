// Periodic auto-snapshot scheduler.
//
// Snapshots are a point-in-time dump of agent memories used for drift/rollback.
// A single freshness guard keeps multiple m8m processes (one per MCP client)
// from stamping out redundant snapshots.

import { createSnapshot, getAllMemories, getLatestSnapshot } from './db.js';

const AUTO_PLATFORM = 'auto';

/** Start the auto-snapshot timer. Returns a stop function. */
export function startAutoSnapshot(intervalMinutes: number): () => void {
  if (!intervalMinutes || intervalMinutes <= 0) return () => {};
  const intervalMs = intervalMinutes * 60_000;

  const tick = (): void => {
    try {
      const latest = getLatestSnapshot(AUTO_PLATFORM);
      if (latest && Date.now() - new Date(latest.taken_at).getTime() < intervalMs) {
        return; // a recent snapshot already exists
      }
      createSnapshot(AUTO_PLATFORM, getAllMemories());
    } catch (err) {
      console.error('[m8m auto-snapshot] failed:', err);
    }
  };

  tick(); // catch up on startup if stale
  const timer = setInterval(tick, 60_000); // check once a minute
  return () => clearInterval(timer);
}
