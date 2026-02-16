/**
 * Widget Analytics Worker
 *
 * Aggregates widget analytics data (impressions, searches, chats, feedback)
 * into periodic summaries for efficient querying.
 */

import { createWorker, QUEUE_NAMES, type WidgetAnalyticsJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('widget-analytics-worker');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export function startWidgetAnalyticsWorker() {
  const worker = createWorker(
    QUEUE_NAMES.WIDGET_ANALYTICS,
    async (job) => {
      const data = job.data as WidgetAnalyticsJobData;
      const { widgetId, period } = data;

      log.info({ jobId: job.id, widgetId, period }, 'Aggregating widget analytics');

      await job.updateProgress(10);

      // Fetch raw events for the period
      const start = new Date(period.start);
      const end = new Date(period.end);

      const events = await db.widgetEvent.findMany({
        where: {
          widgetId,
          timestamp: { gte: start, lte: end },
        },
      });

      await job.updateProgress(40);

      // Aggregate counts
      const counts = { impressions: 0, searches: 0, chats: 0, feedbacks: 0 };
      for (const event of events) {
        switch (event.type) {
          case 'impression':
            counts.impressions++;
            break;
          case 'search':
            counts.searches++;
            break;
          case 'chat':
            counts.chats++;
            break;
          case 'feedback':
            counts.feedbacks++;
            break;
        }
      }

      await job.updateProgress(70);

      // Upsert aggregated analytics record
      await db.widgetAnalyticsSummary.upsert({
        where: {
          widgetId_periodStart: { widgetId, periodStart: start },
        },
        create: {
          widgetId,
          periodStart: start,
          periodEnd: end,
          impressions: counts.impressions,
          searches: counts.searches,
          chats: counts.chats,
          feedbacks: counts.feedbacks,
          updatedAt: new Date(),
        },
        update: {
          impressions: counts.impressions,
          searches: counts.searches,
          chats: counts.chats,
          feedbacks: counts.feedbacks,
          updatedAt: new Date(),
        },
      });

      await job.updateProgress(100);

      log.info({ widgetId, ...counts }, 'Widget analytics aggregation complete');
    },
    { concurrency: 3 }
  );

  log.info('Widget analytics worker started');

  return worker;
}
