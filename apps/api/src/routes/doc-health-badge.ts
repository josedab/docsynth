/**
 * Doc Health Badge Routes
 *
 * API endpoints for documentation health scoring, badge rendering,
 * GitHub status checks, organization leaderboards, and score history.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  computeHealthScore,
  renderBadge,
  postStatusCheck,
  getOrgLeaderboard,
  getScoreHistory,
} from '../services/doc-health-badge.service.js';

const log = createLogger('doc-health-badge-routes');
const app = new Hono();

/**
 * GET /score/:repositoryId - Compute health score for a repository
 */
app.get('/score/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');

    const job = await addJob(QUEUE_NAMES.DOC_HEALTH_BADGE, {
      repositoryId,
      action: 'compute',
    });

    const score = await computeHealthScore(repositoryId);

    log.info({ repositoryId, jobId: job.id }, 'Health score computed');
    return c.json({ success: true, data: { jobId: job.id, score } });
  } catch (error) {
    log.error({ error }, 'Failed to compute health score');
    return c.json({ success: false, error: 'Failed to compute health score' }, 500);
  }
});

/**
 * GET /badge/:repositoryId - Render a health badge (public, no auth)
 */
app.get('/badge/:repositoryId', async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const style = c.req.query('style') || 'flat';

    const badge = await renderBadge(repositoryId, style);

    c.header('Content-Type', 'image/svg+xml');
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    return c.body(badge);
  } catch (error) {
    log.error({ error }, 'Failed to render badge');
    return c.json({ success: false, error: 'Failed to render badge' }, 500);
  }
});

/**
 * POST /status-check - Post a GitHub status check for doc health
 */
app.post('/status-check', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      commitSha: string;
      installationId: number;
    }>();

    if (!body.repositoryId || !body.commitSha || !body.installationId) {
      return c.json(
        { success: false, error: 'repositoryId, commitSha, and installationId are required' },
        400
      );
    }

    const result = await postStatusCheck(body.repositoryId, body.commitSha, body.installationId);
    log.info({ repositoryId: body.repositoryId, commitSha: body.commitSha }, 'Status check posted');
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to post status check');
    return c.json({ success: false, error: 'Failed to post status check' }, 500);
  }
});

/**
 * GET /leaderboard/:organizationId - Get org leaderboard
 */
app.get('/leaderboard/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const organizationId = c.req.param('organizationId');
    const limit = parseInt(c.req.query('limit') || '20', 10);

    const leaderboard = await getOrgLeaderboard(organizationId, limit);
    return c.json({ success: true, data: leaderboard });
  } catch (error) {
    log.error({ error }, 'Failed to get leaderboard');
    return c.json({ success: false, error: 'Failed to get leaderboard' }, 500);
  }
});

/**
 * GET /history/:repositoryId - Get score history
 */
app.get('/history/:repositoryId', requireAuth, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const days = parseInt(c.req.query('days') || '30', 10);

    const history = await getScoreHistory(repositoryId, days);
    return c.json({ success: true, data: history });
  } catch (error) {
    log.error({ error }, 'Failed to get score history');
    return c.json({ success: false, error: 'Failed to get score history' }, 500);
  }
});

export { app as docHealthBadgeRoutes };
