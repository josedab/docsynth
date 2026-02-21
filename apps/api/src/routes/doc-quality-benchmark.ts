/**
 * Doc Quality Benchmark Routes
 *
 * API endpoints for benchmarking documentation quality against standardized
 * suites, viewing leaderboards, and submitting external results.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  getDefaultSuite,
  listSuites,
  getLeaderboard,
  submitExternalResult,
} from '../services/doc-quality-benchmark.service.js';

const log = createLogger('doc-quality-benchmark-routes');
const app = new Hono();

/**
 * POST /evaluate - Evaluate a document against a benchmark suite
 */
app.post('/evaluate', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ repositoryId: string; documentId: string; suiteId?: string }>();

    if (!body.repositoryId || !body.documentId) {
      return c.json({ success: false, error: 'repositoryId and documentId are required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.DOC_QUALITY_BENCHMARK, {
      repositoryId: body.repositoryId,
      documentId: body.documentId,
      suiteId: body.suiteId,
    });

    return c.json({
      success: true,
      data: { jobId: job.id, message: 'Benchmark evaluation queued' },
    });
  } catch (error) {
    log.error({ error }, 'Failed to evaluate document');
    return c.json({ success: false, error: 'Failed to evaluate document' }, 500);
  }
});

/**
 * GET /suites - List available benchmark suites
 */
app.get('/suites', requireAuth, async (c) => {
  try {
    const suites = await listSuites();
    return c.json({ success: true, data: suites });
  } catch (error) {
    log.error({ error }, 'Failed to list suites');
    return c.json({ success: false, error: 'Failed to list suites' }, 500);
  }
});

/**
 * GET /suite/:suiteId - Get a specific benchmark suite
 */
app.get('/suite/:suiteId', requireAuth, async (c) => {
  try {
    const suite = await getDefaultSuite(c.req.param('suiteId'));
    if (!suite) return c.json({ success: false, error: 'Suite not found' }, 404);
    return c.json({ success: true, data: suite });
  } catch (error) {
    log.error({ error }, 'Failed to get suite');
    return c.json({ success: false, error: 'Failed to get suite' }, 500);
  }
});

/**
 * GET /leaderboard - Get the quality benchmark leaderboard
 */
app.get('/leaderboard', requireAuth, async (c) => {
  try {
    const period = c.req.query('period') || 'current';
    const leaderboard = await getLeaderboard(period);
    return c.json({ success: true, data: leaderboard });
  } catch (error) {
    log.error({ error }, 'Failed to get leaderboard');
    return c.json({ success: false, error: 'Failed to get leaderboard' }, 500);
  }
});

/**
 * POST /submit-external - Submit an external benchmark result
 */
app.post('/submit-external', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      suiteId: string;
      scores: Record<string, number>;
    }>();

    if (!body.repositoryId || !body.suiteId || !body.scores) {
      return c.json(
        { success: false, error: 'repositoryId, suiteId, and scores are required' },
        400
      );
    }

    const result = await submitExternalResult(body.repositoryId, body.suiteId, body.scores);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to submit external result');
    return c.json({ success: false, error: 'Failed to submit external result' }, 500);
  }
});

export { app as docQualityBenchmarkRoutes };
