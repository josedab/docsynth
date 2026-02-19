/**
 * Doc Diff Staging Worker
 *
 * Computes section-level diffs between current and generated documentation,
 * previews changes, and applies staged accept/reject decisions.
 */

import { createWorker, QUEUE_NAMES, type DocDiffStagingJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  computeDiff,
  applyStagingDecisions,
} from '../../../api/src/services/doc-diff-staging.service.js';

const log = createLogger('doc-diff-staging-worker');

export function startDocDiffStagingWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_DIFF_STAGING,
    async (job) => {
      const data = job.data as DocDiffStagingJobData;
      const { repositoryId, action, generationJobId, documentPath } = data;

      log.info(
        { jobId: job.id, repositoryId, action, documentPath },
        'Starting doc diff staging job'
      );
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'compute-diff': {
            log.info({ repositoryId, generationJobId }, 'Computing section-level diff');
            await job.updateProgress(20);
            await computeDiff(repositoryId, generationJobId!, documentPath);
            await job.updateProgress(90);
            break;
          }

          case 'apply-staged': {
            log.info({ repositoryId, documentPath }, 'Applying staged decisions');
            await job.updateProgress(20);
            await applyStagingDecisions(repositoryId, data.stagedSections ?? []);
            await job.updateProgress(90);
            break;
          }

          case 'preview': {
            log.info({ repositoryId, documentPath }, 'Generating diff preview');
            await job.updateProgress(20);
            await computeDiff(repositoryId, generationJobId!, documentPath);
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc diff staging action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc diff staging job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc diff staging job failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Doc diff staging worker started');
  return worker;
}
