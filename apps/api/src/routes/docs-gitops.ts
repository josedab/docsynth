/**
 * Docs GitOps Routes
 *
 * API endpoints for GitOps-driven documentation workflows including
 * config management, change planning, plan application, and drift detection.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  parseConfig,
  planDocChanges,
  detectDrift,
  getConfig,
  updateConfig,
} from '../services/docs-gitops.service.js';

const log = createLogger('docs-gitops-routes');
const app = new Hono();

/**
 * POST /plan - Plan documentation changes based on GitOps config
 */
app.post('/plan', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ repositoryId: string; branch?: string }>();

    if (!body.repositoryId) {
      return c.json({ success: false, error: 'repositoryId is required' }, 400);
    }

    const plan = await planDocChanges(body.repositoryId, body.branch);
    return c.json({ success: true, data: plan });
  } catch (error) {
    log.error({ error }, 'Failed to plan doc changes');
    return c.json({ success: false, error: 'Failed to plan doc changes' }, 500);
  }
});

/**
 * POST /apply - Apply a planned set of documentation changes
 */
app.post('/apply', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ repositoryId: string; planId: string }>();

    if (!body.repositoryId || !body.planId) {
      return c.json({ success: false, error: 'repositoryId and planId are required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.DOCS_GITOPS, {
      repositoryId: body.repositoryId,
      planId: body.planId,
      action: 'apply' as const,
    });

    return c.json({ success: true, data: { jobId: job.id, message: 'Plan apply queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to apply plan');
    return c.json({ success: false, error: 'Failed to apply plan' }, 500);
  }
});

/**
 * POST /drift - Detect drift between docs and source
 */
app.post('/drift', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ repositoryId: string }>();

    if (!body.repositoryId) {
      return c.json({ success: false, error: 'repositoryId is required' }, 400);
    }

    const drift = await detectDrift(body.repositoryId);
    return c.json({ success: true, data: drift });
  } catch (error) {
    log.error({ error }, 'Failed to detect drift');
    return c.json({ success: false, error: 'Failed to detect drift' }, 500);
  }
});

/**
 * GET /config/:repositoryId - Get GitOps config for a repository
 */
app.get('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const config = await getConfig(c.req.param('repositoryId'));
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error }, 'Failed to get config');
    return c.json({ success: false, error: 'Failed to get config' }, 500);
  }
});

/**
 * POST /config - Create or update GitOps config
 */
app.post('/config', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ repositoryId: string; config: Record<string, unknown> }>();

    if (!body.repositoryId || !body.config) {
      return c.json({ success: false, error: 'repositoryId and config are required' }, 400);
    }

    const config = await updateConfig(body.repositoryId, body.config);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error }, 'Failed to update config');
    return c.json({ success: false, error: 'Failed to update config' }, 500);
  }
});

/**
 * POST /validate - Validate a GitOps config without saving
 */
app.post('/validate', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ content: string }>();

    if (!body.content) {
      return c.json({ success: false, error: 'content is required' }, 400);
    }

    const result = await parseConfig(body.content);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to validate config');
    return c.json({ success: false, error: 'Failed to validate config' }, 500);
  }
});

export { app as docsGitOpsRoutes };
