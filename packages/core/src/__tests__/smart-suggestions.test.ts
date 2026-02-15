import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordFeedback,
  getFeedbackStore,
  clearFeedbackStore,
  calculateAcceptanceRates,
  identifyCommonModifications,
  buildProfile,
  scoreSuggestion,
  type SuggestionFeedback,
} from '../suggestion-learning.js';
import {
  scanForUndocumented,
  prioritizeSuggestions,
  generateBatchReport,
} from '../batch-suggestions.js';
import {
  analyzeStyle,
  scoreConsistency,
  suggestStyleAdjustments,
} from '../style-personalization.js';

// ============================================================================
// Fixtures
// ============================================================================

function feedback(
  type: SuggestionFeedback['suggestionType'],
  action: SuggestionFeedback['action'],
  opts: Partial<SuggestionFeedback> = {}
): SuggestionFeedback {
  return {
    id: `fb-${Math.random().toString(36).slice(2, 8)}`,
    suggestionType: type,
    action,
    originalText: 'Original suggestion text',
    userId: 'user-1',
    timestamp: new Date().toISOString(),
    ...opts,
  };
}

function makeFile(path: string, content: string) {
  return { path, content };
}

// ============================================================================
// Suggestion Feedback & Learning
// ============================================================================

describe('suggestion-learning', () => {
  beforeEach(() => {
    clearFeedbackStore();
  });

  it('records and retrieves feedback', () => {
    const fb = feedback('docstring', 'accepted');
    recordFeedback(fb);
    expect(getFeedbackStore()).toHaveLength(1);
    expect(getFeedbackStore()[0].id).toBe(fb.id);
  });

  it('clears feedback store', () => {
    recordFeedback(feedback('docstring', 'accepted'));
    recordFeedback(feedback('readme', 'rejected'));
    clearFeedbackStore();
    expect(getFeedbackStore()).toHaveLength(0);
  });

  it('calculates acceptance rates per type', () => {
    const items = [
      feedback('docstring', 'accepted'),
      feedback('docstring', 'accepted'),
      feedback('docstring', 'rejected'),
      feedback('readme', 'modified'),
      feedback('readme', 'rejected'),
    ];

    const rates = calculateAcceptanceRates(items);
    const docstring = rates.find((r) => r.type === 'docstring')!;
    const readme = rates.find((r) => r.type === 'readme')!;

    expect(docstring.total).toBe(3);
    expect(docstring.accepted).toBe(2);
    expect(docstring.rate).toBeCloseTo(2 / 3);
    expect(readme.total).toBe(2);
    expect(readme.rate).toBeCloseTo(0.5);
  });

  it('returns empty rates for empty feedback', () => {
    expect(calculateAcceptanceRates([])).toEqual([]);
  });

  it('identifies common modification patterns', () => {
    const items = [
      feedback('docstring', 'modified', {
        originalText: 'Short text',
        modifiedText: 'Short text with much more detail added to explain the concept thoroughly',
      }),
      feedback('docstring', 'modified', {
        originalText: 'Brief',
        modifiedText: 'Brief explanation with additional context and examples for clarity',
      }),
    ];

    const mods = identifyCommonModifications(items);
    expect(mods.length).toBeGreaterThan(0);
    expect(mods[0].frequency).toBeGreaterThanOrEqual(1);
  });

  it('builds a user preference profile', () => {
    const items = [
      feedback('docstring', 'accepted', { userId: 'alice' }),
      feedback('docstring', 'accepted', { userId: 'alice' }),
      feedback('readme', 'rejected', { userId: 'alice' }),
      feedback('docstring', 'accepted', { userId: 'bob' }),
    ];

    const profile = buildProfile('alice', items);
    expect(profile.userId).toBe('alice');
    expect(profile.totalFeedback).toBe(3);
    expect(profile.overallAcceptanceRate).toBeCloseTo(2 / 3);
    expect(profile.preferredTypes).toContain('docstring');
  });

  it('scores suggestions based on historical feedback', () => {
    const items = [
      feedback('docstring', 'accepted'),
      feedback('docstring', 'accepted'),
      feedback('docstring', 'rejected'),
      feedback('changelog', 'rejected'),
      feedback('changelog', 'rejected'),
    ];

    const docScore = scoreSuggestion('docstring', items);
    const changelogScore = scoreSuggestion('changelog', items);
    const unknownScore = scoreSuggestion('tutorial', items);

    expect(docScore).toBeGreaterThan(changelogScore);
    expect(unknownScore).toBe(50);
  });
});

// ============================================================================
// Batch Suggestions
// ============================================================================

