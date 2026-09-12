// Database schema definitions. SQL statements are applied on startup (idempotent).

export const SCHEMA_STATEMENTS: string[] = [
  // Core memory entries table
  `CREATE TABLE IF NOT EXISTS memory_entries (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,

    -- Provenance
    source_type TEXT NOT NULL DEFAULT 'unknown',
    source_platform TEXT NOT NULL DEFAULT 'unknown',
    source_conversation_id TEXT,
    source_url TEXT,
    source_detail TEXT,

    -- Trust & Security
    trust_level REAL NOT NULL DEFAULT 0.5,
    anomaly_score REAL NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'active',
    flags TEXT DEFAULT '[]',

    -- Content classification
    category TEXT DEFAULT 'unknown',
    entities TEXT DEFAULT '[]',

    -- Lifecycle
    first_seen DATETIME NOT NULL DEFAULT (datetime('now')),
    last_seen DATETIME NOT NULL DEFAULT (datetime('now')),
    last_modified DATETIME,
    version INTEGER NOT NULL DEFAULT 1,

    -- Organization
    tags TEXT DEFAULT '[]'
  )`,

  // Changelog: every mutation is recorded (append-only)
  `CREATE TABLE IF NOT EXISTS memory_changelog (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    change_type TEXT NOT NULL,
    old_content TEXT,
    new_content TEXT,
    old_status TEXT,
    new_status TEXT,
    changed_at DATETIME NOT NULL DEFAULT (datetime('now')),
    source_type TEXT,
    source_detail TEXT,
    detected_by TEXT NOT NULL
  )`,

  // Snapshots: periodic full dumps for diffing
  `CREATE TABLE IF NOT EXISTS memory_snapshots (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    snapshot_data TEXT NOT NULL,
    documents_data TEXT,
    entry_count INTEGER NOT NULL DEFAULT 0,
    taken_at DATETIME NOT NULL DEFAULT (datetime('now')),
    hash TEXT NOT NULL
  )`,

  // Security events
  `CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    memory_id TEXT,
    document_id TEXT,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    details TEXT,
    detected_at DATETIME NOT NULL DEFAULT (datetime('now')),
    resolved_at DATETIME,
    resolution TEXT
  )`,

  // Watch targets: files/directories being monitored
  `CREATE TABLE IF NOT EXISTS watch_targets (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    target_type TEXT NOT NULL,
    file_format TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'unknown',
    last_hash TEXT,
    last_checked DATETIME,
    active BOOLEAN NOT NULL DEFAULT 1
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_entries_status ON memory_entries(status)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_source_platform ON memory_entries(source_platform)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_trust ON memory_entries(trust_level)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_first_seen ON memory_entries(first_seen)`,
  `CREATE INDEX IF NOT EXISTS idx_changelog_memory_id ON memory_changelog(memory_id)`,
  `CREATE INDEX IF NOT EXISTS idx_changelog_changed_at ON memory_changelog(changed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_severity ON security_events(severity)`,
  `CREATE INDEX IF NOT EXISTS idx_events_resolved ON security_events(resolved_at)`,

  // Documents: one row per imported file, stores the complete raw content
  `CREATE TABLE IF NOT EXISTS memory_documents (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    file_format TEXT NOT NULL,
    title TEXT,
    raw_content TEXT NOT NULL,
    provider TEXT,
    source_platform TEXT NOT NULL DEFAULT 'unknown',
    trust_level REAL NOT NULL DEFAULT 0.5,
    anomaly_score REAL NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'active',
    flags_summary TEXT DEFAULT '[]',
    first_seen DATETIME NOT NULL DEFAULT (datetime('now')),
    last_seen DATETIME NOT NULL DEFAULT (datetime('now')),
    last_modified DATETIME,
    version INTEGER NOT NULL DEFAULT 1
  )`,

  // Nodes: tree structure within a document
  `CREATE TABLE IF NOT EXISTS memory_nodes (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES memory_documents(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES memory_nodes(id),
    node_type TEXT NOT NULL,
    depth INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    heading TEXT,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    line_start INTEGER,
    line_end INTEGER,
    flags TEXT DEFAULT '[]',
    anomaly_score REAL NOT NULL DEFAULT 0.0,
    category TEXT DEFAULT 'unknown'
  )`,

  // Document changelog: tracks changes to documents over time
  `CREATE TABLE IF NOT EXISTS document_changelog (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    change_type TEXT NOT NULL,
    old_hash TEXT,
    new_hash TEXT,
    old_content TEXT,
    new_content TEXT,
    nodes_added INTEGER DEFAULT 0,
    nodes_modified INTEGER DEFAULT 0,
    nodes_deleted INTEGER DEFAULT 0,
    changed_at DATETIME NOT NULL DEFAULT (datetime('now')),
    detected_by TEXT NOT NULL
  )`,

  // Indexes for document layer
  `CREATE INDEX IF NOT EXISTS idx_documents_file_path ON memory_documents(file_path)`,
  `CREATE INDEX IF NOT EXISTS idx_documents_status ON memory_documents(status)`,
  `CREATE INDEX IF NOT EXISTS idx_documents_platform ON memory_documents(source_platform)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_document_id ON memory_nodes(document_id)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_parent_id ON memory_nodes(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_doc_changelog_document_id ON document_changelog(document_id)`,
];
