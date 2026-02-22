/**
 * Doc Gamification Routes
 *
 * API endpoints for documentation gamification including activity tracking,
 * achievement checking, user profiles, and leaderboards.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { trackActivity, getProfile, getLeaderboard } from '../services/doc-gamification.service.js';

const log = createLogger('doc-gamification-routes');
const app = new Hono();

/**
 * POST /track - Track a documentation activity
 */
app.post('/track', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      userId: string;
      repositoryId: string;
      activityType: string;
      metadata?: Record<string, unknown>;
    }>();

    if (!body.userId || !body.repositoryId || !body.activityType) {
      return c.json(
        { success: false, error: 'userId, repositoryId, and activityType are required' },
        400
      );
    }

    const result = await trackActivity(
      body.userId,
      body.repositoryId,
      body.activityType,
      body.metadata
    );
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to track activity');
    return c.json({ success: false, error: 'Failed to track activity' }, 500);
  }
});

/**
 * POST /check-achievements - Check and award pending achievements
 */
app.post('/check-achievements', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{ userId: string }>();

    if (!body.userId) {
      return c.json({ success: false, error: 'userId is required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.DOC_GAMIFICATION, {
      userId: body.userId,
      action: 'check-achievements' as const,
    });

    return c.json({ success: true, data: { jobId: job.id, message: 'Achievement check queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to check achievements');
    return c.json({ success: false, error: 'Failed to check achievements' }, 500);
  }
});

/**
 * GET /profile/:userId - Get gamification profile for a user
 */
app.get('/profile/:userId', requireAuth, async (c) => {
  try {
    const profile = await getProfile(c.req.param('userId'));
    if (!profile) return c.json({ success: false, error: 'Profile not found' }, 404);
    return c.json({ success: true, data: profile });
  } catch (error) {
    log.error({ error }, 'Failed to get profile');
    return c.json({ success: false, error: 'Failed to get profile' }, 500);
  }
});

/**
 * GET /leaderboard - Get global gamification leaderboard
 */
app.get('/leaderboard', requireAuth, async (c) => {
  try {
    const period = c.req.query('period') || 'monthly';
    const leaderboard = await getLeaderboard(period);
    return c.json({ success: true, data: leaderboard });
  } catch (error) {
    log.error({ error }, 'Failed to get leaderboard');
    return c.json({ success: false, error: 'Failed to get leaderboard' }, 500);
  }
});

/**
 * GET /leaderboard/:repositoryId - Get repository-specific leaderboard
 */
app.get('/leaderboard/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const period = c.req.query('period') || 'monthly';
    const leaderboard = await getLeaderboard(period, c.req.param('repositoryId'));
    return c.json({ success: true, data: leaderboard });
  } catch (error) {
    log.error({ error }, 'Failed to get repository leaderboard');
    return c.json({ success: false, error: 'Failed to get repository leaderboard' }, 500);
  }
});

export { app as docGamificationRoutes };
