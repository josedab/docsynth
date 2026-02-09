/**
 * LLM Observability Service
 *
 * Provides instrumented LLM client that logs token usage, costs, and latency.
 * Enables monitoring and cost tracking for all AI operations.
 */

import { prisma } from '@docsynth/database';
import { createLogger, createLLMClient, type LLMClient, type LLMGenerateOptions, type LLMGenerateResult } from '@docsynth/utils';

const log = createLogger('llm-observability');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Cost Estimation (prices in cents per 1K tokens)
// ============================================================================

const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic models (per 1K tokens in cents)
  'claude-sonnet-4-20250514': { input: 0.3, output: 1.5 },
  'claude-3-5-sonnet-20241022': { input: 0.3, output: 1.5 },
  'claude-3-opus-20240229': { input: 1.5, output: 7.5 },
  'claude-3-haiku-20240307': { input: 0.025, output: 0.125 },
  // OpenAI models (per 1K tokens in cents)
  'gpt-4-turbo-preview': { input: 1.0, output: 3.0 },
  'gpt-4o': { input: 0.25, output: 1.0 },
  'gpt-4o-mini': { input: 0.015, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.05, output: 0.15 },
};

const DEFAULT_PRICING = { input: 0.5, output: 1.5 };

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PRICING[model] || DEFAULT_PRICING;
  const inputCost = (inputTokens / 1000) * pricing.input;
  const outputCost = (outputTokens / 1000) * pricing.output;
  return Math.round((inputCost + outputCost) * 100) / 100; // Round to 2 decimals
}

// ============================================================================
// Types
// ============================================================================

export interface LLMUsageContext {
  organizationId: string;
  repositoryId?: string;
  userId?: string;
  feature: string;
  operation?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface ObservableLLMResult extends LLMGenerateResult {
  latencyMs: number;
  estimatedCost: number;
  logId: string;
}

// ============================================================================
// Observable LLM Client
// ============================================================================

/**
 * Creates an observable LLM client that logs usage to the database
 */
export function createObservableLLMClient(context: LLMUsageContext): ObservableLLMClient {
  return new ObservableLLMClient(context);
}

export class ObservableLLMClient implements LLMClient {
  private client: LLMClient;
  private context: LLMUsageContext;

  constructor(context: LLMUsageContext) {
    this.client = createLLMClient();
    this.context = context;
  }

  isAvailable(): boolean {
    return this.client.isAvailable();
  }

  getProvider(): 'anthropic' | 'openai' | 'none' {
    return this.client.getProvider();
  }

  /**
   * Generate with observability - logs usage to database
   */
  async generate(prompt: string, options?: LLMGenerateOptions): Promise<ObservableLLMResult> {
    const startTime = Date.now();
    let success = true;
    let errorCode: string | undefined;

    try {
      const result = await this.client.generate(prompt, options);
      const latencyMs = Date.now() - startTime;

      // Estimate tokens if not provided (rough estimate: 4 chars per token)
      const inputTokens = Math.ceil(prompt.length / 4);
      const outputTokens = Math.ceil((result.content?.length || 0) / 4);
      const totalTokens = result.tokensUsed || inputTokens + outputTokens;

      const estimatedCost = estimateCost(result.model, inputTokens, outputTokens);

      // Log to database
      const logEntry = await this.logUsage({
        provider: result.provider,
        model: result.model,
        inputTokens,
        outputTokens: result.tokensUsed ? result.tokensUsed - inputTokens : outputTokens,
        totalTokens,
        estimatedCost,
        latencyMs,
        success: true,
      });

      return {
        ...result,
        latencyMs,
        estimatedCost,
        logId: logEntry.id,
      };
    } catch (error) {
      success = false;
      errorCode = error instanceof Error ? error.name : 'UNKNOWN_ERROR';
      const latencyMs = Date.now() - startTime;

      // Log failed request
      await this.logUsage({
        provider: this.getProvider(),
        model: options?.model || 'unknown',
        inputTokens: Math.ceil(prompt.length / 4),
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        latencyMs,
        success: false,
        errorCode,
      });

      throw error;
    }
  }

