/**
 * Doc Impact Analysis Routes
 *
 * API endpoints for analyzing documentation impact during code reviews.
 * Automatically detects which documentation sections will become stale when a PR is merged.
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  analyzeDocImpact,
  generateImpactComment,
  getImpactHistory,
  getImpactConfig,
  updateImpactConfig,
  type ChangedFile,
  type ImpactConfig,
} from '../services/doc-impact.service.js';

const log = createLogger('doc-impact-routes');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

/**
 * Analyze doc impact for a PR
 * POST /analyze
 */
app.post('/analyze', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    prNumber: number;
    installationId: number;
    changedFiles?: ChangedFile[];
  }>();

  const { repositoryId, prNumber, installationId, changedFiles } = body;

  if (!repositoryId || !prNumber || !installationId) {
    return c.json(
      { success: false, error: 'repositoryId, prNumber, and installationId are required' },
      400
    );
  }

  // Get repository
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    return c.json({ success: false, error: 'Repository not found' }, 404);
  }

  // Parse owner/repo from fullName
  const [owner, repo] = repository.fullName.split('/');

  if (!owner || !repo) {
    return c.json({ success: false, error: 'Invalid repository fullName' }, 400);
  }

  // If changedFiles provided, run analysis immediately
  if (changedFiles && changedFiles.length > 0) {
    try {
      const analysis = await analyzeDocImpact(repositoryId, prNumber, changedFiles);

      // Store analysis result
      const analysisRecord = await db.docImpactAnalysis.create({
        data: {
          repositoryId,
          prNumber,
          impactedDocs: analysis.impactedDocs,
          overallRisk: analysis.overallRisk,
          summary: analysis.summary,
          approved: false,
        },
      });

      log.info({ repositoryId, prNumber, analysisId: analysisRecord.id }, 'Doc impact analysis completed');

      return c.json({
        success: true,
        data: {
          analysisId: analysisRecord.id,
          analysis,
        },
      });
    } catch (error) {
      log.error({ error, repositoryId, prNumber }, 'Doc impact analysis failed');
      return c.json(
        { success: false, error: 'Failed to analyze doc impact', details: error instanceof Error ? error.message : 'Unknown error' },
        500
      );
    }
  }

  // Otherwise, queue the analysis job
  const job = await addJob(QUEUE_NAMES.DOC_IMPACT, {
    repositoryId,
    prNumber,
    installationId,
    owner,
    repo,
  });

  log.info({ repositoryId, prNumber, jobId: job.id }, 'Doc impact analysis queued');

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Doc impact analysis has been queued',
    },
  });
});

/**
 * Get impact analysis history for a repository
 * GET /history/:repositoryId
 */
