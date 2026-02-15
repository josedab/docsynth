import { describe, it, expect } from 'vitest';
import {
  detectGaps,
  detectSearchGaps,
  detectBounceGaps,
  detectUndocumentedCode,
  rankGaps,
  generateGapReport,
  type SearchQuery,
  type PageBounce,
  type CodePath,
  type ContentGap,
} from '../content-gap-detector.js';
import {
  createExperiment,
  assignVariant,
  chiSquareTest,
  calculateResults,
  type Variant,
  type ConversionEvent,
} from '../ab-testing.js';
import {
  predictStaleness,
  calculateDecayCurve,
  detectSeasonalPatterns,
  generateMaintenanceSchedule,
  type DocRecord,
  type CodeChangeRecord,
} from '../predictive-analytics.js';

// ============================================================================
// Content Gap Detector
// ============================================================================

describe('content-gap-detector', () => {
  describe('detectSearchGaps', () => {
    it('should detect queries with no results as critical', () => {
      const queries: SearchQuery[] = [{ query: 'webhook setup', count: 50, resultsReturned: 0 }];
      const gaps = detectSearchGaps(queries);
      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.type).toBe('no-results');
      expect(gaps[0]!.severity).toBe('critical');
    });

    it('should detect queries with low results as high severity', () => {
      const queries: SearchQuery[] = [{ query: 'rate limiting', count: 30, resultsReturned: 2 }];
      const gaps = detectSearchGaps(queries);
      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.type).toBe('low-results');
      expect(gaps[0]!.severity).toBe('high');
    });

    it('should skip queries with sufficient results', () => {
      const queries: SearchQuery[] = [{ query: 'authentication', count: 100, resultsReturned: 15 }];
      expect(detectSearchGaps(queries)).toHaveLength(0);
    });
  });

  describe('detectBounceGaps', () => {
    it('should detect pages with high bounce rates', () => {
      const pages: PageBounce[] = [{ path: '/docs/api', visits: 200, avgTimeOnPageMs: 3000 }];
      const gaps = detectBounceGaps(pages);
      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.type).toBe('high-bounce');
    });

    it('should skip pages with adequate time on page', () => {
      const pages: PageBounce[] = [{ path: '/docs/guide', visits: 100, avgTimeOnPageMs: 60_000 }];
      expect(detectBounceGaps(pages)).toHaveLength(0);
    });
  });

  describe('detectUndocumentedCode', () => {
    it('should detect code paths without documentation', () => {
      const codePaths: CodePath[] = [
        { filePath: 'src/auth.ts', exportedSymbols: ['login', 'logout'], hasDocumentation: false },
      ];
      const gaps = detectUndocumentedCode(codePaths);
      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.type).toBe('undocumented-code');
    });

    it('should skip documented code', () => {
      const codePaths: CodePath[] = [
        { filePath: 'src/utils.ts', exportedSymbols: ['format'], hasDocumentation: true },
      ];
      expect(detectUndocumentedCode(codePaths)).toHaveLength(0);
    });

    it('should skip files with no exports', () => {
      const codePaths: CodePath[] = [
        { filePath: 'src/internal.ts', exportedSymbols: [], hasDocumentation: false },
      ];
      expect(detectUndocumentedCode(codePaths)).toHaveLength(0);
    });
  });

  describe('detectGaps', () => {
    it('should combine all gap sources', () => {
      const gaps = detectGaps(
        [{ query: 'webhooks', count: 10, resultsReturned: 0 }],
        [{ path: '/docs/old', visits: 50, avgTimeOnPageMs: 2000 }],
        [{ filePath: 'src/api.ts', exportedSymbols: ['handler'], hasDocumentation: false }]
      );
      expect(gaps).toHaveLength(3);
    });
  });

  describe('rankGaps', () => {
    it('should rank by severity then traffic impact', () => {
      const gaps: ContentGap[] = [
        { type: 'high-bounce', subject: '/a', severity: 'low', trafficImpact: 10, details: '' },
        { type: 'no-results', subject: 'b', severity: 'critical', trafficImpact: 100, details: '' },
        { type: 'low-results', subject: 'c', severity: 'high', trafficImpact: 50, details: '' },
      ];
      const ranked = rankGaps(gaps);
      expect(ranked[0]!.severity).toBe('critical');
      expect(ranked[1]!.severity).toBe('high');
      expect(ranked[2]!.severity).toBe('low');
    });
  });

  describe('generateGapReport', () => {
    it('should generate report with recommendations', () => {
      const gaps: ContentGap[] = [
        {
          type: 'no-results',
          subject: 'webhooks',
          severity: 'critical',
          trafficImpact: 200,
          details: '',
        },
        {
          type: 'high-bounce',
          subject: '/old',
          severity: 'medium',
          trafficImpact: 50,
          details: '',
        },
      ];
      const report = generateGapReport(gaps);
      expect(report.criticalCount).toBe(1);
      expect(report.totalTrafficImpact).toBe(250);
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.generatedAt).toBeTruthy();
    });
  });
});

