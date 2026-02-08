/**
 * LLM Usage Aggregation Worker
 *
 * Aggregates LLM usage logs into summaries for cost tracking
 * and usage monitoring.
 */

import { createWorker, QUEUE_NAMES, type LLMUsageAggregationJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('llm-usage-aggregation-worker');

export function startLLMUsageAggregationWorker() {
  const worker = createWorker(
    QUEUE_NAMES.LLM_USAGE_AGGREGATION,
    async (job) => {
      const data = job.data as LLMUsageAggregationJobData;
      const { organizationId, repositoryId, period, periodStart, periodEnd } = data;

      log.info({ jobId: job.id, organizationId, period }, 'Starting LLM usage aggregation');

      await job.updateProgress(10);

      try {
        const startDate = new Date(periodStart);
        const endDate = new Date(periodEnd);

        // Aggregate by provider
        const byProvider = await prisma.lLMUsageLog.groupBy({
          by: ['provider'],
          where: {
            organizationId,
            repositoryId: repositoryId || undefined,
            createdAt: {
              gte: startDate,
              lt: endDate,
            },
          },
          _count: { id: true },
          _sum: {
            inputTokens: true,
            outputTokens: true,
            totalTokens: true,
            estimatedCost: true,
            latencyMs: true,
          },
        });

        await job.updateProgress(30);

        // Aggregate by feature
        const byFeature = await prisma.lLMUsageLog.groupBy({
          by: ['feature'],
          where: {
            organizationId,
            repositoryId: repositoryId || undefined,
            createdAt: {
              gte: startDate,
              lt: endDate,
            },
          },
          _count: { id: true },
          _sum: {
            inputTokens: true,
            outputTokens: true,
            totalTokens: true,
            estimatedCost: true,
          },
        });

        await job.updateProgress(50);

        // Aggregate by model
        const byModel = await prisma.lLMUsageLog.groupBy({
          by: ['model'],
          where: {
            organizationId,
            repositoryId: repositoryId || undefined,
            createdAt: {
              gte: startDate,
              lt: endDate,
            },
          },
          _count: { id: true },
          _sum: {
            inputTokens: true,
            outputTokens: true,
            totalTokens: true,
            estimatedCost: true,
          },
        });

        await job.updateProgress(70);

        // Calculate success/failure counts
        const successCount = await prisma.lLMUsageLog.count({
          where: {
            organizationId,
            repositoryId: repositoryId || undefined,
            createdAt: {
              gte: startDate,
              lt: endDate,
            },
            success: true,
          },
        });

        const failureCount = await prisma.lLMUsageLog.count({
          where: {
            organizationId,
            repositoryId: repositoryId || undefined,
            createdAt: {
              gte: startDate,
              lt: endDate,
            },
            success: false,
          },
        });

        // Calculate latency percentiles
        const latencies = await prisma.lLMUsageLog.findMany({
          where: {
            organizationId,
            repositoryId: repositoryId || undefined,
            createdAt: {
              gte: startDate,
              lt: endDate,
            },
          },
          select: { latencyMs: true },
          orderBy: { latencyMs: 'asc' },
        });

        const avgLatency =
          latencies.length > 0
            ? latencies.reduce((sum, l) => sum + l.latencyMs, 0) / latencies.length
            : 0;

        const p95Index = Math.floor(latencies.length * 0.95);
        const p95Latency = latencies[p95Index]?.latencyMs || 0;

        await job.updateProgress(85);

        // Calculate totals
        const totalRequests = successCount + failureCount;
        const totalInputTokens = byProvider.reduce((sum, p) => sum + (p._sum.inputTokens || 0), 0);
        const totalOutputTokens = byProvider.reduce((sum, p) => sum + (p._sum.outputTokens || 0), 0);
        const totalCost = byProvider.reduce((sum, p) => sum + (p._sum.estimatedCost || 0), 0);

        // Format aggregations
        const providerMap: Record<string, { requests: number; tokens: number; cost: number }> = {};
        for (const p of byProvider) {
          providerMap[p.provider] = {
            requests: p._count.id,
            tokens: p._sum.totalTokens || 0,
            cost: p._sum.estimatedCost || 0,
          };
        }

        const featureMap: Record<string, { requests: number; tokens: number; cost: number }> = {};
        for (const f of byFeature) {
          featureMap[f.feature] = {
            requests: f._count.id,
            tokens: f._sum.totalTokens || 0,
            cost: f._sum.estimatedCost || 0,
          };
        }

        const modelMap: Record<string, { requests: number; tokens: number; cost: number }> = {};
        for (const m of byModel) {
          modelMap[m.model] = {
            requests: m._count.id,
            tokens: m._sum.totalTokens || 0,
            cost: m._sum.estimatedCost || 0,
          };
        }

        await job.updateProgress(95);

        // Upsert usage summary
        await prisma.lLMUsageSummary.upsert({
          where: {
            organizationId_repositoryId_period_periodStart: {
              organizationId,
              repositoryId: repositoryId || '',
              period,
              periodStart: startDate,
            },
          },
          create: {
            organizationId,
            repositoryId,
            period,
            periodStart: startDate,
            periodEnd: endDate,
            totalRequests,
            successfulReqs: successCount,
            failedReqs: failureCount,
            totalInputTokens,
            totalOutputTokens,
            totalCost,
            byProvider: providerMap,
            byFeature: featureMap,
            byModel: modelMap,
            avgLatencyMs: avgLatency,
            p95LatencyMs: p95Latency,
          },
          update: {
            totalRequests,
            successfulReqs: successCount,
            failedReqs: failureCount,
            totalInputTokens,
            totalOutputTokens,
            totalCost,
            byProvider: providerMap,
            byFeature: featureMap,
            byModel: modelMap,
            avgLatencyMs: avgLatency,
            p95LatencyMs: p95Latency,
          },
        });

        await job.updateProgress(100);

        log.info(
          {
            organizationId,
            period,
            totalRequests,
            totalCost: totalCost.toFixed(2),
            avgLatency: avgLatency.toFixed(0),
          },
          'LLM usage aggregation completed'
        );

      } catch (error) {
        log.error({ error, organizationId }, 'LLM usage aggregation failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('LLM usage aggregation worker started');
  return worker;
}

// Schedule hourly LLM usage aggregation for all organizations
export async function scheduleHourlyLLMUsageAggregation(): Promise<void> {
  log.info('Scheduling hourly LLM usage aggregation');

  const organizations = await prisma.organization.findMany({
    select: { id: true },
  });

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

  const { addJob } = await import('@docsynth/queue');

  for (const org of organizations) {
    await addJob(QUEUE_NAMES.LLM_USAGE_AGGREGATION, {
      organizationId: org.id,
      period: 'hourly',
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    });
  }

  log.info({ count: organizations.length }, 'Scheduled hourly LLM usage aggregation');
}
