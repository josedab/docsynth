/**
 * Doc Forecast Routes
 *
 * API endpoints for predicting documentation staleness, generating
 * proactive maintenance digests, and evaluating forecast accuracy.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  predict,
  generateDigest,
  getForecastHistory,
  evaluateAccuracy,
} from '../services/doc-forecast.service.js';

const log = createLogger('doc-forecast-routes');
const app = new Hono();

/**
 * POST /predict - Predict which docs will become stale
 */
app.post('/predict', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      horizonDays?: number;
    }>();

    if (!body.repositoryId) {
      return c.json({ success: false, error: 'repositoryId is required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.DOC_FORECAST, {
      repositoryId: body.repositoryId,
      action: 'predict',
    });

    const predictions = await predict(body.repositoryId, body.horizonDays);

    log.info({ repositoryId: body.repositoryId, jobId: job.id }, 'Forecast prediction started');
    return c.json({ success: true, data: { jobId: job.id, predictions } });
  } catch (error) {
    log.error({ error }, 'Failed to predict stale docs');
    return c.json({ success: false, error: 'Failed to predict stale docs' }, 500);
  }
});

/**
 * POST /digest - Generate a proactive maintenance digest
 */
app.post('/digest', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      format?: string;
    }>();

    if (!body.repositoryId) {
      return c.json({ success: false, error: 'repositoryId is required' }, 400);
    }

    const digest = await generateDigest(body.repositoryId, body.format);
    log.info({ repositoryId: body.repositoryId }, 'Forecast digest generated');
    return c.json({ success: true, data: digest });
  } catch (error) {
    log.error({ error }, 'Failed to generate digest');
    return c.json({ success: false, error: 'Failed to generate digest' }, 500);
  }
});

/**
 * GET /history/:repositoryId - Get forecast history
 */
app.get('/history/:repositoryId', requireAuth, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const limit = parseInt(c.req.query('limit') || '20', 10);

    const history = await getForecastHistory(repositoryId, limit);
    return c.json({ success: true, data: history });
  } catch (error) {
    log.error({ error }, 'Failed to get forecast history');
    return c.json({ success: false, error: 'Failed to get forecast history' }, 500);
  }
});

/**
 * GET /accuracy/:repositoryId - Evaluate forecast accuracy
 */
app.get('/accuracy/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const days = parseInt(c.req.query('days') || '90', 10);

    const accuracy = await evaluateAccuracy(repositoryId, days);
    return c.json({ success: true, data: accuracy });
  } catch (error) {
    log.error({ error }, 'Failed to evaluate accuracy');
    return c.json({ success: false, error: 'Failed to evaluate accuracy' }, 500);
  }
});

export { app as docForecastRoutes };
