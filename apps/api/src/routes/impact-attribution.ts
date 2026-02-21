/**
 * Impact Attribution Routes
 *
 * API endpoints for correlating documentation changes with business outcomes,
 * generating impact reports, predicting impact, and ingesting ticket data.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  correlateDocImpact,
  predictDocImpact,
  ingestTicketData,
  getImpactTrends,
} from '../services/impact-attribution.service.js';

const log = createLogger('impact-attribution-routes');
const app = new Hono();

/**
 * POST /correlate - Correlate documentation changes with business outcomes
 */
app.post('/correlate', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ repositoryId: string; timeRange?: string }>();

    if (!body.repositoryId) {
      return c.json({ success: false, error: 'repositoryId is required' }, 400);
    }

    const result = await correlateDocImpact(body.repositoryId, body.timeRange);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to correlate doc impact');
    return c.json({ success: false, error: 'Failed to correlate doc impact' }, 500);
  }
});

/**
 * POST /report - Generate an impact attribution report
 */
app.post('/report', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ repositoryId: string; format?: string }>();

    if (!body.repositoryId) {
      return c.json({ success: false, error: 'repositoryId is required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.IMPACT_ATTRIBUTION, {
      repositoryId: body.repositoryId,
      action: 'report' as const,
      format: body.format,
    });

    return c.json({ success: true, data: { jobId: job.id, message: 'Impact report queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to generate impact report');
    return c.json({ success: false, error: 'Failed to generate impact report' }, 500);
  }
});

/**
 * POST /predict - Predict the impact of proposed documentation changes
 */
app.post('/predict', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      changes: Array<{ path: string; type: string }>;
    }>();

    if (!body.repositoryId || !body.changes) {
      return c.json({ success: false, error: 'repositoryId and changes are required' }, 400);
    }

    const prediction = await predictDocImpact(body.repositoryId, body.changes);
    return c.json({ success: true, data: prediction });
  } catch (error) {
    log.error({ error }, 'Failed to predict doc impact');
    return c.json({ success: false, error: 'Failed to predict doc impact' }, 500);
  }
});

/**
 * POST /ingest-tickets - Ingest ticket/support data for correlation
 */
app.post('/ingest-tickets', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ organizationId: string; source: string; tickets: unknown[] }>();

    if (!body.organizationId || !body.tickets) {
      return c.json({ success: false, error: 'organizationId and tickets are required' }, 400);
    }

    const result = await ingestTicketData(body.organizationId, body.source, body.tickets);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to ingest ticket data');
    return c.json({ success: false, error: 'Failed to ingest ticket data' }, 500);
  }
});

/**
 * GET /trends/:organizationId - Get impact trends over time
 */
app.get('/trends/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const days = parseInt(c.req.query('days') || '30', 10);
    const trends = await getImpactTrends(c.req.param('organizationId'), days);
    return c.json({ success: true, data: trends });
  } catch (error) {
    log.error({ error }, 'Failed to get impact trends');
    return c.json({ success: false, error: 'Failed to get impact trends' }, 500);
  }
});

export { app as impactAttributionRoutes };