// ============================================================================
// A/B Testing
// ============================================================================

describe('ab-testing', () => {
  const variants: Variant[] = [
    { id: 'control', name: 'Control', trafficPercent: 50 },
    { id: 'treatment', name: 'Treatment', trafficPercent: 50 },
  ];

  describe('createExperiment', () => {
    it('should create an experiment with valid variants', () => {
      const exp = createExperiment('exp-1', 'Button Color Test', variants);
      expect(exp.id).toBe('exp-1');
      expect(exp.variants).toHaveLength(2);
      expect(exp.startDate).toBeTruthy();
    });

    it('should reject variants not summing to 100%', () => {
      const bad: Variant[] = [
        { id: 'a', name: 'A', trafficPercent: 60 },
        { id: 'b', name: 'B', trafficPercent: 60 },
      ];
      expect(() => createExperiment('bad', 'Bad', bad)).toThrow('100%');
    });

    it('should reject fewer than 2 variants', () => {
      expect(() =>
        createExperiment('bad', 'Bad', [{ id: 'a', name: 'A', trafficPercent: 100 }])
      ).toThrow('at least 2');
    });
  });

  describe('assignVariant', () => {
    it('should deterministically assign the same user to the same variant', () => {
      const exp = createExperiment('exp-1', 'Test', variants);
      const v1 = assignVariant(exp, 'user-42');
      const v2 = assignVariant(exp, 'user-42');
      expect(v1.id).toBe(v2.id);
    });

    it('should distribute users across variants', () => {
      const exp = createExperiment('exp-1', 'Test', variants);
      const assignments = new Set<string>();
      for (let i = 0; i < 100; i++) {
        assignments.add(assignVariant(exp, `user-${i}`).id);
      }
      expect(assignments.size).toBe(2);
    });
  });

  describe('chiSquareTest', () => {
    it('should return 0 for identical distributions', () => {
      expect(chiSquareTest([50, 50], [50, 50])).toBe(0);
    });

    it('should return positive value for different distributions', () => {
      expect(chiSquareTest([70, 30], [50, 50])).toBeGreaterThan(0);
    });
  });

  describe('calculateResults', () => {
    it('should calculate results for an experiment', () => {
      const exp = createExperiment('exp-1', 'Test', variants);
      const events: ConversionEvent[] = [];
      for (let i = 0; i < 50; i++) {
        events.push({
          experimentId: 'exp-1',
          variantId: 'control',
          userId: `user-c-${i}`,
          metric: 'feedback-rating',
          value: i < 15 ? 1 : 0,
          timestamp: new Date().toISOString(),
        });
        events.push({
          experimentId: 'exp-1',
          variantId: 'treatment',
          userId: `user-t-${i}`,
          metric: 'feedback-rating',
          value: i < 35 ? 1 : 0,
          timestamp: new Date().toISOString(),
        });
      }

      const results = calculateResults(exp, events);
      expect(results.experimentId).toBe('exp-1');
      expect(results.variants).toHaveLength(2);
      expect(results.confidenceLevel).toBeGreaterThanOrEqual(0);
      expect(results.confidenceLevel).toBeLessThanOrEqual(100);
    });

    it('should handle empty events', () => {
      const exp = createExperiment('exp-1', 'Test', variants);
      const results = calculateResults(exp, []);
      expect(results.significant).toBe(false);
      expect(results.winningVariantId).toBeNull();
    });
  });
});

// ============================================================================
// Predictive Analytics
// ============================================================================

