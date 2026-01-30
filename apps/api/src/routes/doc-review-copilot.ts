import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';

const app = new Hono();

// List doc reviews for repository
app.get('/repository/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { status, limit, offset } = c.req.query();

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const whereClause: Record<string, unknown> = { repositoryId };
  if (status) whereClause.status = status;

  const [reviews, total] = await Promise.all([
    prisma.docReview.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit ? parseInt(limit, 10) : 20,
      skip: offset ? parseInt(offset, 10) : 0,
    }),
    prisma.docReview.count({ where: whereClause }),
  ]);

  return c.json({
    success: true,
    data: { reviews, total },
  });
});

// Get single review with comments
app.get('/:reviewId', requireAuth, requireOrgAccess, async (c) => {
  const reviewId = c.req.param('reviewId');
  const orgId = c.get('organizationId');

  const review = await prisma.docReview.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    throw new NotFoundError('Review', reviewId);
  }

  // Verify access
  const repository = await prisma.repository.findFirst({
    where: { id: review.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Review', reviewId);
  }

  // Get comments
  const comments = await prisma.docReviewComment.findMany({
    where: { reviewId },
    orderBy: { lineStart: 'asc' },
  });

  return c.json({
    success: true,
    data: { ...review, comments },
  });
});

// Trigger new review
app.post('/review', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    documentId?: string;
    pullRequestId?: string;
    content?: string;
    styleGuideId?: string;
  }>();

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Verify document if provided
  if (body.documentId) {
    const document = await prisma.document.findFirst({
      where: { id: body.documentId, repositoryId: body.repositoryId },
    });
    if (!document) {
      throw new NotFoundError('Document', body.documentId);
    }
  }

  // Queue review job
  const job = await addJob(QUEUE_NAMES.DOC_REVIEW_COPILOT, {
    repositoryId: body.repositoryId,
    documentId: body.documentId,
    pullRequestId: body.pullRequestId,
    content: body.content,
    styleGuideId: body.styleGuideId,
    checkAccuracy: true,
    checkStyle: true,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Review started',
    },
  });
});

// Resolve comment
app.post('/:reviewId/comments/:commentId/resolve', requireAuth, requireOrgAccess, async (c) => {
  const reviewId = c.req.param('reviewId');
  const commentId = c.req.param('commentId');
  const orgId = c.get('organizationId');

  // Verify access
  const review = await prisma.docReview.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    throw new NotFoundError('Review', reviewId);
  }

  const repository = await prisma.repository.findFirst({
    where: { id: review.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Review', reviewId);
  }

  await prisma.docReviewComment.update({
    where: { id: commentId },
    data: { resolved: true },
  });

  return c.json({ success: true });
});

// ============================================================================
// Style Guides
// ============================================================================

// List style guides
app.get('/style-guides', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const guides = await prisma.styleGuide.findMany({
    where: { organizationId: orgId },
    orderBy: { name: 'asc' },
  });

  return c.json({
    success: true,
    data: guides,
  });
});

// Create style guide
app.post('/style-guides', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    name: string;
    description?: string;
    rules?: Array<{ pattern: string; message: string; severity: string }>;
    examples?: Array<{ bad: string; good: string }>;
    isDefault?: boolean;
  }>();

  if (!body.name) {
    throw new ValidationError('name is required');
  }

  // If setting as default, unset other defaults
  if (body.isDefault) {
    await prisma.styleGuide.updateMany({
      where: { organizationId: orgId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const guide = await prisma.styleGuide.create({
    data: {
      organizationId: orgId,
      name: body.name,
      description: body.description,
      rules: body.rules || [],
      examples: body.examples || [],
      isDefault: body.isDefault || false,
    },
  });

  return c.json({
    success: true,
    data: guide,
  });
});

// Update style guide
app.put('/style-guides/:guideId', requireAuth, requireOrgAccess, async (c) => {
  const guideId = c.req.param('guideId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    name?: string;
    description?: string;
    rules?: unknown[];
    examples?: unknown[];
    isDefault?: boolean;
  }>();

  const guide = await prisma.styleGuide.findFirst({
    where: { id: guideId, organizationId: orgId },
  });

  if (!guide) {
    throw new NotFoundError('StyleGuide', guideId);
  }

  // If setting as default, unset other defaults
  if (body.isDefault) {
    await prisma.styleGuide.updateMany({
      where: { organizationId: orgId, isDefault: true, id: { not: guideId } },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.styleGuide.update({
    where: { id: guideId },
    data: {
      name: body.name,
      description: body.description,
      rules: body.rules as object | undefined,
      examples: body.examples as object | undefined,
      isDefault: body.isDefault,
    },
  });

  return c.json({
    success: true,
    data: updated,
  });
});

// Delete style guide
app.delete('/style-guides/:guideId', requireAuth, requireOrgAccess, async (c) => {
  const guideId = c.req.param('guideId');
  const orgId = c.get('organizationId');

  const guide = await prisma.styleGuide.findFirst({
    where: { id: guideId, organizationId: orgId },
  });

  if (!guide) {
    throw new NotFoundError('StyleGuide', guideId);
  }

  await prisma.styleGuide.delete({
    where: { id: guideId },
  });

  return c.json({ success: true });
});

export const docReviewCopilotRoutes = app;
