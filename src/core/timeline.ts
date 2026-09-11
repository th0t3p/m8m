// Pre-aggregated timeline data for the dashboard (river + heatmap + radar).

import type { MemoryEntry } from './types.js';

export type Period = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'older';

export interface RiverBucket {
  start: string;
  end: string;
  counts: Record<string, number>;
}

export interface HeatmapCell {
  source_type: string;
  period: Period;
  count: number;
  avg_trust: number;
  min_trust: number;
  flagged_count: number;
}

export interface RadarCounts {
  instruction_detected: number;
  credential_detected: number;
  source_unknown: number;
  contradiction_detected: number;
  url_detected: number;
  hidden_chars: number;
}

const DAY_MS = 86_400_000;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function periodOf(d: Date, now: Date): Period {
  const t = d.getTime();
  const todayStart = startOfDay(now).getTime();
  if (t >= todayStart) return 'today';
  if (t >= todayStart - DAY_MS) return 'yesterday';
  const thisWeekStart = startOfWeek(now).getTime();
  if (t >= thisWeekStart) return 'this_week';
  if (t >= thisWeekStart - 7 * DAY_MS) return 'last_week';
  if (t >= startOfMonth(now).getTime()) return 'this_month';
  if (t >= new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()) return 'last_month';
  return 'older';
}

/** Bucket memories by first_seen time (auto granularity) and platform. */
export function buildRiver(memories: MemoryEntry[]): { buckets: RiverBucket[]; platforms: string[] } {
  const times = memories.map((m) => new Date(m.first_seen).getTime()).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return { buckets: [], platforms: [] };

  const min = Math.min(...times);
  const max = Math.max(...times, Date.now());
  const span = max - min;
  let bucketMs: number;
  if (span < 2 * DAY_MS) bucketMs = 3_600_000; // hour
  else if (span < 14 * DAY_MS) bucketMs = DAY_MS; // day
  else bucketMs = 7 * DAY_MS; // week

  const map = new Map<number, RiverBucket>();
  for (const m of memories) {
    const t = new Date(m.first_seen).getTime();
    if (Number.isNaN(t)) continue;
    const bucketStart = Math.floor(t / bucketMs) * bucketMs;
    let b = map.get(bucketStart);
    if (!b) {
      b = { start: new Date(bucketStart).toISOString(), end: new Date(bucketStart + bucketMs).toISOString(), counts: {} };
      map.set(bucketStart, b);
    }
    b.counts[m.source_platform] = (b.counts[m.source_platform] ?? 0) + 1;
  }
  const buckets = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
  const platforms = [...new Set(memories.map((m) => m.source_platform))].sort();
  return { buckets, platforms };
}

export function buildHeatmap(memories: MemoryEntry[], now: Date): { cells: HeatmapCell[]; source_types: string[] } {
  const groups = new Map<string, HeatmapCell & { trustSum: number }>();
  for (const m of memories) {
    const period = periodOf(new Date(m.first_seen), now);
    const key = `${m.source_type}|${period}`;
    let g = groups.get(key);
    if (!g) {
      g = { source_type: m.source_type, period, count: 0, avg_trust: 0, min_trust: 1, flagged_count: 0, trustSum: 0 };
      groups.set(key, g);
    }
    g.count += 1;
    g.trustSum += m.trust_level;
    g.min_trust = Math.min(g.min_trust, m.trust_level);
    if (m.flags.length > 0) g.flagged_count += 1;
  }
  const cells: HeatmapCell[] = [...groups.values()].map((g) => ({
    source_type: g.source_type,
    period: g.period,
    count: g.count,
    avg_trust: g.trustSum / g.count,
    min_trust: g.min_trust,
    flagged_count: g.flagged_count,
  }));
  const source_types = [...new Set(memories.map((m) => m.source_type))].sort();
  return { cells, source_types };
}

export function buildRadar(memories: MemoryEntry[]): RadarCounts {
  const counts: RadarCounts = {
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
