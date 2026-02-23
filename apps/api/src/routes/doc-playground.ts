/**
 * Doc Playground Routes
 *
 * API endpoints for extracting, creating, executing, and managing
 * interactive documentation playgrounds.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  extractExamples,
  createPlayground,
  executePlayground,
  getPlayground,
  listPlaygrounds,
} from '../services/doc-playground.service.js';

const log = createLogger('doc-playground-routes');
const app = new Hono();

/**
 * POST /extract - Extract code examples from documentation
 */
app.post('/extract', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      filePath: string;
      content?: string;
    }>();

    if (!body.repositoryId || !body.filePath) {
      return c.json({ success: false, error: 'repositoryId and filePath are required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.DOC_PLAYGROUND, {
      repositoryId: body.repositoryId,
      action: 'extract',
      filePath: body.filePath,
    });

    const examples = await extractExamples(body.repositoryId, body.filePath, body.content);

    log.info({ repositoryId: body.repositoryId, jobId: job.id }, 'Examples extracted');
    return c.json({ success: true, data: { jobId: job.id, examples } });
  } catch (error) {
    log.error({ error }, 'Failed to extract examples');
    return c.json({ success: false, error: 'Failed to extract examples' }, 500);
  }
});

/**
 * POST /create - Create a new playground
 */
app.post('/create', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      name: string;
      language: string;
      code: string;
      dependencies?: Record<string, string>;
    }>();

    if (!body.repositoryId || !body.name || !body.language || !body.code) {
      return c.json(
        { success: false, error: 'repositoryId, name, language, and code are required' },
        400
      );
    }

    const playground = await createPlayground(
      body.repositoryId,
      body.name,
      body.language,
      body.code,
      body.dependencies
    );
    log.info({ repositoryId: body.repositoryId, playgroundName: body.name }, 'Playground created');
    return c.json({ success: true, data: playground });
  } catch (error) {
    log.error({ error }, 'Failed to create playground');
    return c.json({ success: false, error: 'Failed to create playground' }, 500);
  }
});

/**
 * POST /execute/:playgroundId - Execute a playground
 */
app.post('/execute/:playgroundId', requireAuth, async (c) => {
  try {
    const playgroundId = c.req.param('playgroundId');
    const body = await c.req.json<{ code?: string; inputs?: Record<string, unknown> }>();

    const result = await executePlayground(playgroundId, body.code, body.inputs);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to execute playground');
    return c.json({ success: false, error: 'Failed to execute playground' }, 500);
  }
});

/**
 * GET /playground/:playgroundId - Get a playground by ID
 */
app.get('/playground/:playgroundId', requireAuth, async (c) => {
  try {
    const playgroundId = c.req.param('playgroundId');
    const playground = await getPlayground(playgroundId);

    if (!playground) {
      return c.json({ success: false, error: 'Playground not found' }, 404);
    }

    return c.json({ success: true, data: playground });
  } catch (error) {
    log.error({ error }, 'Failed to get playground');
    return c.json({ success: false, error: 'Failed to get playground' }, 500);
  }
});

/**
 * GET /list/:repositoryId - List playgrounds for a repository
 */
app.get('/list/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const limit = parseInt(c.req.query('limit') || '20', 10);

    const playgrounds = await listPlaygrounds(repositoryId, limit);
    return c.json({ success: true, data: playgrounds });
  } catch (error) {
    log.error({ error }, 'Failed to list playgrounds');
    return c.json({ success: false, error: 'Failed to list playgrounds' }, 500);
  }
});

export { app as docPlaygroundRoutes };
