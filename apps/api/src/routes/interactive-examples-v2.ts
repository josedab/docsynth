/**
 * Interactive Code Examples V2 Routes
 *
 * API endpoints for live, executable code examples in documentation.
 */

import { Hono } from 'hono';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  generateExamplesFromDocument,
  validateExamples,
  getDocumentExamples,
  getExampleExecutions,
  recordExecution,
  type ExecutionResult,
} from '../services/interactive-examples-v2.service.js';

const log = createLogger('interactive-examples-v2-routes');

const app = new Hono();

/**
 * POST /generate - Generate examples from a document
 */
app.post('/generate', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ documentId: string; repositoryId: string }>();

  if (!body.documentId || !body.repositoryId) {
    return c.json({ success: false, error: 'documentId and repositoryId are required' }, 400);
  }

  try {
    const examples = await generateExamplesFromDocument(body.documentId, body.repositoryId);
    return c.json({ success: true, data: examples });
  } catch (error) {
    log.error({ error }, 'Example generation failed');
    return c.json({ success: false, error: 'Generation failed' }, 500);
  }
});

/**
 * POST /validate - Validate all examples for a repository (queued)
 */
app.post('/validate', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  const job = await addJob(QUEUE_NAMES.INTERACTIVE_EXAMPLE_V2, {
    repositoryId: body.repositoryId,
    action: 'validate' as const,
  });

  return c.json({ success: true, data: { jobId: job.id, message: 'Validation queued' } });
});

/**
 * POST /validate/sync - Validate synchronously (small repos)
 */
app.post('/validate/sync', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string }>();

  try {
    const result = await validateExamples(body.repositoryId);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Validation failed');
    return c.json({ success: false, error: 'Validation failed' }, 500);
  }
});

/**
 * GET /document/:documentId - Get examples for a document
 */
app.get('/document/:documentId', requireAuth, async (c) => {
  const examples = await getDocumentExamples(c.req.param('documentId'));
  return c.json({ success: true, data: examples });
});

/**
 * GET /executions/:exampleId - Get execution history
 */
app.get('/executions/:exampleId', requireAuth, async (c) => {
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const executions = await getExampleExecutions(c.req.param('exampleId'), limit);
  return c.json({ success: true, data: executions });
});

/**
 * POST /execute/:exampleId - Record an execution result
 */
app.post('/execute/:exampleId', requireAuth, async (c) => {
  const body = await c.req.json<ExecutionResult>();

  try {
    await recordExecution(c.req.param('exampleId'), body);
    return c.json({ success: true });
  } catch (error) {
    log.error({ error }, 'Failed to record execution');
    return c.json({ success: false, error: 'Recording failed' }, 500);
  }
});

export { app as interactiveExamplesV2Routes };
