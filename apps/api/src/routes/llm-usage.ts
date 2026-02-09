/**
 * LLM Usage Routes
 *
 * API endpoints for monitoring LLM token usage, costs, and performance.
 * Provides visibility into AI feature costs and usage patterns.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { llmUsageStatsService } from '../services/llm-observability.service.js';

const log = createLogger('llm-usage-routes');

const app = new Hono();

/**
 * Get organization usage overview
 */
app.get('/overview', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  // Get date range from query params (default to last 30 days)
  const endDate = new Date();
  const startDateParam = c.req.query('startDate');
  const endDateParam = c.req.query('endDate');

  const startDate = startDateParam
    ? new Date(startDateParam)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const actualEndDate = endDateParam ? new Date(endDateParam) : endDate;

  try {
    const stats = await llmUsageStatsService.getOrganizationStats(
      org.id,
      startDate,
      actualEndDate
    );

    return c.json({
      success: true,
      data: {
        period: {
          start: startDate.toISOString(),
          end: actualEndDate.toISOString(),
        },
        ...stats,
      },
    });
  } catch (error) {
    log.error({ error, orgId: org.id }, 'Failed to get usage overview');
    return c.json({ success: false, error: 'Failed to get usage overview' }, 500);
  }
});

/**
 * Get usage trend over time
 */
app.get('/trend', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  const endDate = new Date();
  const startDateParam = c.req.query('startDate');
  const endDateParam = c.req.query('endDate');
  const granularity = (c.req.query('granularity') as 'hourly' | 'daily' | 'weekly') || 'daily';

  const startDate = startDateParam
    ? new Date(startDateParam)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const actualEndDate = endDateParam ? new Date(endDateParam) : endDate;

  try {
    const trend = await llmUsageStatsService.getUsageTrend(
      org.id,
      startDate,
      actualEndDate,
      granularity
    );

    return c.json({
      success: true,
      data: {
        period: {
          start: startDate.toISOString(),
          end: actualEndDate.toISOString(),
          granularity,
        },
        trend,
      },
    });
  } catch (error) {
    log.error({ error, orgId: org.id }, 'Failed to get usage trend');
    return c.json({ success: false, error: 'Failed to get usage trend' }, 500);
  }
});

/**
 * Get top features by cost
 */
app.get('/top-features', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  const endDate = new Date();
  const startDateParam = c.req.query('startDate');
  const endDateParam = c.req.query('endDate');
  const limitParam = c.req.query('limit');

  const startDate = startDateParam
    ? new Date(startDateParam)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const actualEndDate = endDateParam ? new Date(endDateParam) : endDate;
  const limit = limitParam ? parseInt(limitParam, 10) : 10;

  try {
    const features = await llmUsageStatsService.getTopFeatures(
      org.id,
      startDate,
      actualEndDate,
      limit
    );

    return c.json({
      success: true,
      data: {
        period: {
          start: startDate.toISOString(),
          end: actualEndDate.toISOString(),
        },
        features,
      },
    });
  } catch (error) {
    log.error({ error, orgId: org.id }, 'Failed to get top features');
    return c.json({ success: false, error: 'Failed to get top features' }, 500);
  }
});

/**
 * Get repository-specific usage
 */
