/**
 * Collaborative Review Workflow Routes
 * 
 * API endpoints for documentation review workflows.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { reviewWorkflowService } from '../services/review-workflow.service.js';

const router = new Hono();

router.use('*', requireAuth);

// Create a review request
const createReviewSchema = z.object({
  documentId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  reviewType: z.enum(['content', 'technical', 'style', 'all']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  dueDate: z.string().datetime().optional(),
  reviewerIds: z.array(z.string()).optional(),
  autoAssign: z.boolean().optional(),
});

router.post('/create/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const body = await c.req.json();
  const user = c.get('user');

  const parsed = createReviewSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  // Verify document belongs to repository
  const document = await prisma.document.findFirst({
    where: { id: parsed.data.documentId, repositoryId },
  });

  if (!document) {
    return c.json({ error: 'Document not found in repository' }, 404);
  }

  try {
    const reviewId = await reviewWorkflowService.createReviewRequest({
      repositoryId,
      documentId: parsed.data.documentId,
      requesterId: user?.id ?? '',
      title: parsed.data.title,
      description: parsed.data.description,
      reviewType: parsed.data.reviewType,
      priority: parsed.data.priority,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
      reviewerIds: parsed.data.reviewerIds,
      autoAssign: parsed.data.autoAssign,
    });

    return c.json({
      message: 'Review request created',
      reviewId,
    });
  } catch (error) {
    console.error('Failed to create review request:', error);
    return c.json({ error: 'Failed to create review request' }, 500);
  }
});

// List review requests for repository
router.get('/list/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const { status, priority, reviewer } = c.req.query();

  const reviews = await reviewWorkflowService.listReviewRequests(repositoryId, {
    status: status || undefined,
    priority: priority || undefined,
    reviewerId: reviewer || undefined,
  });

  return c.json({ reviews });
});

// Get single review request with details
router.get('/request/:reviewRequestId', async (c) => {
  const { reviewRequestId } = c.req.param();

  const result = await reviewWorkflowService.getReviewRequest(reviewRequestId);

  if (!result) {
    return c.json({ error: 'Review request not found' }, 404);
  }

  return c.json(result);
});

// Assign reviewers
const assignSchema = z.object({
  reviewerIds: z.array(z.string()).min(1),
});

router.post('/assign/:reviewRequestId', async (c) => {
  const { reviewRequestId } = c.req.param();
  const body = await c.req.json();

  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  try {
    await reviewWorkflowService.assignReviewers(reviewRequestId, parsed.data.reviewerIds);
    return c.json({ message: 'Reviewers assigned' });
  } catch (error) {
    console.error('Failed to assign reviewers:', error);
    return c.json({ error: 'Failed to assign reviewers' }, 500);
  }
});

// Submit review decision
const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'request_changes']),
  comment: z.string().max(5000).optional(),
});

router.post('/decide/:reviewRequestId', async (c) => {
  const { reviewRequestId } = c.req.param();
  const body = await c.req.json();
  const user = c.get('user');

  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  try {
    await reviewWorkflowService.submitReviewDecision({
      reviewRequestId,
      reviewerId: user.id,
      decision: parsed.data.decision,
      comment: parsed.data.comment,
    });

    return c.json({
      message: 'Review decision submitted',
      decision: parsed.data.decision,
    });
  } catch (error) {
    console.error('Failed to submit review decision:', error);
    return c.json({ error: 'Failed to submit review decision' }, 500);
  }
});

// Add comment
const commentSchema = z.object({
  content: z.string().min(1).max(5000),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  parentId: z.string().optional(),
});

router.post('/comment/:reviewRequestId', async (c) => {
  const { reviewRequestId } = c.req.param();
  const body = await c.req.json();
  const user = c.get('user');

  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  try {
    const commentId = await reviewWorkflowService.addComment({
      reviewRequestId,
      authorId: user.id,
      content: parsed.data.content,
      lineStart: parsed.data.lineStart,
      lineEnd: parsed.data.lineEnd,
      parentId: parsed.data.parentId,
    });

    return c.json({
      message: 'Comment added',
      commentId,
    });
  } catch (error) {
    console.error('Failed to add comment:', error);
    return c.json({ error: 'Failed to add comment' }, 500);
  }
});

// Resolve comment
router.post('/comment/:commentId/resolve', async (c) => {
  const { commentId } = c.req.param();
  const user = c.get('user');

  try {
    await reviewWorkflowService.resolveComment(commentId, user.id);
    return c.json({ message: 'Comment resolved' });
  } catch (error) {
    console.error('Failed to resolve comment:', error);
    return c.json({ error: 'Failed to resolve comment' }, 500);
  }
});

// Get pending reviews for current user
router.get('/my-reviews', async (c) => {
  const user = c.get('user');

  const reviews = await reviewWorkflowService.getPendingReviewsForUser(user.id);

  return c.json({ reviews });
});

// Get AI review suggestions
router.get('/ai-suggestions/:documentId', async (c) => {
  const { documentId } = c.req.param();
  const { reviewType = 'all' } = c.req.query();

  const suggestions = await reviewWorkflowService.generateAIReviewSuggestions(
    documentId,
    reviewType
  );

  return c.json(suggestions);
});

// Cancel a review request
router.post('/cancel/:reviewRequestId', async (c) => {
  const { reviewRequestId } = c.req.param();

  try {
    await reviewWorkflowService.cancelReviewRequest(reviewRequestId);
    return c.json({ message: 'Review request cancelled' });
  } catch (error) {
    console.error('Failed to cancel review request:', error);
    return c.json({ error: 'Failed to cancel review request' }, 500);
  }
});

// Get review statistics for repository
router.get('/stats/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';

  const stats = await reviewWorkflowService.getReviewStats(repositoryId);

  return c.json(stats);
});

export default router;
