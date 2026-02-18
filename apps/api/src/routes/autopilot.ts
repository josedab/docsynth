/**
 * Documentation Autopilot Routes
 *
 * Zero-config documentation baseline generation endpoints.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  analyzeRepository,
  getAutopilotStatus,
  getAutopilotConfig,
  updateAutopilotConfig,
} from '../services/autopilot.service.js';

const log = createLogger('autopilot-routes');
const app = new Hono();

app.post('/analyze', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    depth?: 'shallow' | 'deep';
    includePatterns?: string[];
    excludePatterns?: string[];
  }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  try {
    await addJob(QUEUE_NAMES.DOC_AUTOPILOT, {
      repositoryId: body.repositoryId,
      action: 'analyze' as const,
      options: {
        depth: body.depth ?? 'shallow',
        includePatterns: body.includePatterns,
        excludePatterns: body.excludePatterns,
      },
    });

    log.info({ repositoryId: body.repositoryId }, 'Autopilot analysis queued');

    return c.json({
      success: true,
      data: { message: 'Repository analysis queued', repositoryId: body.repositoryId },
    });
  } catch (error) {
    log.error({ error, repositoryId: body.repositoryId }, 'Failed to queue autopilot analysis');
    return c.json({ success: false, error: 'Failed to queue analysis' }, 500);
  }
});

app.post('/analyze/sync', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string; depth?: 'shallow' | 'deep' }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  try {
    const analysis = await analyzeRepository(body.repositoryId, { depth: body.depth ?? 'shallow' });
    return c.json({ success: true, data: analysis });
  } catch (error) {
    log.error({ error, repositoryId: body.repositoryId }, 'Failed to analyze repository');
    return c.json(
      {
        success: false,
        error: 'Failed to analyze repository',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

app.post('/generate', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  try {
    await addJob(QUEUE_NAMES.DOC_AUTOPILOT, {
      repositoryId: body.repositoryId,
      action: 'generate-baseline' as const,
    });

    return c.json({
      success: true,
      data: { message: 'Baseline generation queued', repositoryId: body.repositoryId },
    });
  } catch (error) {
    log.error({ error }, 'Failed to queue baseline generation');
    return c.json({ success: false, error: 'Failed to queue generation' }, 500);
  }
});

app.get('/status/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  try {
    const status = await getAutopilotStatus(repositoryId);
    return c.json({ success: true, data: status });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get autopilot status');
    return c.json({ success: false, error: 'Failed to get status' }, 500);
  }
});

app.get('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  try {
    const config = await getAutopilotConfig(repositoryId);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get autopilot config');
    return c.json({ success: false, error: 'Failed to get config' }, 500);
  }
});

app.post('/config', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    observationDays?: number;
    autoGenerate?: boolean;
  }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  try {
    const config = await updateAutopilotConfig(body.repositoryId, body);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error }, 'Failed to update autopilot config');
    return c.json({ success: false, error: 'Failed to update config' }, 500);
  }
});

export { app as autopilotRoutes };
