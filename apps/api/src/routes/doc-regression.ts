/**
 * Doc Regression Routes
 *
 * API endpoints for documentation regression testing including assertion runs,
 * suite validation, test history, and formatted output for CI/CD integrations.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  runAssertions,
  validateSuite,
  getDefaultSuite,
  getTestHistory,
  formatJUnitXML,
  formatGitHubComment,
} from '../services/doc-regression.service.js';

const log = createLogger('doc-regression-routes');
const app = new Hono();

/**
 * POST /run - Run regression assertions synchronously
 */
app.post('/run', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      suite?: object;
      format?: string;
    }>();

    if (!body.repositoryId) {
      return c.json({ success: false, error: 'repositoryId is required' }, 400);
    }

    const results = await runAssertions(body.repositoryId, body.suite);

    if (body.format === 'junit') {
      const xml = formatJUnitXML(results);
      return c.json({ success: true, data: { results, junit: xml } });
    }

    if (body.format === 'github-comment') {
      const comment = formatGitHubComment(results);
      return c.json({ success: true, data: { results, comment } });
    }

    return c.json({ success: true, data: results });
  } catch (error) {
    log.error({ error }, 'Failed to run assertions');
    return c.json({ success: false, error: 'Failed to run assertions' }, 500);
  }
});

/**
 * POST /validate - Validate a test suite definition
 */
app.post('/validate', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{ suite: object }>();

    if (!body.suite) {
      return c.json({ success: false, error: 'suite is required' }, 400);
    }

    const validation = await validateSuite(body.suite);
    return c.json({ success: true, data: validation });
  } catch (error) {
    log.error({ error }, 'Failed to validate suite');
    return c.json({ success: false, error: 'Failed to validate suite' }, 500);
  }
});

/**
 * GET /suite/:repositoryId - Get the default test suite for a repository
 */
app.get('/suite/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const suite = await getDefaultSuite(repositoryId);
    return c.json({ success: true, data: suite });
  } catch (error) {
    log.error({ error }, 'Failed to get default suite');
    return c.json({ success: false, error: 'Failed to get default suite' }, 500);
  }
});

/**
 * GET /history/:repositoryId - Get regression test history
 */
app.get('/history/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const limit = parseInt(c.req.query('limit') || '20', 10);

    const history = await getTestHistory(repositoryId, limit);
    return c.json({ success: true, data: history });
  } catch (error) {
    log.error({ error }, 'Failed to get test history');
    return c.json({ success: false, error: 'Failed to get test history' }, 500);
  }
});

/**
 * POST /run/async - Queue a regression test run
 */
app.post('/run/async', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      installationId: number;
      suite?: object;
    }>();

    if (!body.repositoryId || !body.installationId) {
      return c.json({ success: false, error: 'repositoryId and installationId are required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.DOC_REGRESSION, {
      repositoryId: body.repositoryId,
      action: 'run',
      installationId: body.installationId,
    });

    log.info({ repositoryId: body.repositoryId, jobId: job.id }, 'Regression test run queued');
    return c.json({
      success: true,
      data: { jobId: job.id, message: 'Regression test run queued' },
    });
  } catch (error) {
    log.error({ error }, 'Failed to queue regression run');
    return c.json({ success: false, error: 'Failed to queue regression run' }, 500);
  }
});

export { app as docRegressionRoutes };
