/**
 * Analytics Computation Worker
 *
 * Aggregates documentation analytics data into summaries for
 * dashboards and reporting.
 */

import { createWorker, QUEUE_NAMES, type AnalyticsComputationJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('analytics-computation-worker');

export function startAnalyticsComputationWorker() {
  const worker = createWorker(
    QUEUE_NAMES.ANALYTICS_COMPUTATION,
    async (job) => {
      const data = job.data as AnalyticsComputationJobData;
      const { repositoryId, organizationId, period, startDate, endDate } = data;

      log.info({ jobId: job.id, repositoryId, period }, 'Starting analytics computation');

      await job.updateProgress(10);

      try {
        // Calculate period bounds
        const now = new Date();
        let periodStart: Date;
        let periodEnd: Date;

        if (startDate && endDate) {
          periodStart = new Date(startDate);
          periodEnd = new Date(endDate);
        } else {
          switch (period) {
            case 'daily':
              periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
              periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              break;
            case 'weekly':
              periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
              periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              break;
            case 'monthly':
              periodStart = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
              periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              break;
            default:
              periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
              periodEnd = now;
          }
        }

        await job.updateProgress(20);

        // Aggregate page views
        const pageViews = await prisma.docPageView.groupBy({
          by: ['documentPath'],
          where: {
            repositoryId,
            createdAt: {
              gte: periodStart,
              lt: periodEnd,
            },
          },
          _count: { id: true },
          _avg: { duration: true, scrollDepth: true },
        });

        await job.updateProgress(40);

        // Get unique visitors
        const uniqueVisitors = await prisma.docPageView.findMany({
          where: {
            repositoryId,
            createdAt: {
              gte: periodStart,
              lt: periodEnd,
            },
          },
          distinct: ['sessionId'],
          select: { sessionId: true },
        });

        await job.updateProgress(50);

        // Aggregate search queries
        const searchQueries = await prisma.docSearchQuery.groupBy({
          by: ['query'],
          where: {
            repositoryId,
            createdAt: {
              gte: periodStart,
              lt: periodEnd,
            },
          },
          _count: { id: true },
          _avg: { resultCount: true },
        });

        await job.updateProgress(60);

        // Aggregate feedback
        const feedback = await prisma.docFeedback.groupBy({
          by: ['helpful'],
          where: {
            repositoryId,
            createdAt: {
              gte: periodStart,
              lt: periodEnd,
            },
          },
          _count: { id: true },
        });

        await job.updateProgress(70);

        // Calculate totals
        const totalViews = pageViews.reduce((sum, p) => sum + p._count.id, 0);
        const avgTimeOnPage =
          pageViews.reduce((sum, p) => sum + (p._avg.duration || 0), 0) / (pageViews.length || 1);
        const avgScrollDepth =
          pageViews.reduce((sum, p) => sum + (p._avg.scrollDepth || 0), 0) / (pageViews.length || 1);

        const helpfulCount = feedback.find((f) => f.helpful)?._count.id || 0;
        const notHelpfulCount = feedback.find((f) => !f.helpful)?._count.id || 0;

        // Get top pages
        const topPages = pageViews
          .sort((a, b) => b._count.id - a._count.id)
          .slice(0, 10)
          .map((p) => ({
            path: p.documentPath,
            views: p._count.id,
            avgDuration: p._avg.duration || 0,
            avgScrollDepth: p._avg.scrollDepth || 0,
          }));

        // Get top searches
        const topSearches = searchQueries
          .sort((a, b) => b._count.id - a._count.id)
          .slice(0, 10)
          .map((s) => ({
            query: s.query,
            count: s._count.id,
            avgResults: s._avg.resultCount || 0,
          }));

        await job.updateProgress(80);

        // Identify content gaps (searches with low results)
        const gapAnalysis = searchQueries
          .filter((s) => (s._avg.resultCount || 0) < 3 && s._count.id >= 3)
          .map((s) => ({
            query: s.query,
            searchCount: s._count.id,
            avgResults: s._avg.resultCount || 0,
            suggestion: `Consider adding documentation for "${s.query}"`,
          }));

        await job.updateProgress(90);

        // Upsert analytics summary
        await prisma.analyticsSummary.upsert({
          where: {
            repositoryId_period_periodStart: {
              repositoryId,
              period,
              periodStart,
            },
          },
          create: {
            repositoryId,
            period,
            periodStart,
            periodEnd,
            totalViews,
            uniqueVisitors: uniqueVisitors.length,
            avgTimeOnPage,
            avgScrollDepth,
            searchCount: searchQueries.reduce((sum, s) => sum + s._count.id, 0),
            helpfulCount,
            notHelpfulCount,
            topPages,
            topSearches,
            gapAnalysis,
          },
          update: {
            totalViews,
            uniqueVisitors: uniqueVisitors.length,
            avgTimeOnPage,
            avgScrollDepth,
            searchCount: searchQueries.reduce((sum, s) => sum + s._count.id, 0),
            helpfulCount,
            notHelpfulCount,
            topPages,
            topSearches,
            gapAnalysis,
          },
        });

        await job.updateProgress(100);

        log.info(
          {
            repositoryId,
            period,
            totalViews,
            uniqueVisitors: uniqueVisitors.length,
            gapsIdentified: gapAnalysis.length,
          },
          'Analytics computation completed'
        );

        // Result logged above; void return required by JobProcessor
      } catch (error) {
        log.error({ error, repositoryId }, 'Analytics computation failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Analytics computation worker started');
  return worker;
}

// Schedule daily analytics computation for all repositories
export async function scheduleDailyAnalytics(): Promise<void> {
  log.info('Scheduling daily analytics computation');

  const repositories = await prisma.repository.findMany({
    where: { enabled: true },
    select: { id: true, organizationId: true },
  });

  const { addJob } = await import('@docsynth/queue');

  for (const repo of repositories) {
    await addJob(QUEUE_NAMES.ANALYTICS_COMPUTATION, {
      repositoryId: repo.id,
      organizationId: repo.organizationId,
      period: 'daily',
    });
  }

  log.info({ count: repositories.length }, 'Scheduled daily analytics computation');
}