describe('predictive-analytics', () => {
  const now = new Date('2025-01-15T00:00:00Z');

  const docs: DocRecord[] = [
    {
      path: '/docs/api-auth.md',
      lastUpdatedAt: '2024-06-01T00:00:00Z',
      linkedCodePaths: ['src/auth.ts'],
      monthlyPageViews: 2000,
    },
    {
      path: '/docs/getting-started.md',
      lastUpdatedAt: '2025-01-10T00:00:00Z',
      linkedCodePaths: ['src/setup.ts'],
      monthlyPageViews: 500,
    },
  ];

  const codeChanges: CodeChangeRecord[] = [
    {
      filePath: 'src/auth.ts',
      changesLast30Days: 8,
      changesLast90Days: 20,
      lastChangedAt: '2025-01-14T00:00:00Z',
    },
    {
      filePath: 'src/setup.ts',
      changesLast30Days: 1,
      changesLast90Days: 3,
      lastChangedAt: '2025-01-05T00:00:00Z',
    },
  ];

  describe('predictStaleness', () => {
    it('should predict higher staleness for old docs with fast-changing code', () => {
      const predictions = predictStaleness(docs, codeChanges, now);
      expect(predictions).toHaveLength(2);

      const authDoc = predictions.find((p) => p.docPath === '/docs/api-auth.md')!;
      const setupDoc = predictions.find((p) => p.docPath === '/docs/getting-started.md')!;
      expect(authDoc.stalenessScore).toBeGreaterThan(setupDoc.stalenessScore);
    });

    it('should assign urgency levels', () => {
      const predictions = predictStaleness(docs, codeChanges, now);
      for (const p of predictions) {
        expect(['critical', 'high', 'medium', 'low']).toContain(p.urgency);
      }
    });

    it('should handle docs with no linked code', () => {
      const isolated: DocRecord[] = [
        {
          path: '/docs/faq.md',
          lastUpdatedAt: '2025-01-01T00:00:00Z',
          linkedCodePaths: [],
          monthlyPageViews: 100,
        },
      ];
      const predictions = predictStaleness(isolated, [], now);
      expect(predictions).toHaveLength(1);
      expect(predictions[0]!.stalenessScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('calculateDecayCurve', () => {
    it('should generate decay points from 100 to near 0', () => {
      const curve = calculateDecayCurve(90, 365, 30);
      expect(curve[0]!.freshnessScore).toBe(100);
      expect(curve[curve.length - 1]!.freshnessScore).toBeLessThan(20);
    });

    it('should respect step size', () => {
      const curve = calculateDecayCurve(90, 180, 60);
      expect(curve).toHaveLength(4); // 0, 60, 120, 180
    });
  });

  describe('detectSeasonalPatterns', () => {
    it('should calculate relative traffic per month', () => {
      const views = [
        { month: 1, views: 1000 },
        { month: 2, views: 500 },
        { month: 3, views: 1500 },
      ];
      const patterns = detectSeasonalPatterns(views);
      expect(patterns).toHaveLength(3);
      expect(patterns[2]!.relativeTraffic).toBeGreaterThan(1);
      expect(patterns[1]!.relativeTraffic).toBeLessThan(1);
    });

    it('should handle empty input', () => {
      expect(detectSeasonalPatterns([])).toHaveLength(0);
    });

    it('should assign month labels', () => {
      const patterns = detectSeasonalPatterns([{ month: 1, views: 100 }]);
      expect(patterns[0]!.label).toBe('January');
    });
  });

  describe('generateMaintenanceSchedule', () => {
    it('should generate schedule from predictions', () => {
      const predictions = predictStaleness(docs, codeChanges, now);
      const schedule = generateMaintenanceSchedule(predictions, 90, now);
      expect(schedule.tasks.length).toBeGreaterThan(0);
      expect(schedule.totalEstimatedHours).toBeGreaterThan(0);
      expect(schedule.generatedAt).toBeTruthy();
    });

    it('should prioritize critical tasks first', () => {
      const predictions: ReturnType<typeof predictStaleness> = [
        {
          docPath: '/a',
          stalenessScore: 90,
          urgency: 'critical',
          predictedStaleByDate: '2025-01-20',
          reason: 'old',
        },
        {
          docPath: '/b',
          stalenessScore: 30,
          urgency: 'low',
          predictedStaleByDate: '2025-06-01',
          reason: 'ok',
        },
      ];
      const schedule = generateMaintenanceSchedule(predictions, 90, now);
      expect(schedule.tasks[0]!.urgency).toBe('critical');
    });

    it('should return empty schedule when nothing is due', () => {
      const predictions: ReturnType<typeof predictStaleness> = [
        {
          docPath: '/fine',
          stalenessScore: 10,
          urgency: 'low',
          predictedStaleByDate: '2026-01-01',
          reason: 'ok',
        },
      ];
      const schedule = generateMaintenanceSchedule(predictions, 30, now);
      expect(schedule.tasks).toHaveLength(0);
    });
  });
});
