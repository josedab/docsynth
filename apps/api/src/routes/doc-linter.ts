/**
 * Doc Linter Routes
 *
 * API endpoints for AI-powered documentation linting.
 */

import { Hono } from 'hono';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  lintContent,
  lintPullRequest,
  getAvailableRules,
  getRepositoryLintConfig,
  updateRepositoryLintConfig,
} from '../services/doc-linter.service.js';
import type { LintConfig } from '@docsynth/lint';

const app = new Hono();

/**
 * Lint provided content
 * POST /lint
 */
app.post('/lint', requireAuth, async (c) => {
  const body = await c.req.json<{
    content: string;
    filePath: string;
    config?: Partial<LintConfig>;
  }>();

  if (!body.content || !body.filePath) {
    return c.json({ success: false, error: 'content and filePath are required' }, 400);
  }

  const result = await lintContent(body.content, body.filePath, body.config);

  return c.json({ success: true, data: result });
});

/**
 * Lint all doc files changed in a PR
 * POST /lint-pr
 */
app.post('/lint-pr', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    prNumber: number;
    installationId: string;
  }>();

  if (!body.repositoryId || !body.prNumber || !body.installationId) {
    return c.json(
      { success: false, error: 'repositoryId, prNumber, and installationId are required' },
      400
    );
  }

  // Queue a background lint job
  await addJob(QUEUE_NAMES.DOC_LINT, {
    repositoryId: body.repositoryId,
    prNumber: body.prNumber,
    installationId: body.installationId,
  });

  // Also run inline for immediate feedback
  const result = await lintPullRequest(body.repositoryId, body.prNumber, body.installationId);

  return c.json({ success: true, data: result }, 201);
});

/**
 * List all available lint rules
 * GET /rules
 */
app.get('/rules', async (c) => {
  const rules = getAvailableRules();
  return c.json({ success: true, data: rules });
});

/**
 * Get lint config for a repository
 * GET /config/:repositoryId
 */
app.get('/config/:repositoryId', requireAuth, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const config = await getRepositoryLintConfig(repositoryId);
  return c.json({ success: true, data: config });
});

/**
 * Update lint config for a repository
 * PUT /config/:repositoryId
 */
app.put('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const body = await c.req.json<Partial<LintConfig>>();
  const config = await updateRepositoryLintConfig(repositoryId, body);
  return c.json({ success: true, data: config });
});

export { app as docLinterRoutes };
