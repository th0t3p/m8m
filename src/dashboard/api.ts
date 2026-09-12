// REST API routes for the local dashboard.

import { Router } from 'express';
import {
  createSnapshot,
  flagMemory,
  getAllDocuments,
  getAllMemories,
  getAllSnapshots,
  getChangelog,
  getDocument,
  getDocumentChangelog,
  getDocumentStats,
  getDocumentWithNodes,
  getMemory,
  getSecurityEvents,
  getStats,
  getTimeline,
  resolveSecurityEvent,
  unflagMemory,
  updateMemoryStatus,
} from '../core/db.js';
import { diffMemories } from '../core/diff.js';
import { loadConfig } from '../core/config.js';
import type { MemoryStatus, SourcePlatform } from '../core/types.js';

export function registerApi(): Router {
  const router = Router();

  // Memory files layer (file-based imports, stored as document trees)
  router.get('/api/documents/stats', (_req, res) => {
    res.json(getDocumentStats());
  });

  router.get('/api/documents', (_req, res) => {
    const docs = getAllDocuments().map((d) => {
      const { raw_content: _raw, ...rest } = d as unknown as Record<string, unknown>;
      return rest;
    });
    res.json(docs);
  });

  router.get('/api/documents/:id/raw', (req, res) => {
    const doc = getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.type('text/plain').send(doc.raw_content);
  });

  router.get('/api/documents/:id/changelog', (req, res) => {
    res.json(getDocumentChangelog(req.params.id));
  });

  router.get('/api/documents/:id', (req, res) => {
    const doc = getDocumentWithNodes(req.params.id);
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.json(doc);
  });

  router.get('/api/memories/stats', (_req, res) => {
    res.json(getStats());
  });

  router.get('/api/memories', (req, res) => {
    const { status, platform, min_trust } = req.query;
    const entries = getAllMemories({
      status: status as MemoryStatus | undefined,
      source_platform: platform as SourcePlatform | undefined,
      min_trust: min_trust !== undefined ? Number(min_trust) : undefined,
    });
    res.json(entries);
  });

  router.get('/api/memories/:id', (req, res) => {
    const entry = getMemory(req.params.id);
    if (!entry) return res.status(404).json({ error: 'not found' });
    const changelog = getChangelog({ memory_id: entry.id });
    res.json({ ...entry, changelog });
  });

  router.post('/api/memories/:id/flag', (req, res) => {
    const reason = req.body?.reason ?? 'Flagged from dashboard';
    const entry = flagMemory(req.params.id, reason, 'dashboard');
    res.json(entry);
  });

  router.post('/api/memories/:id/dismiss', (req, res) => {
    unflagMemory(req.params.id, 'dashboard');
    res.json({ ok: true });
  });

  router.post('/api/memories/:id/quarantine', (req, res) => {
    updateMemoryStatus(req.params.id, 'quarantined', 'dashboard');
    res.json({ ok: true });
  });

  router.post('/api/memories/:id/restore', (req, res) => {
    updateMemoryStatus(req.params.id, 'active', 'dashboard');
    res.json({ ok: true });
  });

  router.get('/api/changelog', (req, res) => {
    const { memory_id, since, change_type } = req.query;
    res.json(
      getChangelog({
        memory_id: memory_id as string | undefined,
        since: since as string | undefined,
        change_type: change_type as any,
      }),
    );
  });

  router.get('/api/timeline', (_req, res) => {
    res.json(getTimeline());
  });

  router.get('/api/diff', (req, res) => {
    const since = req.query.since as string | undefined;
    if (since) {
      const changelog = getChangelog({ since });
      return res.json({ since, changelog });
    }
    const snapshots = getAllSnapshots();
    const latest = snapshots[0];
    const current = getAllMemories();
    const diff = diffMemories(latest ? latest.snapshot_data : [], current);
    res.json({ snapshot: latest?.id ?? null, snapshot_taken_at: latest?.taken_at ?? null, ...diff });
  });

  router.get('/api/events', (req, res) => {
    const { severity, resolved } = req.query;
    res.json(
      getSecurityEvents({
        severity: severity as any,
        resolved: resolved !== undefined ? resolved === 'true' : undefined,
      }),
    );
  });

  router.post('/api/events/:id/resolve', (req, res) => {
    const resolution = req.body?.resolution ?? 'user_dismissed';
    resolveSecurityEvent(req.params.id, resolution);
    res.json({ ok: true });
  });

  router.post('/api/snapshot', (req, res) => {
    const platform = req.body?.platform ?? 'manual';
    createSnapshot(platform, getAllMemories());
    res.json({ ok: true, platform });
  });

  router.get('/api/config', (_req, res) => {
    res.json(loadConfig());
  });

  return router;
}
