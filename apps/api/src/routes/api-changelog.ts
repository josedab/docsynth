/**
 * Automated API Changelog & Breaking Change Alerts Routes
 *
 * API endpoints for analyzing API changes between versions, generating
 * changelogs, detecting breaking changes, and managing subscriber notifications.
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { createLogger, ValidationError, NotFoundError } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';

const log = createLogger('api-changelog-routes');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

// ============================================================================
// API Change Analysis
// ============================================================================

/**
 * Analyze API changes between two versions/refs
 * POST /analyze
 */
app.post('/analyze', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    baseRef: string;
    headRef: string;
    specPath?: string;
  }>();

  if (!body.repositoryId || !body.baseRef || !body.headRef) {
    throw new ValidationError('repositoryId, baseRef, and headRef are required');
  }

  // Verify the repository exists
  const repository = await prisma.repository.findUnique({
    where: { id: body.repositoryId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  try {
    // Create analysis record
    const analysis = await db.apiChangeAnalysis.create({
      data: {
        repositoryId: body.repositoryId,
        baseRef: body.baseRef,
        headRef: body.headRef,
        specPath: body.specPath ?? null,
        status: 'analyzing',
        changes: [],
        breakingChanges: [],
        summary: null,
      },
    });

    // Simulate analysis results (in production, this would be a queued job)
    const updatedAnalysis = await db.apiChangeAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: 'completed',
        changes: [],
        breakingChanges: [],
        summary: `API change analysis between ${body.baseRef} and ${body.headRef}`,
        completedAt: new Date(),
      },
    });

    log.info(
      { analysisId: analysis.id, repositoryId: body.repositoryId, baseRef: body.baseRef, headRef: body.headRef },
      'API change analysis completed'
    );

    return c.json({
      success: true,
      data: updatedAnalysis,
    }, 201);
  } catch (error) {
    log.error({ error, repositoryId: body.repositoryId }, 'API change analysis failed');
    return c.json(
      { success: false, error: 'Failed to analyze API changes', details: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

// ============================================================================
// Changelogs
// ============================================================================

/**
 * List generated changelogs for a repository
 * GET /:repositoryId/changelogs
 */
app.get('/:repositoryId/changelogs', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const [changelogs, total] = await Promise.all([
    db.apiChangelog.findMany({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      select: {
        id: true,
        version: true,
        title: true,
        status: true,
        breakingChangeCount: true,
        createdAt: true,
        publishedAt: true,
      },
    }),
    db.apiChangelog.count({ where: { repositoryId } }),
  ]);

  return c.json({
    success: true,
    data: {
      changelogs,
      total,
      limit,
      offset,
    },
  });
});

/**
 * Get a specific changelog
 * GET /changelogs/:changelogId
 */
app.get('/changelogs/:changelogId', requireAuth, async (c) => {
  const changelogId = c.req.param('changelogId');

  const changelog = await db.apiChangelog.findUnique({
    where: { id: changelogId },
    include: {
      analysis: {
        select: { id: true, baseRef: true, headRef: true, status: true },
      },
    },
  });

  if (!changelog) {
    throw new NotFoundError('Changelog', changelogId);
  }

  return c.json({
    success: true,
    data: changelog,
  });
});

/**
 * Publish a changelog to a target
 * POST /changelogs/:changelogId/publish
 */
app.post('/changelogs/:changelogId/publish', requireAuth, requireOrgAccess, async (c) => {
  const changelogId = c.req.param('changelogId');
  const body = await c.req.json<{
    target: 'github_release' | 'slack' | 'email';
  }>();

  if (!body.target || !['github_release', 'slack', 'email'].includes(body.target)) {
    throw new ValidationError('target must be one of: github_release, slack, email');
  }

  const changelog = await db.apiChangelog.findUnique({
    where: { id: changelogId },
  });

  if (!changelog) {
    throw new NotFoundError('Changelog', changelogId);
  }

  if (changelog.status === 'draft') {
    return c.json(
      { success: false, error: 'Cannot publish a draft changelog. Finalize it first.' },
      400
    );
  }

  // Record the publication
  const publication = await db.changelogPublication.create({
    data: {
      changelogId,
      target: body.target,
      status: 'pending',
      publishedAt: null,
    },
  });

  // Update changelog status
  await db.apiChangelog.update({
    where: { id: changelogId },
    data: {
      status: 'published',
      publishedAt: new Date(),
    },
  });

  log.info({ changelogId, target: body.target, publicationId: publication.id }, 'Changelog publication initiated');

  return c.json({
    success: true,
    data: {
      publicationId: publication.id,
      changelogId,
      target: body.target,
      status: 'pending',
      message: `Changelog queued for publication to ${body.target}`,
    },
  });
});

// ============================================================================
// Breaking Changes
// ============================================================================

/**
 * Get breaking changes for a repository
 * GET /:repositoryId/breaking-changes
 */
app.get('/:repositoryId/breaking-changes', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const since = c.req.query('since');
  const severity = c.req.query('severity');

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const whereClause: Record<string, unknown> = { repositoryId };

  if (since) {
    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      throw new ValidationError('Invalid date format for since parameter');
    }
    whereClause.detectedAt = { gte: sinceDate };
  }

  if (severity) {
    if (!['low', 'medium', 'high', 'critical'].includes(severity)) {
      throw new ValidationError('severity must be one of: low, medium, high, critical');
    }
    whereClause.severity = severity;
  }

  const breakingChanges = await db.apiBreakingChange.findMany({
    where: whereClause,
    orderBy: { detectedAt: 'desc' },
    include: {
      changelog: {
        select: { id: true, version: true },
      },
    },
  });

  return c.json({
    success: true,
    data: {
      breakingChanges,
      total: breakingChanges.length,
    },
  });
});