  /**
   * Log usage to database
   */
  private async logUsage(data: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    latencyMs: number;
    success: boolean;
    errorCode?: string;
  }): Promise<{ id: string }> {
    try {
      const logEntry = await db.lLMUsageLog.create({
        data: {
          organizationId: this.context.organizationId,
          repositoryId: this.context.repositoryId,
          userId: this.context.userId,
          provider: data.provider,
          model: data.model,
          operation: this.context.operation || 'generate',
          feature: this.context.feature,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          totalTokens: data.totalTokens,
          estimatedCost: data.estimatedCost,
          latencyMs: data.latencyMs,
          success: data.success,
          errorCode: data.errorCode,
          requestId: this.context.requestId,
          metadata: this.context.metadata || {},
        },
      });

      log.debug(
        {
          logId: logEntry.id,
          feature: this.context.feature,
          tokens: data.totalTokens,
          cost: data.estimatedCost,
          latencyMs: data.latencyMs,
        },
        'LLM usage logged'
      );

      return logEntry;
    } catch (error) {
      log.error({ error }, 'Failed to log LLM usage');
      return { id: 'log-failed' };
    }
  }
}

// ============================================================================
// Usage Statistics Service
// ============================================================================

export interface UsageStats {
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

export interface UsageTrend {
  date: string;
  requests: number;
  tokens: number;
  cost: number;
}

class LLMUsageStatsService {
  /**
   * Get usage statistics for an organization
   */
  async getOrganizationStats(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<UsageStats> {
    const logs = await db.lLMUsageLog.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    return this.aggregateStats(logs);
  }

  /**
   * Get usage statistics for a repository
   */
  async getRepositoryStats(
    repositoryId: string,
    startDate: Date,
    endDate: Date
  ): Promise<UsageStats> {
    const logs = await db.lLMUsageLog.findMany({
      where: {
        repositoryId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    return this.aggregateStats(logs);
  }

  /**
   * Get usage trend over time
   */
  async getUsageTrend(
    organizationId: string,
    startDate: Date,
    endDate: Date,
    granularity: 'hourly' | 'daily' | 'weekly' = 'daily'
  ): Promise<UsageTrend[]> {
    const logs = await db.lLMUsageLog.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const trends = new Map<string, UsageTrend>();

    for (const log of logs) {
      const date = this.formatDateForGranularity(log.createdAt, granularity);

      const existing = trends.get(date) || { date, requests: 0, tokens: 0, cost: 0 };
      existing.requests += 1;
      existing.tokens += log.totalTokens;
      existing.cost += log.estimatedCost;
      trends.set(date, existing);
    }

    return Array.from(trends.values());
  }

  /**
   * Get top features by usage
   */
  async getTopFeatures(
    organizationId: string,
    startDate: Date,
    endDate: Date,
    limit: number = 10
  ): Promise<Array<{ feature: string; requests: number; tokens: number; cost: number }>> {
    const logs = await db.lLMUsageLog.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const featureStats = new Map<string, { requests: number; tokens: number; cost: number }>();

    for (const log of logs) {
      const existing = featureStats.get(log.feature) || { requests: 0, tokens: 0, cost: 0 };
      existing.requests += 1;
      existing.tokens += log.totalTokens;
      existing.cost += log.estimatedCost;
      featureStats.set(log.feature, existing);
    }

    return Array.from(featureStats.entries())
      .map(([feature, stats]) => ({ feature, ...stats }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, limit);
  }

  /**
   * Get pre-computed summary (from aggregation worker)
   */
  async getSummary(
    organizationId: string,
    period: 'hourly' | 'daily' | 'weekly' | 'monthly',
    periodStart: Date
  ): Promise<unknown | null> {
    const summary = await db.lLMUsageSummary.findFirst({
      where: {
        organizationId,
        period,
        periodStart: {
          gte: new Date(periodStart.getTime() - 1000),
          lte: new Date(periodStart.getTime() + 1000),
        },
      },
    });

    return summary;
  }

  /**
   * Get recent summaries
   */
  async getRecentSummaries(
    organizationId: string,
    period: 'hourly' | 'daily' | 'weekly' | 'monthly',
    limit: number = 30
  ): Promise<unknown[]> {
    const summaries = await db.lLMUsageSummary.findMany({
      where: {
        organizationId,
        period,
      },
      orderBy: { periodStart: 'desc' },
      take: limit,
    });

    return summaries;
  }

  /**
   * Aggregate stats from logs
   */
  private aggregateStats(logs: Array<{
    success: boolean;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    latencyMs: number;
    provider: string;
    feature: string;
    model: string;
  }>): UsageStats {
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
  }

  /**
   * Format date for grouping by granularity
   */
  private formatDateForGranularity(
    date: Date,
    granularity: 'hourly' | 'daily' | 'weekly'
  ): string {
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
  }
}

export const llmUsageStatsService = new LLMUsageStatsService();
