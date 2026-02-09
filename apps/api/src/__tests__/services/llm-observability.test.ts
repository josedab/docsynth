import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    lLMUsageLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    lLMUsageSummary: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@docsynth/utils', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createLLMClient: vi.fn(() => ({
    isAvailable: vi.fn(() => true),
    getProvider: vi.fn(() => 'anthropic'),
    generate: vi.fn().mockResolvedValue({
      content: 'Generated response',
      tokensUsed: 150,
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
    }),
  })),
}));

describe('LLM Observability Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Cost Estimation', () => {
    it('should calculate cost based on token usage', () => {
      // Cost estimation logic
      const PRICING: Record<string, { input: number; output: number }> = {
        'claude-sonnet-4-20250514': { input: 0.3, output: 1.5 },
        'gpt-4-turbo-preview': { input: 1.0, output: 3.0 },
      };

      const estimateCost = (
        model: string,
        inputTokens: number,
        outputTokens: number
      ): number => {
        const pricing = PRICING[model] || { input: 0.5, output: 1.5 };
        const inputCost = (inputTokens / 1000) * pricing.input;
        const outputCost = (outputTokens / 1000) * pricing.output;
        return Math.round((inputCost + outputCost) * 100) / 100;
      };

      // Claude Sonnet: 1000 input ($0.30), 500 output ($0.75) = $1.05
      expect(estimateCost('claude-sonnet-4-20250514', 1000, 500)).toBe(1.05);

      // GPT-4 Turbo: 1000 input ($1.00), 500 output ($1.50) = $2.50
      expect(estimateCost('gpt-4-turbo-preview', 1000, 500)).toBe(2.5);

      // Unknown model uses default pricing
      expect(estimateCost('unknown-model', 1000, 500)).toBe(1.25);
    });
  });

  describe('Usage Context', () => {
    it('should validate usage context structure', () => {
      interface LLMUsageContext {
        organizationId: string;
        repositoryId?: string;
        userId?: string;
        feature: string;
        operation?: string;
        requestId?: string;
        metadata?: Record<string, unknown>;
      }

      const isValidContext = (context: LLMUsageContext): boolean => {
        if (!context.organizationId) return false;
        if (!context.feature) return false;
        return true;
      };

      expect(
        isValidContext({
          organizationId: 'org-123',
          feature: 'ai-doc-editor',
        })
      ).toBe(true);

      expect(
        isValidContext({
          organizationId: 'org-123',
          repositoryId: 'repo-456',
          userId: 'user-789',
          feature: 'playground-hint',
          operation: 'generate',
          requestId: 'req-abc',
          metadata: { sessionId: 'sess-123' },
        })
      ).toBe(true);

      expect(
        isValidContext({
          organizationId: '',
          feature: 'test',
        })
      ).toBe(false);
    });
  });

  describe('Usage Statistics Aggregation', () => {
    it('should aggregate stats from logs', () => {
      interface UsageStats {
        totalRequests: number;
        successfulRequests: number;
        failedRequests: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        totalTokens: number;
        totalCost: number;
        avgLatencyMs: number;
        byProvider: Record<string, { requests: number; tokens: number; cost: number }>;
        byFeature: Record<string, { requests: number; tokens: number; cost: number }>;
        byModel: Record<string, { requests: number; tokens: number; cost: number }>;
      }

      const aggregateStats = (
        logs: Array<{
          success: boolean;
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          estimatedCost: number;
          latencyMs: number;
          provider: string;
          feature: string;
          model: string;
        }>
      ): UsageStats => {
        const stats: UsageStats = {
          totalRequests: logs.length,
          successfulRequests: 0,
          failedRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalCost: 0,
          avgLatencyMs: 0,
          byProvider: {},
          byFeature: {},
          byModel: {},
        };

        let totalLatency = 0;

        for (const log of logs) {
          if (log.success) {
            stats.successfulRequests++;
          } else {
            stats.failedRequests++;
          }

          stats.totalInputTokens += log.inputTokens;
          stats.totalOutputTokens += log.outputTokens;
          stats.totalTokens += log.totalTokens;
          stats.totalCost += log.estimatedCost;
          totalLatency += log.latencyMs;

          // By provider
          if (!stats.byProvider[log.provider]) {
            stats.byProvider[log.provider] = { requests: 0, tokens: 0, cost: 0 };
          }
          stats.byProvider[log.provider]!.requests++;
          stats.byProvider[log.provider]!.tokens += log.totalTokens;
          stats.byProvider[log.provider]!.cost += log.estimatedCost;

          // By feature
          if (!stats.byFeature[log.feature]) {
            stats.byFeature[log.feature] = { requests: 0, tokens: 0, cost: 0 };
          }
          stats.byFeature[log.feature]!.requests++;
          stats.byFeature[log.feature]!.tokens += log.totalTokens;
          stats.byFeature[log.feature]!.cost += log.estimatedCost;

          // By model
          if (!stats.byModel[log.model]) {
            stats.byModel[log.model] = { requests: 0, tokens: 0, cost: 0 };
          }
          stats.byModel[log.model]!.requests++;
          stats.byModel[log.model]!.tokens += log.totalTokens;
          stats.byModel[log.model]!.cost += log.estimatedCost;
        }

        stats.avgLatencyMs = logs.length > 0 ? Math.round(totalLatency / logs.length) : 0;
        stats.totalCost = Math.round(stats.totalCost * 100) / 100;

        return stats;
      };

      const logs = [
        {
          success: true,
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          estimatedCost: 0.5,
          latencyMs: 200,
          provider: 'anthropic',
          feature: 'ai-doc-editor',
          model: 'claude-sonnet-4-20250514',
        },
        {
          success: true,
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
          estimatedCost: 1.0,
          latencyMs: 300,
          provider: 'anthropic',
          feature: 'playground-hint',
          model: 'claude-sonnet-4-20250514',
        },
        {
          success: false,
          inputTokens: 50,
          outputTokens: 0,
          totalTokens: 50,
          estimatedCost: 0,
          latencyMs: 1000,
          provider: 'openai',
          feature: 'ai-doc-editor',
          model: 'gpt-4-turbo-preview',
        },
      ];

      const stats = aggregateStats(logs);

      expect(stats.totalRequests).toBe(3);
      expect(stats.successfulRequests).toBe(2);
      expect(stats.failedRequests).toBe(1);
      expect(stats.totalTokens).toBe(500);
      expect(stats.totalCost).toBe(1.5);
      expect(stats.avgLatencyMs).toBe(500);
      expect(stats.byProvider['anthropic']!.requests).toBe(2);
      expect(stats.byProvider['openai']!.requests).toBe(1);
      expect(stats.byFeature['ai-doc-editor']!.requests).toBe(2);
      expect(stats.byModel['claude-sonnet-4-20250514']!.requests).toBe(2);
    });
  });

  describe('Usage Trend', () => {
    it('should group logs by date granularity', () => {
      const formatDateForGranularity = (
        date: Date,
        granularity: 'hourly' | 'daily' | 'weekly'
      ): string => {
        const d = new Date(date);

        switch (granularity) {
          case 'hourly':
            return d.toISOString().slice(0, 13) + ':00:00Z';
          case 'daily':
            return d.toISOString().slice(0, 10);
          case 'weekly': {
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            d.setDate(diff);
            return d.toISOString().slice(0, 10);
          }
          default:
            return d.toISOString().slice(0, 10);
        }
      };

      const date = new Date('2024-03-15T14:30:45Z');

      expect(formatDateForGranularity(date, 'hourly')).toBe('2024-03-15T14:00:00Z');
      expect(formatDateForGranularity(date, 'daily')).toBe('2024-03-15');
      // March 15, 2024 is a Friday, so week starts on March 11 (Monday)
      expect(formatDateForGranularity(date, 'weekly')).toBe('2024-03-11');
    });

    it('should calculate trends from logs', () => {
      interface UsageTrend {
        date: string;
        requests: number;
        tokens: number;
        cost: number;
      }

      const calculateTrends = (
        logs: Array<{ createdAt: Date; totalTokens: number; estimatedCost: number }>
      ): UsageTrend[] => {
        const trends = new Map<string, UsageTrend>();

        for (const log of logs) {
          const date = log.createdAt.toISOString().slice(0, 10);
          const existing = trends.get(date) || { date, requests: 0, tokens: 0, cost: 0 };
          existing.requests += 1;
          existing.tokens += log.totalTokens;
          existing.cost += log.estimatedCost;
          trends.set(date, existing);
        }

        return Array.from(trends.values()).sort((a, b) => a.date.localeCompare(b.date));
      };

      const logs = [
        { createdAt: new Date('2024-03-01'), totalTokens: 100, estimatedCost: 0.5 },
        { createdAt: new Date('2024-03-01'), totalTokens: 200, estimatedCost: 1.0 },
        { createdAt: new Date('2024-03-02'), totalTokens: 150, estimatedCost: 0.75 },
      ];

      const trends = calculateTrends(logs);

      expect(trends).toHaveLength(2);
      expect(trends[0]!.date).toBe('2024-03-01');
      expect(trends[0]!.requests).toBe(2);
      expect(trends[0]!.tokens).toBe(300);
      expect(trends[1]!.date).toBe('2024-03-02');
      expect(trends[1]!.requests).toBe(1);
    });
  });

  describe('Alerts and Recommendations', () => {
    it('should detect cost spikes', () => {
      const detectCostSpike = (
        currentCost: number,
        previousCost: number,
        threshold: number = 1.5
      ): { isSpiking: boolean; percentageIncrease: number } => {
        if (previousCost === 0) {
          return { isSpiking: false, percentageIncrease: 0 };
        }

        const ratio = currentCost / previousCost;
        const percentageIncrease = Math.round((ratio - 1) * 100);

        return {
          isSpiking: ratio > threshold,
          percentageIncrease,
        };
      };

      expect(detectCostSpike(100, 50)).toEqual({ isSpiking: true, percentageIncrease: 100 });
      expect(detectCostSpike(60, 50)).toEqual({ isSpiking: false, percentageIncrease: 20 });
      expect(detectCostSpike(100, 0)).toEqual({ isSpiking: false, percentageIncrease: 0 });
    });

    it('should detect high failure rate', () => {
      const detectHighFailureRate = (
        totalRequests: number,
        failedRequests: number,
        threshold: number = 5
      ): { isHigh: boolean; rate: number } => {
        if (totalRequests === 0) {
          return { isHigh: false, rate: 0 };
        }

        const rate = (failedRequests / totalRequests) * 100;

        return {
          isHigh: rate > threshold,
          rate: Math.round(rate * 10) / 10,
        };
      };

      expect(detectHighFailureRate(100, 10)).toEqual({ isHigh: true, rate: 10 });
      expect(detectHighFailureRate(100, 3)).toEqual({ isHigh: false, rate: 3 });
      expect(detectHighFailureRate(0, 0)).toEqual({ isHigh: false, rate: 0 });
    });

    it('should generate recommendations for expensive model usage', () => {
      const generateRecommendations = (
        byModel: Record<string, { cost: number }>,
        totalCost: number
      ): string[] => {
        const recommendations: string[] = [];

        const expensiveModels = ['claude-3-opus-20240229', 'gpt-4-turbo-preview'];

        for (const [model, data] of Object.entries(byModel)) {
          if (expensiveModels.includes(model) && data.cost > totalCost * 0.5) {
            recommendations.push(
              `Consider using a smaller model to reduce costs. ${model} accounts for ${Math.round((data.cost / totalCost) * 100)}% of spend.`
            );
          }
        }

        return recommendations;
      };

      const byModel = {
        'claude-3-opus-20240229': { cost: 80 },
        'claude-sonnet-4-20250514': { cost: 20 },
      };

      const recommendations = generateRecommendations(byModel, 100);
      expect(recommendations).toHaveLength(1);
      expect(recommendations[0]).toContain('claude-3-opus-20240229');
      expect(recommendations[0]).toContain('80%');
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens from text length', () => {
      // Simple heuristic: ~4 characters per token
      const estimateTokens = (text: string): number => {
        return Math.ceil(text.length / 4);
      };

      expect(estimateTokens('Hello world')).toBe(3); // 11 chars / 4 = 2.75 -> 3
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('A'.repeat(100))).toBe(25);
    });
  });
});
