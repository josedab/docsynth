/**
 * Community Badge Check Worker
 *
 * Checks and awards badges to community contributors
 * based on their achievements and contributions.
 */

import { createWorker, QUEUE_NAMES, type CommunityBadgeCheckJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('community-badge-check-worker');

// Badge definitions with requirements
const BADGE_DEFINITIONS = [
  {
    slug: 'first-contribution',
    requirement: { contributions: 1 },
    check: (stats: ContributorStats) => stats.contributions >= 1,
  },
  {
    slug: 'prolific-contributor',
    requirement: { contributions: 10 },
    check: (stats: ContributorStats) => stats.contributions >= 10,
  },
  {
    slug: 'documentation-master',
    requirement: { contributions: 50 },
    check: (stats: ContributorStats) => stats.contributions >= 50,
  },
  {
    slug: 'quality-champion',
    requirement: { approvalRate: 0.9, minContributions: 5 },
    check: (stats: ContributorStats) =>
      stats.contributions >= 5 && stats.approvalRate >= 0.9,
  },
  {
    slug: 'helpful-reviewer',
    requirement: { discussionReplies: 10, acceptedReplies: 3 },
    check: (stats: ContributorStats) =>
      stats.discussionReplies >= 10 && stats.acceptedReplies >= 3,
  },
  {
    slug: 'early-adopter',
    requirement: { isEarlyAdopter: true },
    check: (stats: ContributorStats) => stats.isEarlyAdopter,
  },
  {
    slug: 'streak-keeper',
    requirement: { consecutiveWeeks: 4 },
    check: (stats: ContributorStats) => stats.consecutiveWeeks >= 4,
  },
  {
    slug: 'bug-hunter',
    requirement: { fixContributions: 5 },
    check: (stats: ContributorStats) => stats.fixContributions >= 5,
  },
  {
    slug: 'translator',
    requirement: { translationContributions: 3 },
    check: (stats: ContributorStats) => stats.translationContributions >= 3,
  },
  {
    slug: 'community-leader',
    requirement: { totalPoints: 1000 },
    check: (stats: ContributorStats) => stats.totalPoints >= 1000,
  },
];

interface ContributorStats {
  contributions: number;
  approvedCount: number;
  rejectedCount: number;
  approvalRate: number;
  discussionReplies: number;
  acceptedReplies: number;
  isEarlyAdopter: boolean;
  consecutiveWeeks: number;
  fixContributions: number;
  translationContributions: number;
  totalPoints: number;
}

export function startCommunityBadgeCheckWorker() {
  const worker = createWorker(
    QUEUE_NAMES.COMMUNITY_BADGE_CHECK,
    async (job) => {
      const data = job.data as CommunityBadgeCheckJobData;
      const { userId, repositoryId, triggerEvent } = data;

      log.info({ jobId: job.id, userId, triggerEvent }, 'Starting badge check');

      await job.updateProgress(10);

      try {
        // Get contributor stats
        const reputation = await prisma.contributorReputation.findUnique({
          where: { userId },
        });

        if (!reputation) {
          log.info({ userId }, 'No reputation record found');
          return { badgesAwarded: [] };
        }

        await job.updateProgress(20);

        // Get contribution stats
        const contributions = await prisma.communityContribution.findMany({
          where: { contributorId: userId },
          select: {
            status: true,
            contributionType: true,
            createdAt: true,
          },
        });

        // Get discussion stats
        const replies = await prisma.communityReply.findMany({
          where: { authorId: userId },
          select: { isAccepted: true },
        });

        await job.updateProgress(40);

        // Calculate stats
        const approvedContributions = contributions.filter((c) => c.status === 'merged').length;
        const rejectedContributions = contributions.filter((c) => c.status === 'rejected').length;
        const fixContributions = contributions.filter((c) => c.contributionType === 'fix').length;
        const translationContributions = contributions.filter(
          (c) => c.contributionType === 'translation'
        ).length;

        // Check for consecutive weeks of activity
        const weeklyActivity = new Map<string, boolean>();
        contributions.forEach((c) => {
          const weekKey = getWeekKey(c.createdAt);
          weeklyActivity.set(weekKey, true);
        });
        const consecutiveWeeks = calculateConsecutiveWeeks(weeklyActivity);

        // Check if early adopter (joined in first month)
        const firstContribution = contributions[0]?.createdAt;
        const isEarlyAdopter = firstContribution
          ? firstContribution < new Date('2024-02-01')
          : false;

        const stats: ContributorStats = {
          contributions: contributions.length,
          approvedCount: approvedContributions,
          rejectedCount: rejectedContributions,
          approvalRate:
            contributions.length > 0
              ? approvedContributions / (approvedContributions + rejectedContributions || 1)
              : 0,
          discussionReplies: replies.length,
          acceptedReplies: replies.filter((r) => r.isAccepted).length,
          isEarlyAdopter,
          consecutiveWeeks,
          fixContributions,
          translationContributions,
          totalPoints: reputation.totalScore,
        };

        await job.updateProgress(60);

        // Get existing badges
        const existingAwards = await prisma.badgeAward.findMany({
          where: { userId },
          select: { badgeId: true },
        });
        const existingBadgeIds = new Set(existingAwards.map((a) => a.badgeId));

        // Get all available badges
        const availableBadges = await prisma.communityBadge.findMany({
          where: { isActive: true },
        });

        const badgesAwarded: string[] = [];

        await job.updateProgress(70);

        // Check each badge
        for (const badge of availableBadges) {
          // Skip if already awarded
          if (existingBadgeIds.has(badge.id)) continue;

          // Find badge definition
          const definition = BADGE_DEFINITIONS.find((d) => d.slug === badge.slug);
          if (!definition) continue;

          // Check if eligible
          if (definition.check(stats)) {
            // Award the badge
            await prisma.badgeAward.create({
              data: {
                badgeId: badge.id,
                userId,
                repositoryId,
                reason: `Automatically awarded for ${triggerEvent}`,
              },
            });

            // Update reputation points
            if (badge.pointsAwarded > 0) {
              await prisma.contributorReputation.update({
                where: { userId },
                data: {
                  totalScore: { increment: badge.pointsAwarded },
                  badges: {
                    push: badge.slug,
                  },
                },
              });
            }

            badgesAwarded.push(badge.name);
            log.info({ userId, badge: badge.name }, 'Badge awarded');
          }
        }

        await job.updateProgress(90);

        // Update contributor level based on total points
        const updatedReputation = await prisma.contributorReputation.findUnique({
          where: { userId },
        });

        if (updatedReputation) {
          let newLevel = 'newcomer';
          if (updatedReputation.totalScore >= 1000) newLevel = 'expert';
          else if (updatedReputation.totalScore >= 500) newLevel = 'trusted';
          else if (updatedReputation.totalScore >= 100) newLevel = 'contributor';

          if (newLevel !== updatedReputation.level) {
            await prisma.contributorReputation.update({
              where: { userId },
              data: { level: newLevel },
            });
            log.info({ userId, newLevel }, 'Contributor level updated');
          }
        }

        await job.updateProgress(100);

        log.info(
          { userId, badgesAwarded: badgesAwarded.length },
          'Badge check completed'
        );

        return { badgesAwarded };
      } catch (error) {
        log.error({ error, userId }, 'Badge check failed');
        throw error;
      }
    },
    { concurrency: 5 }
  );

  log.info('Community badge check worker started');
  return worker;
}

function getWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // Start of week
  return d.toISOString().split('T')[0];
}

function calculateConsecutiveWeeks(weeklyActivity: Map<string, boolean>): number {
  const weeks = Array.from(weeklyActivity.keys()).sort().reverse();
  let consecutive = 0;

  const now = new Date();
  let checkDate = new Date(now);
  checkDate.setDate(checkDate.getDate() - checkDate.getDay()); // Start of current week

  for (let i = 0; i < 52; i++) {
    // Check up to a year
    const weekKey = checkDate.toISOString().split('T')[0];
    if (weeklyActivity.has(weekKey)) {
      consecutive++;
      checkDate.setDate(checkDate.getDate() - 7);
    } else {
      break;
    }
  }

  return consecutive;
}
