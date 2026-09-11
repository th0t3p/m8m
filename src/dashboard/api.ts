// REST API routes for the local dashboard.

import { Router } from 'express';
import {
  createSnapshot,
  flagMemory,
  getAllMemories,
  getAllSnapshots,
  getChangelog,
  getMemory,
  getSecurityEvents,
  getSnapshot,
  getStats,
  resolveSecurityEvent,
  unflagMemory,
  updateMemoryStatus,
} from '../core/db.js';
import { diffMemories, diffSnapshots } from '../core/diff.js';
import { loadConfig } from '../core/config.js';
import type { MemoryEntry, MemoryStatus, SourcePlatform } from '../core/types.js';

// ---------------------------------------------------------------------------
// Timeline-data aggregation (river + heatmap + radar)
// ---------------------------------------------------------------------------

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

const DAY_MS = 86_400_000;

function buildRiver(memories: MemoryEntry[]) {
  const times = memories
    .map((m) => new Date(m.first_seen).getTime())
    .filter((t) => !Number.isNaN(t));
  if (times.length === 0) return { buckets: [], platforms: [] };

  const min = Math.min(...times);
  const max = Math.max(...times, Date.now());
  const span = max - min;
  let bucketMs: number;
  if (span < 2 * DAY_MS) bucketMs = 3_600_000; // hour
  else if (span < 14 * DAY_MS) bucketMs = DAY_MS; // day
  else bucketMs = 7 * DAY_MS; // week

  const map = new Map<number, { start: string; end: string; counts: Record<string, number> }>();
  for (const m of memories) {
    const t = new Date(m.first_seen).getTime();
    if (Number.isNaN(t)) continue;
    const bucketStart = Math.floor(t / bucketMs) * bucketMs;
    let b = map.get(bucketStart);
    if (!b) {
      b = {
        start: new Date(bucketStart).toISOString(),
        end: new Date(bucketStart + bucketMs).toISOString(),
        counts: {},
      };
      map.set(bucketStart, b);
    }
    b.counts[m.source_platform] = (b.counts[m.source_platform] ?? 0) + 1;
  }
  const buckets = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
  const platforms = [...new Set(memories.map((m) => m.source_platform))].sort();
  return { buckets, platforms };
}

type Period = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'older';

function periodOf(d: Date, now: Date): Period {
  const t = d.getTime();
  const todayStart = startOfDay(now).getTime();
  if (t >= todayStart) return 'today';
  const yesterdayStart = todayStart - DAY_MS;
  if (t >= yesterdayStart) return 'yesterday';
  const thisWeekStart = startOfWeek(now).getTime();
  if (t >= thisWeekStart) return 'this_week';
  const lastWeekStart = thisWeekStart - 7 * DAY_MS;
  if (t >= lastWeekStart) return 'last_week';
  const thisMonthStart = startOfMonth(now).getTime();
  if (t >= thisMonthStart) return 'this_month';
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  if (t >= lastMonthStart) return 'last_month';
  return 'older';
}

function buildHeatmap(memories: MemoryEntry[], now: Date) {
  const cells: {
    source_type: string;
    period: Period;
    count: number;
    avg_trust: number;
    min_trust: number;
    flagged_count: number;
  }[] = [];
  const groups = new Map<string, { source_type: string; period: Period; count: number; trustSum: number; minTrust: number; flagged: number }>();
  for (const m of memories) {
    const period = periodOf(new Date(m.first_seen), now);
    const key = `${m.source_type}|${period}`;
    let g = groups.get(key);
    if (!g) {
      g = { source_type: m.source_type, period, count: 0, trustSum: 0, minTrust: 1, flagged: 0 };
      groups.set(key, g);
    }
    g.count += 1;
    g.trustSum += m.trust_level;
    g.minTrust = Math.min(g.minTrust, m.trust_level);
    if (m.flags.length > 0) g.flagged += 1;
  }
  for (const g of groups.values()) {
    cells.push({
      source_type: g.source_type,
      period: g.period,
      count: g.count,
      avg_trust: g.trustSum / g.count,
      min_trust: g.minTrust,
      flagged_count: g.flagged,
    });
  }
  const source_types = [...new Set(memories.map((m) => m.source_type))].sort();
  return { cells, source_types };
}

