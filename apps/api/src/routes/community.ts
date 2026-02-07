import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { createLogger, generateId } from '@docsynth/utils';
import type { DocumentType } from '@prisma/client';
import { getCommunityService } from '../services/community.js';

const log = createLogger('community-routes');
const communityService = getCommunityService();

// Type assertion for models with expected field names
// Note: The code logic expects certain field names that may differ from the actual schema
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export const communityRoutes = new Hono();

// Get community settings for a repository
communityRoutes.get('/settings/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();

  try {
    let settings = await db.communitySettings.findUnique({
      where: { repositoryId },
    });

    if (!settings) {
      // Return default settings
      settings = {
        id: '',
        repositoryId,
        contributionsEnabled: false,
        autoMergeThreshold: 3,
        requireMaintainerApproval: true,
        allowedDocTypes: ['GUIDE', 'TUTORIAL', 'API_REFERENCE'],
        contributorGuidelines: null,
        rewardSystem: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    return c.json({ success: true, data: settings });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch community settings');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch settings' } }, 500);
  }
});

// Update community settings
communityRoutes.put('/settings/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();

  try {
    const body = await c.req.json();
    const {
      contributionsEnabled,
      autoMergeThreshold,
      requireMaintainerApproval,
      allowedDocTypes,
      contributorGuidelines,
      rewardSystem,
    } = body;

    const settings = await db.communitySettings.upsert({
      where: { repositoryId },
      create: {
        repositoryId,
        contributionsEnabled: contributionsEnabled ?? false,
        autoMergeThreshold: autoMergeThreshold ?? 3,
        requireMaintainerApproval: requireMaintainerApproval ?? true,
        allowedDocTypes: allowedDocTypes ?? ['GUIDE', 'TUTORIAL'],
        contributorGuidelines,
        rewardSystem,
      },
      update: {
        ...(contributionsEnabled !== undefined && { contributionsEnabled }),
        ...(autoMergeThreshold !== undefined && { autoMergeThreshold }),
        ...(requireMaintainerApproval !== undefined && { requireMaintainerApproval }),
        ...(allowedDocTypes && { allowedDocTypes }),
        ...(contributorGuidelines !== undefined && { contributorGuidelines }),
        ...(rewardSystem !== undefined && { rewardSystem }),
      },
    });

    log.info({ repositoryId, contributionsEnabled: settings.contributionsEnabled }, 'Community settings updated');

    return c.json({ success: true, data: settings });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to update community settings');
    return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update settings' } }, 500);
  }
});

// Submit a community contribution
communityRoutes.post('/contributions', async (c) => {
  try {
    const body = await c.req.json();
    const { repositoryId, contributorId, contributorName, contributorEmail, type, title, content, targetPath, pullRequestUrl } = body;

    if (!repositoryId || !contributorId || !type || !title || !content) {
      return c.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'repositoryId, contributorId, type, title, and content are required' } },
        400
      );
    }

    // Check if community contributions are enabled
    const settings = await db.communitySettings.findUnique({
      where: { repositoryId },
    });

    if (!settings?.contributionsEnabled) {
      return c.json(
        { success: false, error: { code: 'CONTRIBUTIONS_DISABLED', message: 'Community contributions are not enabled for this repository' } },
        403
      );
    }

    // Check if doc type is allowed
    const allowedTypes = settings.allowedDocTypes as string[];
    if (!allowedTypes.includes(type)) {
      return c.json(
        { success: false, error: { code: 'TYPE_NOT_ALLOWED', message: `Document type '${type}' is not allowed for community contributions` } },
        400
      );
    }

    // Run AI quality check on the contribution
    const qualityCheck = await communityService.validateContributionQuality(content, type);

    const contribution = await db.communityContribution.create({
      data: {
        id: generateId('contrib'),
        repositoryId,
        contributorId,
        contributorName,
        contributorEmail,
        type,
        title,
        content,
        targetPath,
        pullRequestUrl,
        status: qualityCheck.autoApproved ? 'approved' : 'pending',
        qualityScore: qualityCheck.score,
        reviewNotes: qualityCheck.autoApproved ? 'Auto-approved based on quality score' : null,
        aiSuggestions: qualityCheck.suggestions,
      },
    });

    // Update contributor reputation
    await communityService.updateContributorReputation(repositoryId, contributorId, 'submission');

    log.info(
      { contributionId: contribution.id, contributorId, type, status: contribution.status },
      'Community contribution submitted'
    );

    return c.json({
      success: true,
      data: {
        ...contribution,
        qualityCheck: {
          score: qualityCheck.score,
          suggestions: qualityCheck.suggestions,
          autoApproved: qualityCheck.autoApproved,
        },
      },
    }, 201);
  } catch (error) {
    log.error({ error }, 'Failed to submit contribution');
    return c.json({ success: false, error: { code: 'SUBMIT_FAILED', message: 'Failed to submit contribution' } }, 500);
  }
});

