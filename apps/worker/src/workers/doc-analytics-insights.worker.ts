/**
 * Doc Analytics & Insights Worker
 *
 * Collects reader behavior events, computes documentation usage insights,
 * and generates actionable improvement recommendations.
 */

import { createWorker, QUEUE_NAMES, type DocAnalyticsInsightsJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  collectEvents,
  computeInsights,
  generateRecommendations,
} from '../../../api/src/services/doc-analytics-insights.service.js';

const log = createLogger('doc-analytics-insights-worker');

export function startDocAnalyticsInsightsWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_ANALYTICS_INSIGHTS,
    async (job) => {
      const data = job.data as DocAnalyticsInsightsJobData;
      const { organizationId, repositoryId, action, period } = data;

      log.info(
        { jobId: job.id, organizationId, repositoryId, action, period },
        'Starting doc analytics insights job'
      );
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'collect-events': {
            log.info({ organizationId, repositoryId }, 'Collecting analytics events');
            await job.updateProgress(20);
            await collectEvents(organizationId, repositoryId, data.eventBatch ?? []);
            await job.updateProgress(90);
            break;
          }

          case 'compute-insights': {
            log.info({ organizationId, period }, 'Computing documentation insights');
            await job.updateProgress(20);
            await computeInsights(organizationId, repositoryId, period ?? 'weekly');
            await job.updateProgress(90);
            break;
          }

          case 'generate-recommendations': {
            log.info({ organizationId }, 'Generating improvement recommendations');
            await job.updateProgress(20);
            await generateRecommendations(organizationId, repositoryId);
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc analytics insights action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, organizationId, action }, 'Doc analytics insights job completed');
      } catch (error) {
        log.error(
          { error, jobId: job.id, organizationId, action },
          'Doc analytics insights job failed'
        );
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Doc analytics insights worker started');
  return worker;
}