function buildRadar(memories: MemoryEntry[]) {
  const counts = {
    instruction_detected: 0,
    credential_detected: 0,
    source_unknown: 0,
    contradiction_detected: 0,
    url_detected: 0,
    hidden_chars: 0,
  };
  for (const m of memories) {
    for (const f of m.flags) {
      switch (f.type) {
        case 'contains_instruction':
          counts.instruction_detected += 1;
          break;
        case 'contains_credential':
          counts.credential_detected += 1;
          break;
        case 'source_unknown':
          counts.source_unknown += 1;
          break;
        case 'contradicts_existing':
          counts.contradiction_detected += 1;
          break;
        case 'contains_url':
        case 'contains_email':
          counts.url_detected += 1;
          break;
        case 'hidden_character':
          counts.hidden_chars += 1;
          break;
      }
    }
  }
  return counts;
}

export function registerApi(): Router {
  const router = Router();

  router.get('/api/memories/stats', (_req, res) => {
    res.json(getStats());
  });

  router.get('/api/memories/timeline-data', (_req, res) => {
    const memories = getAllMemories();
    const snapshots = getAllSnapshots().map((s) => ({
      id: s.id,
      platform: s.platform,
      taken_at: s.taken_at,
    }));
    res.json({
      river: buildRiver(memories),
      heatmap: buildHeatmap(memories, new Date()),
      radar: buildRadar(memories),
      snapshots,
    });
  });

  router.get('/api/memories', (req, res) => {
    const { status, platform, min_trust } = req.query;
    const entries = getAllMemories({
      status: status as MemoryStatus | undefined,
      source_platform: platform as SourcePlatform | undefined,
      min_trust: min_trust !== undefined ? Number(min_trust) : undefined,
    });
    res.json(entries);
  });

  router.get('/api/memories/:id', (req, res) => {
    const entry = getMemory(req.params.id);
    if (!entry) return res.status(404).json({ error: 'not found' });
    const changelog = getChangelog({ memory_id: entry.id });
    res.json({ ...entry, changelog });
  });

  router.post('/api/memories/:id/flag', (req, res) => {
    const reason = req.body?.reason ?? 'Flagged from dashboard';
    const entry = flagMemory(req.params.id, reason, 'dashboard');
    res.json(entry);
  });

  router.post('/api/memories/:id/dismiss', (req, res) => {
    unflagMemory(req.params.id, 'dashboard');
    res.json({ ok: true });
  });

  router.post('/api/memories/:id/quarantine', (req, res) => {
    updateMemoryStatus(req.params.id, 'quarantined', 'dashboard');
    res.json({ ok: true });
  });

  router.post('/api/memories/:id/restore', (req, res) => {
    updateMemoryStatus(req.params.id, 'active', 'dashboard');
    res.json({ ok: true });
  });

  router.get('/api/changelog', (req, res) => {
    const { memory_id, since, change_type } = req.query;
    res.json(
      getChangelog({
        memory_id: memory_id as string | undefined,
        since: since as string | undefined,
        change_type: change_type as any,
      }),
    );
  });

  router.get('/api/diff', (req, res) => {
    const since = req.query.since as string | undefined;
    const snapshot = req.query.snapshot as string | undefined;
    const snapshot2 = req.query.snapshot2 as string | undefined;

    if (snapshot && snapshot2) {
      const d = diffSnapshots(snapshot, snapshot2);
      return res.json({ snapshot, snapshot2, ...d });
    }
    if (snapshot) {
      const snap = getSnapshot(snapshot);
      const d = diffMemories(snap ? snap.snapshot_data : [], getAllMemories());
      return res.json({ snapshot, snapshot_taken_at: snap?.taken_at ?? null, ...d });
    }
    if (since) {
      const changelog = getChangelog({ since });
      return res.json({ since, changelog });
    }
    const snapshots = getAllSnapshots();
    const latest = snapshots[0];
    const current = getAllMemories();
    const d = diffMemories(latest ? latest.snapshot_data : [], current);
    res.json({ snapshot: latest?.id ?? null, snapshot_taken_at: latest?.taken_at ?? null, ...d });
  });

  router.get('/api/events', (req, res) => {
    const { severity, resolved } = req.query;
    res.json(
      getSecurityEvents({
        severity: severity as any,
        resolved: resolved !== undefined ? resolved === 'true' : undefined,
      }),
    );
  });

  router.post('/api/events/:id/resolve', (req, res) => {
    const resolution = req.body?.resolution ?? 'user_dismissed';
    resolveSecurityEvent(req.params.id, resolution);
    res.json({ ok: true });
  });

  router.post('/api/snapshot', (req, res) => {
    const platform = req.body?.platform ?? 'manual';
    createSnapshot(platform, getAllMemories());
    res.json({ ok: true, platform });
  });

  router.get('/api/config', (_req, res) => {
    res.json(loadConfig());
  });

  return router;
}
