/**
 * Auto-Healing Documentation Routes
 *
 * API endpoints for detecting and auto-fixing documentation issues.
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  runHealingScan,
  getHealingConfig,
  updateHealingConfig,
  getHealingScanHistory,
  type HealingConfig,
} from '../services/auto-healing.service.js';

const log = createLogger('auto-healing-routes');

const app = new Hono();

/**
 * POST /scan - Run a healing scan
 */
app.post('/scan', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string; scanTypes?: string[]; async?: boolean }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  if (body.async) {
    const job = await addJob(QUEUE_NAMES.AUTO_HEALING, {
      repositoryId: body.repositoryId,
      triggeredBy: 'manual' as const,
      scanTypes: body.scanTypes,
    });
    return c.json({ success: true, data: { jobId: job.id, message: 'Healing scan queued' } });
  }

  try {
    const result = await runHealingScan(body.repositoryId, body.scanTypes as any);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Healing scan failed');
    return c.json({ success: false, error: 'Scan failed' }, 500);
  }
});

/**
 * GET /history/:repositoryId - Get scan history
 */
app.get('/history/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const history = await getHealingScanHistory(c.req.param('repositoryId'), limit);
  return c.json({ success: true, data: history });
});

/**
 * GET /config/:repositoryId - Get healing configuration
 */
app.get('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const config = await getHealingConfig(c.req.param('repositoryId'));
  return c.json({ success: true, data: config });
});

/**
 * PUT /config/:repositoryId - Update healing configuration
 */
app.put('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<Partial<HealingConfig>>();

  try {
    const config = await updateHealingConfig(c.req.param('repositoryId'), body);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error }, 'Failed to update healing config');
    return c.json({ success: false, error: 'Update failed' }, 500);
  }
});

/**
 * GET /stats/:repositoryId - Get healing statistics
 */
app.get('/stats/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const days = parseInt(c.req.query('days') || '30', 10);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  const scans = await db.healingScan.findMany({
    where: { repositoryId, scannedAt: { gte: since } },
    select: { issuesFound: true, issuesFixed: true, prCreated: true, scannedAt: true },
  });

  const stats = {
    totalScans: scans.length,
    totalIssuesFound: scans.reduce(
      (s: number, scan: { issuesFound: number }) => s + scan.issuesFound,
      0
    ),
    totalIssuesFixed: scans.reduce(
      (s: number, scan: { issuesFixed: number }) => s + scan.issuesFixed,
      0
    ),
    prsCreated: scans.filter((s: { prCreated: boolean }) => s.prCreated).length,
  };

  return c.json({ success: true, data: stats });
});

export { app as autoHealingRoutes };
