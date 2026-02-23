/**
 * Doc Playground Worker
 *
 * Manages interactive documentation playgrounds: example extraction,
 * snippet execution, playground creation, and container cleanup.
 */

import { createWorker, QUEUE_NAMES, type DocPlaygroundJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  extractExamples,
  createPlayground,
  executePlayground,
  cleanupExpiredPlaygrounds,
} from '../../../api/src/services/doc-playground.service.js';

const log = createLogger('doc-playground-worker');

export function startDocPlaygroundWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_PLAYGROUND,
    async (job) => {
      const data = job.data as DocPlaygroundJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc playground job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'extract-examples': {
            log.info({ repositoryId }, 'Extracting code examples');
            await job.updateProgress(20);
            await extractExamples(repositoryId, data.documentId);
            await job.updateProgress(90);
            break;
          }

          case 'execute-snippet': {
            log.info({ repositoryId }, 'Executing code snippet');
            await job.updateProgress(20);
            await executePlayground(data.playgroundId, data.snippet);
            await job.updateProgress(90);
            break;
          }

          case 'create-playground': {
            log.info({ repositoryId }, 'Creating playground');
            await job.updateProgress(20);
            await createPlayground(repositoryId, data.config);
            await job.updateProgress(90);
            break;
          }

          case 'cleanup-containers': {
            log.info({ repositoryId }, 'Cleaning up expired containers');
            await job.updateProgress(20);
            await cleanupExpiredPlaygrounds();
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc playground action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc playground job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc playground job failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Doc playground worker started');
  return worker;
}
