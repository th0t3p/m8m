import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildNodeTree,
  clearAllMemories,
  createSecurityEvent,
  createSnapshot,
  deleteMemory,
  getAllMemories,
  getChangelog,
  getDocumentChangelog,
  getDocumentWithNodes,
  getLatestSnapshot,
  getMemory,
  getNodesForDocument,
  getSecurityEvents,
  getStats,
  getTimeline,
  initDatabase,
  resolveSecurityEvent,
  updateMemoryStatus,
  upsertDocument,
  upsertMemory,
} from '../../src/core/db.js';

beforeEach(() => {
  initDatabase(':memory:');
});

describe('db — upsert and dedup', () => {
  it('creates a new entry with a changelog record', () => {
    const e = upsertMemory({ content: 'User likes tea', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    expect(e.id).toBeTruthy();
    expect(getChangelog()).toHaveLength(1);
    expect(getChangelog()[0].change_type).toBe('created');
  });

  it('deduplicates identical content by content_hash', () => {
    const a = upsertMemory({ content: 'User likes tea', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    const b = upsertMemory({ content: 'User likes tea', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    expect(a.id).toBe(b.id);
    expect(getAllMemories()).toHaveLength(1);
  });

  it('modifies same-source entries with a changelog and version bump', () => {
    const a = upsertMemory({ content: 'User works at A', source_type: 'conversation', source_platform: 'claude_code', source_detail: 'f#1' }, 'cli');
    const b = upsertMemory({ content: 'User works at B', source_type: 'conversation', source_platform: 'claude_code', source_detail: 'f#1' }, 'cli');
    expect(b.id).toBe(a.id);
    expect(b.version).toBe(2);
    expect(getChangelog().some((c) => c.change_type === 'modified')).toBe(true);
  });

  it('attaches analyzer flags and creates security events', () => {
    upsertMemory({ content: 'API key is sk_live_abc123', source_type: 'document', source_platform: 'local_file' }, 'cli');
    const e = getAllMemories()[0];
    expect(e.flags.map((f) => f.type)).toContain('contains_credential');
    expect(getSecurityEvents().length).toBeGreaterThan(0);
  });
});

describe('db — delete and status', () => {
  it('soft-deletes with a changelog record', () => {
    const e = upsertMemory({ content: 'x', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    deleteMemory(e.id, 'cli');
    expect(getMemory(e.id)?.status).toBe('deleted');
    expect(getChangelog().some((c) => c.change_type === 'deleted')).toBe(true);
  });

  it('changes status with a changelog record', () => {
    const e = upsertMemory({ content: 'x', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    updateMemoryStatus(e.id, 'quarantined', 'cli');
    expect(getMemory(e.id)?.status).toBe('quarantined');
    expect(getChangelog().some((c) => c.change_type === 'status_changed')).toBe(true);
  });

  it('clears all memories as soft-deletes', () => {
    upsertMemory({ content: 'a', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    upsertMemory({ content: 'b', source_type: 'document', source_platform: 'local_file' }, 'cli');
    const cleared = clearAllMemories('cli');
    expect(cleared).toBe(2);
    expect(getAllMemories().filter((m) => m.status !== 'deleted')).toHaveLength(0);
    expect(getChangelog().filter((c) => c.change_type === 'deleted')).toHaveLength(2);
  });
});

describe('db — snapshots', () => {
  it('creates and retrieves the latest snapshot', () => {
    const entries = getAllMemories();
    createSnapshot('claude_code', entries);
    createSnapshot('claude_code', entries);
    const latest = getLatestSnapshot('claude_code');
    expect(latest).toBeTruthy();
    expect(latest?.entry_count).toBe(entries.length);
  });
});

describe('db — security events', () => {
  it('creates and resolves events', () => {
    const ev = createSecurityEvent({ event_type: 'test', severity: 'info', title: 'T' });
    expect(ev.id).toBeTruthy();
    expect(getSecurityEvents({ resolved: false }).map((e) => e.id)).toContain(ev.id);
    resolveSecurityEvent(ev.id, 'user_dismissed');
    expect(getSecurityEvents({ resolved: true }).map((e) => e.id)).toContain(ev.id);
  });
});

describe('db — stats', () => {
  it('returns counts and groupings', () => {
    upsertMemory({ content: 'User likes tea', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    upsertMemory({ content: 'API key is sk_live_abc', source_type: 'document', source_platform: 'local_file' }, 'cli');
    const s = getStats();
    expect(s.total).toBe(2);
    expect(s.active).toBe(2);
    expect(s.by_platform.claude_code).toBe(1);
    expect(s.by_platform.local_file).toBe(1);
  });

  it('counts file memories alongside agent memories', () => {
    upsertMemory({ content: 'User likes tea', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    upsertDocument(
      '/tmp/m.md',
      'note',
      { title: 'M', nodes: [{ node_type: 'paragraph', content: 'note', children: [] }] },
      'local_file',
      'Codex',
      0.5,
      'cli',
    );
    const s = getStats();
    expect(s.agent).toBe(1);
    expect(s.file).toBe(1);
    expect(s.total).toBe(2);
    expect(s.file_nodes).toBe(1);
    expect(s.by_platform.claude_code).toBe(1);
    expect(s.by_platform.local_file).toBe(1);
  });
});

describe('db — documents', () => {
  it('upsertDocument creates document + nodes + changelog', () => {
    const parsed = {
      title: 'Test Doc',
      nodes: [
        { node_type: 'section', heading: 'Intro', content: '# Intro', children: [{ node_type: 'paragraph', content: 'Hello world', children: [] }] },
      ],
    };
    const doc = upsertDocument('/tmp/test.md', '# Intro\n\nHello world', parsed, 'local_file', 'Claude Code', 0.5, 'cli');
    expect(doc.id).toBeTruthy();
    expect(doc.title).toBe('Test Doc');
    expect(doc.provider).toBe('Claude Code');
    expect(doc.raw_content).toBe('# Intro\n\nHello world');
    expect(getNodesForDocument(doc.id)).toHaveLength(2);
    expect(getDocumentChangelog(doc.id)).toHaveLength(1);
  });

  it('getTimeline includes file-memory changes', () => {
    const parsed = { title: 'T', nodes: [{ node_type: 'paragraph', content: 'note', children: [] }] };
    upsertDocument('/tmp/t.md', 'note', parsed, 'local_file', 'Codex', 0.5, 'cli');
    const timeline = getTimeline();
    expect(timeline).toHaveLength(1);
    expect(timeline[0].kind).toBe('file');
    expect(timeline[0].file_name).toBe('t.md');
    expect(timeline[0].provider).toBe('Codex');
    expect(timeline[0].nodes_added).toBe(1);
  });

  it('creates security events for flagged document nodes', () => {
    const parsed = { title: 'T', nodes: [{ node_type: 'paragraph', content: 'API key is sk_live_abc123', children: [] }] };
    upsertDocument('/tmp/sec.md', 'API key is sk_live_abc123', parsed, 'local_file', 'Codex', 0.5, 'cli');
    const events = getSecurityEvents({ resolved: false });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].document_id).toBeTruthy();
    expect(events[0].memory_id).toBeUndefined();
  });

  it('upsertDocument with same hash only updates last_seen', () => {
    const parsed = { title: 'T', nodes: [] };
    const a = upsertDocument('/tmp/a.md', 'same content', parsed, 'local_file', null, 0.5, 'cli');
    const b = upsertDocument('/tmp/a.md', 'same content', parsed, 'local_file', null, 0.5, 'cli');
    expect(b.id).toBe(a.id);
    expect(b.version).toBe(1);
    expect(getDocumentChangelog(a.id)).toHaveLength(1);
  });

  it('upsertDocument backfills provider on same-hash re-scan', () => {
    const parsed = { title: 'T', nodes: [] };
    const a = upsertDocument('/tmp/a2.md', 'same content', parsed, 'local_file', null, 0.5, 'cli');
    expect(a.provider).toBeNull();
    const b = upsertDocument('/tmp/a2.md', 'same content', parsed, 'local_file', 'Codex', 0.5, 'cli');
    expect(b.id).toBe(a.id);
    expect(b.version).toBe(1);
    expect(b.provider).toBe('Codex');
  });

  it('upsertDocument with different hash creates a new version', () => {
    const parsed = { title: 'T', nodes: [{ node_type: 'paragraph', content: 'one', children: [] }] };
    const a = upsertDocument('/tmp/b.md', 'one', parsed, 'local_file', null, 0.5, 'cli');
    const parsed2 = { title: 'T', nodes: [{ node_type: 'paragraph', content: 'two', children: [] }] };
    const b = upsertDocument('/tmp/b.md', 'two', parsed2, 'local_file', null, 0.5, 'cli');
    expect(b.id).toBe(a.id);
    expect(b.version).toBe(2);
    expect(b.raw_content).toBe('two');
    const cl = getDocumentChangelog(a.id);
    expect(cl).toHaveLength(2);
    // The "modified" entry stores the before/after raw content for diffing.
    const modified = cl.find((c) => c.change_type === 'modified');
    expect(modified).toBeTruthy();
    expect(modified!.old_content).toBe('one');
    expect(modified!.new_content).toBe('two');
  });

  it('getDocumentWithNodes returns a nested tree', () => {
    const parsed = {
      title: 'Tree',
      nodes: [
        { node_type: 'section', heading: 'S', content: '## S', children: [{ node_type: 'bullet', content: '- b', children: [] }] },
      ],
    };
    const doc = upsertDocument('/tmp/c.md', '## S\n- b', parsed, 'local_file', null, 0.5, 'cli');
    const full = getDocumentWithNodes(doc.id)!;
    expect(full.nodes![0].heading).toBe('S');
    expect(full.nodes![0].children![0].node_type).toBe('bullet');
  });

  it('buildNodeTree nests children under parents', () => {
    const flat = [
      { id: 'n1', document_id: 'd', parent_id: null, node_type: 'section', depth: 0, position: 0, heading: 'A', content: '', content_hash: '', line_start: null, line_end: null, flags: [], anomaly_score: 0, category: 'unknown' },
      { id: 'n2', document_id: 'd', parent_id: 'n1', node_type: 'bullet', depth: 1, position: 0, heading: null, content: '', content_hash: '', line_start: null, line_end: null, flags: [], anomaly_score: 0, category: 'unknown' },
    ];
    const tree = buildNodeTree(flat);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
  });
});
