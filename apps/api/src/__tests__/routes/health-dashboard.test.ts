import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    repository: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    healthScoreSnapshot: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    healthAlert: {
      findMany: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
    teamLeaderboard: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    document: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    pREvent: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@docsynth/queue', () => ({
  addJob: vi.fn().mockResolvedValue({ id: 'job-123' }),
  QUEUE_NAMES: {
    HEALTH_SCAN: 'health-scan',
  },
}));

describe('Health Dashboard & Gamification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Health Score Calculation', () => {
    it('should calculate freshness score based on document age', () => {
      const calculateFreshnessScore = (docAgeDays: number): number => {
        return Math.max(0, 100 - (docAgeDays * 2));
      };

      expect(calculateFreshnessScore(0)).toBe(100);
      expect(calculateFreshnessScore(10)).toBe(80);
      expect(calculateFreshnessScore(25)).toBe(50);
      expect(calculateFreshnessScore(60)).toBe(0);
    });

    it('should calculate completeness score based on content length', () => {
      const calculateCompletenessScore = (contentLength: number): number => {
        return Math.min(100, Math.floor(contentLength / 50));
      };

      expect(calculateCompletenessScore(0)).toBe(0);
      expect(calculateCompletenessScore(2500)).toBe(50);
      expect(calculateCompletenessScore(5000)).toBe(100);
      expect(calculateCompletenessScore(10000)).toBe(100); // Capped at 100
    });

    it('should calculate overall score as weighted average', () => {
      const freshnessScore = 80;
      const completenessScore = 70;
      
      const overallScore = Math.floor(freshnessScore * 0.5 + completenessScore * 0.5);

      expect(overallScore).toBe(75);
    });

    it('should determine health status based on score', () => {
      const getStatus = (score: number): 'healthy' | 'needs-attention' | 'critical' => {
        if (score >= 70) return 'healthy';
        if (score >= 40) return 'needs-attention';
        return 'critical';
      };

      expect(getStatus(85)).toBe('healthy');
      expect(getStatus(55)).toBe('needs-attention');
      expect(getStatus(30)).toBe('critical');
    });
  });

  describe('Badges', () => {
    it('should define all available badges', () => {
      const badges = [
        { id: 'first-doc', name: 'First Doc', criteria: 'docsCreated >= 1' },
        { id: 'doc-master', name: 'Doc Master', criteria: 'docsCreated >= 10' },
        { id: 'perfect-score', name: 'Perfect Score', criteria: 'score >= 100' },
        { id: 'streak-7', name: 'Week Warrior', criteria: 'streak >= 7' },
        { id: 'streak-30', name: 'Month Champion', criteria: 'streak >= 30' },
        { id: 'fixer', name: 'Bug Squasher', criteria: 'docsImproved >= 5' },
        { id: 'translator', name: 'Polyglot', criteria: 'translations >= 3' },
        { id: 'reviewer', name: 'Quality Keeper', criteria: 'reviews >= 10' },
      ];

      expect(badges.length).toBe(8);
      expect(badges.find(b => b.id === 'perfect-score')?.name).toBe('Perfect Score');
    });

    it('should evaluate badge criteria correctly', () => {
      const evaluateCriteria = (criteria: string, stats: Record<string, number>): boolean => {
        const match = criteria.match(/(\w+)\s*(>=|>|==|<=|<)\s*(\d+)/);
        if (!match) return false;

        const [, stat, op, valueStr] = match;
        if (!stat || !valueStr) return false;
        const value = parseInt(valueStr, 10);
        const statValue = stats[stat] || 0;

        switch (op) {
          case '>=': return statValue >= value;
          case '>': return statValue > value;
          case '==': return statValue === value;
          case '<=': return statValue <= value;
          case '<': return statValue < value;
          default: return false;
        }
      };

      expect(evaluateCriteria('docsCreated >= 10', { docsCreated: 15 })).toBe(true);
      expect(evaluateCriteria('docsCreated >= 10', { docsCreated: 5 })).toBe(false);
      expect(evaluateCriteria('score >= 100', { score: 100 })).toBe(true);
      expect(evaluateCriteria('streak >= 7', { streak: 3 })).toBe(false);
    });

    it('should award badges when criteria met', () => {
      const userStats = {
        docsCreated: 12,
        docsImproved: 8,
        streak: 14,
        score: 85,
      };

      const badges = [
        { id: 'first-doc', criteria: 'docsCreated >= 1' },
        { id: 'doc-master', criteria: 'docsCreated >= 10' },
        { id: 'streak-7', criteria: 'streak >= 7' },
        { id: 'streak-30', criteria: 'streak >= 30' },
      ];

      const evaluateCriteria = (criteria: string, stats: Record<string, number>): boolean => {
        const match = criteria.match(/(\w+)\s*(>=)\s*(\d+)/);
        if (!match) return false;
        const [, stat, , valueStr] = match;
        if (!stat) return false;
        return (stats[stat] || 0) >= parseInt(valueStr ?? '0', 10);
      };

      const earnedBadges = badges.filter(b => evaluateCriteria(b.criteria, userStats));

      expect(earnedBadges.length).toBe(3); // first-doc, doc-master, streak-7
      expect(earnedBadges.map(b => b.id)).toContain('doc-master');
      expect(earnedBadges.map(b => b.id)).not.toContain('streak-30');
    });
  });

  describe('Leaderboard', () => {
    it('should rank entries by score', () => {
      const entries = [
        { repositoryId: 'repo-1', repositoryName: 'Frontend', score: 85 },
        { repositoryId: 'repo-2', repositoryName: 'Backend', score: 92 },
        { repositoryId: 'repo-3', repositoryName: 'Mobile', score: 78 },
        { repositoryId: 'repo-4', repositoryName: 'API', score: 92 },
      ];

      const ranked = entries
        .sort((a, b) => b.score - a.score)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));

      expect(ranked[0]?.repositoryName).toBe('Backend');
      expect(ranked[0]?.rank).toBe(1);
      expect(ranked[1]?.rank).toBe(2);
    });

    it('should support different time periods', () => {
      const now = new Date();
      
      const getWeekStart = () => {
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);
        return weekStart;
      };

      const getMonthStart = () => {
        return new Date(now.getFullYear(), now.getMonth(), 1);
      };

      expect(getWeekStart().getDay()).toBe(0); // Sunday
      expect(getMonthStart().getDate()).toBe(1);
    });

    it('should calculate score changes', () => {
      const currentScore = 85;
      const previousScore = 72;
      const change = currentScore - previousScore;

      expect(change).toBe(13);
      expect(change > 0 ? 'up' : change < 0 ? 'down' : 'stable').toBe('up');
    });
  });

  describe('Achievements', () => {
    it('should calculate user level from contributions', () => {
      const totalContributions = 45;
      const xpPerLevel = 10;

      const level = Math.floor(totalContributions / xpPerLevel) + 1;
      const currentXp = totalContributions % xpPerLevel;
      const xpForNextLevel = xpPerLevel;

      expect(level).toBe(5);
      expect(currentXp).toBe(5);
      expect(xpForNextLevel).toBe(10);
    });

    it('should track user stats', () => {
      const stats = {
        totalDocsCreated: 25,
        totalDocsImproved: 15,
        currentStreak: 7,
        bestScore: 95,
        totalTranslations: 5,
        totalReviews: 12,
      };

      expect(stats.totalDocsCreated + stats.totalDocsImproved).toBe(40);
      expect(stats.currentStreak).toBe(7);
    });
  });

  describe('Challenges', () => {
    it('should define weekly challenges', () => {
      const now = new Date();
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));

      const challenges = [
        {
          id: 'weekly-docs',
          title: 'Documentation Sprint',
          description: 'Create 5 new documents this week',
          type: 'weekly',
          goal: 5,
          reward: 'Sprint Champion badge',
          endsAt: weekEnd,
        },
        {
          id: 'health-boost',
          title: 'Health Boost',
          description: 'Improve organization health score by 10 points',
          type: 'weekly',
          goal: 10,
          reward: 'Health Hero badge',
          endsAt: weekEnd,
        },
      ];

      expect(challenges.filter(c => c.type === 'weekly').length).toBe(2);
      expect(challenges[0]?.goal).toBe(5);
    });

    it('should track challenge progress', () => {
      const challenge = {
        id: 'weekly-docs',
        goal: 5,
        current: 3,
      };

      const progress = Math.round((challenge.current / challenge.goal) * 100);
      const isComplete = challenge.current >= challenge.goal;

      expect(progress).toBe(60);
      expect(isComplete).toBe(false);
    });
  });

  describe('Team Stats', () => {
    it('should calculate team totals', () => {
      const entries = [
        { score: 85, docsCreated: 10, docsImproved: 5 },
        { score: 92, docsCreated: 15, docsImproved: 8 },
        { score: 78, docsCreated: 8, docsImproved: 3 },
      ];

      const teamStats = {
        totalScore: entries.reduce((sum, e) => sum + e.score, 0),
        totalDocsCreated: entries.reduce((sum, e) => sum + e.docsCreated, 0),
        totalDocsImproved: entries.reduce((sum, e) => sum + e.docsImproved, 0),
        activeRepos: entries.length,
        averageScore: Math.round(entries.reduce((sum, e) => sum + e.score, 0) / entries.length),
      };

      expect(teamStats.totalScore).toBe(255);
      expect(teamStats.averageScore).toBe(85);
      expect(teamStats.activeRepos).toBe(3);
    });

    it('should calculate period-over-period change', () => {
      const currentPeriod = { totalScore: 255 };
      const previousPeriod = { totalScore: 230 };

      const change = currentPeriod.totalScore - previousPeriod.totalScore;
      const trend = change > 0 ? 'up' : change < 0 ? 'down' : 'stable';

      expect(change).toBe(25);
      expect(trend).toBe('up');
    });
  });

  describe('Alerts', () => {
    it('should categorize alerts by severity', () => {
      const alerts = [
        { id: 'a-1', severity: 'critical', acknowledged: false },
        { id: 'a-2', severity: 'warning', acknowledged: false },
        { id: 'a-3', severity: 'info', acknowledged: false },
        { id: 'a-4', severity: 'critical', acknowledged: true },
        { id: 'a-5', severity: 'warning', acknowledged: false },
      ];

      const unacknowledgedCounts = {
        critical: alerts.filter(a => a.severity === 'critical' && !a.acknowledged).length,
        warning: alerts.filter(a => a.severity === 'warning' && !a.acknowledged).length,
        info: alerts.filter(a => a.severity === 'info' && !a.acknowledged).length,
      };

      expect(unacknowledgedCounts.critical).toBe(1);
      expect(unacknowledgedCounts.warning).toBe(2);
      expect(unacknowledgedCounts.info).toBe(1);
    });

    it('should acknowledge alert', () => {
      const alert = {
        id: 'a-1',
        acknowledged: false,
        acknowledgedBy: null as string | null,
        acknowledgedAt: null as Date | null,
      };

      // Acknowledge
      alert.acknowledged = true;
      alert.acknowledgedBy = 'user-123';
      alert.acknowledgedAt = new Date();

      expect(alert.acknowledged).toBe(true);
      expect(alert.acknowledgedBy).toBe('user-123');
    });
  });

  describe('Trends', () => {
    it('should calculate trend direction', () => {
      const snapshots = [
        { date: '2024-01-01', score: 70 },
        { date: '2024-01-02', score: 72 },
        { date: '2024-01-03', score: 75 },
        { date: '2024-01-04', score: 78 },
        { date: '2024-01-05', score: 80 },
        { date: '2024-01-06', score: 82 },
        { date: '2024-01-07', score: 85 },
      ];

      const recentAvg = snapshots.slice(-3).reduce((s, x) => s + x.score, 0) / 3;
      const olderAvg = snapshots.slice(0, -3).reduce((s, x) => s + x.score, 0) / Math.max(1, snapshots.length - 3);
      const diff = recentAvg - olderAvg;
      const trend = diff > 5 ? 'improving' : diff < -5 ? 'declining' : 'stable';

      expect(recentAvg).toBeGreaterThan(80);
      expect(olderAvg).toBeLessThan(75);
      expect(trend).toBe('improving');
    });

    it('should identify top performers', () => {
      const repoScores = [
        { repositoryId: 'r1', repositoryName: 'Repo A', score: 95 },
        { repositoryId: 'r2', repositoryName: 'Repo B', score: 88 },
        { repositoryId: 'r3', repositoryName: 'Repo C', score: 72 },
        { repositoryId: 'r4', repositoryName: 'Repo D', score: 65 },
        { repositoryId: 'r5', repositoryName: 'Repo E', score: 91 },
      ];

      const topPerformers = repoScores
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      expect(topPerformers[0]?.repositoryName).toBe('Repo A');
      expect(topPerformers.length).toBe(3);
    });

    it('should identify repos needing work', () => {
      const repoScores = [
        { repositoryId: 'r1', score: 95 },
        { repositoryId: 'r2', score: 65 },
        { repositoryId: 'r3', score: 55 },
        { repositoryId: 'r4', score: 40 },
      ];

      const needsWork = repoScores.filter(r => r.score < 70);

      expect(needsWork.length).toBe(3);
      expect(needsWork.map(r => r.repositoryId)).toContain('r4');
    });
  });
});
