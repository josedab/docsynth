/**
 * Documentation Skill Tree (Gamification) Service
 *
 * Tracks user contributions, awards achievements and badges, manages
 * streaks, and maintains leaderboards to encourage documentation
 * quality and participation.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-gamification-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface UserProfile {
  userId: string;
  level: number;
  xp: number;
  badges: Badge[];
  streaks: Streak;
  rank?: number;
}

export type BadgeCategory = 'writing' | 'reviewing' | 'quality' | 'streak' | 'community';

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: BadgeCategory;
  awardedAt: Date;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  criteria: AchievementCriteria;
  xpReward: number;
}

export type AchievementCriteriaType = 'count' | 'streak' | 'quality' | 'milestone';

export interface AchievementCriteria {
  type: AchievementCriteriaType;
  target: number;
  metric: string;
}

export interface Streak {
  currentDays: number;
  longestDays: number;
  lastActivityAt: Date;
}

export interface LeaderboardEntry {
  userId: string;
  xp: number;
  level: number;
  badgeCount: number;
  rank: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Track a user activity and award XP.
 */
export async function trackActivity(
  userId: string,
  activityType: string,
  metadata?: Record<string, unknown>
): Promise<{ xpAwarded: number; newLevel: boolean }> {
  const xpMap: Record<string, number> = {
    'doc.written': 50,
    'doc.reviewed': 30,
    'doc.updated': 20,
    'question.answered': 25,
    'feedback.given': 10,
    'example.added': 35,
  };

  const xpAwarded = xpMap[activityType] ?? 10;

  const profile = await ensureProfile(userId);
  const newXp = profile.xp + xpAwarded;
  const oldLevel = calculateLevel(profile.xp);
  const newLevel = calculateLevel(newXp);

  await db.gamificationProfile.update({
    where: { userId },
    data: { xp: newXp, level: newLevel, lastActivityAt: new Date() },
  });

  await db.gamificationActivity.create({
    data: {
      userId,
      activityType,
      xpAwarded,
      metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      createdAt: new Date(),
    },
  });

  log.info({ userId, activityType, xpAwarded, newXp }, 'Activity tracked');

  return { xpAwarded, newLevel: newLevel > oldLevel };
}

/**
 * Check all achievements and award any newly unlocked ones.
 */
export async function checkAchievements(userId: string): Promise<Achievement[]> {
  const definitions = getAchievementDefinitions();
  const profile = await ensureProfile(userId);
  const existingBadges = await db.gamificationBadge.findMany({ where: { userId } });
  const existingIds = new Set(existingBadges.map((b: any) => b.badgeId));

  const newlyUnlocked: Achievement[] = [];

  for (const achievement of definitions) {
    if (existingIds.has(achievement.id)) continue;

    const unlocked = await isAchievementUnlocked(userId, achievement, profile);

    if (unlocked) {
      await awardBadge(userId, achievement.id);
      newlyUnlocked.push(achievement);

      // Award XP for the achievement
      const newXp = profile.xp + achievement.xpReward;
      await db.gamificationProfile.update({
        where: { userId },
        data: { xp: newXp, level: calculateLevel(newXp) },
      });

      profile.xp = newXp;
      log.info({ userId, achievementId: achievement.id }, 'Achievement unlocked');
    }
  }

  return newlyUnlocked;
}

/**
 * Award a specific badge to a user.
 */
export async function awardBadge(userId: string, badgeId: string): Promise<Badge> {
  const definitions = getAchievementDefinitions();
  const achievement = definitions.find((a) => a.id === badgeId);

  if (!achievement) {
    throw new Error(`Achievement not found: ${badgeId}`);
  }

  const existing = await db.gamificationBadge.findUnique({
    where: { userId_badgeId: { userId, badgeId } },
  });

  if (existing) {
    return {
      id: existing.badgeId,
      name: achievement.name,
      description: achievement.description,
      icon: getBadgeIcon(badgeId),
      category: getBadgeCategory(badgeId),
      awardedAt: existing.awardedAt,
    };
  }

  const badge = await db.gamificationBadge.create({
    data: {
      userId,
      badgeId,
      awardedAt: new Date(),
    },
  });

  log.info({ userId, badgeId }, 'Badge awarded');

  return {
    id: badgeId,
    name: achievement.name,
    description: achievement.description,
    icon: getBadgeIcon(badgeId),
    category: getBadgeCategory(badgeId),
    awardedAt: badge.awardedAt,
  };
}

