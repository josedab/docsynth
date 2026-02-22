/**
 * Doc LSP Routes
 *
 * API endpoints for documentation Language Server Protocol features
 * including diagnostics, completions, reference resolution, and workspace indexing.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  diagnoseDocument,
  getCompletions,
  resolveReference,
  indexWorkspace,
} from '../services/doc-lsp.service.js';

const log = createLogger('doc-lsp-routes');
const app = new Hono();

/**
 * POST /diagnose - Run diagnostics on a document
 */
app.post('/diagnose', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      filePath: string;
      content: string;
    }>();

    if (!body.repositoryId || !body.filePath || !body.content) {
      return c.json(
        { success: false, error: 'repositoryId, filePath, and content are required' },
        400
      );
    }

    const diagnostics = await diagnoseDocument(body.repositoryId, body.filePath, body.content);
    return c.json({ success: true, data: diagnostics });
  } catch (error) {
    log.error({ error }, 'Failed to diagnose document');
    return c.json({ success: false, error: 'Failed to diagnose document' }, 500);
  }
});

/**
 * POST /completions - Get completions at a position
 */
app.post('/completions', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      filePath: string;
      content: string;
      position: { line: number; character: number };
    }>();

    if (!body.repositoryId || !body.filePath || !body.content || !body.position) {
      return c.json(
        { success: false, error: 'repositoryId, filePath, content, and position are required' },
        400
      );
    }

    const completions = await getCompletions(
      body.repositoryId,
      body.filePath,
      body.content,
      body.position
    );
    return c.json({ success: true, data: completions });
  } catch (error) {
    log.error({ error }, 'Failed to get completions');
    return c.json({ success: false, error: 'Failed to get completions' }, 500);
  }
});

/**
 * POST /resolve - Resolve a document reference
 */
app.post('/resolve', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      reference: string;
      context?: string;
    }>();

    if (!body.repositoryId || !body.reference) {
      return c.json({ success: false, error: 'repositoryId and reference are required' }, 400);
    }

    const resolved = await resolveReference(body.repositoryId, body.reference, body.context);
    return c.json({ success: true, data: resolved });
  } catch (error) {
    log.error({ error }, 'Failed to resolve reference');
    return c.json({ success: false, error: 'Failed to resolve reference' }, 500);
  }
});

/**
 * POST /index - Index a workspace for LSP features
 */
app.post('/index', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      installationId: number;
    }>();

    if (!body.repositoryId || !body.installationId) {
      return c.json({ success: false, error: 'repositoryId and installationId are required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.DOC_LSP, {
      repositoryId: body.repositoryId,
      action: 'index',
      installationId: body.installationId,
    });

    const result = await indexWorkspace(body.repositoryId, body.installationId);

    log.info({ repositoryId: body.repositoryId, jobId: job.id }, 'Workspace indexing started');
    return c.json({ success: true, data: { jobId: job.id, result } });
  } catch (error) {
    log.error({ error }, 'Failed to index workspace');
    return c.json({ success: false, error: 'Failed to index workspace' }, 500);
  }
});

/**
 * POST /symbols - Get symbols at a position in a document
 */
app.post('/symbols', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      filePath: string;
      content: string;
      position: { line: number; character: number };
    }>();

    if (!body.repositoryId || !body.filePath || !body.content || !body.position) {
      return c.json(
        { success: false, error: 'repositoryId, filePath, content, and position are required' },
        400
      );
    }

    const symbols = await getCompletions(
      body.repositoryId,
      body.filePath,
      body.content,
      body.position
    );
    return c.json({ success: true, data: symbols });
  } catch (error) {
    log.error({ error }, 'Failed to get symbols');
    return c.json({ success: false, error: 'Failed to get symbols' }, 500);
  }
});

export { app as docLSPRoutes };
