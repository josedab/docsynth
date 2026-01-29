import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REPOSITORY_CONFIG,
  DEFAULT_FEATURE_FLAGS,
  TIER_LIMITS,
  RATE_LIMITS,
} from '../index.js';

describe('Default Repository Config', () => {
  it('should have default trigger settings', () => {
    expect(DEFAULT_REPOSITORY_CONFIG.triggers.onPRMerge).toBe(true);
    expect(DEFAULT_REPOSITORY_CONFIG.triggers.onPush).toBe(false);
    expect(DEFAULT_REPOSITORY_CONFIG.triggers.branches).toContain('main');
  });

  it('should have default filter settings', () => {
    expect(DEFAULT_REPOSITORY_CONFIG.filters.includePaths).toContain('src/**/*');
    expect(DEFAULT_REPOSITORY_CONFIG.filters.excludePaths).toContain('**/*.test.*');
  });

  it('should have default doc types', () => {
    expect(DEFAULT_REPOSITORY_CONFIG.docTypes.readme).toBe(true);
    expect(DEFAULT_REPOSITORY_CONFIG.docTypes.apiDocs).toBe(true);
    expect(DEFAULT_REPOSITORY_CONFIG.docTypes.changelog).toBe(true);
  });

  it('should have style settings', () => {
    expect(DEFAULT_REPOSITORY_CONFIG.style.tone).toBe('technical');
    expect(DEFAULT_REPOSITORY_CONFIG.style.includeExamples).toBe(true);
  });
});

describe('Default Feature Flags', () => {
  it('should have all required flags', () => {
    expect(DEFAULT_FEATURE_FLAGS).toHaveProperty('enableIntentInference');
    expect(DEFAULT_FEATURE_FLAGS).toHaveProperty('enableStyleLearning');
    expect(DEFAULT_FEATURE_FLAGS).toHaveProperty('enableDiagramGeneration');
    expect(DEFAULT_FEATURE_FLAGS).toHaveProperty('enableSlackIntegration');
    expect(DEFAULT_FEATURE_FLAGS).toHaveProperty('enableJiraIntegration');
    expect(DEFAULT_FEATURE_FLAGS).toHaveProperty('enableConfluenceOutput');
  });

  it('should have boolean values', () => {
    Object.values(DEFAULT_FEATURE_FLAGS).forEach((value) => {
      expect(typeof value).toBe('boolean');
    });
  });

  it('should have intent inference enabled by default', () => {
    expect(DEFAULT_FEATURE_FLAGS.enableIntentInference).toBe(true);
  });
});

describe('Tier Limits', () => {
  it('should have limits for free tier', () => {
    expect(TIER_LIMITS['free']!.maxRepositories).toBe(3);
    expect(TIER_LIMITS['free']!.maxGenerationsPerMonth).toBe(50);
    expect(TIER_LIMITS['free']!.maxTeamMembers).toBe(1);
  });

  it('should have limits for pro tier', () => {
    expect(TIER_LIMITS['pro']!.maxRepositories).toBe(20);
    expect(TIER_LIMITS['pro']!.maxGenerationsPerMonth).toBe(500);
  });

  it('should have limits for team tier', () => {
    expect(TIER_LIMITS['team']!.maxRepositories).toBe(100);
    expect(TIER_LIMITS['team']!.maxTeamMembers).toBe(50);
  });

  it('should have unlimited for enterprise tier', () => {
    expect(TIER_LIMITS['enterprise']!.maxRepositories).toBe(-1);
    expect(TIER_LIMITS['enterprise']!.maxGenerationsPerMonth).toBe(-1);
    expect(TIER_LIMITS['enterprise']!.maxTeamMembers).toBe(-1);
  });

  it('should have feature flags per tier', () => {
    expect(TIER_LIMITS['free']!.features.enableIntentInference).toBe(false);
    expect(TIER_LIMITS['pro']!.features.enableStyleLearning).toBe(true);
    expect(TIER_LIMITS['enterprise']!.features.enableConfluenceOutput).toBe(true);
  });
});

describe('Rate Limits', () => {
  it('should have api rate limits', () => {
    expect(RATE_LIMITS['api']!.windowMs).toBe(60000);
    expect(RATE_LIMITS['api']!.maxRequests).toBe(100);
  });

  it('should have webhook rate limits', () => {
    expect(RATE_LIMITS['webhook']!.windowMs).toBe(60000);
    expect(RATE_LIMITS['webhook']!.maxRequests).toBe(500);
  });

  it('should have generation rate limits', () => {
    expect(RATE_LIMITS['generation']!.windowMs).toBe(3600000);
    expect(RATE_LIMITS['generation']!.maxRequests).toBe(50);
  });
});
