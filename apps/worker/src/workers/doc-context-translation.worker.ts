/**
 * Doc Context Translation Worker
 *
 * Handles context-aware documentation translation: full document translation,
 * delta synchronization, glossary building, and translation validation.
 */

import { createWorker, QUEUE_NAMES, type DocContextTranslationJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  translateDocument,
  syncTranslationDelta,
  buildGlossary,
  validateTranslation,
} from '../../../api/src/services/doc-context-translation.service.js';

const log = createLogger('doc-context-translation-worker');

export function startDocContextTranslationWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_CONTEXT_TRANSLATION,
    async (job) => {
      const data = job.data as DocContextTranslationJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc context translation job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'translate': {
            log.info({ repositoryId }, 'Translating document');
            await job.updateProgress(20);
            await translateDocument(repositoryId, data.documentId, data.targetLocale);
            await job.updateProgress(90);
            break;
          }

          case 'sync-delta': {
            log.info({ repositoryId }, 'Synchronizing translation delta');
            await job.updateProgress(20);
            await syncTranslationDelta(repositoryId, data.targetLocale);
            await job.updateProgress(90);
            break;
          }

          case 'build-glossary': {
            log.info({ repositoryId }, 'Building translation glossary');
            await job.updateProgress(20);
            await buildGlossary(repositoryId, data.targetLocale);
            await job.updateProgress(90);
            break;
          }

          case 'validate-translation': {
            log.info({ repositoryId }, 'Validating translation');
            await job.updateProgress(20);
            await validateTranslation(repositoryId, data.documentId, data.targetLocale);
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc context translation action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc context translation job completed');
      } catch (error) {
        log.error(
          { error, jobId: job.id, repositoryId, action },
          'Doc context translation job failed'
        );
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Doc context translation worker started');
  return worker;
}
