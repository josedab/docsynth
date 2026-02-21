/**
 * Doc Quality Benchmark Worker
 *
 * Processes documentation quality benchmark jobs: evaluating documents
 * against quality standards, comparing results, updating leaderboards,
 * and generating benchmark reports.
 */

import { createWorker, QUEUE_NAMES, type DocQualityBenchmarkJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  evaluateDocument,
  getLeaderboard,
} from '../../../api/src/services/doc-quality-benchmark.service.js';

const log = createLogger('doc-quality-benchmark-worker');

export function startDocQualityBenchmarkWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_QUALITY_BENCHMARK,
    async (job) => {
      const data = job.data as DocQualityBenchmarkJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc quality benchmark job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'evaluate': {
            await job.updateProgress(10);
            const evaluation = await evaluateDocument(repositoryId, data.documentId!, data.options);
            await job.updateProgress(90);

            log.info({ repositoryId, score: evaluation.score }, 'Document evaluation complete');
            break;
          }

          case 'compare': {
            await job.updateProgress(10);
            await evaluateDocument(repositoryId, data.documentId!, { compare: true });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Benchmark comparison complete');
            break;
          }

          case 'update-leaderboard': {
            await job.updateProgress(10);
            const leaderboard = await getLeaderboard(repositoryId);
            await job.updateProgress(90);

            log.info(
              { repositoryId, entries: leaderboard.entries?.length ?? 0 },
              'Leaderboard updated'
            );
            break;
          }

          case 'generate-report': {
            await job.updateProgress(10);
            await evaluateDocument(repositoryId, data.documentId!, { generateReport: true });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Benchmark report generated');
            break;
          }

          default: {
            throw new Error(`Unknown doc quality benchmark action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc quality benchmark job completed');
      } catch (error) {
        log.error(
          { error, jobId: job.id, repositoryId, action },
          'Doc quality benchmark job failed'
        );
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Doc quality benchmark worker started');
  return worker;
}
