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
  'claude_web', 'chatgpt_web', 'claude_code', 'claude_desktop', 'cursor',
  'dsh', 'codebuddy', 'windsurf', 'cline', 'codex', 'aider', 'copilot',
  'continue_dev', 'gemini', 'zed', 'trae', 'goose', 'qoder',
  'mem0', 'local_file', 'manual_import', 'unknown',
];

// Ordered keyword → platform pairs, shared by the clientInfo handshake and the
// environment fallback. Order matters for tokens that are substrings of others
// (e.g. `claude_desktop` must precede `claude`). A harness is caught by any of
// the tokens it is known to expose.
const PLATFORM_KEYWORDS: Array<{ keyword: string; platform: SourcePlatform }> = [
  { keyword: 'codebuddy', platform: 'codebuddy' },
  { keyword: 'deepseek', platform: 'dsh' },
  { keyword: 'claude-desktop', platform: 'claude_desktop' },
  { keyword: 'claude_desktop', platform: 'claude_desktop' },
  { keyword: 'claude', platform: 'claude_code' },
  { keyword: 'cursor', platform: 'cursor' },
  { keyword: 'windsurf', platform: 'windsurf' },
  { keyword: 'codeium', platform: 'windsurf' },
  { keyword: 'cline', platform: 'cline' },
  { keyword: 'codex', platform: 'codex' },
  { keyword: 'aider', platform: 'aider' },
  { keyword: 'copilot', platform: 'copilot' },
  { keyword: 'continue', platform: 'continue_dev' },
  { keyword: 'gemini', platform: 'gemini' },
  { keyword: 'zed', platform: 'zed' },
  { keyword: 'trae', platform: 'trae' },
  { keyword: 'goose', platform: 'goose' },
  { keyword: 'qoder', platform: 'qoder' },
  { keyword: 'qwen', platform: 'qoder' },
  { keyword: 'chatgpt', platform: 'chatgpt_web' },
  { keyword: 'dsh', platform: 'dsh' },
];

// Populated from the MCP `initialize` handshake (clientInfo.name) once the
// client connects — the most authoritative signal because the client declares
// itself, regardless of how it was installed.
let clientPlatform: SourcePlatform | null = null;

/** Record the client's self-reported name from the MCP initialize handshake. */
export function setClientPlatform(clientInfoName?: string): void {
  const n = (clientInfoName ?? '').toLowerCase();
  if (!n) return;
  for (const { keyword, platform } of PLATFORM_KEYWORDS) {
    if (n.includes(keyword)) {
      clientPlatform = platform;
      return;
    }
  }
}

/** Which harness is connected. Prefers the MCP clientInfo name, then the
 * explicit M8M_PLATFORM config, then environment sniffing. */
export function detectPlatform(): SourcePlatform {
  if (clientPlatform) return clientPlatform;
  const explicit = process.env.M8M_PLATFORM;
  if (explicit && (PLATFORMS as string[]).includes(explicit)) return explicit as SourcePlatform;

  // Full-environment keyword sniffing: scan every env var NAME (joined and
  // uppercased) so each harness is caught by whichever token it exposes —
  // CODEBUDDY_HOME, WINDSURF_*, CLINE_*, CODEX_HOME, AIDER_*, COPILOT_*,
  // CONTINUE_*, GEMINI_*, ZED_*, TRAE_*, GOOSE_*, QODER_* — without pinning one
  // exact variable name per harness.
  const env = Object.keys(process.env).join(' ').toUpperCase();
  for (const { keyword, platform } of PLATFORM_KEYWORDS) {
    if (env.includes(keyword.toUpperCase())) return platform;
  }
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
