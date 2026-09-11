import { describe, expect, it } from 'vitest';
import { buildHeatmap, buildRadar, buildRiver, periodOf, startOfDay, startOfWeek } from '../../src/core/timeline.js';
import type { MemoryEntry, MemoryFlag } from '../../src/core/types.js';

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: crypto.randomUUID(),
    content: 'test content',
    content_hash: 'h',
    source_type: 'conversation',
    source_platform: 'claude_code',
    trust_level: 0.5,
    anomaly_score: 0,
    status: 'active',
    flags: [],
    category: 'unknown',
    entities: [],
    first_seen: '2026-09-12T00:00:00.000Z',
    last_seen: '2026-09-12T00:00:00.000Z',
    version: 1,
    tags: [],
    ...overrides,
  };
}

function flag(type: string): MemoryFlag {
  return { type, detail: '', detected_at: new Date().toISOString() };
}

describe('periodOf', () => {
  const now = new Date('2026-09-12T12:00:00Z');

  it('classifies today and yesterday', () => {
    const today = startOfDay(now);
    expect(periodOf(today, now)).toBe('today');
    expect(periodOf(new Date(today.getTime() - 1), now)).toBe('yesterday');
  });

  it('classifies this_week / last_week boundaries', () => {
    const thisWeek = startOfWeek(now);
    expect(periodOf(thisWeek, now)).toBe('this_week');
    expect(periodOf(new Date(thisWeek.getTime() - 1), now)).toBe('last_week');
  });

  it('classifies older as older', () => {
    expect(periodOf(new Date('2020-01-01T00:00:00Z'), now)).toBe('older');
  });
});

describe('buildRiver', () => {
  it('returns empty for no memories', () => {
    expect(buildRiver([])).toEqual({ buckets: [], platforms: [] });
  });

  it('counts memories per platform in one bucket', () => {
    const r = buildRiver([
      entry({ first_seen: '2026-09-12T00:00:00.000Z', source_platform: 'claude_code' }),
      entry({ first_seen: '2026-09-12T00:30:00.000Z', source_platform: 'cursor' }),
    ]);
    expect(r.buckets).toHaveLength(1);
    expect(r.buckets[0].counts).toEqual({ claude_code: 1, cursor: 1 });
    expect(r.platforms).toEqual(['claude_code', 'cursor']);
  });

  it('uses weekly buckets for spans >= 14 days', () => {
    const r = buildRiver([
      entry({ first_seen: '2026-09-01T00:00:00.000Z' }),
      entry({ first_seen: '2026-09-20T00:00:00.000Z' }),
    ]);
    expect(r.buckets.length).toBeGreaterThan(1);
  });
});

describe('buildHeatmap', () => {
  const now = new Date('2026-09-12T12:00:00Z');

  it('aggregates count, avg/min trust, and flagged count', () => {
    const mems = [
      entry({ source_type: 'document', trust_level: 0.8, first_seen: now.toISOString() }),
      entry({ source_type: 'document', trust_level: 0.4, first_seen: now.toISOString(), flags: [flag('contains_credential')] }),
      entry({ source_type: 'conversation', trust_level: 0.6, first_seen: now.toISOString() }),
    ];
    const hm = buildHeatmap(mems, now);
    expect(hm.source_types).toEqual(['conversation', 'document']);
    const docToday = hm.cells.find((c) => c.source_type === 'document' && c.period === 'today')!;
    expect(docToday.count).toBe(2);
    expect(docToday.avg_trust).toBeCloseTo(0.6);
    expect(docToday.min_trust).toBeCloseTo(0.4);
    expect(docToday.flagged_count).toBe(1);
  });
});

describe('buildRadar', () => {
  it('maps flag types to the 6 axes', () => {
    const mems = [
      entry({ flags: [flag('contains_instruction'), flag('contains_credential')] }),
      entry({ flags: [flag('contains_url'), flag('contains_email'), flag('hidden_character')] }),
      entry({ flags: [flag('source_unknown')] }),
    ];
    const r = buildRadar(mems);
    expect(r).toEqual({
      instruction_detected: 1,
      credential_detected: 1,
      source_unknown: 1,
      contradiction_detected: 0,
      url_detected: 2, // url + email both count
      hidden_chars: 1,
    });
  });

  it('ignores unknown flag types', () => {
    const r = buildRadar([entry({ flags: [flag('manual_flag'), flag('some_unknown')] })]);
    expect(r).toEqual({
      instruction_detected: 0,
      credential_detected: 0,
      source_unknown: 0,
      contradiction_detected: 0,
      url_detected: 0,
      hidden_chars: 0,
    });
  });
});
