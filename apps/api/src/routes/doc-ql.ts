/**
 * Doc QL Routes
 *
 * API endpoints for a documentation query language that enables structured
 * queries, validation, alerting, and suggested queries across documentation.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  executeQuery,
  validateQuery,
  createAlert,
  listAlerts,
  deleteAlert,
  getSuggestedQueries,
} from '../services/doc-ql.service.js';

const log = createLogger('doc-ql-routes');
const app = new Hono();

/**
 * POST /query - Execute a DocQL query
 */
app.post('/query', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      query: string;
      params?: Record<string, unknown>;
    }>();

    if (!body.repositoryId || !body.query) {
      return c.json({ success: false, error: 'repositoryId and query are required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.DOC_QL, {
      repositoryId: body.repositoryId,
      action: 'query',
      query: body.query,
    });

    const result = await executeQuery(body.repositoryId, body.query, body.params);

    log.info({ repositoryId: body.repositoryId, jobId: job.id }, 'DocQL query executed');
    return c.json({ success: true, data: { jobId: job.id, result } });
  } catch (error) {
    log.error({ error }, 'Failed to execute query');
    return c.json({ success: false, error: 'Failed to execute query' }, 500);
  }
});

/**
 * POST /validate - Validate a DocQL query without executing
 */
app.post('/validate', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{ query: string }>();

    if (!body.query) {
      return c.json({ success: false, error: 'query is required' }, 400);
    }

    const validation = await validateQuery(body.query);
    return c.json({ success: true, data: validation });
  } catch (error) {
    log.error({ error }, 'Failed to validate query');
    return c.json({ success: false, error: 'Failed to validate query' }, 500);
  }
});

/**
 * POST /alert - Create a DocQL alert
 */
app.post('/alert', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      organizationId: string;
      name: string;
      query: string;
      schedule: string;
    }>();

    if (!body.organizationId || !body.name || !body.query || !body.schedule) {
      return c.json(
        { success: false, error: 'organizationId, name, query, and schedule are required' },
        400
      );
    }

    const alert = await createAlert(body.organizationId, body.name, body.query, body.schedule);
    log.info({ organizationId: body.organizationId, alertName: body.name }, 'DocQL alert created');
    return c.json({ success: true, data: alert });
  } catch (error) {
    log.error({ error }, 'Failed to create alert');
    return c.json({ success: false, error: 'Failed to create alert' }, 500);
  }
});

/**
 * GET /alerts/:organizationId - List alerts for an organization
 */
app.get('/alerts/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const organizationId = c.req.param('organizationId');
    const alerts = await listAlerts(organizationId);
    return c.json({ success: true, data: alerts });
  } catch (error) {
    log.error({ error }, 'Failed to list alerts');
    return c.json({ success: false, error: 'Failed to list alerts' }, 500);
  }
});

/**
 * DELETE /alert/:alertId - Delete an alert
 */
app.delete('/alert/:alertId', requireAuth, async (c) => {
  try {
    const alertId = c.req.param('alertId');
    await deleteAlert(alertId);
    log.info({ alertId }, 'DocQL alert deleted');
    return c.json({ success: true, data: { deleted: true } });
  } catch (error) {
    log.error({ error }, 'Failed to delete alert');
    return c.json({ success: false, error: 'Failed to delete alert' }, 500);
  }
});

/**
 * GET /suggestions - Get suggested queries
 */
app.get('/suggestions', requireAuth, async (c) => {
  try {
    const repositoryId = c.req.query('repositoryId');
    const suggestions = await getSuggestedQueries(repositoryId);
    return c.json({ success: true, data: suggestions });
  } catch (error) {
    log.error({ error }, 'Failed to get suggested queries');
    return c.json({ success: false, error: 'Failed to get suggested queries' }, 500);
  }
});

export { app as docQLRoutes };