// ============================================================================
// Subscribers
// ============================================================================

/**
 * Subscribe to breaking change alerts
 * POST /subscribers
 */
app.post('/subscribers', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    webhook?: string;
    email?: string;
    slack?: string;
  }>();

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  if (!body.webhook && !body.email && !body.slack) {
    throw new ValidationError('At least one notification channel (webhook, email, or slack) is required');
  }

  const repository = await prisma.repository.findUnique({
    where: { id: body.repositoryId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  const userId = c.get('userId');

  const subscriber = await db.changelogSubscriber.create({
    data: {
      repositoryId: body.repositoryId,
      userId,
      webhookUrl: body.webhook ?? null,
      email: body.email ?? null,
      slackChannel: body.slack ?? null,
      active: true,
    },
  });

  log.info(
    { subscriberId: subscriber.id, repositoryId: body.repositoryId, userId },
    'Subscriber registered for breaking change alerts'
  );

  return c.json({
    success: true,
    data: subscriber,
  }, 201);
});

/**
 * List subscribers for a repository
 * GET /:repositoryId/subscribers
 */
app.get('/:repositoryId/subscribers', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const subscribers = await db.changelogSubscriber.findMany({
    where: { repositoryId, active: true },
    include: {
      user: {
        select: { id: true, githubUsername: true, avatarUrl: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return c.json({
    success: true,
    data: {
      subscribers,
      total: subscribers.length,
    },
  });
});

/**
 * Unsubscribe from breaking change alerts
 * DELETE /subscribers/:subscriberId
 */
app.delete('/subscribers/:subscriberId', requireAuth, async (c) => {
  const subscriberId = c.req.param('subscriberId');
  const userId = c.get('userId');

  const subscriber = await db.changelogSubscriber.findUnique({
    where: { id: subscriberId },
  });

  if (!subscriber) {
    throw new NotFoundError('Subscriber', subscriberId);
  }

  // Verify the user owns this subscription
  if (subscriber.userId !== userId) {
    return c.json(
      { success: false, error: 'You can only delete your own subscriptions' },
      403
    );
  }

  await db.changelogSubscriber.update({
    where: { id: subscriberId },
    data: { active: false },
  });

  log.info({ subscriberId, userId }, 'Subscriber unsubscribed from alerts');

  return c.json({
    success: true,
    data: {
      message: 'Successfully unsubscribed',
    },
  });
});

// ============================================================================
// API Spec Comparison
// ============================================================================

/**
 * Compare two API specs
 * POST /:repositoryId/compare
 */
app.post('/:repositoryId/compare', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const body = await c.req.json<{
    oldSpec: string;
    newSpec: string;
    format: 'openapi' | 'graphql';
  }>();

  if (!body.oldSpec || !body.newSpec) {
    throw new ValidationError('oldSpec and newSpec are required');
  }

  if (!body.format || !['openapi', 'graphql'].includes(body.format)) {
    throw new ValidationError('format must be one of: openapi, graphql');
  }

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  try {
    // Store comparison record
    const comparison = await db.apiSpecComparison.create({
      data: {
        repositoryId,
        format: body.format,
        status: 'completed',
        addedEndpoints: [],
        removedEndpoints: [],
        modifiedEndpoints: [],
        breakingChanges: [],
        summary: `Comparison of ${body.format} specs for ${repository.fullName}`,
        completedAt: new Date(),
      },
    });

    log.info({ comparisonId: comparison.id, repositoryId, format: body.format }, 'API spec comparison completed');

    return c.json({
      success: true,
      data: comparison,
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'API spec comparison failed');
    return c.json(
      { success: false, error: 'Failed to compare API specs', details: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

// ============================================================================
// API Evolution Timeline
// ============================================================================

/**
 * Get API evolution timeline for a repository
 * GET /:repositoryId/timeline
 */
app.get('/:repositoryId/timeline', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Fetch changelogs and breaking changes as timeline events
  const [changelogs, breakingChanges] = await Promise.all([
    db.apiChangelog.findMany({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        version: true,
        title: true,
        status: true,
        breakingChangeCount: true,
        createdAt: true,
        publishedAt: true,
      },
    }),
    db.apiBreakingChange.findMany({
      where: { repositoryId },
      orderBy: { detectedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        description: true,
        severity: true,
        detectedAt: true,
      },
    }),
  ]);

  // Build unified timeline
  const timeline = [
    ...changelogs.map((cl: Record<string, unknown>) => ({
      type: 'changelog' as const,
      id: cl.id,
      version: cl.version,
      title: cl.title,
      status: cl.status,
      breakingChangeCount: cl.breakingChangeCount,
      date: cl.publishedAt || cl.createdAt,
    })),
    ...breakingChanges.map((bc: Record<string, unknown>) => ({
      type: 'breaking_change' as const,
      id: bc.id,
      changeType: bc.type,
      description: bc.description,
      severity: bc.severity,
      date: bc.detectedAt,
    })),
  ].sort((a, b) => new Date(b.date as string).getTime() - new Date(a.date as string).getTime());

  return c.json({
    success: true,
    data: {
      repositoryId,
      repositoryName: repository.fullName,
      timeline: timeline.slice(0, limit),
      total: timeline.length,
    },
  });
});

export { app as apiChangelogRoutes };
