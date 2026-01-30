/**
 * Community Contribution Service
 * Handles community documentation contributions, reputation, and gamification
 */

import { prisma } from '@docsynth/database';
import { createLogger, createLLMClient, type LLMClient } from '@docsynth/utils';
import { AI_TOKEN_LIMITS } from '../constants.js';

const log = createLogger('community-service');

// Type assertion for models with expected field names
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface QualityValidationResult {
  score: number;
  suggestions: string[];
  autoApproved: boolean;
}

export interface ReputationStats {
  points: number;
  level: string;
  contributionsCount: number;
  approvedCount: number;
  rejectedCount: number;
  mergedCount: number;
  badges: string[];
}

export type ReputationAction = 'submission' | 'approved' | 'rejected' | 'merged';

// ============================================================================
// Constants
// ============================================================================

const REPUTATION_POINTS: Record<ReputationAction, number> = {
  submission: 1,
  approved: 5,
  rejected: -2,
  merged: 10,
};

const LEVEL_THRESHOLDS: Array<{ threshold: number; level: string }> = [
  { threshold: 500, level: 'legend' },
  { threshold: 200, level: 'expert' },
  { threshold: 100, level: 'veteran' },
  { threshold: 50, level: 'contributor' },
  { threshold: 10, level: 'regular' },
  { threshold: 0, level: 'newcomer' },
];

const BADGE_REQUIREMENTS: Array<{
  id: string;
  check: (stats: ReputationStats) => boolean;
}> = [
  { id: 'first_merge', check: (s) => s.mergedCount >= 1 },
  { id: 'prolific_contributor', check: (s) => s.mergedCount >= 10 },
  { id: 'documentation_hero', check: (s) => s.mergedCount >= 50 },
  { id: 'quality_champion', check: (s) => s.approvedCount >= 5 && s.rejectedCount === 0 },
];

// ============================================================================
// Service Class
// ============================================================================

export class CommunityService {
  private llmClient: LLMClient;

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient ?? createLLMClient('anthropic');
  }

  /**
   * Validate contribution quality using AI
   */
  async validateContributionQuality(
    content: string,
    docType: string
  ): Promise<QualityValidationResult> {
    try {
      const prompt = `Evaluate this documentation contribution for quality.

Document Type: ${docType}

Content:
${content.slice(0, 4000)}

Score this contribution from 0-100 based on:
- Clarity and readability (25%)
- Technical accuracy (25%)
- Completeness (25%)
- Formatting and structure (25%)

Return JSON:
{
  "score": 0-100,
  "suggestions": ["list of specific improvement suggestions"],
  "issues": ["list of any critical issues"]
}

Return ONLY valid JSON.`;

      const response = await this.llmClient.generate(prompt, {
        maxTokens: AI_TOKEN_LIMITS.MEDIUM,
      });

      const text = response.content;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const result = JSON.parse(jsonMatch ? jsonMatch[0] : text);

      const score = result.score ?? 50;
      const suggestions = [...(result.suggestions ?? []), ...(result.issues ?? [])];

      return {
        score,
        suggestions,
        autoApproved: score >= 80 && suggestions.length === 0,
      };
    } catch (error) {
      log.warn({ error }, 'Quality validation failed, using default score');
      return { score: 50, suggestions: ['Manual review recommended'], autoApproved: false };
    }
  }

  /**
   * Update contributor reputation after an action
   */
  async updateContributorReputation(
    repositoryId: string,
    contributorId: string,
    action: ReputationAction
  ): Promise<void> {
    try {
      const existing = await db.contributorReputation.findUnique({
        where: { repositoryId_contributorId: { repositoryId, contributorId } },
      });

      const currentStats: ReputationStats = {
        points: existing?.points ?? 0,
        level: existing?.level ?? 'newcomer',
        contributionsCount: existing?.contributionsCount ?? 0,
        approvedCount: existing?.approvedCount ?? 0,
        rejectedCount: existing?.rejectedCount ?? 0,
        mergedCount: existing?.mergedCount ?? 0,
        badges: (existing?.badges as string[]) ?? [],
      };

      // Update stats based on action
      const newStats = this.applyAction(currentStats, action);

      // Check for new badges
      const newBadges = this.checkForNewBadges(newStats, currentStats.badges);
      newStats.badges = [...currentStats.badges, ...newBadges];

      await db.contributorReputation.upsert({
        where: { repositoryId_contributorId: { repositoryId, contributorId } },
        create: {
          repositoryId,
          contributorId,
          ...newStats,
        },
        update: newStats,
      });

      if (newBadges.length > 0) {
        log.info({ repositoryId, contributorId, newBadges }, 'Contributor earned new badges');
      }
    } catch (error) {
      log.warn({ error, repositoryId, contributorId, action }, 'Failed to update reputation');
    }
  }

  /**
   * Get contributor reputation
   */
  async getContributorReputation(
    repositoryId: string,
    contributorId: string
  ): Promise<ReputationStats> {
    const existing = await db.contributorReputation.findUnique({
      where: { repositoryId_contributorId: { repositoryId, contributorId } },
    });

    if (!existing) {
      return {
        points: 0,
        level: 'newcomer',
        contributionsCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        mergedCount: 0,
        badges: [],
      };
    }

    return {
      points: existing.points,
      level: existing.level,
      contributionsCount: existing.contributionsCount,
      approvedCount: existing.approvedCount,
      rejectedCount: existing.rejectedCount,
      mergedCount: existing.mergedCount,
      badges: (existing.badges as string[]) ?? [],
    };
  }

  /**
   * Apply a reputation action to stats
   */
  private applyAction(stats: ReputationStats, action: ReputationAction): ReputationStats {
    const newStats = { ...stats };
    newStats.points += REPUTATION_POINTS[action];
    newStats.level = this.calculateLevel(newStats.points);

    switch (action) {
      case 'submission':
        newStats.contributionsCount++;
        break;
      case 'approved':
        newStats.approvedCount++;
        break;
      case 'rejected':
        newStats.rejectedCount++;
        break;
      case 'merged':
        newStats.mergedCount++;
        break;
    }

    return newStats;
  }

  /**
   * Calculate contributor level based on points
   */
  private calculateLevel(points: number): string {
    for (const { threshold, level } of LEVEL_THRESHOLDS) {
      if (points >= threshold) {
        return level;
      }
    }
    return 'newcomer';
  }

  /**
   * Check for newly earned badges
   */
  private checkForNewBadges(stats: ReputationStats, existingBadges: string[]): string[] {
    const newBadges: string[] = [];

    for (const { id, check } of BADGE_REQUIREMENTS) {
      if (!existingBadges.includes(id) && check(stats)) {
        newBadges.push(id);
      }
    }

    return newBadges;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let communityServiceInstance: CommunityService | null = null;

export function getCommunityService(): CommunityService {
  if (!communityServiceInstance) {
    communityServiceInstance = new CommunityService();
  }
  return communityServiceInstance;
}

// Export for testing - allows creating instances with mock dependencies
export function createCommunityService(llmClient?: LLMClient): CommunityService {
  return new CommunityService(llmClient);
}
