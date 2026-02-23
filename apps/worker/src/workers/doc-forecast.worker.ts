/**
 * Doc Forecast Worker
 *
 * Forecasts documentation trends and needs: signal collection,
 * model training, prediction, and digest generation.
 */

import { createWorker, QUEUE_NAMES, type DocForecastJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  collectSignals,
  predict,
  generateDigest,
} from '../../../api/src/services/doc-forecast.service.js';

const log = createLogger('doc-forecast-worker');

export function startDocForecastWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_FORECAST,
    async (job) => {
      const data = job.data as DocForecastJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc forecast job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'collect-signals': {
            log.info({ repositoryId }, 'Collecting forecast signals');
            await job.updateProgress(20);
            await collectSignals(repositoryId);
            await job.updateProgress(90);
            break;
          }

          case 'train-model': {
            log.info({ repositoryId }, 'Training forecast model');
            await job.updateProgress(20);
            const signals = await collectSignals(repositoryId);
            await job.updateProgress(50);
            await predict(repositoryId, { trainOnly: true, signals });
            await job.updateProgress(90);
            break;
          }

          case 'predict': {
            log.info({ repositoryId }, 'Generating predictions');
            await job.updateProgress(20);
            await predict(repositoryId, data.options);
            await job.updateProgress(90);
            break;
          }

          case 'generate-digest': {
            log.info({ repositoryId }, 'Generating forecast digest');
            await job.updateProgress(20);
            await generateDigest(repositoryId, data.period);
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc forecast action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc forecast job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc forecast job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Doc forecast worker started');
  return worker;
}
