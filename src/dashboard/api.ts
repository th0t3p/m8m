// REST API routes for the local dashboard.

import { Router } from 'express';
import {
  createSnapshot,
  flagMemory,
  getAllMemories,
  getAllSnapshots,
  getChangelog,
  getMemory,
  getSecurityEvents,
  getSnapshot,
  getStats,
  resolveSecurityEvent,
  unflagMemory,
  updateMemoryStatus,
} from '../core/db.js';
import { diffMemories, diffSnapshots } from '../core/diff.js';
import { buildHeatmap, buildRadar, buildRiver } from '../core/timeline.js';
import { loadConfig } from '../core/config.js';
import type { MemoryStatus, SourcePlatform } from '../core/types.js';

export function registerApi(): Router {
  const router = Router();

  router.get('/api/memories/stats', (_req, res) => {
    res.json(getStats());
  });

  router.get('/api/memories/timeline-data', (_req, res) => {
    const memories = getAllMemories();
    const snapshots = getAllSnapshots().map((s) => ({
      id: s.id,
      platform: s.platform,
      taken_at: s.taken_at,
    }));
    res.json({
      river: buildRiver(memories),
      heatmap: buildHeatmap(memories, new Date()),
      radar: buildRadar(memories),
      snapshots,
    });
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

  router.get('/api/diff', (req, res) => {
    const since = req.query.since as string | undefined;
    const snapshot = req.query.snapshot as string | undefined;
    const snapshot2 = req.query.snapshot2 as string | undefined;

    if (snapshot && snapshot2) {
      const d = diffSnapshots(snapshot, snapshot2);
      return res.json({ snapshot, snapshot2, ...d });
    }
    if (snapshot) {
      const snap = getSnapshot(snapshot);
      const d = diffMemories(snap ? snap.snapshot_data : [], getAllMemories());
      return res.json({ snapshot, snapshot_taken_at: snap?.taken_at ?? null, ...d });
    }
    if (since) {
      const changelog = getChangelog({ since });
      return res.json({ since, changelog });
    }
    const snapshots = getAllSnapshots();
    const latest = snapshots[0];
    const current = getAllMemories();
    const d = diffMemories(latest ? latest.snapshot_data : [], current);
    res.json({ snapshot: latest?.id ?? null, snapshot_taken_at: latest?.taken_at ?? null, ...d });
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
