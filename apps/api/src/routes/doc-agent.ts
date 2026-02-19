/**
 * Doc Agent Routes
 *
 * API endpoints for the autonomous documentation agent that manages
 * full documentation generation cycles.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  executeAgentCycle,
  getPlanStatus,
  getAgentConfig,
  updateAgentConfig,
  getAgentHistory,
} from '../services/doc-agent.service.js';

const log = createLogger('doc-agent-routes');
const app = new Hono();

/**
 * POST /execute - Queue a full documentation generation cycle
 */
app.post('/execute', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      installationId: number;
      options?: Record<string, unknown>;
    }>();

    if (!body.repositoryId || !body.installationId) {
      return c.json({ success: false, error: 'repositoryId and installationId are required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.DOC_AGENT, {
      repositoryId: body.repositoryId,
      installationId: body.installationId,
      options: body.options,
    });

    return c.json({ success: true, data: { jobId: job.id, message: 'Agent cycle queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to queue agent cycle');
    return c.json({ success: false, error: 'Failed to queue agent cycle' }, 500);
  }
});

/**
 * POST /execute/sync - Execute a documentation cycle synchronously
 */
app.post('/execute/sync', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      installationId: number;
      options?: Record<string, unknown>;
    }>();

    if (!body.repositoryId || !body.installationId) {
      return c.json({ success: false, error: 'repositoryId and installationId are required' }, 400);
    }

    const result = await executeAgentCycle(body.repositoryId, body.installationId, body.options);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to execute agent cycle');
    return c.json({ success: false, error: 'Failed to execute agent cycle' }, 500);
  }
});

/**
 * GET /plan/:planId - Get the status of a documentation plan
 */
app.get('/plan/:planId', requireAuth, async (c) => {
  try {
    const planId = c.req.param('planId');
    const plan = await getPlanStatus(planId);

    if (!plan) {
      return c.json({ success: false, error: 'Plan not found' }, 404);
    }

    return c.json({ success: true, data: plan });
  } catch (error) {
    log.error({ error }, 'Failed to get plan status');
    return c.json({ success: false, error: 'Failed to get plan status' }, 500);
  }
});

/**
 * GET /config/:repositoryId - Get agent configuration for a repository
 */
app.get('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const config = await getAgentConfig(repositoryId);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error }, 'Failed to get agent config');
    return c.json({ success: false, error: 'Failed to get agent config' }, 500);
  }
});

/**
 * POST /config - Update agent configuration
 */
app.post('/config', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      config: Record<string, unknown>;
    }>();

    if (!body.repositoryId || !body.config) {
      return c.json({ success: false, error: 'repositoryId and config are required' }, 400);
    }

    const config = await updateAgentConfig(body.repositoryId, body.config);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error }, 'Failed to update agent config');
    return c.json({ success: false, error: 'Failed to update agent config' }, 500);
  }
});

/**
 * GET /history/:repositoryId - Get agent execution history
 */
app.get('/history/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const history = await getAgentHistory(repositoryId, limit);
    return c.json({ success: true, data: history });
  } catch (error) {
    log.error({ error }, 'Failed to get agent history');
    return c.json({ success: false, error: 'Failed to get agent history' }, 500);
  }
});

export { app as docAgentRoutes };
