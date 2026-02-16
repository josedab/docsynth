/**
 * Doc-Driven Development Mode Routes
 *
 * API endpoints for spec-first development: parse docs, generate code.
 */

import { Hono } from 'hono';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  parseDocSpec,
  generateArtifacts,
  getSpecWithArtifacts,
  listSpecs,
} from '../services/doc-driven-dev.service.js';

const log = createLogger('doc-driven-dev-routes');

const app = new Hono();

/**
 * POST /parse - Parse a document to extract specs
 */
app.post('/parse', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ documentId: string; repositoryId: string }>();

  if (!body.documentId || !body.repositoryId) {
    return c.json({ success: false, error: 'documentId and repositoryId are required' }, 400);
  }

  try {
    const spec = await parseDocSpec(body.documentId, body.repositoryId);
    return c.json({ success: true, data: spec });
  } catch (error) {
    log.error({ error }, 'Spec parsing failed');
    return c.json({ success: false, error: 'Parsing failed' }, 500);
  }
});

/**
 * POST /generate - Generate code artifacts from a spec
 */
app.post('/generate', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    specId: string;
    targetLanguage: string;
    generateTests?: boolean;
    async?: boolean;
  }>();

  if (!body.specId || !body.targetLanguage) {
    return c.json({ success: false, error: 'specId and targetLanguage are required' }, 400);
  }

  if (body.async) {
    const job = await addJob(QUEUE_NAMES.DOC_DRIVEN_DEV, {
      repositoryId: '', // Will be resolved from spec
      documentId: body.specId,
      targetLanguage: body.targetLanguage,
      generateTests: body.generateTests ?? true,
    });
    return c.json({ success: true, data: { jobId: job.id, message: 'Code generation queued' } });
  }

  try {
    const artifacts = await generateArtifacts(
      body.specId,
      body.targetLanguage,
      body.generateTests ?? true
    );
    return c.json({ success: true, data: artifacts });
  } catch (error) {
    log.error({ error }, 'Code generation failed');
    return c.json({ success: false, error: 'Generation failed' }, 500);
  }
});

/**
 * GET /spec/:specId - Get spec with generated artifacts
 */
app.get('/spec/:specId', requireAuth, async (c) => {
  const result = await getSpecWithArtifacts(c.req.param('specId'));
  if (!result) return c.json({ success: false, error: 'Spec not found' }, 404);
  return c.json({ success: true, data: result });
});

/**
 * GET /specs/:repositoryId - List specs for a repository
 */
app.get('/specs/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const specs = await listSpecs(c.req.param('repositoryId'));
  return c.json({ success: true, data: specs });
});

export { app as docDrivenDevRoutes };
