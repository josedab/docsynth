/**
 * Impact Scoring Routes
 *
 * API endpoints for enhanced documentation impact scoring for PRs.
 * Provides scoring, debt tracking, trends, and auto-trigger configuration.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  scoreChanges,
  getRecommendations,
  calculateDocDebt,
  getScoreTrends,
  getAutoTriggerConfig,
  updateAutoTriggerConfig,
  getWeeklyDigest,
  type ChangedFile,
} from '../services/impact-scoring.service.js';

const log = createLogger('impact-scoring-routes');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

/**
 * Score a PR's documentation impact
 * POST /score
 */
app.post('/score', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    prNumber: number;
    changedFiles: ChangedFile[];
  }>();

  const { repositoryId, prNumber, changedFiles } = body;

  if (!repositoryId || !prNumber) {
    return c.json({ success: false, error: 'repositoryId and prNumber are required' }, 400);
  }

  if (!changedFiles || changedFiles.length === 0) {
    return c.json(
      { success: false, error: 'changedFiles array is required and must not be empty' },
      400
    );
  }

  try {
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repository) {
      return c.json({ success: false, error: 'Repository not found' }, 404);
    }

    const scoringResult = await scoreChanges(changedFiles);
    const recommendations = getRecommendations(scoringResult.score, changedFiles);

    // Store scoring result
    await db.docImpactAnalysis.create({
      data: {
        repositoryId,
        prNumber,
        impactedDocs: scoringResult.classifications,
        overallRisk:
          scoringResult.score >= 70 ? 'high' : scoringResult.score >= 40 ? 'medium' : 'low',
        summary: scoringResult.summary,
        approved: false,
        metadata: {
          score: scoringResult.score,
          breakdown: scoringResult.breakdown,
          recommendationCount: recommendations.recommendations.length,
        },
      },
    });

    // Check auto-trigger
    const autoTrigger = await getAutoTriggerConfig(repositoryId);
    if (autoTrigger.enabled && scoringResult.score >= autoTrigger.threshold) {
      const [owner, repo] = repository.fullName.split('/');
      if (owner && repo) {
        await addJob(QUEUE_NAMES.IMPACT_SCORING, {
          repositoryId,
          prNumber,
          action: 'auto-generate' as const,
          score: scoringResult.score,
        });

        log.info(
          { repositoryId, prNumber, score: scoringResult.score, threshold: autoTrigger.threshold },
          'Auto-triggered doc generation based on impact score'
        );
      }
    }

    log.info({ repositoryId, prNumber, score: scoringResult.score }, 'PR impact scored');

    return c.json({
      success: true,
      data: {
        scoring: scoringResult,
        recommendations,
      },
    });
  } catch (error) {
    log.error({ error, repositoryId, prNumber }, 'Failed to score PR impact');
    return c.json(
      {
        success: false,
        error: 'Failed to score PR impact',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * Get documentation debt backlog
 * GET /debt/:repositoryId
 */
app.get('/debt/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  try {
    const debt = await calculateDocDebt(repositoryId);

    return c.json({
      success: true,
      data: debt,
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to calculate doc debt');
    return c.json({ success: false, error: 'Failed to calculate documentation debt' }, 500);
  }
});

/**
 * Get impact score trends over time
 * GET /trends/:repositoryId
 */
app.get('/trends/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const days = parseInt(c.req.query('days') || '30', 10);

  try {
    const trends = await getScoreTrends(repositoryId, days);

    return c.json({
      success: true,
      data: trends,
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get impact trends');
    return c.json({ success: false, error: 'Failed to get impact score trends' }, 500);
  }
});

/**
 * Configure auto-trigger threshold for doc generation
 * POST /auto-trigger
 */
app.post('/auto-trigger', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    threshold?: number;
    enabled?: boolean;
    notifyOnTrigger?: boolean;
  }>();

  const { repositoryId } = body;

  if (!repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  if (body.threshold !== undefined && (body.threshold < 0 || body.threshold > 100)) {
    return c.json({ success: false, error: 'threshold must be between 0 and 100' }, 400);
  }

  try {
    const config = await updateAutoTriggerConfig(repositoryId, {
      threshold: body.threshold,
      enabled: body.enabled,
      notifyOnTrigger: body.notifyOnTrigger,
    });

    log.info(
      { repositoryId, threshold: config.threshold, enabled: config.enabled },
      'Auto-trigger config updated'
    );

    return c.json({
      success: true,
      data: config,
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to update auto-trigger config');
    return c.json({ success: false, error: 'Failed to update auto-trigger configuration' }, 500);
  }
});

/**
 * Get weekly digest of documentation gaps
 * GET /weekly-digest/:repositoryId
 */
app.get('/weekly-digest/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  try {
    const digest = await getWeeklyDigest(repositoryId);

    return c.json({
      success: true,
      data: digest,
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get weekly digest');
    return c.json({ success: false, error: 'Failed to get weekly digest' }, 500);
  }
});

export { app as impactScoringRoutes };
