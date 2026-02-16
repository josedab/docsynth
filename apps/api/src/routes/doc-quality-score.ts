/**
 * Documentation Quality Score Routes
 *
 * API endpoints for AI-powered documentation quality scoring and leaderboards.
 */

import { Hono } from 'hono';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  scoreDocument,
  scoreRepository,
  getQualityLeaderboard,
  getDocumentQualityHistory,
} from '../services/doc-quality-score.service.js';

const log = createLogger('doc-quality-score-routes');

const app = new Hono();

/**
 * POST /score/document - Score a single document
 */
app.post('/score/document', requireAuth, async (c) => {
  const body = await c.req.json<{ documentId: string; repositoryId: string }>();

  if (!body.documentId || !body.repositoryId) {
    return c.json({ success: false, error: 'documentId and repositoryId are required' }, 400);
  }

  try {
    const score = await scoreDocument(body.documentId, body.repositoryId);
    return c.json({ success: true, data: score });
  } catch (error) {
    log.error({ error }, 'Failed to score document');
    return c.json({ success: false, error: 'Scoring failed' }, 500);
  }
});

/**
 * POST /score/repository - Score all documents in a repository (queued)
 */
app.post('/score/repository', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  const job = await addJob(QUEUE_NAMES.DOC_QUALITY_SCORE, {
    repositoryId: body.repositoryId,
    fullScan: true,
  });

  return c.json({ success: true, data: { jobId: job.id, message: 'Repository scoring queued' } });
});

/**
 * GET /history/:documentId - Get quality history for a document
 */
app.get('/history/:documentId', requireAuth, async (c) => {
  const limit = parseInt(c.req.query('limit') || '30', 10);
  const history = await getDocumentQualityHistory(c.req.param('documentId'), limit);
  return c.json({ success: true, data: history });
});

/**
 * GET /leaderboard/:organizationId - Get quality leaderboard
 */
app.get('/leaderboard/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  const period = c.req.query('period') || 'current';
  const leaderboard = await getQualityLeaderboard(c.req.param('organizationId'), period);
  return c.json({ success: true, data: leaderboard });
});

/**
 * POST /score/repository/sync - Score repository synchronously (small repos)
 */
app.post('/score/repository/sync', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  try {
    const scores = await scoreRepository(body.repositoryId);
    const avgScore =
      scores.length > 0 ? scores.reduce((s, r) => s + r.overallScore, 0) / scores.length : 0;

    return c.json({
      success: true,
      data: {
        documentsScored: scores.length,
        averageScore: Math.round(avgScore * 10) / 10,
        scores,
      },
    });
  } catch (error) {
    log.error({ error }, 'Failed to score repository');
    return c.json({ success: false, error: 'Repository scoring failed' }, 500);
  }
});

export { app as docQualityScoreRoutes };