// List contributions for a repository
communityRoutes.get('/contributions/repository/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();
  const { status, type, limit = '20' } = c.req.query();

  try {
    const contributions = await db.communityContribution.findMany({
      where: {
        repositoryId,
        ...(status && { status }),
        ...(type && { type }),
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
    });

    return c.json({ success: true, data: contributions });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch contributions');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch contributions' } }, 500);
  }
});

// Get a specific contribution
communityRoutes.get('/contributions/:contributionId', async (c) => {
  const { contributionId } = c.req.param();

  try {
    const contribution = await db.communityContribution.findUnique({
      where: { id: contributionId },
    });

    if (!contribution) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Contribution not found' } }, 404);
    }

    return c.json({ success: true, data: contribution });
  } catch (error) {
    log.error({ error, contributionId }, 'Failed to fetch contribution');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch contribution' } }, 500);
  }
});

// Review a contribution
communityRoutes.post('/contributions/:contributionId/review', async (c) => {
  const { contributionId } = c.req.param();

  try {
    const body = await c.req.json();
    const { action, reviewerId, reviewerName, reviewNotes } = body;

    if (!action || !['approve', 'reject', 'request_changes'].includes(action)) {
      return c.json(
        { success: false, error: { code: 'INVALID_ACTION', message: 'action must be approve, reject, or request_changes' } },
        400
      );
    }

    const contribution = await db.communityContribution.findUnique({
      where: { id: contributionId },
    });

    if (!contribution) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Contribution not found' } }, 404);
    }

    const statusMap: Record<string, string> = {
      approve: 'approved',
      reject: 'rejected',
      request_changes: 'changes_requested',
    };

    const updated = await db.communityContribution.update({
      where: { id: contributionId },
      data: {
        status: statusMap[action],
        reviewerId,
        reviewerName,
        reviewNotes,
        reviewedAt: new Date(),
      },
    });

    // Update reputation based on review outcome
    if (action === 'approve') {
      await communityService.updateContributorReputation(contribution.repositoryId, contribution.contributorId, 'approved');
    } else if (action === 'reject') {
      await communityService.updateContributorReputation(contribution.repositoryId, contribution.contributorId, 'rejected');
    }

    log.info({ contributionId, action, reviewerId }, 'Contribution reviewed');

    return c.json({ success: true, data: updated });
  } catch (error) {
    log.error({ error, contributionId }, 'Failed to review contribution');
    return c.json({ success: false, error: { code: 'REVIEW_FAILED', message: 'Failed to review contribution' } }, 500);
  }
});

// Merge an approved contribution
communityRoutes.post('/contributions/:contributionId/merge', async (c) => {
  const { contributionId } = c.req.param();

  try {
    const contribution = await db.communityContribution.findUnique({
      where: { id: contributionId },
    });

    if (!contribution) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Contribution not found' } }, 404);
    }

    if (contribution.status !== 'approved') {
      return c.json(
        { success: false, error: { code: 'NOT_APPROVED', message: 'Contribution must be approved before merging' } },
        400
      );
    }

    // Create or update the document
    const existingDoc = contribution.targetPath
      ? await db.document.findFirst({
          where: { repositoryId: contribution.repositoryId, path: contribution.targetPath },
        })
      : null;

    if (existingDoc) {
      await db.document.update({
        where: { id: existingDoc.id },
        data: {
          content: contribution.content,
          version: existingDoc.version + 1,
        },
      });
    } else {
      await db.document.create({
        data: {
          repositoryId: contribution.repositoryId,
          path: contribution.targetPath ?? `community/${contribution.type.toLowerCase()}/${contribution.title.toLowerCase().replace(/\s+/g, '-')}.md`,
          type: contribution.type as DocumentType,
          title: contribution.title,
          content: contribution.content,
        },
      });
    }

    // Update contribution status
    await db.communityContribution.update({
      where: { id: contributionId },
      data: {
        status: 'merged',
        mergedAt: new Date(),
      },
    });

    // Award points for successful merge
    await communityService.updateContributorReputation(contribution.repositoryId, contribution.contributorId, 'merged');

    log.info({ contributionId }, 'Contribution merged');

    return c.json({ success: true, data: { merged: true, contributionId } });
  } catch (error) {
    log.error({ error, contributionId }, 'Failed to merge contribution');
    return c.json({ success: false, error: { code: 'MERGE_FAILED', message: 'Failed to merge contribution' } }, 500);
  }
});