app.get('/history/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const limit = parseInt(c.req.query('limit') || '20', 10);

  try {
    const history = await getImpactHistory(repositoryId, limit);

    return c.json({
      success: true,
      data: history,
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get impact history');
    return c.json(
      { success: false, error: 'Failed to get impact history' },
      500
    );
  }
});

/**
 * Get a specific impact report
 * GET /report/:analysisId
 */
app.get('/report/:analysisId', requireAuth, async (c) => {
  const analysisId = c.req.param('analysisId');

  const analysis = await db.docImpactAnalysis.findUnique({
    where: { id: analysisId },
  });

  if (!analysis) {
    return c.json({ success: false, error: 'Analysis not found' }, 404);
  }

  return c.json({
    success: true,
    data: analysis,
  });
});

/**
 * Approve suggested doc updates from an impact analysis
 * POST /approve/:analysisId
 */
app.post('/approve/:analysisId', requireAuth, async (c) => {
  const analysisId = c.req.param('analysisId');
  const body = await c.req.json<{
    documentIds?: string[];
    createPR?: boolean;
  }>();

  const analysis = await db.docImpactAnalysis.findUnique({
    where: { id: analysisId },
  });

  if (!analysis) {
    return c.json({ success: false, error: 'Analysis not found' }, 404);
  }

  // Update analysis approval status
  const approved = await db.docImpactAnalysis.update({
    where: { id: analysisId },
    data: {
      approved: true,
      approvedAt: new Date(),
      approvedDocuments: body.documentIds || [],
    },
  });

  // If createPR is true, queue a job to create a PR with doc updates
  if (body.createPR) {
    // Queue self-healing job for the approved documents
    const repository = await prisma.repository.findUnique({
      where: { id: analysis.repositoryId },
    });

    if (repository) {
      await addJob(QUEUE_NAMES.SELF_HEALING, {
        repositoryId: analysis.repositoryId,
        triggeredBy: 'manual' as const,
        documentIds: body.documentIds,
      });
    }
  }

  log.info({ analysisId, documentCount: body.documentIds?.length }, 'Doc impact analysis approved');

  return c.json({
    success: true,
    data: approved,
  });
});

/**
 * Get doc impact configuration for a repository
 * GET /config/:repositoryId
 */
app.get('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  try {
    const config = await getImpactConfig(repositoryId);

    return c.json({
      success: true,
      data: config,
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get impact config');
    return c.json(
      { success: false, error: 'Failed to get impact config' },
      500
    );
  }
});

/**
 * Update doc impact configuration for a repository
 * PUT /config/:repositoryId
 */
app.put('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const body = await c.req.json<Partial<ImpactConfig>>();

  // Validate threshold values
  if (body.confidenceThreshold !== undefined) {
    if (body.confidenceThreshold < 0 || body.confidenceThreshold > 1) {
      return c.json(
        { success: false, error: 'confidenceThreshold must be between 0 and 1' },
        400
      );
    }
  }

  try {
    const config = await updateImpactConfig(repositoryId, body);

    log.info({ repositoryId, enabled: config.enabled }, 'Doc impact config updated');

    return c.json({
      success: true,
      data: config,
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to update impact config');
    return c.json(
      { success: false, error: 'Failed to update impact config' },
      500
    );
  }
});

/**
 * Get impact analysis for a specific PR
 * GET /pr/:repositoryId/:prNumber
 */
app.get('/pr/:repositoryId/:prNumber', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const prNumber = parseInt(c.req.param('prNumber'), 10);

  if (isNaN(prNumber)) {
    return c.json({ success: false, error: 'Invalid PR number' }, 400);
  }

  const analyses = await db.docImpactAnalysis.findMany({
    where: { repositoryId, prNumber },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });

  if (analyses.length === 0) {
    return c.json({ success: false, error: 'No analysis found for this PR' }, 404);
  }

  return c.json({
    success: true,
    data: analyses[0],
  });
});

/**
 * Generate a comment for a PR based on impact analysis
 * POST /comment/:analysisId
 */
app.post('/comment/:analysisId', requireAuth, async (c) => {
  const analysisId = c.req.param('analysisId');

  const analysis = await db.docImpactAnalysis.findUnique({
    where: { id: analysisId },
  });

  if (!analysis) {
    return c.json({ success: false, error: 'Analysis not found' }, 404);
  }

  try {
    const comment = await generateImpactComment({
      repositoryId: analysis.repositoryId,
      prNumber: analysis.prNumber,
      impactedDocs: analysis.impactedDocs,
      overallRisk: analysis.overallRisk,
      summary: analysis.summary,
    });

    return c.json({
      success: true,
      data: {
        comment,
        markdown: comment,
      },
    });
  } catch (error) {
    log.error({ error, analysisId }, 'Failed to generate impact comment');
    return c.json(
      { success: false, error: 'Failed to generate comment' },
      500
    );
  }
});

/**
 * Get impact statistics for a repository
 * GET /stats/:repositoryId
 */
app.get('/stats/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const days = parseInt(c.req.query('days') || '30', 10);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const analyses = await db.docImpactAnalysis.findMany({
    where: {
      repositoryId,
      createdAt: { gte: startDate },
    },
    select: {
      overallRisk: true,
      impactedDocs: true,
      approved: true,
      createdAt: true,
    },
  });

  const stats = {
    totalAnalyses: analyses.length,
    riskDistribution: {
      high: analyses.filter((a: { overallRisk: string }) => a.overallRisk === 'high').length,
      medium: analyses.filter((a: { overallRisk: string }) => a.overallRisk === 'medium').length,
      low: analyses.filter((a: { overallRisk: string }) => a.overallRisk === 'low').length,
    },
    avgImpactedDocs: analyses.length > 0
      ? analyses.reduce((sum: number, a: { impactedDocs: unknown[] }) => sum + (a.impactedDocs?.length || 0), 0) / analyses.length
      : 0,
    approvalRate: analyses.length > 0
      ? (analyses.filter((a: { approved: boolean }) => a.approved).length / analyses.length) * 100
      : 0,
  };

  return c.json({
    success: true,
    data: stats,
  });
});

export { app as docImpactRoutes };
