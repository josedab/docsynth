/**
 * Documentation ROI Dashboard V2 Routes
 *
 * API endpoints for documentation ROI computation and analytics.
 */

import { Hono } from 'hono';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  computeROIDashboard,
  trackDocUsage,
  getROIDashboardHistory,
  getUsageAnalytics,
} from '../services/roi-dashboard-v2.service.js';

const log = createLogger('roi-dashboard-v2-routes');

const app = new Hono();

/**
 * POST /compute - Compute ROI dashboard
 */
app.post('/compute', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ organizationId: string; periodDays?: number; async?: boolean }>();

  if (!body.organizationId) {
    return c.json({ success: false, error: 'organizationId is required' }, 400);
  }

  if (body.async) {
    const job = await addJob(QUEUE_NAMES.ROI_DASHBOARD, {
      organizationId: body.organizationId,
      periodDays: body.periodDays || 30,
    });
    return c.json({ success: true, data: { jobId: job.id, message: 'ROI computation queued' } });
  }

  try {
    const dashboard = await computeROIDashboard(body.organizationId, body.periodDays);
    return c.json({ success: true, data: dashboard });
  } catch (error) {
    log.error({ error }, 'ROI computation failed');
    return c.json({ success: false, error: 'Computation failed' }, 500);
  }
});

/**
 * GET /history/:organizationId - Get dashboard history
 */
app.get('/history/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  const limit = parseInt(c.req.query('limit') || '12', 10);
  const history = await getROIDashboardHistory(c.req.param('organizationId'), limit);
  return c.json({ success: true, data: history });
});

/**
 * POST /track - Track a documentation usage event
 */
app.post('/track', async (c) => {
  const body = await c.req.json<{
    organizationId: string;
    eventType: string;
    metadata?: Record<string, unknown>;
  }>();

  if (!body.organizationId || !body.eventType) {
    return c.json({ success: false, error: 'organizationId and eventType are required' }, 400);
  }

  await trackDocUsage(body.organizationId, body.eventType, body.metadata || {});
  return c.json({ success: true });
});

/**
 * GET /analytics/:organizationId - Get usage analytics
 */
app.get('/analytics/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  const days = parseInt(c.req.query('days') || '30', 10);
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

  try {
    const analytics = await getUsageAnalytics(c.req.param('organizationId'), startDate, endDate);
    return c.json({ success: true, data: analytics });
  } catch (error) {
    log.error({ error }, 'Failed to get analytics');
    return c.json({ success: false, error: 'Failed to get analytics' }, 500);
  }
});

export { app as roiDashboardV2Routes };
