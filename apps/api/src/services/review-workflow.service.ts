/**
 * Collaborative Review Workflows Service
 * 
 * Provides functionality for documentation review workflows,
 * including review assignments, comments, and approval processes.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId, getAnthropicClient } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';

const log = createLogger('review-workflow');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface CreateReviewRequest {
  repositoryId: string;
  documentId: string;
  requesterId: string;
  title: string;
  description?: string;
  reviewType: 'content' | 'technical' | 'style' | 'all';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  dueDate?: Date;
  reviewerIds?: string[];
  autoAssign?: boolean;
}

export interface ReviewDecision {
  reviewRequestId: string;
  reviewerId: string;
  decision: 'approve' | 'reject' | 'request_changes';
  comment?: string;
}

export interface AddCommentInput {
  reviewRequestId: string;
  authorId: string;
  content: string;
  lineStart?: number;
  lineEnd?: number;
  parentId?: string;
}

export interface ReviewSummary {
  id: string;
  title: string;
  status: string;
  documentPath: string;
  requester: string;
  reviewType: string;
  priority: string;
  assignmentCount: number;
  completedCount: number;
  commentCount: number;
  unresolvedComments: number;
  createdAt: Date;
  dueDate?: Date;
}

class ReviewWorkflowService {
  /**
   * Create a new documentation review request
   */
  async createReviewRequest(input: CreateReviewRequest): Promise<string> {
    const id = generateId();

    // Create the review request
    await db.docReviewRequest.create({
      data: {
        id,
        repositoryId: input.repositoryId,
        documentId: input.documentId,
        requesterId: input.requesterId,
        title: input.title,
        description: input.description,
        reviewType: input.reviewType,
        priority: input.priority || 'normal',
        dueDate: input.dueDate,
        status: 'pending',
      },
    });

    // Assign reviewers if provided
    if (input.reviewerIds && input.reviewerIds.length > 0) {
      await this.assignReviewers(id, input.reviewerIds);
    } else if (input.autoAssign) {
      await this.autoAssignReviewers(id, input.repositoryId, input.reviewType);
    }

    // Send notifications
    await this.notifyReviewRequested(id);

    log.info({ reviewRequestId: id, repositoryId: input.repositoryId }, 'Review request created');

    return id;
  }

  /**
   * Assign reviewers to a review request
   */
  async assignReviewers(reviewRequestId: string, reviewerIds: string[]): Promise<void> {
    for (const reviewerId of reviewerIds) {
      await db.reviewAssignment.upsert({
        where: {
          reviewRequestId_reviewerId: {
            reviewRequestId,
            reviewerId,
          },
        },
        update: {},
        create: {
          id: generateId(),
          reviewRequestId,
          reviewerId,
          status: 'pending',
        },
      });
    }

    // Update review status to in_review if not already
    await db.docReviewRequest.update({
      where: { id: reviewRequestId },
      data: { status: 'in_review' },
    });
  }

  /**
   * Auto-assign reviewers based on document history and expertise
   */
  async autoAssignReviewers(
    reviewRequestId: string,
    repositoryId: string,
    reviewType: string
  ): Promise<string[]> {
    // Get document ID from the review request
    const reviewRequest = await db.docReviewRequest.findUnique({
      where: { id: reviewRequestId },
      select: { documentId: true },
    });

    if (!reviewRequest) {
      return [];
    }

    // Find potential reviewers based on:
    // 1. Past contributors to this document
    // 2. Team members with relevant expertise
    // 3. Active reviewers in the repository

    // Get organization members
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { organizationId: true },
    });

    if (!repository?.organizationId) {
      return [];
    }

    // Get active organization members (simplified - in production, use more sophisticated matching)
    const members = await prisma.membership.findMany({
      where: {
        organizationId: repository.organizationId,
        role: { in: ['ADMIN', 'MEMBER'] },
      },
      take: 3,
      select: { userId: true },
    });

    const reviewerIds = members.map((m: { userId: string }) => m.userId);

    if (reviewerIds.length > 0) {
      await this.assignReviewers(reviewRequestId, reviewerIds);
    }

    return reviewerIds;
  }

  /**
   * Submit a review decision
   */
  async submitReviewDecision(input: ReviewDecision): Promise<void> {
    // Update assignment
    await db.reviewAssignment.update({
      where: {
        reviewRequestId_reviewerId: {
          reviewRequestId: input.reviewRequestId,
          reviewerId: input.reviewerId,
        },
      },
      data: {
        status: 'completed',
        decision: input.decision,
        completedAt: new Date(),
      },
    });

    // Add comment if provided
    if (input.comment) {
      await this.addComment({
        reviewRequestId: input.reviewRequestId,
        authorId: input.reviewerId,
        content: input.comment,
      });
    }

    // Check if all reviewers have completed
    await this.updateReviewStatus(input.reviewRequestId);

    log.info({ ...input }, 'Review decision submitted');
  }

  /**
   * Update review request status based on assignments
   */
  private async updateReviewStatus(reviewRequestId: string): Promise<void> {
    const assignments = await db.reviewAssignment.findMany({
      where: { reviewRequestId },
    });

    if (assignments.length === 0) {
      return;
    }

    const completedAssignments = assignments.filter(
      (a: { status: string }) => a.status === 'completed'
    );

    // All reviewers completed
    if (completedAssignments.length === assignments.length) {
      const decisions = completedAssignments.map((a: { decision: string }) => a.decision);

      let finalStatus: string;
      if (decisions.every((d: string) => d === 'approve')) {
        finalStatus = 'approved';
      } else if (decisions.some((d: string) => d === 'reject')) {
        finalStatus = 'rejected';
      } else {
        finalStatus = 'changes_requested';
      }

      await db.docReviewRequest.update({
        where: { id: reviewRequestId },
        data: { status: finalStatus },
      });

      // Notify requester
      await this.notifyReviewCompleted(reviewRequestId, finalStatus);
    }
  }

  /**
   * Add a comment to a review
   */
  async addComment(input: AddCommentInput): Promise<string> {
    const id = generateId();

    await db.reviewComment.create({
      data: {
        id,
        reviewRequestId: input.reviewRequestId,
        authorId: input.authorId,
        content: input.content,
        lineStart: input.lineStart,
        lineEnd: input.lineEnd,
        parentId: input.parentId,
        resolved: false,
      },
    });

    return id;
  }

  /**
   * Resolve a comment
   */
  async resolveComment(commentId: string, resolvedBy: string): Promise<void> {
    await db.reviewComment.update({
      where: { id: commentId },
      data: {
        resolved: true,
        resolvedBy,
        resolvedAt: new Date(),
      },
    });
  }

  /**
   * Get review request with all details
   */
  async getReviewRequest(reviewRequestId: string): Promise<{
    request: unknown;
    assignments: unknown[];
    comments: unknown[];
    document: unknown;
  } | null> {
    const request = await db.docReviewRequest.findUnique({
      where: { id: reviewRequestId },
    });

    if (!request) {
      return null;
    }

    const [assignments, comments, document] = await Promise.all([
      db.reviewAssignment.findMany({
        where: { reviewRequestId },
        orderBy: { createdAt: 'asc' },
      }),
      db.reviewComment.findMany({
        where: { reviewRequestId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.document.findUnique({
        where: { id: request.documentId },
        select: { id: true, path: true, title: true, content: true },
      }),
    ]);

    return { request, assignments, comments, document };
  }

  /**
   * List review requests for a repository
   */
  async listReviewRequests(
    repositoryId: string,
    filters?: { status?: string; reviewerId?: string; priority?: string }
  ): Promise<ReviewSummary[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { repositoryId };
    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.priority) {
      where.priority = filters.priority;
    }

    const requests = await db.docReviewRequest.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: {
        assignments: true,
        comments: true,
      },
    });

    // If filtering by reviewer, filter after query
    let filteredRequests = requests;
    if (filters?.reviewerId) {
      filteredRequests = requests.filter((r: { assignments: { reviewerId: string }[] }) =>
        r.assignments.some((a: { reviewerId: string }) => a.reviewerId === filters.reviewerId)
      );
    }

    // Get document paths
    const documentIds = [...new Set(filteredRequests.map((r: { documentId: string }) => r.documentId))] as string[];
    const documents = await prisma.document.findMany({
      where: { id: { in: documentIds } },
      select: { id: true, path: true },
    });
    const docMap = new Map(documents.map((d) => [d.id, d.path]));

    return filteredRequests.map((r: {
      id: string;
      title: string;
      status: string;
      documentId: string;
      requesterId: string;
      reviewType: string;
      priority: string;
      createdAt: Date;
      dueDate?: Date;
      assignments: { status: string }[];
      comments: { resolved: boolean }[];
    }) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      documentPath: docMap.get(r.documentId) || '',
      requester: r.requesterId,
      reviewType: r.reviewType,
      priority: r.priority,
      assignmentCount: r.assignments.length,
      completedCount: r.assignments.filter((a: { status: string }) => a.status === 'completed').length,
      commentCount: r.comments.length,
      unresolvedComments: r.comments.filter((c: { resolved: boolean }) => !c.resolved).length,
      createdAt: r.createdAt,
      dueDate: r.dueDate,
    }));
  }

  /**
   * Get pending reviews for a user
   */
  async getPendingReviewsForUser(userId: string): Promise<ReviewSummary[]> {
    const assignments = await db.reviewAssignment.findMany({
      where: {
        reviewerId: userId,
        status: { in: ['pending', 'in_progress'] },
      },
      include: {
        reviewRequest: {
          include: {
            assignments: true,
            comments: true,
          },
        },
      },
    });

    // Get document paths
    const documentIds = [
      ...new Set(
        assignments.map((a: { reviewRequest: { documentId: string } }) => a.reviewRequest.documentId)
      ),
    ] as string[];
    const documents = await prisma.document.findMany({
      where: { id: { in: documentIds } },
      select: { id: true, path: true },
    });
    const docMap = new Map(documents.map((d) => [d.id, d.path]));

    return assignments.map((a: {
      reviewRequest: {
        id: string;
        title: string;
        status: string;
        documentId: string;
        requesterId: string;
        reviewType: string;
        priority: string;
        createdAt: Date;
        dueDate?: Date;
        assignments: { status: string }[];
        comments: { resolved: boolean }[];
      };
    }) => {
      const r = a.reviewRequest;
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        documentPath: docMap.get(r.documentId) || '',
        requester: r.requesterId,
        reviewType: r.reviewType,
        priority: r.priority,
        assignmentCount: r.assignments.length,
        completedCount: r.assignments.filter((as: { status: string }) => as.status === 'completed')
          .length,
        commentCount: r.comments.length,
        unresolvedComments: r.comments.filter((c: { resolved: boolean }) => !c.resolved).length,
        createdAt: r.createdAt,
        dueDate: r.dueDate,
      };
    });
  }

  /**
   * Generate AI review suggestions for a document
   */
  async generateAIReviewSuggestions(
    documentId: string,
    reviewType: string
  ): Promise<{ suggestions: string[]; score: number }> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return { suggestions: [], score: 0 };
    }

    const anthropic = getAnthropicClient();
    if (!anthropic) {
      return { suggestions: [], score: 0 };
    }

    const prompts: Record<string, string> = {
      content: 'Review this documentation for clarity, completeness, and accuracy.',
      technical: 'Review this documentation for technical accuracy, correct terminology, and proper code examples.',
      style: 'Review this documentation for writing style, grammar, and consistency.',
      all: 'Provide a comprehensive review covering clarity, technical accuracy, and writing style.',
    };

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: `You are a documentation reviewer. ${prompts[reviewType] || prompts.all}

Provide your feedback as a JSON object with:
- suggestions: array of specific, actionable improvement suggestions
- score: quality score from 0-100

Focus on substantive improvements, not minor style preferences.`,
        messages: [
          {
            role: 'user',
            content: `Review this documentation:\n\n${document.content.substring(0, 8000)}`,
          },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          suggestions: parsed.suggestions || [],
          score: parsed.score || 0,
        };
      }
    } catch (error) {
      log.warn({ error, documentId }, 'Failed to generate AI review suggestions');
    }

    return { suggestions: [], score: 0 };
  }

  /**
   * Send notification when review is requested
   */
  private async notifyReviewRequested(reviewRequestId: string): Promise<void> {
    try {
      // Use a generic notification format compatible with existing type
      await addJob(
        QUEUE_NAMES.NOTIFICATIONS,
        {
          type: 'webhook' as const,
          recipient: 'review-system',
          subject: 'Review Requested',
          body: `New review request: ${reviewRequestId}`,
          metadata: { reviewRequestId, action: 'review_requested' },
        },
        {
          jobId: `notify-review-${reviewRequestId}`,
        }
      );
    } catch (error) {
      log.warn({ error, reviewRequestId }, 'Failed to queue review notification');
    }
  }

  /**
   * Send notification when review is completed
   */
  private async notifyReviewCompleted(reviewRequestId: string, status: string): Promise<void> {
    try {
      await addJob(
        QUEUE_NAMES.NOTIFICATIONS,
        {
          type: 'webhook' as const,
          recipient: 'review-system',
          subject: 'Review Completed',
          body: `Review completed: ${reviewRequestId} (${status})`,
          metadata: { reviewRequestId, status, action: 'review_completed' },
        },
        {
          jobId: `notify-review-complete-${reviewRequestId}`,
        }
      );
    } catch (error) {
      log.warn({ error, reviewRequestId }, 'Failed to queue review completion notification');
    }
  }

  /**
   * Cancel a review request
   */
  async cancelReviewRequest(reviewRequestId: string): Promise<void> {
    await db.docReviewRequest.update({
      where: { id: reviewRequestId },
      data: { status: 'cancelled' },
    });
  }

  /**
   * Get review statistics for a repository
   */
  async getReviewStats(repositoryId: string): Promise<{
    total: number;
    pending: number;
    inReview: number;
    approved: number;
    rejected: number;
    changesRequested: number;
    avgTimeToApproval: number;
    overdueCount: number;
  }> {
    const requests = await db.docReviewRequest.findMany({
      where: { repositoryId },
      select: { status: true, createdAt: true, updatedAt: true, dueDate: true },
    });

    const byStatus = requests.reduce(
      (acc: Record<string, number>, r: { status: string }) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      },
      {}
    );

    // Calculate average time to approval
    const approved = requests.filter((r: { status: string }) => r.status === 'approved');
    const avgTime =
      approved.length > 0
        ? approved.reduce(
            (sum: number, r: { createdAt: Date; updatedAt: Date }) =>
              sum + (r.updatedAt.getTime() - r.createdAt.getTime()),
            0
          ) / approved.length
        : 0;

    // Count overdue
    const now = new Date();
    const overdue = requests.filter(
      (r: { status: string; dueDate: Date | null }) =>
        r.dueDate && r.dueDate < now && !['approved', 'rejected', 'cancelled'].includes(r.status)
    ).length;

    return {
      total: requests.length,
      pending: byStatus['pending'] || 0,
      inReview: byStatus['in_review'] || 0,
      approved: byStatus['approved'] || 0,
      rejected: byStatus['rejected'] || 0,
      changesRequested: byStatus['changes_requested'] || 0,
      avgTimeToApproval: Math.round(avgTime / (1000 * 60 * 60)), // hours
      overdueCount: overdue,
    };
  }

  // ============================================
  // Public utility methods (for testing/external use)
  // ============================================

  /**
   * Calculate overall review status from assignments
   */
  calculateStatus(
    assignments: Array<{ decision: string | null; status: string }>
  ): string {
    if (assignments.length === 0) return 'pending';

    const completed = assignments.filter((a) => a.status === 'completed');
    if (completed.length === 0) return 'pending';
    if (completed.length < assignments.length) return 'in_review';

    // All completed - check decisions
    const decisions = completed.map((a) => a.decision);
    if (decisions.some((d) => d === 'reject')) return 'rejected';
    if (decisions.some((d) => d === 'request_changes')) return 'changes_requested';
    if (decisions.every((d) => d === 'approve')) return 'approved';

    return 'in_review';
  }

  /**
   * Validate review type
   */
  isValidReviewType(type: string): boolean {
    return ['content', 'technical', 'style', 'all'].includes(type);
  }

  /**
   * Validate priority
   */
  isValidPriority(priority: string): boolean {
    return ['low', 'normal', 'high', 'urgent'].includes(priority);
  }
}

export const reviewWorkflowService = new ReviewWorkflowService();
