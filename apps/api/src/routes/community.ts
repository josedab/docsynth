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
