/**
 * Team Collaboration Routes
 *
 * API endpoints for documentation review workflows including
 * creating reviews, submitting feedback, commenting, and resolving threads.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  createReview,
  submitReview,
  addComment,
  resolveThread,
  listReviews,
  getMyPendingReviews,
} from '../services/team-collaboration.service.js';

const log = createLogger('team-collaboration-routes');
const app = new Hono();

/**
 * POST /review - Create a new documentation review
 */
app.post('/review', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      documentPath: string;
      reviewers: string[];
      title?: string;
    }>();

    if (!body.repositoryId || !body.documentPath || !body.reviewers?.length) {
      return c.json(
        { success: false, error: 'repositoryId, documentPath, and reviewers are required' },
        400
      );
    }

    const review = await createReview(
      body.repositoryId,
      body.documentPath,
      body.reviewers,
      body.title
    );
    return c.json({ success: true, data: review }, 201);
  } catch (error) {
    log.error({ error }, 'Failed to create review');
    return c.json({ success: false, error: 'Failed to create review' }, 500);
  }
});

/**
 * POST /review/:reviewId/submit - Submit a review with approval or changes requested
 */
app.post('/review/:reviewId/submit', requireAuth, async (c) => {
  try {
    const reviewId = c.req.param('reviewId');
    const body = await c.req.json<{
      status: 'approved' | 'changes_requested';
      summary?: string;
    }>();

    if (!body.status) {
      return c.json({ success: false, error: 'status is required' }, 400);
    }

    const result = await submitReview(reviewId, body.status, body.summary);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to submit review');
    return c.json({ success: false, error: 'Failed to submit review' }, 500);
  }
});

/**
 * POST /review/:reviewId/comment - Add a comment to a review
 */
app.post('/review/:reviewId/comment', requireAuth, async (c) => {
  try {
    const reviewId = c.req.param('reviewId');
    const body = await c.req.json<{
      content: string;
      lineNumber?: number;
      sectionId?: string;
    }>();

    if (!body.content) {
      return c.json({ success: false, error: 'content is required' }, 400);
    }

    const comment = await addComment(reviewId, body.content, body.lineNumber, body.sectionId);
    return c.json({ success: true, data: comment }, 201);
  } catch (error) {
    log.error({ error }, 'Failed to add comment');
    return c.json({ success: false, error: 'Failed to add comment' }, 500);
  }
});

/**
 * POST /review/:reviewId/resolve/:threadId - Resolve a comment thread
 */
app.post('/review/:reviewId/resolve/:threadId', requireAuth, async (c) => {
  try {
    const reviewId = c.req.param('reviewId');
    const threadId = c.req.param('threadId');
    const result = await resolveThread(reviewId, threadId);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to resolve thread');
    return c.json({ success: false, error: 'Failed to resolve thread' }, 500);
  }
});

/**
 * GET /reviews/:repositoryId - List reviews for a repository
 */
app.get('/reviews/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const status = c.req.query('status');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const reviews = await listReviews(repositoryId, status, limit);
    return c.json({ success: true, data: reviews });
  } catch (error) {
    log.error({ error }, 'Failed to list reviews');
    return c.json({ success: false, error: 'Failed to list reviews' }, 500);
  }
});

/**
 * GET /my-reviews - Get pending reviews for the current user
 */
app.get('/my-reviews', requireAuth, async (c) => {
  try {
    const reviews = await getMyPendingReviews();
    return c.json({ success: true, data: reviews });
  } catch (error) {
    log.error({ error }, 'Failed to get pending reviews');
    return c.json({ success: false, error: 'Failed to get pending reviews' }, 500);
  }
});

export { app as teamCollaborationRoutes };
