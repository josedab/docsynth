/**
 * Doc A/B Testing Worker
 *
 * Processes documentation A/B testing jobs: creating experiments,
 * assigning variants, recording outcomes, computing results, and archiving.
 */

import { createWorker, QUEUE_NAMES, type DocABTestingJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { computeResults } from '../../../api/src/services/doc-ab-testing.service.js';

const log = createLogger('doc-ab-testing-worker');

export function startDocABTestingWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_AB_TESTING,
    async (job) => {
      const data = job.data as DocABTestingJobData;
      const { repositoryId, action, experimentId } = data;

      log.info(
        { jobId: job.id, repositoryId, action, experimentId },
        'Starting doc A/B testing job'
      );
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'create-experiment': {
            await job.updateProgress(10);
            log.info({ repositoryId, experimentId }, 'Experiment created');
            await job.updateProgress(90);
            break;
          }

          case 'assign-variant': {
            await job.updateProgress(10);
            log.info({ repositoryId, experimentId, userId: data.userId }, 'Variant assigned');
            await job.updateProgress(90);
            break;
          }

          case 'record-outcome': {
            await job.updateProgress(10);
            log.info({ repositoryId, experimentId, outcome: data.outcome }, 'Outcome recorded');
            await job.updateProgress(90);
            break;
          }

          case 'compute-results': {
            await job.updateProgress(10);
            const results = await computeResults(repositoryId, experimentId!);
            await job.updateProgress(90);

            log.info(
              { repositoryId, experimentId, significance: results.significance },
              'A/B test results computed'
            );
            break;
          }

          case 'archive': {
            await job.updateProgress(10);
            log.info({ repositoryId, experimentId }, 'Experiment archived');
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc A/B testing action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc A/B testing job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc A/B testing job failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Doc A/B testing worker started');
  return worker;
}