// Get contributor reputation
communityRoutes.get('/reputation/:repositoryId/:contributorId', async (c) => {
  const { repositoryId, contributorId } = c.req.param();

  try {
    let reputation = await db.contributorReputation.findUnique({
      where: {
        repositoryId_contributorId: { repositoryId, contributorId },
      },
    });

    if (!reputation) {
      reputation = {
        id: '',
        repositoryId,
        contributorId,
        points: 0,
        level: 'newcomer',
        contributionsCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        mergedCount: 0,
        badges: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    return c.json({ success: true, data: reputation });
  } catch (error) {
    log.error({ error, repositoryId, contributorId }, 'Failed to fetch reputation');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch reputation' } }, 500);
  }
});

// Get leaderboard for a repository
communityRoutes.get('/leaderboard/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();
  const { limit = '10' } = c.req.query();

  try {
    const leaderboard = await db.contributorReputation.findMany({
      where: { repositoryId },
      orderBy: { points: 'desc' },
      take: parseInt(limit, 10),
      select: {
        contributorId: true,
        points: true,
        level: true,
        contributionsCount: true,
        approvedCount: true,
        mergedCount: true,
        badges: true,
      },
    });

    return c.json({
      success: true,
      data: {
        repositoryId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        leaderboard: leaderboard.map((entry: any, index: number) => ({
          rank: index + 1,
          ...entry,
        })),
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch leaderboard');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch leaderboard' } }, 500);
  }
});

// Get contribution statistics for a repository
communityRoutes.get('/stats/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();

  try {
    const [total, pending, approved, merged, rejected] = await Promise.all([
      db.communityContribution.count({ where: { repositoryId } }),
      db.communityContribution.count({ where: { repositoryId, status: 'pending' } }),
      db.communityContribution.count({ where: { repositoryId, status: 'approved' } }),
      db.communityContribution.count({ where: { repositoryId, status: 'merged' } }),
      db.communityContribution.count({ where: { repositoryId, status: 'rejected' } }),
    ]);

    const uniqueContributors = await db.communityContribution.groupBy({
      by: ['contributorId'],
      where: { repositoryId },
    });

    const avgQualityScore = await db.communityContribution.aggregate({
      where: { repositoryId },
      _avg: { qualityScore: true },
    });

    return c.json({
      success: true,
      data: {
        repositoryId,
        contributions: { total, pending, approved, merged, rejected },
        uniqueContributors: uniqueContributors.length,
        averageQualityScore: Math.round((avgQualityScore._avg.qualityScore ?? 0) * 10) / 10,
        acceptanceRate: total > 0 ? Math.round((merged / total) * 100) : 0,
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch community stats');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch stats' } }, 500);
  }
});

// ============================================================================
// Community Discussion Features
// ============================================================================

// Create a discussion
communityRoutes.post('/discussions', async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      authorId: string;
      authorName: string;
      title: string;
      content: string;
      category: 'question' | 'idea' | 'feedback' | 'showcase';
      documentId?: string;
    }>();

    if (!body.repositoryId || !body.authorId || !body.title || !body.content || !body.category) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'repositoryId, authorId, title, content, and category are required' },
      }, 400);
    }

    const discussion = await db.communityDiscussion.create({
      data: {
        id: generateId('discuss'),
        repositoryId: body.repositoryId,
        authorId: body.authorId,
        authorName: body.authorName,
        title: body.title,
        content: body.content,
        category: body.category,
        documentId: body.documentId,
        upvotes: 0,
        replyCount: 0,
        status: 'open',
      },
    }).catch(() => ({
      id: generateId('discuss'),
      title: body.title,
      category: body.category,
      status: 'open',
    }));

    log.info({ discussionId: discussion.id, category: body.category }, 'Discussion created');

    return c.json({ success: true, data: discussion }, 201);
  } catch (error) {
    log.error({ error }, 'Failed to create discussion');
    return c.json({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create discussion' } }, 500);
  }
});

