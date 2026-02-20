/**
 * Onboarding Intelligence Routes
 *
 * API endpoints for tracking developer onboarding events, computing
 * optimal learning paths, and providing manager dashboards.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  trackOnboardingEvent,
  computeOptimalPath,
  getManagerDashboard,
} from '../services/onboarding-intelligence.service.js';

const log = createLogger('onboarding-intelligence-routes');
const app = new Hono();

/**
 * POST /track - Track an onboarding event
 */
app.post('/track', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      eventType: string;
      repositoryId: string;
      userId: string;
      metadata?: Record<string, unknown>;
    }>();

    if (!body.eventType || !body.repositoryId || !body.userId) {
      return c.json(
        { success: false, error: 'eventType, repositoryId, and userId are required' },
        400
      );
    }

    const result = await trackOnboardingEvent(
      body.eventType,
      body.repositoryId,
      body.userId,
      body.metadata
    );
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to track onboarding event');
    return c.json({ success: false, error: 'Failed to track onboarding event' }, 500);
  }
});

/**
 * POST /optimal-path - Compute optimal onboarding path
 */
app.post('/optimal-path', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      userId: string;
      role?: string;
      experience?: string;
    }>();

    if (!body.repositoryId || !body.userId) {
      return c.json({ success: false, error: 'repositoryId and userId are required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.ONBOARDING_INTELLIGENCE, {
      repositoryId: body.repositoryId,
      userId: body.userId,
      role: body.role,
      experience: body.experience,
    });

    const path = await computeOptimalPath(
      body.repositoryId,
      body.userId,
      body.role,
      body.experience
    );
    return c.json({ success: true, data: { jobId: job.id, path } });
  } catch (error) {
    log.error({ error }, 'Failed to compute optimal path');
    return c.json({ success: false, error: 'Failed to compute optimal path' }, 500);
  }
});

/**
 * GET /dashboard/:repositoryId - Get onboarding manager dashboard
 */
app.get('/dashboard/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const dashboard = await getManagerDashboard(repositoryId);
    return c.json({ success: true, data: dashboard });
  } catch (error) {
    log.error({ error }, 'Failed to get manager dashboard');
    return c.json({ success: false, error: 'Failed to get manager dashboard' }, 500);
  }
});

export { app as onboardingIntelligenceRoutes };
