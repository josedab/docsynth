import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { NotFoundError, ValidationError, createLogger } from '@docsynth/utils';

const log = createLogger('pr-doc-review');

// Type assertion for new Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

// ============================================================================
// Trigger & Review Management
// ============================================================================

// Trigger PR doc review for a specific PR
app.post('/trigger', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId') as string;
  const body = await c.req.json<{
    repositoryId: string;
    prNumber: number;
    installationId: string;
    owner: string;
    repo: string;
  }>();

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  if (!body.prNumber) {
    throw new ValidationError('prNumber is required');
  }

  if (!body.installationId || !body.owner || !body.repo) {
    throw new ValidationError('installationId, owner, and repo are required');
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Check if a review already exists for this PR
  const existingReview = await db.prDocReview.findFirst({
    where: {
      repositoryId: body.repositoryId,
      prNumber: body.prNumber,
      status: { in: ['pending', 'in_progress'] },
    },
  });

  if (existingReview) {
    return c.json({
      success: true,
      data: {
        reviewId: existingReview.id,
        message: 'Review already in progress for this PR',
        status: existingReview.status,
      },
    });
  }

  // Create a new PR doc review
  const review = await db.prDocReview.create({
    data: {
      repositoryId: body.repositoryId,
      prNumber: body.prNumber,
      installationId: body.installationId,
      owner: body.owner,
      repo: body.repo,
      organizationId: orgId,
      status: 'pending',
      triggeredAt: new Date(),
    },
  });

  log.info({
    reviewId: review.id,
    repositoryId: body.repositoryId,
    prNumber: body.prNumber,
  }, 'PR doc review triggered');

  return c.json({
    success: true,
    data: {
      reviewId: review.id,
      message: 'PR doc review triggered successfully',
      status: review.status,
    },
  }, 201);
});

// List recent PR doc reviews for a repository
app.get('/:repositoryId/reviews', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const orgId = c.get('organizationId') as string;
  const { status, limit, offset } = c.req.query();

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const whereClause: Record<string, unknown> = { repositoryId };
  if (status) whereClause.status = status;

  const [reviews, total] = await Promise.all([
    db.prDocReview.findMany({
      where: whereClause,
      orderBy: { triggeredAt: 'desc' },
      take: limit ? parseInt(limit, 10) : 20,
      skip: offset ? parseInt(offset, 10) : 0,
    }),
    db.prDocReview.count({ where: whereClause }),
  ]);

  return c.json({
    success: true,
    data: { reviews, total },
  });
});

// ============================================================================
// Individual Review Details
// ============================================================================

// Get a specific review result
app.get('/review/:reviewId', requireAuth, requireOrgAccess, async (c) => {
  const reviewId = c.req.param('reviewId') ?? '';
  const orgId = c.get('organizationId') as string;

  const review = await db.prDocReview.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    throw new NotFoundError('PrDocReview', reviewId);
  }

  // Verify org access through the repository
  const repository = await prisma.repository.findFirst({
    where: { id: review.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('PrDocReview', reviewId);
  }

  // Get associated review comments
  const comments = await db.prDocReviewComment.findMany({
    where: { reviewId },
    orderBy: { createdAt: 'asc' },
  });

  return c.json({
    success: true,
    data: {
      ...review,
      comments,
    },
  });
});

// ============================================================================
// Feedback
// ============================================================================

// Submit feedback on a review comment
app.post('/feedback', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId') as string;
  const userId = c.get('userId') as string;
  const body = await c.req.json<{
    reviewId: string;
    commentId: string;
    helpful: boolean;
  }>();

  if (!body.reviewId) {
    throw new ValidationError('reviewId is required');
  }

  if (!body.commentId) {
    throw new ValidationError('commentId is required');
  }

  if (typeof body.helpful !== 'boolean') {
    throw new ValidationError('helpful must be a boolean');
  }

  // Verify the review exists and belongs to the org
  const review = await db.prDocReview.findUnique({
    where: { id: body.reviewId },
  });

  if (!review) {
    throw new NotFoundError('PrDocReview', body.reviewId);
  }

  const repository = await prisma.repository.findFirst({
    where: { id: review.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('PrDocReview', body.reviewId);
  }

  // Verify the comment exists
  const comment = await db.prDocReviewComment.findFirst({
    where: { id: body.commentId, reviewId: body.reviewId },
  });

  if (!comment) {
    throw new NotFoundError('PrDocReviewComment', body.commentId);
  }

  // Store the feedback
  const feedback = await db.prDocReviewFeedback.create({
    data: {
      reviewId: body.reviewId,
      commentId: body.commentId,
      userId,
      helpful: body.helpful,
      submittedAt: new Date(),
    },
  });

  log.info({
    feedbackId: feedback.id,
    reviewId: body.reviewId,
    commentId: body.commentId,
    helpful: body.helpful,
  }, 'PR doc review feedback submitted');

  return c.json({
    success: true,
    data: {
      feedbackId: feedback.id,
      message: 'Feedback submitted successfully',
    },
  });
});

// ============================================================================
// Settings
// ============================================================================

// Update PR doc review settings for a repository
app.put('/:repositoryId/settings', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const orgId = c.get('organizationId') as string;
  const body = await c.req.json<{
    enabled?: boolean;
    sensitivity?: 'low' | 'medium' | 'high';
    autoComment?: boolean;
    notifyOnBreaking?: boolean;
  }>();

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Validate sensitivity if provided
  if (body.sensitivity && !['low', 'medium', 'high'].includes(body.sensitivity)) {
    throw new ValidationError('sensitivity must be one of: low, medium, high');
  }

  const settings = await db.prDocReviewSettings.upsert({
    where: { repositoryId },
    create: {
      repositoryId,
      organizationId: orgId,
      enabled: body.enabled ?? true,
      sensitivity: body.sensitivity ?? 'medium',
      autoComment: body.autoComment ?? true,
      notifyOnBreaking: body.notifyOnBreaking ?? true,
    },
    update: {
      enabled: body.enabled,
      sensitivity: body.sensitivity,
      autoComment: body.autoComment,
      notifyOnBreaking: body.notifyOnBreaking,
    },
  });

  log.info({ repositoryId, enabled: settings.enabled }, 'PR doc review settings updated');

  return c.json({
    success: true,
    data: settings,
  });
});

export { app as prDocReviewRoutes };
