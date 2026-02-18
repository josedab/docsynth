/**
 * Doc Tests Runtime Routes
 *
 * Extract and execute code examples from documentation.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  extractCodeBlocks,
  executeCodeBlocks,
  autoFixFailedBlocks,
  getTestHistory,
} from '../services/doc-tests-runtime.service.js';

const log = createLogger('doc-tests-runtime-routes');
const app = new Hono();

app.post('/extract', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string; documentId?: string }>();
  if (!body.repositoryId) return c.json({ success: false, error: 'repositoryId is required' }, 400);

  try {
    const blocks = await extractCodeBlocks(body.repositoryId, body.documentId);
    return c.json({ success: true, data: { blocks, count: blocks.length } });
  } catch (error) {
    log.error({ error }, 'Failed to extract code blocks');
    return c.json({ success: false, error: 'Failed to extract code blocks' }, 500);
  }
});

app.post('/execute', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string; documentId?: string; timeout?: number }>();
  if (!body.repositoryId) return c.json({ success: false, error: 'repositoryId is required' }, 400);

  try {
    const blocks = await extractCodeBlocks(body.repositoryId, body.documentId);
    const report = await executeCodeBlocks(body.repositoryId, blocks, { timeout: body.timeout });
    return c.json({ success: true, data: report });
  } catch (error) {
    log.error({ error }, 'Failed to execute doc tests');
    return c.json({ success: false, error: 'Failed to execute tests' }, 500);
  }
});

app.post('/execute/async', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string; documentId?: string }>();
  if (!body.repositoryId) return c.json({ success: false, error: 'repositoryId is required' }, 400);

  try {
    await addJob(QUEUE_NAMES.DOC_TESTS_RUNTIME, {
      repositoryId: body.repositoryId,
      documentId: body.documentId,
      action: 'execute' as const,
    });
    return c.json({ success: true, data: { message: 'Doc test execution queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to queue doc tests');
    return c.json({ success: false, error: 'Failed to queue tests' }, 500);
  }
});

app.post('/auto-fix', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string; documentId?: string }>();
  if (!body.repositoryId) return c.json({ success: false, error: 'repositoryId is required' }, 400);

  try {
    const blocks = await extractCodeBlocks(body.repositoryId, body.documentId);
    const report = await executeCodeBlocks(body.repositoryId, blocks);
    const fixes = await autoFixFailedBlocks(report.results, blocks);
    return c.json({ success: true, data: { report, fixes } });
  } catch (error) {
    log.error({ error }, 'Failed to auto-fix');
    return c.json({ success: false, error: 'Failed to auto-fix' }, 500);
  }
});

app.get('/history/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const limit = parseInt(c.req.query('limit') || '10', 10);

  try {
    const history = await getTestHistory(repositoryId, limit);
    return c.json({ success: true, data: history });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get test history');
    return c.json({ success: false, error: 'Failed to get history' }, 500);
  }
});

export { app as docTestsRuntimeRoutes };