app.get('/repository/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const { repositoryId } = c.req.param();

  const endDate = new Date();
  const startDateParam = c.req.query('startDate');
  const endDateParam = c.req.query('endDate');

  const startDate = startDateParam
    ? new Date(startDateParam)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const actualEndDate = endDateParam ? new Date(endDateParam) : endDate;

  try {
    const stats = await llmUsageStatsService.getRepositoryStats(
      repositoryId!,
      startDate,
      actualEndDate
    );

    return c.json({
      success: true,
      data: {
        repositoryId,
        period: {
          start: startDate.toISOString(),
          end: actualEndDate.toISOString(),
        },
        ...stats,
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get repository usage');
    return c.json({ success: false, error: 'Failed to get repository usage' }, 500);
  }
});

/**
 * Get pre-computed summaries
 */
app.get('/summaries', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  const period = (c.req.query('period') as 'hourly' | 'daily' | 'weekly' | 'monthly') || 'daily';
  const limitParam = c.req.query('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : 30;

  try {
    const summaries = await llmUsageStatsService.getRecentSummaries(
      org.id,
      period,
      limit
    );

    return c.json({
      success: true,
      data: {
        period,
        summaries,
      },
    });
  } catch (error) {
    log.error({ error, orgId: org.id }, 'Failed to get summaries');
    return c.json({ success: false, error: 'Failed to get summaries' }, 500);
  }
});

/**
 * Get cost breakdown by provider
 */
app.get('/cost-breakdown', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  const endDate = new Date();
  const startDateParam = c.req.query('startDate');
  const endDateParam = c.req.query('endDate');

  const startDate = startDateParam
    ? new Date(startDateParam)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const actualEndDate = endDateParam ? new Date(endDateParam) : endDate;

  try {
    const stats = await llmUsageStatsService.getOrganizationStats(
      org.id,
      startDate,
      actualEndDate
    );

    // Calculate percentages
    const totalCost = stats.totalCost || 1;

    const providerBreakdown = Object.entries(stats.byProvider).map(([provider, data]) => ({
      provider,
      cost: data.cost,
      percentage: Math.round((data.cost / totalCost) * 100),
      requests: data.requests,
      tokens: data.tokens,
    }));

    const featureBreakdown = Object.entries(stats.byFeature).map(([feature, data]) => ({
      feature,
      cost: data.cost,
      percentage: Math.round((data.cost / totalCost) * 100),
      requests: data.requests,
      tokens: data.tokens,
    }));

    const modelBreakdown = Object.entries(stats.byModel).map(([model, data]) => ({
      model,
      cost: data.cost,
      percentage: Math.round((data.cost / totalCost) * 100),
      requests: data.requests,
      tokens: data.tokens,
    }));

    return c.json({
      success: true,
      data: {
        period: {
          start: startDate.toISOString(),
          end: actualEndDate.toISOString(),
        },
        totalCost: stats.totalCost,
        totalRequests: stats.totalRequests,
        totalTokens: stats.totalTokens,
        successRate: stats.totalRequests > 0
          ? Math.round((stats.successfulRequests / stats.totalRequests) * 100)
          : 100,
        avgLatencyMs: stats.avgLatencyMs,
        byProvider: providerBreakdown.sort((a, b) => b.cost - a.cost),
        byFeature: featureBreakdown.sort((a, b) => b.cost - a.cost),
        byModel: modelBreakdown.sort((a, b) => b.cost - a.cost),
      },
    });
  } catch (error) {
    log.error({ error, orgId: org.id }, 'Failed to get cost breakdown');
    return c.json({ success: false, error: 'Failed to get cost breakdown' }, 500);
  }
});

/**
 * Get usage alerts and recommendations
 */
app.get('/alerts', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  try {
    // Get last 7 days usage
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const stats = await llmUsageStatsService.getOrganizationStats(org.id, startDate, endDate);

    // Get previous 7 days for comparison
    const prevStartDate = new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevStats = await llmUsageStatsService.getOrganizationStats(org.id, prevStartDate, startDate);

    const alerts: Array<{
      type: 'warning' | 'info' | 'error';
      title: string;
      message: string;
    }> = [];

    // Check for cost spike
    if (prevStats.totalCost > 0 && stats.totalCost > prevStats.totalCost * 1.5) {
      alerts.push({
        type: 'warning',
        title: 'Cost Increase',
        message: `LLM costs increased by ${Math.round(((stats.totalCost - prevStats.totalCost) / prevStats.totalCost) * 100)}% compared to previous period.`,
      });
    }

    // Check for high failure rate
    const failureRate = stats.totalRequests > 0
      ? (stats.failedRequests / stats.totalRequests) * 100
      : 0;

    if (failureRate > 5) {
      alerts.push({
        type: 'error',
        title: 'High Failure Rate',
        message: `${failureRate.toFixed(1)}% of LLM requests failed in the last 7 days.`,
      });
    }

    // Check for high latency
    if (stats.avgLatencyMs > 5000) {
      alerts.push({
        type: 'warning',
        title: 'High Latency',
        message: `Average LLM response time is ${(stats.avgLatencyMs / 1000).toFixed(1)}s. Consider optimizing prompts.`,
      });
    }

    // Recommendations
    const recommendations: string[] = [];

    // Check if using expensive models heavily
    const expensiveModels = ['claude-3-opus-20240229', 'gpt-4-turbo-preview'];
    for (const [model, data] of Object.entries(stats.byModel)) {
      if (expensiveModels.includes(model) && data.cost > stats.totalCost * 0.5) {
        recommendations.push(
          `Consider using a smaller model for some ${Object.keys(stats.byFeature).join(', ')} operations to reduce costs.`
        );
        break;
      }
    }

    // Check feature usage patterns
    const topFeatures = Object.entries(stats.byFeature)
      .sort((a, b) => b[1].cost - a[1].cost)
      .slice(0, 3);

    if (topFeatures.length > 0) {
      const [topFeature] = topFeatures[0]!;
      if (stats.byFeature[topFeature]!.cost > stats.totalCost * 0.6) {
        recommendations.push(
          `The "${topFeature}" feature accounts for over 60% of your LLM costs. Review its usage patterns.`
        );
      }
    }

    return c.json({
      success: true,
      data: {
        alerts,
        recommendations,
        summary: {
          weeklySpend: stats.totalCost,
          weeklyRequests: stats.totalRequests,
          avgLatencyMs: stats.avgLatencyMs,
          successRate: stats.totalRequests > 0
            ? Math.round((stats.successfulRequests / stats.totalRequests) * 100)
            : 100,
        },
      },
    });
  } catch (error) {
    log.error({ error, orgId: org.id }, 'Failed to get alerts');
    return c.json({ success: false, error: 'Failed to get alerts' }, 500);
  }
});

export { app as llmUsageRoutes };