/**
 * Get a user's full gamification profile.
 */
export async function getProfile(userId: string): Promise<UserProfile> {
  const profile = await ensureProfile(userId);
  const badges = await db.gamificationBadge.findMany({ where: { userId } });
  const definitions = getAchievementDefinitions();
  const streaks = await computeStreaks(userId);

  const badgeList: Badge[] = badges.map((b: any) => {
    const achievement = definitions.find((a) => a.id === b.badgeId);
    return {
      id: b.badgeId,
      name: achievement?.name ?? b.badgeId,
      description: achievement?.description ?? '',
      icon: getBadgeIcon(b.badgeId),
      category: getBadgeCategory(b.badgeId),
      awardedAt: b.awardedAt,
    };
  });

  return {
    userId,
    level: calculateLevel(profile.xp),
    xp: profile.xp,
    badges: badgeList,
    streaks,
    rank: profile.rank ?? undefined,
  };
}

/**
 * Get leaderboard, optionally scoped to a repository.
 */
export async function getLeaderboard(
  repositoryId?: string,
  limit = 20
): Promise<LeaderboardEntry[]> {
  let profiles;

  if (repositoryId) {
    const contributors = await db.gamificationActivity.findMany({
      where: { metadata: { path: ['repositoryId'], equals: repositoryId } },
      distinct: ['userId'],
      select: { userId: true },
    });
    profiles = await db.gamificationProfile.findMany({
      where: { userId: { in: contributors.map((c: any) => c.userId) } },
      orderBy: { xp: 'desc' },
      take: limit,
    });
  } else {
    profiles = await db.gamificationProfile.findMany({ orderBy: { xp: 'desc' }, take: limit });
  }

  const badgeCounts = await db.gamificationBadge.groupBy({
    by: ['userId'],
    _count: { badgeId: true },
  });
  const badgeMap = new Map(badgeCounts.map((b: any) => [b.userId, b._count.badgeId]));

  return profiles.map((p: any, index: number) => ({
    userId: p.userId,
    xp: p.xp,
    level: calculateLevel(p.xp),
    badgeCount: badgeMap.get(p.userId) ?? 0,
    rank: index + 1,
  }));
}

/**
 * Compute streak information for a user.
 */
