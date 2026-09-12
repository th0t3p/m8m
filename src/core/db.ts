// SQLite database initialization and typed CRUD operations.

import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import Database from 'better-sqlite3';
import { analyzeEntry } from './analyzer.js';
import { ensureParentDir } from './config.js';
import { hashContent, hashSnapshot } from './hasher.js';
import { SCHEMA_STATEMENTS } from './schema.js';
import { detectFileFormat } from '../watcher/parsers.js';
import type {
  ChangelogEntry,
  ChangelogFilters,
  DetectionSource,
  DocumentChangelog,
  EventSeverity,
  MemoryCategory,
  MemoryDocument,
  MemoryEntry,
  MemoryFilters,
  MemoryFlag,
  MemoryNode,
  MemoryStatus,
  M8mStats,
  NodeType,
  ParsedDocument,
  ParsedNode,
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

/** Soft-delete every non-deleted memory. Returns the number cleared. */
export function clearAllMemories(detectedBy: DetectionSource): number {
  const memories = getAllMemories().filter((m) => m.status !== 'deleted');
  for (const m of memories) {
    deleteMemory(m.id, detectedBy);
  }
  return memories.length;
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

export function getStats(): M8mStats {
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

// ---------------------------------------------------------------------------
// Document layer (file-based structured imports)
// ---------------------------------------------------------------------------

function rowToDocument(r: any): MemoryDocument {
  return {
    id: r.id,
    file_path: r.file_path,
    file_name: r.file_name,
    file_hash: r.file_hash,
    file_format: r.file_format,
    title: r.title ?? null,
    raw_content: r.raw_content,
    source_platform: r.source_platform as SourcePlatform,
    trust_level: r.trust_level,
    anomaly_score: r.anomaly_score,
    status: r.status as MemoryStatus,
    flags_summary: parseJsonArray<MemoryFlag>(r.flags_summary, []),
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    last_modified: r.last_modified ?? undefined,
    version: r.version,
  };
}

function rowToNode(r: any): MemoryNode {
  return {
    id: r.id,
    document_id: r.document_id,
    parent_id: r.parent_id ?? null,
    node_type: r.node_type as NodeType,
    depth: r.depth,
    position: r.position,
    heading: r.heading ?? null,
    content: r.content,
    content_hash: r.content_hash,
    line_start: r.line_start ?? null,
    line_end: r.line_end ?? null,
    flags: parseJsonArray<MemoryFlag>(r.flags, []),
    anomaly_score: r.anomaly_score,
    category: r.category as MemoryCategory,
  };
}

function rowToDocChangelog(r: any): DocumentChangelog {
  return {
    id: r.id,
    document_id: r.document_id,
    change_type: r.change_type,
    old_hash: r.old_hash ?? undefined,
    new_hash: r.new_hash ?? undefined,
    nodes_added: r.nodes_added ?? 0,
    nodes_modified: r.nodes_modified ?? 0,
    nodes_deleted: r.nodes_deleted ?? 0,
    changed_at: r.changed_at,
    detected_by: r.detected_by as DetectionSource,
  };
}

function insertDocumentNodes(
  documentId: string,
  nodes: ParsedNode[],
  platform: SourcePlatform,
  trustLevel: number,
  parentId: string | null,
  depth: number,
  position: number,
  hashes: Set<string>,
  parentHeading?: string,
): { flagged: number } {
  const d = requireDb();
  let flagged = 0;

  for (const node of nodes) {
    const analysis = analyzeEntry(node.content, [], 'document', platform, {
      parent_heading: parentHeading,
      node_type: node.node_type,
    });
    const hash = hashContent(node.content, 'document');
    hashes.add(hash);
    if (analysis.flags.length > 0) flagged++;

    const id = randomUUID();
    d.prepare(
      `INSERT INTO memory_nodes
        (id, document_id, parent_id, node_type, depth, position, heading, content, content_hash, line_start, line_end, flags, anomaly_score, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      documentId,
      parentId,
      node.node_type,
      depth,
      position,
      node.heading ?? null,
      node.content,
      hash,
      node.line_start ?? null,
      node.line_end ?? null,
      JSON.stringify(analysis.flags),
      analysis.anomaly_score,
      analysis.category,
    );

    let childPos = 0;
    for (const child of node.children ?? []) {
      flagged += insertDocumentNodes(
        documentId,
        [child],
        platform,
        trustLevel,
        id,
        depth + 1,
        childPos++,
        hashes,
        node.heading ?? parentHeading,
      ).flagged;
    }
  }
  return { flagged };
}

function updateDocumentSummary(documentId: string): void {
  const d = requireDb();
  const rows = d.prepare(`SELECT flags, anomaly_score FROM memory_nodes WHERE document_id = ?`).all(documentId) as any[];
  let maxAnomaly = 0;
  const allFlags: MemoryFlag[] = [];
  for (const r of rows) {
    maxAnomaly = Math.max(maxAnomaly, r.anomaly_score);
    allFlags.push(...parseJsonArray<MemoryFlag>(r.flags, []));
  }
  const seen = new Set<string>();
  const unique = allFlags.filter((f) => {
    const k = `${f.type}|${f.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  d.prepare(`UPDATE memory_documents SET flags_summary = ?, anomaly_score = ? WHERE id = ?`).run(
    JSON.stringify(unique),
    maxAnomaly,
    documentId,
  );
}

export function upsertDocument(
  filePath: string,
  rawContent: string,
  parsedDoc: ParsedDocument,
  platform: SourcePlatform,
  trustLevel: number,
  detectedBy: DetectionSource,
): MemoryDocument {
  const d = requireDb();
  const fileHash = hashSnapshot(rawContent);
  const ts = nowIso();

  const existing = getDocumentByPath(filePath);

  if (existing) {
    if (existing.file_hash === fileHash) {
      d.prepare(`UPDATE memory_documents SET last_seen = ? WHERE id = ?`).run(ts, existing.id);
      return getDocument(existing.id)!;
    }

    // Modification: re-parse and diff nodes.
    const oldNodes = getNodesForDocument(existing.id);
    const oldHashes = new Set(oldNodes.map((n) => n.content_hash));

    d.prepare(
      `UPDATE memory_documents SET raw_content = ?, file_hash = ?, title = ?, last_modified = ?, last_seen = ?, version = version + 1 WHERE id = ?`,
    ).run(rawContent, fileHash, parsedDoc.title ?? null, ts, ts, existing.id);
    d.prepare(`DELETE FROM memory_nodes WHERE document_id = ?`).run(existing.id);

    const newHashes = new Set<string>();
    const { flagged } = insertDocumentNodes(existing.id, parsedDoc.nodes, platform, trustLevel, null, 0, 0, newHashes);
    updateDocumentSummary(existing.id);

    let added = 0, modified = 0, deleted = 0;
    for (const h of newHashes) if (!oldHashes.has(h)) added++;
    for (const h of newHashes) if (oldHashes.has(h)) modified++;
    for (const h of oldHashes) if (!newHashes.has(h)) deleted++;

    d.prepare(
      `INSERT INTO document_changelog (id, document_id, change_type, old_hash, new_hash, nodes_added, nodes_modified, nodes_deleted, changed_at, detected_by)
       VALUES (?, ?, 'modified', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), existing.id, existing.file_hash, fileHash, added, modified, deleted, ts, detectedBy);

    void flagged;
    return getDocument(existing.id)!;
  }

  // New document.
  const id = randomUUID();
  const fileName = basename(filePath);
  const fileFormat = detectFileFormat(filePath);
  d.prepare(
    `INSERT INTO memory_documents (id, file_path, file_name, file_hash, file_format, title, raw_content, source_platform, trust_level, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, filePath, fileName, fileHash, fileFormat, parsedDoc.title ?? null, rawContent, platform, trustLevel, ts, ts);

  const newHashes = new Set<string>();
  insertDocumentNodes(id, parsedDoc.nodes, platform, trustLevel, null, 0, 0, newHashes);
  updateDocumentSummary(id);

  d.prepare(
    `INSERT INTO document_changelog (id, document_id, change_type, old_hash, new_hash, nodes_added, nodes_modified, nodes_deleted, changed_at, detected_by)
     VALUES (?, ?, 'created', NULL, ?, ?, 0, 0, ?, ?)`,
  ).run(randomUUID(), id, fileHash, newHashes.size, ts, detectedBy);

  return getDocument(id)!;
}

export function getDocument(id: string): MemoryDocument | null {
  const row = requireDb().prepare(`SELECT * FROM memory_documents WHERE id = ?`).get(id);
  return row ? rowToDocument(row as any) : null;
}

export function getDocumentByPath(filePath: string): MemoryDocument | null {
  const row = requireDb().prepare(`SELECT * FROM memory_documents WHERE file_path = ? ORDER BY version DESC LIMIT 1`).get(filePath);
  return row ? rowToDocument(row as any) : null;
}

export function getAllDocuments(filters?: { status?: MemoryStatus; source_platform?: SourcePlatform }): MemoryDocument[] {
  const d = requireDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters?.status) { clauses.push('status = ?'); params.push(filters.status); }
  if (filters?.source_platform) { clauses.push('source_platform = ?'); params.push(filters.source_platform); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = d.prepare(`SELECT * FROM memory_documents${where} ORDER BY last_modified DESC`).all(...params);
  return (rows as any[]).map(rowToDocument);
}

export function getNodesForDocument(documentId: string): MemoryNode[] {
  const rows = requireDb()
    .prepare(`SELECT * FROM memory_nodes WHERE document_id = ? ORDER BY depth, position`).all(documentId);
  return (rows as any[]).map(rowToNode);
}

export function buildNodeTree(flatNodes: MemoryNode[]): MemoryNode[] {
  const byId = new Map<string, MemoryNode>();
  for (const n of flatNodes) byId.set(n.id, { ...n, children: [] });
  const roots: MemoryNode[] = [];
  for (const n of byId.values()) {
    if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id)!.children!.push(n);
    else roots.push(n);
  }
  return roots;
}

export function getDocumentWithNodes(id: string): MemoryDocument | null {
  const doc = getDocument(id);
  if (!doc) return null;
  doc.nodes = buildNodeTree(getNodesForDocument(id));
  return doc;
}

export function getDocumentChangelog(documentId: string): DocumentChangelog[] {
  const rows = requireDb()
    .prepare(`SELECT * FROM document_changelog WHERE document_id = ? ORDER BY changed_at DESC`).all(documentId);
  return (rows as any[]).map(rowToDocChangelog);
}

export function getDocumentStats(): {
  total_documents: number;
  total_nodes: number;
  by_platform: Record<string, number>;
  flagged_nodes: number;
  flagged_documents: number;
} {
  const d = requireDb();
  const count = (sql: string): number => {
    const row = d.prepare(sql).get() as any;
    return Number(row?.c ?? 0);
  };
  const group = d.prepare(`SELECT source_platform AS k, COUNT(*) AS c FROM memory_documents GROUP BY source_platform`).all() as any[];
  const by_platform: Record<string, number> = {};
  for (const r of group) by_platform[r.k] = Number(r.c);
  return {
    total_documents: count(`SELECT COUNT(*) AS c FROM memory_documents`),
    total_nodes: count(`SELECT COUNT(*) AS c FROM memory_nodes`),
    by_platform,
    flagged_nodes: count(`SELECT COUNT(*) AS c FROM memory_nodes WHERE json_array_length(flags) > 0`),
    flagged_documents: count(`SELECT COUNT(*) AS c FROM memory_documents WHERE json_array_length(flags_summary) > 0`),
  };
}