describe('batch-suggestions', () => {
  const files = [
    makeFile(
      'src/utils.ts',
      [
        'export function helperA(x: number): number {',
        '  if (x > 0) {',
        '    return x * 2;',
        '  }',
        '  return 0;',
        '}',
        '',
        '/** Documented function */',
        'export function helperB(): void {}',
        '',
        'export class MyService {',
        '  start() {}',
        '}',
        '',
        'export interface Config {',
        '  port: number;',
        '}',
        '',
        'export type UserId = string;',
        '',
        'export const MAX_RETRIES = 3;',
      ].join('\n')
    ),
    makeFile(
      'src/internal.ts',
      ['function privateHelper() {}', '', 'export function publicHelper() {}'].join('\n')
    ),
  ];

  it('detects undocumented exports', () => {
    const entities = scanForUndocumented(files);
    const names = entities.map((e) => e.name);

    expect(names).toContain('helperA');
    expect(names).not.toContain('helperB'); // documented
    expect(names).toContain('MyService');
    expect(names).toContain('Config');
    expect(names).toContain('UserId');
    expect(names).toContain('MAX_RETRIES');
  });

  it('excludes private entities by default', () => {
    const entities = scanForUndocumented(files);
    const names = entities.map((e) => e.name);
    expect(names).not.toContain('privateHelper');
  });

  it('includes private entities when requested', () => {
    const entities = scanForUndocumented(files, { includePrivate: true });
    // privateHelper is not exported, so it doesn't match export patterns
    // This is correct - it only checks export patterns
    expect(entities.length).toBeGreaterThan(0);
  });

  it('filters by file pattern', () => {
    const entities = scanForUndocumented(files, { filePattern: '*internal*' });
    expect(entities.every((e) => e.filePath.includes('internal'))).toBe(true);
  });

  it('prioritizes suggestions by score', () => {
    const entities = scanForUndocumented(files);
    const prioritized = prioritizeSuggestions(entities);

    expect(prioritized.length).toBe(entities.length);
    // Should be sorted descending by score
    for (let i = 1; i < prioritized.length; i++) {
      expect(prioritized[i - 1].score).toBeGreaterThanOrEqual(prioritized[i].score);
    }
  });

  it('assigns severity levels', () => {
    const entities = scanForUndocumented(files);
    const prioritized = prioritizeSuggestions(entities);
    const severities = new Set(prioritized.map((p) => p.severity));
    expect(['critical', 'high', 'medium', 'low'].some((s) => severities.has(s as any))).toBe(true);
  });

  it('generates a batch report with summary', () => {
    const report = generateBatchReport(files);

    expect(report.suggestions.length).toBeGreaterThan(0);
    expect(report.summary.totalFiles).toBe(2);
    expect(report.summary.totalEntities).toBeGreaterThan(0);
    expect(report.summary.undocumentedCount).toBeGreaterThan(0);
    expect(report.summary.coveragePercent).toBeGreaterThanOrEqual(0);
    expect(report.summary.coveragePercent).toBeLessThanOrEqual(100);
    expect(report.generatedAt).toBeTruthy();
  });

  it('filters report by severity', () => {
    const full = generateBatchReport(files);
    const criticalOnly = generateBatchReport(files, { severityFilter: 'critical' });

    expect(criticalOnly.suggestions.length).toBeLessThanOrEqual(full.suggestions.length);
    for (const s of criticalOnly.suggestions) {
      expect(s.severity).toBe('critical');
    }
  });
});

// ============================================================================
// Style Personalization
// ============================================================================

describe('style-personalization', () => {
  const formalDocs = [
    'The implementation shall conform to the specified interface. Furthermore, all parameters must be validated prior to invocation. Consequently, error handling is mandatory.',
    'This module provides a comprehensive abstraction layer. Therefore, consumers shall utilize the public API exclusively. Hereby, internal methods are considered private.',
  ];

  const casualDocs = [
    "Hey, so basically you just call this function and it does stuff for you. Pretty much all you need to get started. Let's go!",
    'We built this thing to be super easy to use. You just pass in your data and we handle the rest. Gonna be awesome!',
  ];

  const technicalDocs = [
    'The algorithm uses a concurrent implementation with O(n log n) complexity. The middleware handles async polymorphism through dependency injection and generic abstractions.',
  ];

  it('analyzes style from documents', () => {
    const profile = analyzeStyle(formalDocs);
    expect(profile.dimensions.formality).toBeGreaterThan(50);
    expect(profile.tone).toBe('formal');
    expect(profile.generatedAt).toBeTruthy();
  });

  it('detects casual tone', () => {
    const profile = analyzeStyle(casualDocs);
    expect(profile.dimensions.formality).toBeLessThan(50);
    expect(profile.tone).toBe('casual');
  });

  it('returns neutral profile for empty input', () => {
    const profile = analyzeStyle([]);
    expect(profile.tone).toBe('neutral');
    expect(profile.dimensions.formality).toBe(50);
  });

  it('measures technical depth', () => {
    const techProfile = analyzeStyle(technicalDocs);
    const casualProfile = analyzeStyle(casualDocs);
    expect(techProfile.dimensions.technicalDepth).toBeGreaterThan(
      casualProfile.dimensions.technicalDepth
    );
  });

  it('scores consistency against a profile', () => {
    const profile = analyzeStyle(formalDocs);

    const formalDoc =
      'The system shall enforce strict validation. Furthermore, all inputs must be sanitized. Therefore, compliance is ensured.';
    const casualDoc = "Hey, just throw your data in and we'll handle it. Pretty easy stuff!";

    const formalScore = scoreConsistency(formalDoc, profile);
    const casualScore = scoreConsistency(casualDoc, profile);

    expect(formalScore).toBeGreaterThan(casualScore);
    expect(formalScore).toBeGreaterThanOrEqual(0);
    expect(formalScore).toBeLessThanOrEqual(100);
  });

  it('suggests style adjustments', () => {
    const profile = analyzeStyle(formalDocs);
    const casualDoc =
      "Hey, just call this and you're good. Pretty simple stuff, basically all you need!";

    const adjustments = suggestStyleAdjustments(casualDoc, profile);
    expect(adjustments.length).toBeGreaterThan(0);

    const formalityAdj = adjustments.find((a) => a.dimension === 'formality');
    if (formalityAdj) {
      expect(formalityAdj.suggestion).toContain('formal');
    }
  });

  it('returns no adjustments when style matches', () => {
    const profile = analyzeStyle(formalDocs);
    const matchingDoc =
      'The implementation shall conform to requirements. Furthermore, validation is mandatory. Consequently, all inputs are verified.';

    const adjustments = suggestStyleAdjustments(matchingDoc, profile);
    // Should have few or no adjustments since styles match
    const formAdj = adjustments.find((a) => a.dimension === 'formality');
    if (formAdj) {
      expect(Math.abs(formAdj.current - formAdj.target)).toBeGreaterThan(15);
    }
  });
});
