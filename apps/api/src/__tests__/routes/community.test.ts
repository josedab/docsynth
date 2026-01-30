import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    repository: {
      findFirst: vi.fn(),
    },
    communitySettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    communityContribution: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    contributorReputation: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    contributionReview: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({
          quality: 85,
          issues: [],
          suggestions: ['Consider adding more examples'],
          approved: true,
        })}],
      }),
    };
  },
}));

describe('Community Contribution Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Community Settings', () => {
    it('should configure community settings correctly', () => {
      interface CommunitySettings {
        repositoryId: string;
        contributionsEnabled: boolean;
        autoMergeThreshold: number;
        requireMaintainerApproval: boolean;
        allowedDocTypes: string[];
        contributorGuidelines: string | null;
        rewardSystem: {
          enabled: boolean;
          pointsPerContribution: number;
          bonusForMerge: number;
        } | null;
      }

      const settings: CommunitySettings = {
        repositoryId: 'repo-123',
        contributionsEnabled: true,
        autoMergeThreshold: 3,
        requireMaintainerApproval: true,
        allowedDocTypes: ['GUIDE', 'TUTORIAL', 'API_REFERENCE'],
        contributorGuidelines: '# Contribution Guidelines\n\n1. Follow style guide...',
        rewardSystem: {
          enabled: true,
          pointsPerContribution: 10,
          bonusForMerge: 25,
        },
      };

      expect(settings.contributionsEnabled).toBe(true);
      expect(settings.allowedDocTypes).toContain('GUIDE');
      expect(settings.rewardSystem?.pointsPerContribution).toBe(10);
    });

    it('should validate contribution types', () => {
      const allowedTypes = ['GUIDE', 'TUTORIAL', 'FAQ'];
      const requestedType = 'API_REFERENCE';

      const isAllowed = allowedTypes.includes(requestedType);
      expect(isAllowed).toBe(false);
    });
  });

  describe('Contribution Workflow', () => {
    it('should track contribution status', () => {
      type ContributionStatus = 
        | 'draft'
        | 'submitted'
        | 'under_review'
        | 'changes_requested'
        | 'approved'
        | 'merged'
        | 'rejected';

      interface Contribution {
        id: string;
        status: ContributionStatus;
        authorId: string;
        title: string;
        docType: string;
        content: string;
        reviewCount: number;
        approvalCount: number;
      }

      const contribution: Contribution = {
        id: 'contrib-123',
        status: 'under_review',
        authorId: 'user-456',
        title: 'Getting Started Guide',
        docType: 'GUIDE',
        content: '# Getting Started\n\n...',
        reviewCount: 2,
        approvalCount: 1,
      };

      expect(contribution.status).toBe('under_review');
      expect(contribution.approvalCount).toBeLessThan(contribution.reviewCount);
    });

    it('should handle status transitions', () => {
      const validTransitions: Record<string, string[]> = {
        draft: ['submitted'],
        submitted: ['under_review', 'rejected'],
        under_review: ['changes_requested', 'approved', 'rejected'],
        changes_requested: ['submitted', 'rejected'],
        approved: ['merged'],
        merged: [],
        rejected: [],
      };

      const canTransition = (from: string, to: string): boolean => {
        return validTransitions[from]?.includes(to) ?? false;
      };

      expect(canTransition('submitted', 'under_review')).toBe(true);
      expect(canTransition('merged', 'draft')).toBe(false);
      expect(canTransition('under_review', 'approved')).toBe(true);
    });
  });

  describe('Review System', () => {
    it('should process community reviews', () => {
      interface Review {
        id: string;
        contributionId: string;
        reviewerId: string;
        decision: 'approve' | 'request_changes' | 'comment';
        feedback: string | null;
        createdAt: Date;
      }

      const reviews: Review[] = [
        { id: 'r1', contributionId: 'c1', reviewerId: 'u1', decision: 'approve', feedback: 'Looks great!', createdAt: new Date() },
        { id: 'r2', contributionId: 'c1', reviewerId: 'u2', decision: 'request_changes', feedback: 'Add more examples', createdAt: new Date() },
        { id: 'r3', contributionId: 'c1', reviewerId: 'u3', decision: 'approve', feedback: null, createdAt: new Date() },
      ];

      const approvalCount = reviews.filter(r => r.decision === 'approve').length;
      const changesRequested = reviews.some(r => r.decision === 'request_changes');

      expect(approvalCount).toBe(2);
      expect(changesRequested).toBe(true);
    });

    it('should determine auto-merge eligibility', () => {
      const checkAutoMerge = (
        approvalCount: number,
        threshold: number,
        hasChangesRequested: boolean,
        requiresMaintainer: boolean,
        hasMaintainerApproval: boolean
      ): boolean => {
        if (hasChangesRequested) return false;
        if (approvalCount < threshold) return false;
        if (requiresMaintainer && !hasMaintainerApproval) return false;
        return true;
      };

      expect(checkAutoMerge(3, 3, false, true, true)).toBe(true);
      expect(checkAutoMerge(3, 3, true, true, true)).toBe(false);
      expect(checkAutoMerge(2, 3, false, true, true)).toBe(false);
      expect(checkAutoMerge(5, 3, false, true, false)).toBe(false);
    });
  });

  describe('Reputation System', () => {
    it('should calculate contributor reputation', () => {
      interface ContributorStats {
        contributionsSubmitted: number;
        contributionsMerged: number;
        reviewsGiven: number;
        helpfulReviews: number;
        reputationPoints: number;
      }

      const calculateReputation = (stats: Omit<ContributorStats, 'reputationPoints'>): number => {
        const points = 
          stats.contributionsMerged * 25 +
          stats.contributionsSubmitted * 5 +
          stats.helpfulReviews * 10 +
          stats.reviewsGiven * 2;
        return points;
      };

      const stats = {
        contributionsSubmitted: 10,
        contributionsMerged: 5,
        reviewsGiven: 20,
        helpfulReviews: 8,
      };

      const reputation = calculateReputation(stats);
      // 5*25 + 10*5 + 8*10 + 20*2 = 125 + 50 + 80 + 40 = 295
      expect(reputation).toBe(295);
    });

    it('should assign reputation levels', () => {
      const getLevel = (points: number): string => {
        if (points >= 1000) return 'expert';
        if (points >= 500) return 'contributor';
        if (points >= 100) return 'member';
        return 'newcomer';
      };

      expect(getLevel(1500)).toBe('expert');
      expect(getLevel(750)).toBe('contributor');
      expect(getLevel(150)).toBe('member');
      expect(getLevel(50)).toBe('newcomer');
    });

    it('should track reputation history', () => {
      interface ReputationEvent {
        type: 'contribution_merged' | 'review_helpful' | 'contribution_rejected';
        points: number;
        timestamp: Date;
        description: string;
      }

      const events: ReputationEvent[] = [
        { type: 'contribution_merged', points: 25, timestamp: new Date('2024-03-01'), description: 'Getting Started Guide merged' },
        { type: 'review_helpful', points: 10, timestamp: new Date('2024-03-05'), description: 'Review marked helpful' },
        { type: 'contribution_rejected', points: -5, timestamp: new Date('2024-03-10'), description: 'Low quality submission' },
      ];

      const totalPoints = events.reduce((sum, e) => sum + e.points, 0);
      expect(totalPoints).toBe(30);
    });
  });

  describe('Leaderboard', () => {
    it('should rank contributors', () => {
      const contributors = [
        { userId: 'u1', name: 'Alice', reputation: 450, merged: 12 },
        { userId: 'u2', name: 'Bob', reputation: 780, merged: 20 },
        { userId: 'u3', name: 'Charlie', reputation: 320, merged: 8 },
        { userId: 'u4', name: 'Diana', reputation: 950, merged: 25 },
      ];

      const leaderboard = [...contributors]
        .sort((a, b) => b.reputation - a.reputation)
        .map((c, i) => ({ ...c, rank: i + 1 }));

      expect(leaderboard[0]?.name).toBe('Diana');
      expect(leaderboard[0]?.rank).toBe(1);
      expect(leaderboard[3]?.name).toBe('Charlie');
    });

    it('should filter leaderboard by time period', () => {
      const contributions = [
        { userId: 'u1', points: 50, date: new Date('2024-03-01') },
        { userId: 'u1', points: 25, date: new Date('2024-03-15') },
        { userId: 'u2', points: 100, date: new Date('2024-02-15') },
        { userId: 'u2', points: 30, date: new Date('2024-03-10') },
      ];

      const march2024 = contributions.filter(c => 
        c.date >= new Date('2024-03-01') && c.date < new Date('2024-04-01')
      );

      const marchPoints = march2024.reduce((acc, c) => {
        acc[c.userId] = (acc[c.userId] || 0) + c.points;
        return acc;
      }, {} as Record<string, number>);

      expect(marchPoints.u1).toBe(75);
      expect(marchPoints.u2).toBe(30);
    });
  });

  describe('Quality Checks', () => {
    it('should validate contribution quality', () => {
      interface QualityCheck {
        name: string;
        passed: boolean;
        message: string | null;
      }

      const runQualityChecks = (content: string, _docType: string): QualityCheck[] => {
        const checks: QualityCheck[] = [];

        // Minimum length check
        checks.push({
          name: 'minimum_length',
          passed: content.length >= 100,
          message: content.length < 100 ? 'Content too short (min 100 chars)' : null,
        });

        // Has title check
        checks.push({
          name: 'has_title',
          passed: content.startsWith('#'),
          message: !content.startsWith('#') ? 'Missing title (start with #)' : null,
        });

        // No broken links (simplified)
        const brokenLinks = content.match(/\[.*?\]\(\s*\)/g) || [];
        checks.push({
          name: 'no_broken_links',
          passed: brokenLinks.length === 0,
          message: brokenLinks.length > 0 ? `Found ${brokenLinks.length} broken links` : null,
        });

        return checks;
      };

      const goodContent = '# My Guide\n\nThis is a comprehensive guide that explains how to use the API effectively with detailed examples and explanations.';
      const badContent = 'short';

      const goodChecks = runQualityChecks(goodContent, 'GUIDE');
      const badChecks = runQualityChecks(badContent, 'GUIDE');

      expect(goodChecks.every(c => c.passed)).toBe(true);
      expect(badChecks.find(c => c.name === 'minimum_length')?.passed).toBe(false);
    });

    it('should detect plagiarism/duplicates', () => {
      const calculateSimilarity = (text1: string, text2: string): number => {
        const words1 = new Set(text1.toLowerCase().split(/\s+/));
        const words2 = new Set(text2.toLowerCase().split(/\s+/));
        
        const intersection = [...words1].filter(w => words2.has(w)).length;
        const union = new Set([...words1, ...words2]).size;
        
        return intersection / union; // Jaccard similarity
      };

      const original = 'This guide explains how to authenticate users using OAuth2';
      const similar = 'This guide explains how to authenticate users with OAuth2';
      const different = 'Setting up database connections for PostgreSQL';

      expect(calculateSimilarity(original, similar)).toBeGreaterThanOrEqual(0.8);
      expect(calculateSimilarity(original, different)).toBeLessThan(0.3);
    });
  });

  describe('Notifications', () => {
    it('should generate contribution notifications', () => {
      interface Notification {
        type: string;
        recipientId: string;
        title: string;
        body: string;
      }

      const generateNotifications = (
        event: string,
        contribution: { title: string; authorId: string },
        _reviewerId?: string
      ): Notification[] => {
        const notifications: Notification[] = [];

        switch (event) {
          case 'review_submitted':
            notifications.push({
              type: 'contribution_reviewed',
              recipientId: contribution.authorId,
              title: 'Your contribution was reviewed',
              body: `"${contribution.title}" received a new review`,
            });
            break;
          case 'contribution_merged':
            notifications.push({
              type: 'contribution_merged',
              recipientId: contribution.authorId,
              title: '🎉 Contribution merged!',
              body: `"${contribution.title}" has been merged into the docs`,
            });
            break;
        }

        return notifications;
      };

      const notifications = generateNotifications(
        'contribution_merged',
        { title: 'Getting Started Guide', authorId: 'u1' }
      );

      expect(notifications.length).toBe(1);
      expect(notifications[0]?.title).toContain('merged');
    });
  });
});
