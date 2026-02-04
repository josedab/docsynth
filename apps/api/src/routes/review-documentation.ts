/**
 * Review Documentation Routes
 *
 * API endpoints for accessing PR review-extracted knowledge,
 * rationales, and institutional documentation.
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { reviewDocumentationService } from '../services/review-documentation.service.js';

const log = createLogger('review-documentation-routes');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

/**
 * Get review rationales for a repository
 */
app.get('/repositories/:repositoryId/rationales', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const decisionType = c.req.query('decisionType');
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const rationales = await reviewDocumentationService.getSignificantRationales(repositoryId, {
    limit,
    decisionType,
  });

  return c.json({
    success: true,
    data: rationales,
  });
});

/**
 * Get rationales for a specific PR
 */
app.get('/repositories/:repositoryId/prs/:prNumber/rationales', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const prNumber = parseInt(c.req.param('prNumber'), 10);

  const rationales = await reviewDocumentationService.getPRRationales(repositoryId, prNumber);

  return c.json({
    success: true,
    data: rationales,
  });
});

/**
 * Get a specific rationale with full details
 */
app.get('/rationales/:rationaleId', requireAuth, async (c) => {
  const rationaleId = c.req.param('rationaleId');

  const rationale = await db.reviewRationale.findUnique({
    where: { id: rationaleId },
    include: {
      thread: {
        include: {
          comments: {
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });

  if (!rationale) {
    return c.json({ success: false, error: 'Rationale not found' }, 404);
  }

  return c.json({
    success: true,
    data: rationale,
  });
});

/**
 * Query the review knowledge base
 */
app.post('/repositories/:repositoryId/knowledge/query', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const body = await c.req.json<{ query: string; topK?: number; category?: string }>();

  if (!body.query) {
    return c.json({ success: false, error: 'Query is required' }, 400);
  }

  const results = await reviewDocumentationService.queryKnowledge(repositoryId, body.query, {
    topK: body.topK,
    category: body.category,
  });

  return c.json({
    success: true,
    data: results,
  });
});

/**
 * Get knowledge base entries for a repository
 */
app.get('/repositories/:repositoryId/knowledge', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const category = c.req.query('category');
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const whereClause: { repositoryId: string; isActive: boolean; category?: string } = {
    repositoryId,
    isActive: true,
  };
  if (category) {
    whereClause.category = category;
  }

  const entries = await db.reviewKnowledgeBase.findMany({
    where: whereClause,
    select: {
      id: true,
      topic: true,
      category: true,
      content: true,
      keywords: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return c.json({
    success: true,
    data: entries,
  });
});

/**
 * Trigger analysis of a PR's review threads
 */
app.post('/repositories/:repositoryId/prs/:prNumber/analyze', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const prNumber = parseInt(c.req.param('prNumber'), 10);

  // Get repository
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    return c.json({ success: false, error: 'Repository not found' }, 404);
  }

  // Parse owner/repo from fullName
  const [owner, repo] = repository.fullName.split('/');

  // Queue analysis job
  const job = await addJob(QUEUE_NAMES.REVIEW_DOCUMENTATION, {
    repositoryId,
    installationId: repository.installationId,
    owner: owner || '',
    repo: repo || '',
    prNumber,
    action: 'analyze_pr',
  });

  log.info({ repositoryId, prNumber, jobId: job.id }, 'PR review analysis queued');

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'PR review analysis has been queued',
    },
  });
});

/**
 * Trigger knowledge base rebuild
 */
app.post('/repositories/:repositoryId/knowledge/rebuild', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  // Get repository
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    return c.json({ success: false, error: 'Repository not found' }, 404);
  }

  // Parse owner/repo from fullName
  const [owner, repo] = repository.fullName.split('/');

  // Queue rebuild job
  const job = await addJob(QUEUE_NAMES.REVIEW_DOCUMENTATION, {
    repositoryId,
    installationId: repository.installationId,
    owner: owner || '',
    repo: repo || '',
    prNumber: 0, // Not needed for rebuild
    action: 'build_knowledge',
  });

  log.info({ repositoryId, jobId: job.id }, 'Knowledge base rebuild queued');

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Knowledge base rebuild has been queued',
    },
  });
});

/**
 * Update rationale status (approve, dismiss)
 */
app.patch('/rationales/:rationaleId', requireAuth, async (c) => {
  const rationaleId = c.req.param('rationaleId');
  const userId = c.get('userId');
  const body = await c.req.json<{ status: 'reviewed' | 'approved' | 'dismissed' }>();

  if (!['reviewed', 'approved', 'dismissed'].includes(body.status)) {
    return c.json({ success: false, error: 'Invalid status' }, 400);
  }

  const rationale = await db.reviewRationale.update({
    where: { id: rationaleId },
    data: {
      status: body.status,
      reviewedBy: userId,
      reviewedAt: new Date(),
    },
  });

  return c.json({
    success: true,
    data: rationale,
  });
});

/**
 * Get statistics for review documentation
 */
app.get('/repositories/:repositoryId/stats', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  const [totalRationales, significantRationales, byType, knowledgeEntries] = await Promise.all([
    db.reviewRationale.count({ where: { repositoryId } }),
    db.reviewRationale.count({ where: { repositoryId, isSignificant: true } }),
    db.reviewRationale.groupBy({
      by: ['decisionType'],
      where: { repositoryId, isSignificant: true },
      _count: true,
    }),
    db.reviewKnowledgeBase.count({ where: { repositoryId, isActive: true } }),
  ]);

  return c.json({
    success: true,
    data: {
      totalRationales,
      significantRationales,
      byDecisionType: byType.reduce(
        (acc: Record<string, number>, item: { decisionType: string; _count: number }) => {
          acc[item.decisionType] = item._count;
          return acc;
        },
        {} as Record<string, number>
      ),
      knowledgeEntries,
    },
  });
});

export { app as reviewDocumentationRoutes };
