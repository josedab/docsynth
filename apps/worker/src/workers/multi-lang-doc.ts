/**
 * Multi-Language Documentation V2 Worker
 */

import { createWorker, QUEUE_NAMES, type MultiLangDocJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { translateDocument } from '../../../api/src/services/multi-lang-doc.service.js';

const log = createLogger('multi-lang-doc-worker');

export function startMultiLangDocWorker() {
  const worker = createWorker(
    QUEUE_NAMES.MULTI_LANG_DOC,
    async (job) => {
      const data = job.data as MultiLangDocJobData;
      const { repositoryId, documentId, targetLanguages, glossaryId } = data;

      log.info(
        { jobId: job.id, repositoryId, documentId, languages: targetLanguages },
        'Starting translation'
      );
      await job.updateProgress(10);

      try {
        if (documentId) {
          const results = await translateDocument(
            documentId,
            repositoryId,
            targetLanguages,
            glossaryId
          );
          await job.updateProgress(100);
          log.info({ documentId, translated: results.length }, 'Document translation completed');
        } else {
          // Translate all documents in repository
          const { prisma } = await import('@docsynth/database');
          const documents = await prisma.document.findMany({
            where: { repositoryId },
            select: { id: true },
          });

          let translated = 0;
          for (const doc of documents) {
            const results = await translateDocument(
              doc.id,
              repositoryId,
              targetLanguages,
              glossaryId
            );
            translated += results.length;
            await job.updateProgress(10 + (80 * (documents.indexOf(doc) + 1)) / documents.length);
          }

          await job.updateProgress(100);
          log.info({ repositoryId, translated }, 'Repository translation completed');
        }
      } catch (error) {
        log.error({ error, repositoryId }, 'Translation failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Multi-lang doc worker started');
  return worker;
}