export async function computeStreaks(userId: string): Promise<Streak> {
  const activities = await db.gamificationActivity.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  if (activities.length === 0) {
    return { currentDays: 0, longestDays: 0, lastActivityAt: new Date(0) };
  }

  // Group activities by day
  const days = new Set<string>();
  for (const activity of activities) {
    days.add(activity.createdAt.toISOString().split('T')[0]);
  }

  const sortedDays = Array.from(days).sort().reverse();
  const today = new Date().toISOString().split('T')[0];

  // Calculate current streak
  let currentDays = 0;
  if (sortedDays[0] === today || isYesterday(sortedDays[0])) {
    currentDays = 1;
    for (let i = 1; i < sortedDays.length; i++) {
      if (isConsecutive(sortedDays[i], sortedDays[i - 1])) currentDays++;
      else break;
    }
  }

  let longestDays = 1;
  let currentRun = 1;
  for (let i = 1; i < sortedDays.length; i++) {
    if (isConsecutive(sortedDays[i], sortedDays[i - 1])) {
      currentRun++;
      longestDays = Math.max(longestDays, currentRun);
    } else currentRun = 1;
  }

  return {
    currentDays,
    longestDays: Math.max(longestDays, currentDays),
    lastActivityAt: activities[0].createdAt,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function calculateLevel(xp: number): number {
  if (xp <= 0) return 1;
  let level = 1,
    threshold = 100,
    accumulated = 0;
  while (accumulated + threshold <= xp) {
    accumulated += threshold;
    level++;
    threshold = level * 100;
  }
  return level;
}

/**
 * Get the built-in achievement definitions.
 */
function getAchievementDefinitions(): Achievement[] {
  return [
    {
      id: 'first-doc',
      name: 'First Steps',
      description: 'Write your first documentation',
      criteria: { type: 'count', target: 1, metric: 'doc.written' },
      xpReward: 100,
    },
    {
      id: 'prolific-writer',
      name: 'Prolific Writer',
      description: 'Write 10 documentation pages',
      criteria: { type: 'count', target: 10, metric: 'doc.written' },
      xpReward: 500,
    },
    {
      id: 'reviewer',
      name: 'Keen Reviewer',
      description: 'Review 5 documentation pages',
      criteria: { type: 'count', target: 5, metric: 'doc.reviewed' },
      xpReward: 300,
    },
    {
      id: 'quality-champion',
      name: 'Quality Champion',
      description: 'Have 3 docs with quality score above 90',
      criteria: { type: 'quality', target: 3, metric: 'quality_score_above_90' },
      xpReward: 750,
    },
    {
      id: 'week-streak',
      name: 'Week Warrior',
      description: 'Maintain a 7-day contribution streak',
      criteria: { type: 'streak', target: 7, metric: 'daily_activity' },
      xpReward: 200,
    },
    {
      id: 'month-streak',
      name: 'Monthly Marathon',
      description: 'Maintain a 30-day contribution streak',
      criteria: { type: 'streak', target: 30, metric: 'daily_activity' },
      xpReward: 1000,
    },
    {
      id: 'community-helper',
      name: 'Community Helper',
      description: 'Answer 5 documentation questions',
      criteria: { type: 'count', target: 5, metric: 'question.answered' },
      xpReward: 400,
    },
    {
      id: 'doc-mentor',
      name: 'Doc Mentor',
      description: 'Review 20 documentation pages',
      criteria: { type: 'count', target: 20, metric: 'doc.reviewed' },
      xpReward: 800,
    },
  ];
}

/**
 * Check if a specific achievement is unlocked for a user.
 */
async function isAchievementUnlocked(
  userId: string,
  achievement: Achievement,
  profile: any
): Promise<boolean> {
  const { criteria } = achievement;

  switch (criteria.type) {
    case 'count': {
      const count = await db.gamificationActivity.count({
        where: { userId, activityType: criteria.metric },
      });
      return count >= criteria.target;
    }
    case 'streak': {
      const streaks = await computeStreaks(userId);
      return streaks.longestDays >= criteria.target;
    }
    case 'quality': {
      const count = await db.docBenchmarkResult.count({ where: { overallScore: { gte: 0.9 } } });
      return count >= criteria.target;
    }
    case 'milestone':
      return profile.xp >= criteria.target;
    default:
      return false;
  }
}

/**
 * Ensure a gamification profile exists for a user.
 */
async function ensureProfile(userId: string): Promise<any> {
  return db.gamificationProfile.upsert({
    where: { userId },
    create: { userId, xp: 0, level: 1, lastActivityAt: new Date() },
    update: {},
  });
}

const BADGE_META: Record<string, { icon: string; category: BadgeCategory }> = {
  'first-doc': { icon: '📝', category: 'writing' },
  'prolific-writer': { icon: '✍️', category: 'writing' },
  reviewer: { icon: '🔍', category: 'reviewing' },
  'quality-champion': { icon: '🏆', category: 'quality' },
  'week-streak': { icon: '🔥', category: 'streak' },
  'month-streak': { icon: '💎', category: 'streak' },
  'community-helper': { icon: '🤝', category: 'community' },
  'doc-mentor': { icon: '🎓', category: 'reviewing' },
};

function getBadgeIcon(badgeId: string): string {
  return BADGE_META[badgeId]?.icon ?? '⭐';
}

function getBadgeCategory(badgeId: string): BadgeCategory {
  return BADGE_META[badgeId]?.category ?? 'writing';
}

function isYesterday(dateStr: string): boolean {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return dateStr === yesterday.toISOString().split('T')[0];
}

function isConsecutive(earlier: string, later: string): boolean {
  const diffMs = new Date(later).getTime() - new Date(earlier).getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000)) === 1;
}
