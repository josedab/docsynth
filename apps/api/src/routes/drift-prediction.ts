import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';

const app = new Hono();

// Type alias for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

interface DriftPredictionRecord {
  id: string;
  repositoryId: string;
  documentId: string;
  documentPath?: string;
  riskLevel: string;
  driftProbability: number;
  status: string;
  signals: unknown;
  suggestedActions: string[];
  predictedAt: Date;
  expiresAt: Date;
  predictedDriftDate?: Date;
  prActivityScore?: number;
  changeVelocityScore?: number;
  staleDaysScore?: number;
  relatedIssuesScore?: number;
  relatedPRs?: unknown[];
  affectedFiles?: string[];
  estimatedEffort?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Get drift predictions for a repository
app.get('/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { status, riskLevel, limit } = c.req.query();

  // Verify access
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, name: true, githubFullName: true },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const whereClause: Record<string, unknown> = { repositoryId };

  if (status) {
    whereClause.status = status;
  } else {
    whereClause.status = 'active'; // Default to active predictions
  }

  if (riskLevel) {
    whereClause.riskLevel = riskLevel;
  }

  const predictions: DriftPredictionRecord[] = await db.driftPrediction.findMany({
    where: whereClause,
    orderBy: { driftProbability: 'desc' },
    take: limit ? parseInt(limit, 10) : 50,
  });

  // Calculate summary stats
  const stats = {
    total: predictions.length,
    critical: predictions.filter((p: DriftPredictionRecord) => p.riskLevel === 'critical').length,
    high: predictions.filter((p: DriftPredictionRecord) => p.riskLevel === 'high').length,
    medium: predictions.filter((p: DriftPredictionRecord) => p.riskLevel === 'medium').length,
    low: predictions.filter((p: DriftPredictionRecord) => p.riskLevel === 'low').length,
    averageProbability: predictions.length > 0
      ? Math.round(predictions.reduce((sum: number, p: DriftPredictionRecord) => sum + p.driftProbability, 0) / predictions.length)
      : 0,
  };

  return c.json({
    success: true,
    data: {
      repository: {
        id: repository.id,
        name: repository.name,
        fullName: repository.githubFullName,
      },
      predictions: predictions.map(p => ({
        id: p.id,
        documentPath: p.documentPath,
        documentId: p.documentId,
        driftProbability: p.driftProbability,
        riskLevel: p.riskLevel,
        predictedDriftDate: p.predictedDriftDate,
        signals: {
          prActivityScore: p.prActivityScore,
          changeVelocityScore: p.changeVelocityScore,
          staleDaysScore: p.staleDaysScore,
          relatedIssuesScore: p.relatedIssuesScore,
        },
        relatedPRs: p.relatedPRs,
        affectedFiles: p.affectedFiles,
        suggestedActions: p.suggestedActions,
        estimatedEffort: p.estimatedEffort,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      stats,
    },
  });
});

// Get organization-wide drift summary
app.get('/', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  // Get all repositories for the org
  const repositories = await prisma.repository.findMany({
    where: { organizationId: orgId, enabled: true },
    select: { id: true, name: true },
  });

  const repoIds = repositories.map(r => r.id);

  // Get active predictions grouped by risk level
  const predictions: DriftPredictionRecord[] = await db.driftPrediction.findMany({
    where: {
      repositoryId: { in: repoIds },
      status: 'active',
    },
    orderBy: { driftProbability: 'desc' },
  });

  // Build per-repository summary
  const repositorySummaries = repositories.map(repo => {
    const repoPredictions = predictions.filter((p: DriftPredictionRecord) => p.repositoryId === repo.id);
    return {
      repositoryId: repo.id,
      repositoryName: repo.name,
      totalPredictions: repoPredictions.length,
      critical: repoPredictions.filter((p: DriftPredictionRecord) => p.riskLevel === 'critical').length,
      high: repoPredictions.filter((p: DriftPredictionRecord) => p.riskLevel === 'high').length,
      averageProbability: repoPredictions.length > 0
        ? Math.round(repoPredictions.reduce((sum: number, p: DriftPredictionRecord) => sum + p.driftProbability, 0) / repoPredictions.length)
        : 0,
    };
  }).sort((a, b) => b.critical + b.high - (a.critical + a.high));

  // Top risk documents across all repos
  const topRiskDocuments = predictions
    .filter((p: DriftPredictionRecord) => p.riskLevel === 'critical' || p.riskLevel === 'high')
    .slice(0, 10)
    .map((p: DriftPredictionRecord & { documentPath?: string }) => {
      const repo = repositories.find(r => r.id === p.repositoryId);
      return {
        documentPath: p.documentPath,
        repositoryName: repo?.name || 'Unknown',
        driftProbability: p.driftProbability,
        riskLevel: p.riskLevel,
        predictedDriftDate: (p as DriftPredictionRecord & { predictedDriftDate?: Date }).predictedDriftDate,
      };
    });

  return c.json({
    success: true,
    data: {
      organizationSummary: {
        totalRepositories: repositories.length,
        totalPredictions: predictions.length,
        riskDistribution: {
          critical: predictions.filter((p: DriftPredictionRecord) => p.riskLevel === 'critical').length,
          high: predictions.filter((p: DriftPredictionRecord) => p.riskLevel === 'high').length,
          medium: predictions.filter((p: DriftPredictionRecord) => p.riskLevel === 'medium').length,
          low: predictions.filter((p: DriftPredictionRecord) => p.riskLevel === 'low').length,
        },
      },
      repositorySummaries,
      topRiskDocuments,
    },
  });
});

// Trigger drift prediction analysis
app.post('/:repositoryId/analyze', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  // Verify access and get repository details
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const [owner, repo] = repository.githubFullName.split('/');
  if (!owner || !repo) {
    throw new Error('Invalid repository full name');
  }

  // Queue the drift prediction job
  const job = await addJob(QUEUE_NAMES.DRIFT_PREDICTION, {
    repositoryId,
    installationId: repository.installationId,
    owner,
    repo,
    scheduled: false,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Drift prediction analysis started',
    },
  }, 202);
});

