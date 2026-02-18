/**
 * Self-Healing Auto Routes
 *
 * Autonomous drift detection and documentation regeneration.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  assessDrift,
  regenerateSections,
  getHealingConfig,
  updateHealingConfig,
  getHealingHistory,
} from '../services/self-healing-auto.service.js';

const log = createLogger('self-healing-auto-routes');
const app = new Hono();

app.post('/assess', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string }>();
  if (!body.repositoryId) return c.json({ success: false, error: 'repositoryId is required' }, 400);

  try {
    const assessment = await assessDrift(body.repositoryId);
    return c.json({ success: true, data: assessment });
  } catch (error) {
    log.error({ error, repositoryId: body.repositoryId }, 'Failed to assess drift');
    return c.json({ success: false, error: 'Failed to assess drift' }, 500);
  }
});

app.post('/regenerate', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    driftThreshold?: number;
    confidenceMinimum?: number;
    maxSections?: number;
  }>();
  if (!body.repositoryId) return c.json({ success: false, error: 'repositoryId is required' }, 400);

  try {
    const result = await regenerateSections(body.repositoryId, body);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to regenerate');
    return c.json({ success: false, error: 'Failed to regenerate' }, 500);
  }
});

app.post('/regenerate/async', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string }>();
  if (!body.repositoryId) return c.json({ success: false, error: 'repositoryId is required' }, 400);

  try {
    await addJob(QUEUE_NAMES.SELF_HEALING_AUTO, {
      repositoryId: body.repositoryId,
      action: 'assess-drift' as const,
    });
    return c.json({ success: true, data: { message: 'Self-healing assessment queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to queue self-healing');
    return c.json({ success: false, error: 'Failed to queue' }, 500);
  }
});

app.get('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  try {
    const config = await getHealingConfig(repositoryId);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get config');
    return c.json({ success: false, error: 'Failed to get config' }, 500);
  }
});

app.post('/config', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    enabled?: boolean;
    driftThreshold?: number;
    confidenceMinimum?: number;
    autoPR?: boolean;
    schedule?: 'daily' | 'weekly' | 'manual';
  }>();
  if (!body.repositoryId) return c.json({ success: false, error: 'repositoryId is required' }, 400);

  try {
    const config = await updateHealingConfig(body.repositoryId, body);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error }, 'Failed to update config');
    return c.json({ success: false, error: 'Failed to update config' }, 500);
  }
});

app.get('/history/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const limit = parseInt(c.req.query('limit') || '10', 10);

  try {
    const history = await getHealingHistory(repositoryId, limit);
    return c.json({ success: true, data: history });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get history');
    return c.json({ success: false, error: 'Failed to get history' }, 500);
  }
});

export { app as selfHealingAutoRoutes };
