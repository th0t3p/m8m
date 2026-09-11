// SQLite database initialization and typed CRUD operations.

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { analyzeEntry } from './analyzer.js';
import { ensureParentDir } from './config.js';
import { hashContent, hashSnapshot } from './hasher.js';
import { SCHEMA_STATEMENTS } from './schema.js';
import type {
  ChangelogEntry,
  ChangelogFilters,
  DetectionSource,
  EventSeverity,
  MemoryCategory,
  MemoryEntry,
  MemoryFilters,
  MemoryFlag,
  MemoryStatus,
  Mem8Stats,
  SecurityEvent,
  SecurityEventFilters,
  Snapshot,
  SourcePlatform,
  SourceType,
} from './types.js';
import { DEFAULT_TRUST_LEVELS } from './types.js';

let db: Database.Database | null = null;

const FLAG_TO_EVENT: Record<
  string,
  { event_type: string; title: string; default_severity: EventSeverity }
> = {
  contains_instruction: { event_type: 'instruction_detected', title: 'Instruction detected', default_severity: 'warning' },
  contains_url: { event_type: 'url_detected', title: 'URL detected', default_severity: 'info' },
  contains_email: { event_type: 'email_detected', title: 'Email detected', default_severity: 'info' },
  contains_credential: { event_type: 'credential_detected', title: 'Credential detected', default_severity: 'critical' },
  contradicts_existing: { event_type: 'contradiction_detected', title: 'Contradiction detected', default_severity: 'warning' },
  source_unknown: { event_type: 'source_unknown', title: 'Source unknown', default_severity: 'info' },
  hidden_character: { event_type: 'suspicious_pattern', title: 'Suspicious pattern detected', default_severity: 'warning' },
};

function nowIso(): string {
  return new Date().toISOString();
}

function orNull(v: string | undefined | null): string | null {
  if (v === undefined || v === null || v === '') return null;
  return v;
}

