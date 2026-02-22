/**
 * Doc QL Worker
 *
 * Processes documentation query-language jobs: query execution,
 * query validation, and alert scheduling.
 */

import { createWorker, QUEUE_NAMES, type DocQLJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  executeQuery,
  validateQuery,
  createAlert,
} from '../../../api/src/services/doc-ql.service.js';

const log = createLogger('doc-ql-worker');

export function startDocQLWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_QL,
    async (job) => {
      const data = job.data as DocQLJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc QL job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'execute-query': {
            log.info({ repositoryId }, 'Executing documentation query');
            await job.updateProgress(20);
            await executeQuery(repositoryId, data.query);
            await job.updateProgress(90);
            break;
          }

          case 'validate-query': {
            log.info({ repositoryId }, 'Validating documentation query');
            await job.updateProgress(20);
            await validateQuery(repositoryId, data.query);
            await job.updateProgress(90);
            break;
          }

          case 'schedule-alert': {
            log.info({ repositoryId }, 'Scheduling documentation alert');
            await job.updateProgress(20);
            await createAlert(repositoryId, data.query, data.schedule);
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc QL action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc QL job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc QL job failed');
        throw error;
      }
    },
    { concurrency: 5 }
  );

  log.info('Doc QL worker started');
  return worker;
}
