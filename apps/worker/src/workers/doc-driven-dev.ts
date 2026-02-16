/**
 * Doc-Driven Development Worker
 */

import { createWorker, QUEUE_NAMES, type DocDrivenDevJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  parseDocSpec,
  generateArtifacts,
} from '../../../api/src/services/doc-driven-dev.service.js';

const log = createLogger('doc-driven-dev-worker');

export function startDocDrivenDevWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_DRIVEN_DEV,
    async (job) => {
      const data = job.data as DocDrivenDevJobData;
      const { repositoryId, documentId, targetLanguage, generateTests } = data;

      log.info(
        { jobId: job.id, repositoryId, documentId, targetLanguage },
        'Starting doc-driven development'
      );
      await job.updateProgress(10);

      try {
        // Parse spec from document
        await parseDocSpec(documentId, repositoryId);
        await job.updateProgress(40);

        // Generate artifacts
        const specId = `${repositoryId}-${documentId}`;
        const artifacts = await generateArtifacts(specId, targetLanguage, generateTests);
        await job.updateProgress(100);

        log.info(
          { repositoryId, documentId, artifacts: artifacts.length },
          'Doc-driven development completed'
        );
      } catch (error) {
        log.error({ error, repositoryId, documentId }, 'Doc-driven development failed');
        throw error;
      }
    },
    { concurrency: 1 }
  );

  log.info('Doc-driven dev worker started');
  return worker;
}