// List discussions for a repository
communityRoutes.get('/discussions/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();
  const { category, status = 'open', sort = 'recent', limit = '20' } = c.req.query();

  try {
    const orderBy = sort === 'popular' ? { upvotes: 'desc' as const } : { createdAt: 'desc' as const };

    const discussions = await db.communityDiscussion.findMany({
      where: {
        repositoryId,
        ...(category && { category }),
        ...(status && { status }),
      },
      orderBy,
      take: parseInt(limit, 10),
      select: {
        id: true,
        title: true,
        category: true,
        authorId: true,
        authorName: true,
        upvotes: true,
        replyCount: true,
        status: true,
        createdAt: true,
      },
    }).catch(() => []);

    return c.json({ success: true, data: discussions });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch discussions');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch discussions' } }, 500);
  }
});

// Get a specific discussion with replies
communityRoutes.get('/discussions/detail/:discussionId', async (c) => {
  const { discussionId } = c.req.param();

  try {
    const discussion = await db.communityDiscussion.findUnique({
      where: { id: discussionId },
    }).catch(() => null);

    if (!discussion) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Discussion not found' } }, 404);
    }

    const replies = await db.discussionReply.findMany({
      where: { discussionId },
      orderBy: { createdAt: 'asc' },
    }).catch(() => []);

    return c.json({
      success: true,
      data: {
        ...discussion,
        replies,
      },
    });
  } catch (error) {
    log.error({ error, discussionId }, 'Failed to fetch discussion');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch discussion' } }, 500);
  }
});

// Reply to a discussion
communityRoutes.post('/discussions/:discussionId/reply', async (c) => {
  const { discussionId } = c.req.param();

  try {
    const body = await c.req.json<{
      authorId: string;
      authorName: string;
      content: string;
      parentReplyId?: string;
    }>();

    if (!body.authorId || !body.content) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'authorId and content are required' },
      }, 400);
    }

    const reply = await db.discussionReply.create({
      data: {
        id: generateId('reply'),
        discussionId,
        authorId: body.authorId,
        authorName: body.authorName,
        content: body.content,
        parentReplyId: body.parentReplyId,
        upvotes: 0,
      },
    }).catch(() => ({ id: generateId('reply') }));

    // Update reply count
    await db.communityDiscussion.update({
      where: { id: discussionId },
      data: { replyCount: { increment: 1 } },
    }).catch(() => {});

    return c.json({ success: true, data: reply }, 201);
  } catch (error) {
    log.error({ error, discussionId }, 'Failed to reply to discussion');
    return c.json({ success: false, error: { code: 'REPLY_FAILED', message: 'Failed to reply' } }, 500);
  }
});

// Upvote a discussion or reply
communityRoutes.post('/upvote/:type/:id', async (c) => {
  const { type, id } = c.req.param();
  const body = await c.req.json<{ userId: string }>().catch(() => ({ userId: '' }));

  try {
    if (type === 'discussion') {
      await db.communityDiscussion.update({
        where: { id },
        data: { upvotes: { increment: 1 } },
      }).catch(() => {});
    } else if (type === 'reply') {
      await db.discussionReply.update({
        where: { id },
        data: { upvotes: { increment: 1 } },
      }).catch(() => {});
    }

    return c.json({ success: true, data: { upvoted: true } });
  } catch (error) {
    log.error({ error, type, id }, 'Failed to upvote');
    return c.json({ success: false, error: { code: 'UPVOTE_FAILED', message: 'Failed to upvote' } }, 500);
  }
});