// Acknowledge a drift prediction
app.post('/:predictionId/acknowledge', requireAuth, requireOrgAccess, async (c) => {
  const predictionId = c.req.param('predictionId');
  const userId = c.get('userId');
  const orgId = c.get('organizationId');

  // Verify the prediction exists and user has access
  const prediction = await db.driftPrediction.findFirst({
    where: { id: predictionId },
    include: {
      repository: { select: { organizationId: true } },
    },
  });

  if (!prediction || prediction.repository?.organizationId !== orgId) {
    throw new NotFoundError('Drift prediction', predictionId);
  }

  await db.driftPrediction.update({
    where: { id: predictionId },
    data: {
      status: 'acknowledged',
      acknowledgedBy: userId,
      acknowledgedAt: new Date(),
    },
  });

  return c.json({
    success: true,
    message: 'Drift prediction acknowledged',
  });
});

// Mark prediction as resolved
app.post('/:predictionId/resolve', requireAuth, requireOrgAccess, async (c) => {
  const predictionId = c.req.param('predictionId');
  const orgId = c.get('organizationId');

  // Verify the prediction exists and user has access
  const prediction = await db.driftPrediction.findFirst({
    where: { id: predictionId },
    include: {
      repository: { select: { organizationId: true } },
    },
  });

  if (!prediction || prediction.repository?.organizationId !== orgId) {
    throw new NotFoundError('Drift prediction', predictionId);
  }

  await db.driftPrediction.update({
    where: { id: predictionId },
    data: {
      status: 'resolved',
      resolvedAt: new Date(),
    },
  });

  return c.json({
    success: true,
    message: 'Drift prediction resolved',
  });
});

// Mark prediction as false positive
app.post('/:predictionId/false-positive', requireAuth, requireOrgAccess, async (c) => {
  const predictionId = c.req.param('predictionId');
  const userId = c.get('userId');
  const orgId = c.get('organizationId');

  // Verify the prediction exists and user has access
  const prediction = await db.driftPrediction.findFirst({
    where: { id: predictionId },
    include: {
      repository: { select: { organizationId: true } },
    },
  });

  if (!prediction || prediction.repository?.organizationId !== orgId) {
    throw new NotFoundError('Drift prediction', predictionId);
  }

  await db.driftPrediction.update({
    where: { id: predictionId },
    data: {
      status: 'false_positive',
      acknowledgedBy: userId,
      acknowledgedAt: new Date(),
    },
  });

  return c.json({
    success: true,
    message: 'Drift prediction marked as false positive',
  });
});

// Get drift prediction timeline/history
app.get('/:repositoryId/history', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { days } = c.req.query();

  // Verify access
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const periodDays = days ? parseInt(days, 10) : 30;
  const startDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  // Get all predictions (including resolved) for the period
  const predictions: DriftPredictionRecord[] = await db.driftPrediction.findMany({
    where: {
      repositoryId,
      createdAt: { gte: startDate },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Group by day for timeline
  const timeline = new Map<string, {
    date: string;
    newPredictions: number;
    resolved: number;
    avgProbability: number;
  }>();

  for (const prediction of predictions) {
    const dateKey = prediction.predictedAt.toISOString().split('T')[0] || '';
    const existing = timeline.get(dateKey) || {
      date: dateKey,
      newPredictions: 0,
      resolved: 0,
      avgProbability: 0,
    };

    existing.newPredictions++;
    const resolvedPrediction = prediction as DriftPredictionRecord & { resolvedAt?: Date };
    if (prediction.status === 'resolved' && resolvedPrediction.resolvedAt) {
      const resolvedKey = resolvedPrediction.resolvedAt.toISOString().split('T')[0];
      if (resolvedKey === dateKey) {
        existing.resolved++;
      }
    }

    timeline.set(dateKey, existing);
  }

  return c.json({
    success: true,
    data: {
      repositoryId,
      periodDays,
      timeline: Array.from(timeline.values()).sort((a, b) => a.date.localeCompare(b.date)),
      summary: {
        totalPredictions: predictions.length,
        resolved: predictions.filter((p: DriftPredictionRecord) => p.status === 'resolved').length,
        falsePositives: predictions.filter((p: DriftPredictionRecord) => p.status === 'false_positive').length,
        active: predictions.filter((p: DriftPredictionRecord) => p.status === 'active').length,
      },
    },
  });
});

export { app as driftPredictionRoutes };
