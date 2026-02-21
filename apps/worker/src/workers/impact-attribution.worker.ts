/**
 * Impact Attribution Worker
 *
 * Processes documentation impact attribution jobs: correlating doc changes
 * to outcomes, computing impact scores, predicting impact, and generating reports.
 */

import { createWorker, QUEUE_NAMES, type ImpactAttributionJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  correlateDocImpact,
  generateImpactReport,
} from '../../../api/src/services/impact-attribution.service.js';

const log = createLogger('impact-attribution-worker');

export function startImpactAttributionWorker() {
  const worker = createWorker(
    QUEUE_NAMES.IMPACT_ATTRIBUTION,
    async (job) => {
      const data = job.data as ImpactAttributionJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting impact attribution job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'correlate': {
            await job.updateProgress(10);
            const correlation = await correlateDocImpact(repositoryId, data.options);
            await job.updateProgress(90);

            log.info(
              { repositoryId, correlations: correlation.matches?.length ?? 0 },
              'Impact correlation complete'
            );
            break;
          }

          case 'compute-impact': {
            await job.updateProgress(10);
            await correlateDocImpact(repositoryId, { ...data.options, computeScore: true });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Impact score computed');
            break;
          }

          case 'predict': {
            await job.updateProgress(10);
            await correlateDocImpact(repositoryId, { ...data.options, predict: true });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Impact prediction complete');
            break;
          }

          case 'generate-report': {
            await job.updateProgress(10);
            const report = await generateImpactReport(repositoryId, data.options);
            await job.updateProgress(90);

            log.info({ repositoryId, reportId: report.id }, 'Impact report generated');
            break;
          }

          default: {
            throw new Error(`Unknown impact attribution action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Impact attribution job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Impact attribution job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Impact attribution worker started');
  return worker;
}