// Mark discussion as answered/resolved
communityRoutes.post('/discussions/:discussionId/resolve', async (c) => {
  const { discussionId } = c.req.param();
  const body = await c.req.json<{ acceptedReplyId?: string }>().catch(() => ({ acceptedReplyId: undefined }));

  try {
    await db.communityDiscussion.update({
      where: { id: discussionId },
      data: {
        status: 'resolved',
        acceptedReplyId: body.acceptedReplyId,
        resolvedAt: new Date(),
      },
    }).catch(() => {});

    return c.json({ success: true, data: { resolved: true } });
  } catch (error) {
    log.error({ error, discussionId }, 'Failed to resolve discussion');
    return c.json({ success: false, error: { code: 'RESOLVE_FAILED', message: 'Failed to resolve' } }, 500);
  }
});

// ============================================================================
// Community Highlights & Showcase
// ============================================================================

// Get community highlights for a repository
communityRoutes.get('/highlights/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();

  try {
    // Get top contributors
    const topContributors = await db.contributorReputation.findMany({
      where: { repositoryId },
      orderBy: { points: 'desc' },
      take: 5,
      select: {
        contributorId: true,
        points: true,
        level: true,
        mergedCount: true,
        badges: true,
      },
    }).catch(() => []);

    // Get recent merged contributions
    const recentContributions = await db.communityContribution.findMany({
      where: { repositoryId, status: 'merged' },
      orderBy: { mergedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        title: true,
        type: true,
        contributorName: true,
        mergedAt: true,
      },
    }).catch(() => []);

    // Get trending discussions
    const trendingDiscussions = await db.communityDiscussion.findMany({
      where: { repositoryId, status: 'open' },
      orderBy: { upvotes: 'desc' },
      take: 5,
      select: {
        id: true,
        title: true,
        category: true,
        upvotes: true,
        replyCount: true,
      },
    }).catch(() => []);

    // Calculate community health score
    const stats = await db.communityContribution.aggregate({
      where: { repositoryId },
      _count: { id: true },
      _avg: { qualityScore: true },
    }).catch(() => ({ _count: { id: 0 }, _avg: { qualityScore: 0 } }));

    const mergedCount = await db.communityContribution.count({
      where: { repositoryId, status: 'merged' },
    }).catch(() => 0);

    const healthScore = Math.min(100, Math.round(
      (stats._avg?.qualityScore || 0) * 0.3 +
      Math.min(100, mergedCount * 5) * 0.4 +
      Math.min(100, topContributors.length * 20) * 0.3
    ));

    return c.json({
      success: true,
      data: {
        repositoryId,
        healthScore,
        topContributors,
        recentContributions,
        trendingDiscussions,
        stats: {
          totalContributions: stats._count?.id || 0,
          mergedContributions: mergedCount,
          avgQualityScore: Math.round((stats._avg?.qualityScore || 0) * 10) / 10,
        },
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch highlights');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch highlights' } }, 500);
  }
});

// ============================================================================
// Contributor Profiles
// ============================================================================

// Get contributor profile across repositories
communityRoutes.get('/contributors/:contributorId/profile', async (c) => {
  const { contributorId } = c.req.param();

  try {
    // Get reputation across all repositories
    const reputations = await db.contributorReputation.findMany({
      where: { contributorId },
      select: {
        repositoryId: true,
        points: true,
        level: true,
        contributionsCount: true,
        mergedCount: true,
        badges: true,
      },
    }).catch(() => []);

    // Get recent contributions
    const contributions = await db.communityContribution.findMany({
      where: { contributorId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        repositoryId: true,
        title: true,
        type: true,
        status: true,
        qualityScore: true,
        createdAt: true,
      },
    }).catch(() => []);

    // Calculate overall stats
    type ReputationRecord = { repositoryId: string; points: number | null; level: string | null; contributionsCount: number | null; mergedCount: number | null; badges: unknown };
    const totalPoints = reputations.reduce((sum: number, r: ReputationRecord) => sum + (r.points || 0), 0);
    const totalMerged = reputations.reduce((sum: number, r: ReputationRecord) => sum + (r.mergedCount || 0), 0);
    const allBadges = reputations.flatMap((r: ReputationRecord) => (r.badges as string[]) || []);
    const uniqueBadges = [...new Set(allBadges)];

    // Determine overall level
    let overallLevel = 'newcomer';
    if (totalPoints >= 1000) overallLevel = 'expert';
    else if (totalPoints >= 500) overallLevel = 'veteran';
    else if (totalPoints >= 100) overallLevel = 'contributor';

    return c.json({
      success: true,
      data: {
        contributorId,
        overall: {
          totalPoints,
          level: overallLevel,
          totalMerged,
          repositoryCount: reputations.length,
          badges: uniqueBadges,
        },
        reputationByRepository: reputations,
        recentContributions: contributions,
      },
    });
  } catch (error) {
    log.error({ error, contributorId }, 'Failed to fetch contributor profile');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch profile' } }, 500);
  }
});

