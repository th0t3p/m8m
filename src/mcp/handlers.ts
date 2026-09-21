// MCP tool call handlers.

import {
  deleteMemory,
  flagMemory,
  getChangelog,
  getMemory,
  getSecurityEvents,
  getStats,
  searchMemories,
  upsertMemory,
} from '../core/db.js';
import type { MemoryEntry, SourcePlatform, SourceType } from '../core/types.js';

const PLATFORMS: SourcePlatform[] = [
  'claude_web', 'chatgpt_web', 'claude_code', 'cursor',
  'claude_desktop', 'dsh', 'mem0', 'local_file', 'manual_import', 'unknown',
];

/** Which harness is connected. Prefers the explicit M8M_PLATFORM set by
 * `m8m mcp add <client>`; falls back to environment sniffing. */
export function detectPlatform(): SourcePlatform {
  const explicit = process.env.M8M_PLATFORM;
  if (explicit && (PLATFORMS as string[]).includes(explicit)) return explicit as SourcePlatform;
  if (process.env.CURSOR || process.env.CURSOR_TRACE_ID) return 'cursor';
  if (process.env.DSH_HOME || process.env.DSH_SESSION_ID) return 'dsh';
  if (process.env.CLAUDE_CODE_ENTRYPOINT || process.env.CLAUDECODE) return 'claude_code';
  if (process.env.CLAUDE_DESKTOP) return 'claude_desktop';
  return 'unknown';
}

/** Remove internal security/provenance metadata before exposing to the agent. */
function sanitize(entry: MemoryEntry): Record<string, unknown> {
  return {
    id: entry.id,
    content: entry.content,
    source_type: entry.source_type,
    source_platform: entry.source_platform,
    source_detail: entry.source_detail,
    trust_level: entry.trust_level,
    status: entry.status,
    category: entry.category,
    flags: entry.flags.map((f) => f.type),
    tags: entry.tags,
    first_seen: entry.first_seen,
    last_seen: entry.last_seen,
  };
}

export function handleStore(params: {
  content: string;
  source_type?: SourceType;
  source_detail?: string;
}): unknown {
  const entry = upsertMemory(
    {
      content: params.content,
      source_type: params.source_type ?? 'conversation',
      source_platform: detectPlatform(),
      source_detail: params.source_detail,
    },
    'mcp_live',
  );
  return { id: entry.id, flags: entry.flags.map((f) => f.type), trust_level: entry.trust_level };
}

export function handleSearch(params: { query: string; limit?: number }): unknown {
  const results = searchMemories(params.query, params.limit ?? 10);
  return { results: results.map(sanitize) };
}

export function handleRecent(params: { limit?: number; since?: string }): unknown {
  const changelog = getChangelog(params.since ? { since: params.since } : {}).slice(
    0,
    params.limit ?? 10,
  );
  const results = changelog.map((c) => {
    const memory = c.memory_id ? getMemory(c.memory_id) : null;
    return {
      id: c.id,
      memory_id: c.memory_id,
      change_type: c.change_type,
      changed_at: c.changed_at,
      detected_by: c.detected_by,
      memory: memory ? sanitize(memory) : null,
    };
  });
  return { results };
}

export function handleStatus(): unknown {
  const stats = getStats();
  const unresolvedEvents = getSecurityEvents({ resolved: false }).length;
  return { stats, unresolved_events: unresolvedEvents };
}

export function handleFlag(params: { memory_id: string; reason: string }): unknown {
  const entry = flagMemory(params.memory_id, params.reason, 'mcp_live');
  return { id: entry.id, flags: entry.flags.map((f) => f.type), flagged: true };
}

/** Soft-delete a memory (reversible — row and history are kept). */
export function handleDelete(params: { memory_id: string }): unknown {
  deleteMemory(params.memory_id, 'mcp_live');
  return { id: params.memory_id, deleted: true, status: 'deleted' };
}
