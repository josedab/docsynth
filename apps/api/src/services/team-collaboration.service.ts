/**
 * Team Collaboration Service
 *
 * Multi-reviewer doc approval workflows, inline commenting,
 * @mention assignments, and team notification channels.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('team-collaboration-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface DocReviewRequest {
  id: string;
  documentId: string;
  repositoryId: string;
  title: string;
  assignees: string[];
  approvalMode: 'any-one' | 'all' | 'majority';
  status: 'open' | 'approved' | 'changes-requested' | 'closed';
  dueDate?: Date;
  reviews: Review[];
  threads: CommentThread[];
  createdBy: string;
  createdAt: Date;
}

export interface Review {
  reviewerId: string;
  status: 'pending' | 'approved' | 'changes-requested';
  comment?: string;
  reviewedAt?: Date;
}

export interface CommentThread {
  id: string;
  reviewId: string;
  sectionPath: string;
  comments: ThreadComment[];
  resolved: boolean;
  createdAt: Date;
}

export interface ThreadComment {
  id: string;
  authorId: string;
  content: string;
  createdAt: Date;
}

export interface NotificationPayload {
  type: 'review-assigned' | 'review-submitted' | 'comment-added' | 'review-due' | 'review-approved';
  recipientIds: string[];
  reviewId: string;
  message: string;
  url?: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create a new documentation review request
 */
export async function createReviewRequest(
  documentId: string,
  repositoryId: string,
  options: {
    title: string;
    assignees: string[];
    approvalMode?: 'any-one' | 'all' | 'majority';
    dueDate?: string;
    createdBy: string;
  }
): Promise<DocReviewRequest> {
  const reviews: Review[] = options.assignees.map((id) => ({
    reviewerId: id,
    status: 'pending',
  }));

  const request: DocReviewRequest = {
    id: `rev-${repositoryId}-${Date.now()}`,
    documentId,
    repositoryId,
    title: options.title,
    assignees: options.assignees,
    approvalMode: options.approvalMode ?? 'any-one',
    status: 'open',
    dueDate: options.dueDate ? new Date(options.dueDate) : undefined,
    reviews,
    threads: [],
    createdBy: options.createdBy,
    createdAt: new Date(),
  };

  await db.docReviewRequest.create({
    data: {
      id: request.id,
      documentId,
      repositoryId,
      title: request.title,
      assignees: options.assignees,
      approvalMode: request.approvalMode,
      status: 'open',
      dueDate: request.dueDate,
      reviews: JSON.parse(JSON.stringify(reviews)),
      threads: JSON.parse(JSON.stringify([])),
      createdBy: options.createdBy,
      createdAt: new Date(),
    },
  });

  log.info({ reviewId: request.id, assignees: options.assignees.length }, 'Review request created');
  return request;
}

/**
 * Submit a review decision
 */
export async function submitReview(
  reviewId: string,
  reviewerId: string,
  decision: 'approved' | 'changes-requested',
  comment?: string
): Promise<DocReviewRequest> {
  const stored = await db.docReviewRequest.findUnique({ where: { id: reviewId } });
  if (!stored) throw new Error(`Review not found: ${reviewId}`);

  const reviews = stored.reviews as unknown as Review[];
  const review = reviews.find((r) => r.reviewerId === reviewerId);
  if (!review) throw new Error(`Reviewer ${reviewerId} not assigned to this review`);

  review.status = decision;
  review.comment = comment;
  review.reviewedAt = new Date();

  // Check if review is complete based on approval mode
  const newStatus = evaluateApproval(reviews, stored.approvalMode);

  await db.docReviewRequest.update({
    where: { id: reviewId },
    data: {
      reviews: JSON.parse(JSON.stringify(reviews)),
      status: newStatus,
      updatedAt: new Date(),
    },
  });

  log.info({ reviewId, reviewerId, decision, newStatus }, 'Review submitted');

  return { ...stored, reviews, status: newStatus } as unknown as DocReviewRequest;
}