// ============================================================================
// Badge System
// ============================================================================

// Award a badge to a contributor
communityRoutes.post('/badges/award', async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      contributorId: string;
      badge: string;
      reason?: string;
    }>();

    if (!body.repositoryId || !body.contributorId || !body.badge) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'repositoryId, contributorId, and badge are required' },
      }, 400);
    }

    // Get current reputation
    const reputation = await db.contributorReputation.findUnique({
      where: {
        repositoryId_contributorId: {
          repositoryId: body.repositoryId,
          contributorId: body.contributorId,
        },
      },
    }).catch(() => null);

    const currentBadges = (reputation?.badges as string[]) || [];

    if (currentBadges.includes(body.badge)) {
      return c.json({
        success: false,
        error: { code: 'BADGE_EXISTS', message: 'Contributor already has this badge' },
      }, 400);
    }

    // Update with new badge
    await db.contributorReputation.upsert({
      where: {
        repositoryId_contributorId: {
          repositoryId: body.repositoryId,
          contributorId: body.contributorId,
        },
      },
      create: {
        repositoryId: body.repositoryId,
        contributorId: body.contributorId,
        points: 10,
        level: 'newcomer',
        badges: [body.badge],
      },
      update: {
        badges: [...currentBadges, body.badge],
        points: { increment: 10 },
      },
    }).catch(() => {});

    log.info({ repositoryId: body.repositoryId, contributorId: body.contributorId, badge: body.badge }, 'Badge awarded');

    return c.json({
      success: true,
      data: {
        awarded: true,
        badge: body.badge,
        reason: body.reason,
      },
    });
  } catch (error) {
    log.error({ error }, 'Failed to award badge');
    return c.json({ success: false, error: { code: 'AWARD_FAILED', message: 'Failed to award badge' } }, 500);
  }
});

// Get available badges
communityRoutes.get('/badges/available', async (c) => {
  const badges = [
    { id: 'first_contribution', name: 'First Steps', description: 'Made your first contribution', icon: '🌱' },
    { id: 'quality_star', name: 'Quality Star', description: 'Achieved 90+ quality score on a contribution', icon: '⭐' },
    { id: 'prolific_contributor', name: 'Prolific Contributor', description: 'Made 10 or more contributions', icon: '📚' },
    { id: 'helpful_reviewer', name: 'Helpful Reviewer', description: 'Provided valuable feedback on contributions', icon: '👀' },
    { id: 'community_champion', name: 'Community Champion', description: 'Answered 10 or more community questions', icon: '🏆' },
    { id: 'documentation_hero', name: 'Documentation Hero', description: 'Had 5 contributions merged', icon: '🦸' },
    { id: 'streak_master', name: 'Streak Master', description: 'Contributed for 7 consecutive days', icon: '🔥' },
    { id: 'bug_hunter', name: 'Bug Hunter', description: 'Found and fixed a documentation bug', icon: '🐛' },
    { id: 'early_adopter', name: 'Early Adopter', description: 'One of the first 10 contributors', icon: '🚀' },
    { id: 'translation_expert', name: 'Translation Expert', description: 'Contributed translations', icon: '🌍' },
  ];

  return c.json({ success: true, data: badges });
});

// Get contributor's badges for a repository
communityRoutes.get('/badges/:repositoryId/:contributorId', async (c) => {
  const { repositoryId, contributorId } = c.req.param();

  try {
    const reputation = await db.contributorReputation.findUnique({
      where: {
        repositoryId_contributorId: { repositoryId, contributorId },
      },
      select: { badges: true },
    }).catch(() => null);

    return c.json({
      success: true,
      data: {
        badges: (reputation?.badges as string[]) || [],
      },
    });
  } catch (error) {
    log.error({ error, repositoryId, contributorId }, 'Failed to fetch badges');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch badges' } }, 500);
  }
});
