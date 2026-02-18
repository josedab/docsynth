/**
 * Translation Sync Worker
 *
 * Processes translation sync jobs with delta support.
 */

import { createWorker, QUEUE_NAMES, type TranslationSyncJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  buildSyncPlan,
  translateDocument,
} from '../../../api/src/services/translation-sync.service.js';

const log = createLogger('translation-sync-worker');

export function startTranslationSyncWorker() {
  const worker = createWorker(
    QUEUE_NAMES.TRANSLATION_SYNC,
    async (job) => {
      const data = job.data as TranslationSyncJobData;
      const { repositoryId, action, targetLanguages } = data;

      log.info(
        { jobId: job.id, repositoryId, action, languages: targetLanguages },
        'Starting translation sync job'
      );
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'sync': {
            const progressPerLang = 80 / targetLanguages.length;
            let currentProgress = 10;

            for (const lang of targetLanguages) {
              const plan = await buildSyncPlan(repositoryId, lang);

              for (const doc of plan.documentsToSync) {
                await translateDocument(repositoryId, doc.documentId, lang, {
                  deltaOnly: data.options?.deltaOnly ?? true,
                  glossaryId: data.glossaryId,
                });
              }

              currentProgress += progressPerLang;
              await job.updateProgress(Math.round(currentProgress));

              log.info(
                { repositoryId, language: lang, docsTranslated: plan.documentsToSync.length },
                'Language sync complete'
              );
            }
            break;
          }

          case 'translate-delta': {
            if (data.documentId) {
              for (const lang of targetLanguages) {
                await translateDocument(repositoryId, data.documentId, lang, {
                  deltaOnly: true,
                  glossaryId: data.glossaryId,
                });
              }
            }
            await job.updateProgress(90);
            break;
          }

          case 'validate':
          case 'update-glossary': {
            log.info({ action }, 'Action processed');
            await job.updateProgress(90);
            break;
          }
        }

        await job.updateProgress(100);
        log.info({ repositoryId, action }, 'Translation sync job completed');
      } catch (error) {
        log.error({ error, repositoryId, action }, 'Translation sync job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Translation sync worker started');
  return worker;
}