/**
 * Add a comment thread
 */
export async function addCommentThread(
  reviewId: string,
  sectionPath: string,
  authorId: string,
  content: string
): Promise<CommentThread> {
  const stored = await db.docReviewRequest.findUnique({ where: { id: reviewId } });
  if (!stored) throw new Error(`Review not found: ${reviewId}`);

  const threads = (stored.threads as unknown as CommentThread[]) ?? [];
  const thread: CommentThread = {
    id: `thread-${Date.now()}`,
    reviewId,
    sectionPath,
    comments: [{ id: `cmt-${Date.now()}`, authorId, content, createdAt: new Date() }],
    resolved: false,
    createdAt: new Date(),
  };
  threads.push(thread);

  await db.docReviewRequest.update({
    where: { id: reviewId },
    data: { threads: JSON.parse(JSON.stringify(threads)), updatedAt: new Date() },
  });

  log.info({ reviewId, threadId: thread.id, authorId }, 'Comment thread added');
  return thread;
}

/**
 * Resolve a comment thread
 */
export async function resolveThread(reviewId: string, threadId: string): Promise<void> {
  const stored = await db.docReviewRequest.findUnique({ where: { id: reviewId } });
  if (!stored) throw new Error(`Review not found: ${reviewId}`);

  const threads = stored.threads as unknown as CommentThread[];
  const thread = threads.find((t) => t.id === threadId);
  if (thread) thread.resolved = true;

  await db.docReviewRequest.update({
    where: { id: reviewId },
    data: { threads: JSON.parse(JSON.stringify(threads)) },
  });
}

/**
 * Get review requests for a repository
 */
export async function getReviewRequests(
  repositoryId: string,
  status?: string
): Promise<DocReviewRequest[]> {
  const where: Record<string, unknown> = { repositoryId };
  if (status) where.status = status;

  const stored = await db.docReviewRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return stored.map((r: any) => ({
    id: r.id,
    documentId: r.documentId,
    repositoryId: r.repositoryId,
    title: r.title,
    assignees: r.assignees,
    approvalMode: r.approvalMode,
    status: r.status,
    dueDate: r.dueDate,
    reviews: r.reviews as unknown as Review[],
    threads: r.threads as unknown as CommentThread[],
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  }));
}

/**
 * Get pending reviews for a user
 */
export async function getPendingReviewsForUser(userId: string): Promise<DocReviewRequest[]> {
  const all = await db.docReviewRequest.findMany({
    where: { status: 'open', assignees: { has: userId } },
    orderBy: { createdAt: 'desc' },
  });

  return all
    .filter((r: any) => {
      const reviews = r.reviews as unknown as Review[];
      return reviews.some((rev) => rev.reviewerId === userId && rev.status === 'pending');
    })
    .map((r: any) => ({
      id: r.id,
      documentId: r.documentId,
      repositoryId: r.repositoryId,
      title: r.title,
      assignees: r.assignees,
      approvalMode: r.approvalMode,
      status: r.status,
      reviews: r.reviews,
      threads: r.threads,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    }));
}

// ============================================================================
// Helper Functions
// ============================================================================

function evaluateApproval(reviews: Review[], mode: string): DocReviewRequest['status'] {
  const completed = reviews.filter((r) => r.status !== 'pending');
  if (completed.length === 0) return 'open';

  const approved = completed.filter((r) => r.status === 'approved');
  const changesRequested = completed.filter((r) => r.status === 'changes-requested');

  if (changesRequested.length > 0 && mode === 'all') return 'changes-requested';

  switch (mode) {
    case 'any-one':
      if (approved.length >= 1) return 'approved';
      if (changesRequested.length >= 1) return 'changes-requested';
      break;
    case 'all':
      if (approved.length === reviews.length) return 'approved';
      break;
    case 'majority':
      if (approved.length > reviews.length / 2) return 'approved';
      if (changesRequested.length > reviews.length / 2) return 'changes-requested';
      break;
  }

  return 'open';
}
