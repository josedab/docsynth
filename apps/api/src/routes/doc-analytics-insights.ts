/**
 * Doc Analytics & Insights Routes
 *
 * API endpoints for tracking documentation usage events,
 * computing analytics insights, and generating recommendations.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  trackEvent,
  trackBatchEvents,
  computeInsights,
  getRecommendations,
} from '../services/doc-analytics-insights.service.js';

const log = createLogger('doc-analytics-insights-routes');
const app = new Hono();

/**
 * POST /track - Track a single documentation event
 */
app.post('/track', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      eventType: string;
      repositoryId: string;
      metadata?: Record<string, unknown>;
    }>();

    if (!body.eventType || !body.repositoryId) {
      return c.json({ success: false, error: 'eventType and repositoryId are required' }, 400);
    }

    const result = await trackEvent(body.eventType, body.repositoryId, body.metadata);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to track event');
    return c.json({ success: false, error: 'Failed to track event' }, 500);
  }
});

/**
 * POST /track/batch - Track multiple documentation events
 */
app.post('/track/batch', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      events: Array<{
        eventType: string;
        repositoryId: string;
        metadata?: Record<string, unknown>;
      }>;
    }>();

    if (!body.events?.length) {
      return c.json({ success: false, error: 'events array is required' }, 400);
    }

    const result = await trackBatchEvents(body.events);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to track batch events');
    return c.json({ success: false, error: 'Failed to track batch events' }, 500);
  }
});

/**
 * POST /insights - Compute analytics insights for a repository or organization
 */
app.post('/insights', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId?: string;
      organizationId?: string;
      timeRange?: { start: string; end: string };
    }>();

    if (!body.repositoryId && !body.organizationId) {
      return c.json({ success: false, error: 'repositoryId or organizationId is required' }, 400);
    }

    const insights = await computeInsights(body.repositoryId, body.organizationId, body.timeRange);
    return c.json({ success: true, data: insights });
  } catch (error) {
    log.error({ error }, 'Failed to compute insights');
    return c.json({ success: false, error: 'Failed to compute insights' }, 500);
  }
});

/**
 * POST /recommendations - Get actionable recommendations based on analytics
 */
app.post('/recommendations', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      context?: Record<string, unknown>;
    }>();

    if (!body.repositoryId) {
      return c.json({ success: false, error: 'repositoryId is required' }, 400);
    }

    const recommendations = await getRecommendations(body.repositoryId, body.context);
    return c.json({ success: true, data: recommendations });
  } catch (error) {
    log.error({ error }, 'Failed to get recommendations');
    return c.json({ success: false, error: 'Failed to get recommendations' }, 500);
  }
});

export { app as docAnalyticsInsightsRoutes };
