// Core type definitions for m8m.

export type SourceType =
  | 'conversation' | 'document' | 'email' | 'web_page'
  | 'tool_output' | 'ai_derived' | 'user_explicit' | 'unknown';

export type SourcePlatform =
  | 'claude_web' | 'chatgpt_web' | 'claude_code' | 'cursor'
  | 'claude_desktop' | 'mem0' | 'local_file' | 'manual_import' | 'unknown';

export type MemoryStatus = 'active' | 'quarantined' | 'dismissed' | 'deleted';

export type MemoryCategory =
  | 'preference' | 'fact' | 'instruction' | 'relationship'
  | 'event' | 'credential' | 'unknown';

export type EventSeverity = 'info' | 'warning' | 'critical';

export type DetectionSource =
  | 'mcp_live' | 'file_watcher' | 'periodic_snapshot'
  | 'manual_import' | 'cli' | 'dashboard';

export type ChangeType = 'created' | 'modified' | 'deleted' | 'status_changed';

export interface MemoryFlag {
  type: string;          // 'contains_instruction', 'contains_url', 'contains_email',
                         // 'contains_credential', 'contradicts_existing', 'source_unknown',
                         // 'hidden_character'
  detail: string;
  detected_at: string;   // ISO datetime
  severity?: EventSeverity; // severity when this flag maps to a security event
}

export interface MemoryEntry {
  id: string;
  content: string;
  content_hash: string;
  source_type: SourceType;
  source_platform: SourcePlatform;
  source_conversation_id?: string;
  source_url?: string;
  source_detail?: string;
  trust_level: number;
  anomaly_score: number;
  status: MemoryStatus;
  flags: MemoryFlag[];
  category: MemoryCategory;
  entities: string[];
  first_seen: string;
  last_seen: string;
  last_modified?: string;
  version: number;
  tags: string[];
}

export interface ChangelogEntry {
  id: string;
  memory_id: string;
  change_type: ChangeType;
  old_content?: string;
  new_content?: string;
  old_status?: string;
  new_status?: string;
  changed_at: string;
  source_type?: string;
  source_detail?: string;
  detected_by: DetectionSource;
}

export interface SecurityEvent {
  id: string;
  memory_id?: string;
  document_id?: string;
  event_type: string;
  severity: EventSeverity;
  title: string;
  details?: Record<string, unknown>;
  detected_at: string;
  resolved_at?: string;
  resolution?: string;
}

export interface Snapshot {
  id: string;
  platform: string;
  snapshot_data: MemoryEntry[];
  entry_count: number;
  taken_at: string;
  hash: string;
}

export interface MemoryDiff {
  added: MemoryEntry[];
  modified: { before: MemoryEntry; after: MemoryEntry }[];
  deleted: MemoryEntry[];
  unchanged_count: number;
}

export interface M8mConfig {
  db_path: string;                    // Default: ~/.m8m/m8m.db
  watch_paths: string[];              // Paths to watch for memory file changes
  providers: ProviderConfig[];        // Agent-harness scan targets (defaults in providers.ts)
  dashboard_port: number;             // Default: 8808
  auto_snapshot_interval_minutes: number;  // Default: 60
  trust_levels: Record<SourceType, number>;
}

export interface MemoryFilters {
  status?: MemoryStatus;
  source_platform?: SourcePlatform;
  min_trust?: number;
}

export interface ChangelogFilters {
  memory_id?: string;
  since?: string;
  change_type?: ChangeType;
}

export interface SecurityEventFilters {
  severity?: EventSeverity;
  resolved?: boolean;
}

export interface M8mStats {
  total: number;          // agent + file
  active: number;         // agent memories with status 'active'
  quarantined: number;    // agent memories with status 'quarantined'
  flagged: number;        // agent memories carrying at least one flag
  agent: number;          // flat memory_entries (MCP facts)
  file: number;           // memory_documents (file memories)
  file_nodes: number;     // total nodes across file memories
  file_flagged: number;   // flagged nodes across file memories
  by_platform: Record<string, number>;
  by_source_type: Record<string, number>;
  by_category: Record<string, number>;
}

export interface AnalysisResult {
  flags: MemoryFlag[];
  category: MemoryCategory;
  entities: string[];
  anomaly_score: number;    // 0-1, heuristic-based in Phase 1
}

export interface ParsedMemory {
  content: string;
  line_number?: number;
  section?: string;
  raw_text: string;
}

export interface ImportResult {
  imported: number;
  updated: number;
  flagged: number;
}

export type NodeType = 'section' | 'bullet' | 'numbered' | 'paragraph' | 'code_block' | 'key_value' | 'text';

export interface MemoryDocument {
  id: string;
  file_path: string;
  file_name: string;
  file_hash: string;
  file_format: string;
  title: string | null;
  raw_content: string;
  provider: string | null;
  source_platform: SourcePlatform;
  trust_level: number;
  anomaly_score: number;
  status: MemoryStatus;
  flags_summary: MemoryFlag[];
  first_seen: string;
  last_seen: string;
  last_modified?: string;
  version: number;
  node_count?: number;
  nodes?: MemoryNode[];
}

export interface MemoryNode {
  id: string;
  document_id: string;
  parent_id: string | null;
  node_type: NodeType;
  depth: number;
  position: number;
  heading: string | null;
  content: string;
  content_hash: string;
  line_start: number | null;
  line_end: number | null;
  flags: MemoryFlag[];
  anomaly_score: number;
  category: MemoryCategory;
  children?: MemoryNode[];
}

export interface DocumentChangelog {
  id: string;
  document_id: string;
  change_type: 'created' | 'modified' | 'deleted';
  old_hash?: string;
  new_hash?: string;
  old_content?: string;
  new_content?: string;
  nodes_added: number;
  nodes_modified: number;
  nodes_deleted: number;
  changed_at: string;
  detected_by: DetectionSource;
}

/** A unified timeline event: agent-memory changes or file-memory changes. */
export interface TimelineEvent {
  kind: 'agent' | 'file';
  id: string;
  changed_at: string;
  change_type: ChangeType;
  detected_by: DetectionSource;
  // agent memory
  memory_id?: string;
  content?: string;
  old_content?: string;
  old_status?: string;
  new_status?: string;
  // file memory
  document_id?: string;
  file_name?: string | null;
  file_path?: string | null;
  provider?: string | null;
  nodes_added?: number;
  nodes_modified?: number;
  nodes_deleted?: number;
  // shared provenance
  source_platform?: SourcePlatform;
}

export interface ParsedNode {
  node_type: NodeType;
  heading?: string;
  content: string;
  line_start?: number;
  line_end?: number;
  children: ParsedNode[];
}

export interface ParsedDocument {
  title?: string;
  nodes: ParsedNode[];
}

export interface DocumentImportResult {
  document_id: string;
  is_new: boolean;
  total_nodes: number;
  flagged_nodes: number;
  nodes_added: number;
  nodes_modified: number;
  nodes_deleted: number;
}

export interface ProviderTarget {
  path: string;
  description: string;
  isDir?: boolean;
  extensions?: string[];
}

export interface ProviderConfig {
  name: string;
  platform: SourcePlatform;
  targets: ProviderTarget[];
}

export const DEFAULT_TRUST_LEVELS: Record<SourceType, number> = {
  user_explicit: 0.9,
  conversation: 0.7,
  document: 0.5,
  email: 0.3,
  web_page: 0.3,
  tool_output: 0.5,
  ai_derived: 0.4,
  unknown: 0.1,
};
