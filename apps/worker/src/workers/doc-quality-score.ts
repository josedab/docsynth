/**
 * Documentation Quality Score Worker
 */

import { createWorker, QUEUE_NAMES, type DocQualityScoreJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  scoreDocument,
  scoreRepository,
} from '../../../api/src/services/doc-quality-score.service.js';

const log = createLogger('doc-quality-score-worker');

export function startDocQualityScoreWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_QUALITY_SCORE,
    async (job) => {
      const data = job.data as DocQualityScoreJobData;
      const { repositoryId, documentId, fullScan } = data;

      log.info({ jobId: job.id, repositoryId, documentId, fullScan }, 'Starting quality scoring');
      await job.updateProgress(10);

      try {
        if (fullScan || !documentId) {
          const results = await scoreRepository(repositoryId);
          await job.updateProgress(100);
          log.info({ repositoryId, scored: results.length }, 'Repository scoring completed');
        } else {
          const result = await scoreDocument(documentId, repositoryId);
          await job.updateProgress(100);
          log.info({ documentId, score: result.overallScore }, 'Document scoring completed');
        }
      } catch (error) {
        log.error({ error, repositoryId }, 'Quality scoring failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Doc quality score worker started');
  return worker;
}
