/**
 * Doc A/B Testing Routes
 *
 * API endpoints for running A/B tests on documentation content including
 * experiment management, variant assignment, and outcome tracking.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  createExperiment,
  assignVariant,
  recordOutcome,
  computeResults,
  getExperiments,
} from '../services/doc-ab-testing.service.js';

const log = createLogger('doc-ab-testing-routes');
const app = new Hono();

/**
 * POST /experiment - Create a new A/B test experiment
 */
app.post('/experiment', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      name: string;
      variants: Array<{ name: string; content: string }>;
    }>();

    if (!body.repositoryId || !body.name || !body.variants) {
      return c.json(
        { success: false, error: 'repositoryId, name, and variants are required' },
        400
      );
    }

    const experiment = await createExperiment(body.repositoryId, body.name, body.variants);
    return c.json({ success: true, data: experiment });
  } catch (error) {
    log.error({ error }, 'Failed to create experiment');
    return c.json({ success: false, error: 'Failed to create experiment' }, 500);
  }
});

/**
 * POST /experiment/:experimentId/start - Start an experiment
 */
app.post('/experiment/:experimentId/start', requireAuth, requireOrgAccess, async (c) => {
  try {
    const experimentId = c.req.param('experimentId');

    const job = await addJob(QUEUE_NAMES.DOC_AB_TESTING, {
      experimentId,
      action: 'start' as const,
    });

    return c.json({ success: true, data: { jobId: job.id, message: 'Experiment start queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to start experiment');
    return c.json({ success: false, error: 'Failed to start experiment' }, 500);
  }
});

/**
 * POST /assign - Assign a variant to a visitor
 */
app.post('/assign', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{ experimentId: string; visitorId: string }>();

    if (!body.experimentId || !body.visitorId) {
      return c.json({ success: false, error: 'experimentId and visitorId are required' }, 400);
    }

    const assignment = await assignVariant(body.experimentId, body.visitorId);
    return c.json({ success: true, data: assignment });
  } catch (error) {
    log.error({ error }, 'Failed to assign variant');
    return c.json({ success: false, error: 'Failed to assign variant' }, 500);
  }
});

/**
 * POST /outcome - Record an experiment outcome
 */
app.post('/outcome', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      experimentId: string;
      visitorId: string;
      outcome: string;
      value?: number;
    }>();

    if (!body.experimentId || !body.visitorId || !body.outcome) {
      return c.json(
        { success: false, error: 'experimentId, visitorId, and outcome are required' },
        400
      );
    }

    const result = await recordOutcome(body.experimentId, body.visitorId, body.outcome, body.value);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to record outcome');
    return c.json({ success: false, error: 'Failed to record outcome' }, 500);
  }
});

/**
 * GET /results/:experimentId - Get computed results for an experiment
 */
app.get('/results/:experimentId', requireAuth, async (c) => {
  try {
    const results = await computeResults(c.req.param('experimentId'));
    return c.json({ success: true, data: results });
  } catch (error) {
    log.error({ error }, 'Failed to compute results');
    return c.json({ success: false, error: 'Failed to compute results' }, 500);
  }
});

/**
 * GET /experiments/:repositoryId - List experiments for a repository
 */
app.get('/experiments/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const experiments = await getExperiments(c.req.param('repositoryId'));
    return c.json({ success: true, data: experiments });
  } catch (error) {
    log.error({ error }, 'Failed to get experiments');
    return c.json({ success: false, error: 'Failed to get experiments' }, 500);
  }
});

export { app as docABTestingRoutes };
