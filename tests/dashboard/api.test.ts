import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { initDatabase, upsertMemory } from '../../src/core/db.js';
import { registerApi } from '../../src/dashboard/api.js';

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(registerApi());
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  initDatabase(':memory:');
});

async function getJson(path: string): Promise<any> {
  const res = await fetch(base + path);
  return res.json();
}

async function postJson(path: string, body?: unknown): Promise<any> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

describe('dashboard API', () => {
  it('serves timeline-data with river, heatmap, radar, snapshots', async () => {
    upsertMemory({ content: 'API key is sk_live_abc', source_type: 'document', source_platform: 'local_file' }, 'cli');
    upsertMemory({ content: 'User works at CompanyA', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');

    const data = await getJson('/api/memories/timeline-data');
    expect(data.river.buckets.length).toBeGreaterThan(0);
    expect(data.river.platforms).toContain('claude_code');
    expect(data.heatmap.source_types).toContain('document');
    expect(data.radar.credential_detected).toBe(1);
    expect(Array.isArray(data.snapshots)).toBe(true);
  });

  it('serves memories and stats', async () => {
    upsertMemory({ content: 'User likes tea', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    const memories = await getJson('/api/memories');
    expect(memories).toHaveLength(1);
    const stats = await getJson('/api/memories/stats');
    expect(stats.total).toBe(1);
  });

  it('flag mutation creates a security event', async () => {
    const m = upsertMemory({ content: 'ordinary fact', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    await postJson(`/api/memories/${m.id}/flag`, { reason: 'test flag' });
    const events = await getJson('/api/events');
    expect(events.some((e: any) => e.title === 'Manually flagged')).toBe(true);
  });

  it('quarantine updates status', async () => {
    const m = upsertMemory({ content: 'quarantine me', source_type: 'conversation', source_platform: 'claude_code' }, 'cli');
    await postJson(`/api/memories/${m.id}/quarantine`);
    const mems = await getJson('/api/memories?status=quarantined');
    expect(mems.some((x: any) => x.id === m.id)).toBe(true);
  });
});