function parseJsonArray<T>(s: string | null | undefined, fallback: T[]): T[] {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonObject(s: string | null | undefined): Record<string, unknown> | undefined {
  if (!s) return undefined;
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function requireDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToMemory(r: any): MemoryEntry {
  return {
    id: r.id,
    content: r.content,
    content_hash: r.content_hash,
    source_type: r.source_type as SourceType,
    source_platform: r.source_platform as SourcePlatform,
    source_conversation_id: r.source_conversation_id ?? undefined,
    source_url: r.source_url ?? undefined,
    source_detail: r.source_detail ?? undefined,
    trust_level: r.trust_level,
    anomaly_score: r.anomaly_score,
    status: r.status as MemoryStatus,
    flags: parseJsonArray<MemoryFlag>(r.flags, []),
    category: r.category as MemoryCategory,
    entities: parseJsonArray<string>(r.entities, []),
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    last_modified: r.last_modified ?? undefined,
    version: r.version,
    tags: parseJsonArray<string>(r.tags, []),
  };
}

function rowToChangelog(r: any): ChangelogEntry {
  return {
    id: r.id,
    memory_id: r.memory_id,
    change_type: r.change_type,
    old_content: r.old_content ?? undefined,
    new_content: r.new_content ?? undefined,
    old_status: r.old_status ?? undefined,
    new_status: r.new_status ?? undefined,
    changed_at: r.changed_at,
    source_type: r.source_type ?? undefined,
    source_detail: r.source_detail ?? undefined,
    detected_by: r.detected_by as DetectionSource,
  };
}

function rowToSecurityEvent(r: any): SecurityEvent {
  return {
    id: r.id,
    memory_id: r.memory_id ?? undefined,
    event_type: r.event_type,
    severity: r.severity as EventSeverity,
    title: r.title,
    details: parseJsonObject(r.details),
    detected_at: r.detected_at,
    resolved_at: r.resolved_at ?? undefined,
    resolution: r.resolution ?? undefined,
  };
}

function rowToSnapshot(r: any): Snapshot {
  return {
    id: r.id,
    platform: r.platform,
    snapshot_data: parseJsonArray<MemoryEntry>(r.snapshot_data, []),
    entry_count: r.entry_count,
    taken_at: r.taken_at,
    hash: r.hash,
  };
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function initDatabase(dbPath: string): Database.Database {
  ensureParentDir(dbPath);
  const instance = new Database(dbPath);
  instance.pragma('journal_mode = WAL');
  instance.exec(SCHEMA_STATEMENTS.join(';\n'));
  db = instance;
  return instance;
}

export function getDb(): Database.Database {
  return requireDb();
}

// ---------------------------------------------------------------------------
// Changelog + security event helpers
// ---------------------------------------------------------------------------

function addChangelog(
  entry: {
    memory_id: string;
    change_type: ChangelogEntry['change_type'];
    old_content?: string | null;
    new_content?: string | null;
    old_status?: string | null;
    new_status?: string | null;
    source_type?: string | null;
    source_detail?: string | null;
    detected_by: DetectionSource;
  },
): void {
  const d = requireDb();
  d.prepare(
    `INSERT INTO memory_changelog
      (id, memory_id, change_type, old_content, new_content, old_status, new_status, changed_at, source_type, source_detail, detected_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    entry.memory_id,
    entry.change_type,
    entry.old_content ?? null,
    entry.new_content ?? null,
    entry.old_status ?? null,
    entry.new_status ?? null,
    nowIso(),
    entry.source_type ?? null,
    entry.source_detail ?? null,
    entry.detected_by,
  );
}

function createSecurityEventsForFlags(entry: MemoryEntry, flags: MemoryFlag[]): void {
  const d = requireDb();
  for (const f of flags) {
    const map = FLAG_TO_EVENT[f.type];
    if (!map) continue;
    const severity = f.severity ?? map.default_severity;
    const existing = d
      .prepare(
        `SELECT id FROM security_events WHERE memory_id = ? AND event_type = ? AND resolved_at IS NULL LIMIT 1`,
      )
      .get(entry.id, map.event_type);
    if (existing) continue;
    createSecurityEvent({
      memory_id: entry.id,
      event_type: map.event_type,
      severity,
      title: map.title,
      details: { flag_type: f.type, detail: f.detail },
    });
  }
}

// ---------------------------------------------------------------------------
// Memory entries
// ---------------------------------------------------------------------------

export function getMemory(id: string): MemoryEntry | null {
  const row = requireDb().prepare(`SELECT * FROM memory_entries WHERE id = ?`).get(id);
  return row ? rowToMemory(row as any) : null;
}

export function getAllMemories(filters: MemoryFilters = {}): MemoryEntry[] {
  const d = requireDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.source_platform) {
    clauses.push('source_platform = ?');
    params.push(filters.source_platform);
  }
  if (typeof filters.min_trust === 'number') {
    clauses.push('trust_level >= ?');
    params.push(filters.min_trust);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = d
    .prepare(`SELECT * FROM memory_entries${where} ORDER BY last_seen DESC`)
    .all(...params);
  return (rows as any[]).map(rowToMemory);
}

/** Keyword search over active memories, ranked by trust then recency. */
export function searchMemories(query: string, limit = 10): MemoryEntry[] {
  const d = requireDb();
  const rows = d
    .prepare(
      `SELECT * FROM memory_entries
       WHERE status = 'active' AND content LIKE ?
       ORDER BY trust_level DESC, last_seen DESC
       LIMIT ?`,
    )
    .all(`%${query}%`, limit);
  return (rows as any[]).map(rowToMemory);
}

function allActiveEntries(excludeId?: string): MemoryEntry[] {
  const d = requireDb();
  const rows = excludeId
    ? d
        .prepare(`SELECT * FROM memory_entries WHERE status != 'deleted' AND id != ?`)
        .all(excludeId)
    : d.prepare(`SELECT * FROM memory_entries WHERE status != 'deleted'`).all();
  return (rows as any[]).map(rowToMemory);
}

function findByContentHash(hash: string): MemoryEntry | null {
  const row = requireDb()
    .prepare(`SELECT * FROM memory_entries WHERE content_hash = ? LIMIT 1`)
    .get(hash);
  return row ? rowToMemory(row as any) : null;
}

function findBySource(entry: Partial<MemoryEntry>): MemoryEntry | null {
  const d = requireDb();
  const st = entry.source_type ?? 'unknown';
  const plat = entry.source_platform ?? 'unknown';
  let row: unknown;
  if (entry.source_url) {
    row = d
      .prepare(
        `SELECT * FROM memory_entries WHERE source_type = ? AND source_platform = ? AND source_url = ? LIMIT 1`,
      )
      .get(st, plat, entry.source_url);
  } else if (entry.source_conversation_id) {
    row = d
      .prepare(
        `SELECT * FROM memory_entries WHERE source_type = ? AND source_platform = ? AND source_conversation_id = ? LIMIT 1`,
      )
      .get(st, plat, entry.source_conversation_id);
  } else if (entry.source_detail) {
    row = d
      .prepare(
        `SELECT * FROM memory_entries WHERE source_type = ? AND source_platform = ? AND source_detail = ? LIMIT 1`,
      )
      .get(st, plat, entry.source_detail);
  } else {
    return null;
  }
  return row ? rowToMemory(row as any) : null;
}

export function upsertMemory(
  entry: Partial<MemoryEntry>,
  detectedBy: DetectionSource,
): MemoryEntry {
  const d = requireDb();
  const content = entry.content ?? '';
  const sourceType = (entry.source_type ?? 'unknown') as SourceType;
  const sourcePlatform = (entry.source_platform ?? 'unknown') as SourcePlatform;
  const contentHash = hashContent(content, sourceType);
  const ts = nowIso();

  let existing: MemoryEntry | null = entry.id ? getMemory(entry.id) : null;
  if (!existing) existing = findByContentHash(contentHash);
  if (!existing) existing = findBySource(entry);

  if (existing) {
    if (existing.content_hash === contentHash) {
      // Identical content observed again — refresh last_seen only.
      d.prepare(`UPDATE memory_entries SET last_seen = ? WHERE id = ?`).run(ts, existing.id);
      return getMemory(existing.id)!;
    }

    // Same source, different content → modification.
    const analysis = analyzeEntry(
      content,
      allActiveEntries(existing.id),
      sourceType,
      sourcePlatform,
    );
    d.prepare(
      `UPDATE memory_entries SET
        content = ?, content_hash = ?, source_type = ?, source_platform = ?,
        source_conversation_id = ?, source_url = ?, source_detail = ?,
        trust_level = COALESCE(?, trust_level),
        anomaly_score = ?, flags = ?, category = ?, entities = ?,
        last_seen = ?, last_modified = ?, version = version + 1
       WHERE id = ?`,
    ).run(
      content,
      contentHash,
      sourceType,
      sourcePlatform,
      orNull(entry.source_conversation_id),
      orNull(entry.source_url),
      orNull(entry.source_detail),
      entry.trust_level ?? null,
      analysis.anomaly_score,
      JSON.stringify(analysis.flags),
      analysis.category,
      JSON.stringify(analysis.entities),
      ts,
      ts,
      existing.id,
    );
    addChangelog({
      memory_id: existing.id,
      change_type: 'modified',
      old_content: existing.content,
      new_content: content,
      source_type: sourceType,
      source_detail: entry.source_detail ?? null,
      detected_by: detectedBy,
    });
    const updated = getMemory(existing.id)!;
    createSecurityEventsForFlags(updated, analysis.flags);
    return updated;
  }

  // New entry.
  const id = entry.id ?? randomUUID();
  const analysis = analyzeEntry(content, allActiveEntries(), sourceType, sourcePlatform);
  const trustLevel =
    entry.trust_level ?? DEFAULT_TRUST_LEVELS[sourceType] ?? 0.5;
  d.prepare(
    `INSERT INTO memory_entries
      (id, content, content_hash, source_type, source_platform, source_conversation_id,
       source_url, source_detail, trust_level, anomaly_score, status, flags, category,
       entities, first_seen, last_seen, last_modified, version, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)`,
  ).run(
    id,
    content,
    contentHash,
    sourceType,
    sourcePlatform,
    orNull(entry.source_conversation_id),
    orNull(entry.source_url),
    orNull(entry.source_detail),
    trustLevel,
    analysis.anomaly_score,
    (entry.status ?? 'active') as MemoryStatus,
    JSON.stringify(analysis.flags),
    analysis.category,
    JSON.stringify(analysis.entities),
    ts,
    ts,
    JSON.stringify(entry.tags ?? []),
  );
  addChangelog({
    memory_id: id,
    change_type: 'created',
    new_content: content,
    source_type: sourceType,
    source_detail: entry.source_detail ?? null,
    detected_by: detectedBy,
  });
  const created = getMemory(id)!;
  createSecurityEventsForFlags(created, analysis.flags);
  return created;
}

export function deleteMemory(id: string, detectedBy: DetectionSource): void {
  const d = requireDb();
  const existing = getMemory(id);
  if (!existing) return;
  const ts = nowIso();
  d.prepare(`UPDATE memory_entries SET status = 'deleted', last_modified = ? WHERE id = ?`).run(ts, id);
  addChangelog({
    memory_id: id,
    change_type: 'deleted',
    old_status: existing.status,
    new_status: 'deleted',
    old_content: existing.content,
    source_type: existing.source_type,
    source_detail: existing.source_detail ?? null,
    detected_by: detectedBy,
  });
}

export function updateMemoryStatus(
  id: string,
  status: MemoryStatus,
  detectedBy: DetectionSource,
): void {
  const d = requireDb();
  const existing = getMemory(id);
  if (!existing) return;
  if (existing.status === status) return;
  const ts = nowIso();
  d.prepare(`UPDATE memory_entries SET status = ?, last_modified = ? WHERE id = ?`).run(status, ts, id);
  addChangelog({
    memory_id: id,
    change_type: 'status_changed',
    old_status: existing.status,
    new_status: status,
    source_type: existing.source_type,
    source_detail: existing.source_detail ?? null,
    detected_by: detectedBy,
  });
}

/** Manually flag a memory as suspicious and record a security event. */
export function flagMemory(id: string, reason: string, detectedBy: DetectionSource): MemoryEntry {
  const d = requireDb();
  const existing = getMemory(id);
  if (!existing) throw new Error(`Memory not found: ${id}`);
  const newFlag: MemoryFlag = {
    type: 'manual_flag',
    detail: reason,
    detected_at: nowIso(),
    severity: 'warning',
  };
  const flags = [...existing.flags, newFlag];
  const ts = nowIso();
  d.prepare(`UPDATE memory_entries SET flags = ?, last_modified = ? WHERE id = ?`).run(
    JSON.stringify(flags),
    ts,
    id,
  );
  createSecurityEvent({
    memory_id: id,
    event_type: 'suspicious_pattern',
    severity: 'warning',
    title: 'Manually flagged',
    details: { reason },
  });
  return getMemory(id)!;
}

/** Remove all flags from a memory (dismiss). */
export function unflagMemory(id: string, detectedBy: DetectionSource): void {
  const d = requireDb();
  d.prepare(`UPDATE memory_entries SET flags = '[]', last_modified = ? WHERE id = ?`).run(
    nowIso(),
    id,
  );
}

// ---------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------

export function getChangelog(filters: ChangelogFilters = {}): ChangelogEntry[] {
  const d = requireDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.memory_id) {
    clauses.push('memory_id = ?');
    params.push(filters.memory_id);
  }
  if (filters.since) {
    clauses.push('changed_at >= ?');
    params.push(filters.since);
  }
  if (filters.change_type) {
    clauses.push('change_type = ?');
    params.push(filters.change_type);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = d
    .prepare(`SELECT * FROM memory_changelog${where} ORDER BY changed_at DESC`)
    .all(...params);
  return (rows as any[]).map(rowToChangelog);
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export function createSnapshot(platform: string, entries: MemoryEntry[]): void {
  const d = requireDb();
  const data = JSON.stringify(entries);
  d.prepare(
    `INSERT INTO memory_snapshots (id, platform, snapshot_data, entry_count, taken_at, hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), platform, data, entries.length, nowIso(), hashSnapshot(data));
}

export function getLatestSnapshot(platform: string): Snapshot | null {
  const row = requireDb()
    .prepare(`SELECT * FROM memory_snapshots WHERE platform = ? ORDER BY taken_at DESC LIMIT 1`)
    .get(platform);
  return row ? rowToSnapshot(row as any) : null;
}

export function getSnapshot(id: string): Snapshot | null {
  const row = requireDb().prepare(`SELECT * FROM memory_snapshots WHERE id = ?`).get(id);
  return row ? rowToSnapshot(row as any) : null;
}

export function getAllSnapshots(platform?: string): Snapshot[] {
  const d = requireDb();
  const rows = platform
    ? d.prepare(`SELECT * FROM memory_snapshots WHERE platform = ? ORDER BY taken_at DESC`).all(platform)
    : d.prepare(`SELECT * FROM memory_snapshots ORDER BY taken_at DESC`).all();
  return (rows as any[]).map(rowToSnapshot);
}

// ---------------------------------------------------------------------------
// Security events
// ---------------------------------------------------------------------------

export function getSecurityEvents(filters: SecurityEventFilters = {}): SecurityEvent[] {
  const d = requireDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.severity) {
    clauses.push('severity = ?');
    params.push(filters.severity);
  }
  if (filters.resolved !== undefined) {
    clauses.push(filters.resolved ? 'resolved_at IS NOT NULL' : 'resolved_at IS NULL');
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = d
    .prepare(
      `SELECT * FROM security_events${where} ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
        detected_at DESC`,
    )
    .all(...params);
  return (rows as any[]).map(rowToSecurityEvent);
}

export function createSecurityEvent(
  event: Omit<SecurityEvent, 'id' | 'detected_at'> & { detected_at?: string },
): SecurityEvent {
  const d = requireDb();
  const id = randomUUID();
  const detectedAt = event.detected_at ?? nowIso();
  d.prepare(
    `INSERT INTO security_events
      (id, memory_id, event_type, severity, title, details, detected_at, resolved_at, resolution)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    orNull(event.memory_id),
    event.event_type,
    event.severity,
    event.title,
    event.details ? JSON.stringify(event.details) : null,
    detectedAt,
    orNull(event.resolved_at),
    orNull(event.resolution),
  );
  const row = d.prepare(`SELECT * FROM security_events WHERE id = ?`).get(id);
  return rowToSecurityEvent(row as any);
}

export function resolveSecurityEvent(id: string, resolution: string): void {
  requireDb()
    .prepare(`UPDATE security_events SET resolved_at = ?, resolution = ? WHERE id = ?`)
    .run(nowIso(), resolution, id);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function getStats(): Mem8Stats {
  const d = requireDb();
  const count = (sql: string, ...params: unknown[]): number => {
    const row = d.prepare(sql).get(...params) as any;
    return Number(row?.c ?? 0);
  };
  const group = (sql: string): Record<string, number> => {
    const rows = d.prepare(sql).all() as any[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.k] = Number(r.c);
    return out;
  };

  return {
    total: count(`SELECT COUNT(*) AS c FROM memory_entries`),
    active: count(`SELECT COUNT(*) AS c FROM memory_entries WHERE status = 'active'`),
    quarantined: count(`SELECT COUNT(*) AS c FROM memory_entries WHERE status = 'quarantined'`),
    flagged: count(`SELECT COUNT(*) AS c FROM memory_entries WHERE json_array_length(flags) > 0`),
    by_platform: group(`SELECT source_platform AS k, COUNT(*) AS c FROM memory_entries GROUP BY source_platform`),
    by_source_type: group(`SELECT source_type AS k, COUNT(*) AS c FROM memory_entries GROUP BY source_type`),
    by_category: group(`SELECT category AS k, COUNT(*) AS c FROM memory_entries GROUP BY category`),
  };
}
