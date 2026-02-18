/**
 * Doc Tests Runtime Worker
 *
 * Processes doc test extraction, execution, and auto-fix jobs.
 */

import { createWorker, QUEUE_NAMES, type DocTestsRuntimeJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  extractCodeBlocks,
  executeCodeBlocks,
  autoFixFailedBlocks,
} from '../../../api/src/services/doc-tests-runtime.service.js';

const log = createLogger('doc-tests-runtime-worker');

export function startDocTestsRuntimeWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_TESTS_RUNTIME,
    async (job) => {
      const data = job.data as DocTestsRuntimeJobData;
      const { repositoryId, action, documentId } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc tests runtime job');
      await job.updateProgress(5);

      try {
        const blocks = await extractCodeBlocks(repositoryId, documentId);
        await job.updateProgress(30);

        switch (action) {
          case 'extract': {
            log.info({ repositoryId, blockCount: blocks.length }, 'Code blocks extracted');
            break;
          }

          case 'execute':
          case 'validate': {
            const report = await executeCodeBlocks(repositoryId, blocks, {
              timeout: data.options?.timeout ?? 10000,
              sandboxed: data.options?.sandboxed ?? true,
            });
            await job.updateProgress(80);

            log.info(
              { repositoryId, passed: report.passed, failed: report.failed },
              'Doc tests executed'
            );
            break;
          }

          case 'auto-fix': {
            const report = await executeCodeBlocks(repositoryId, blocks);
            await job.updateProgress(60);

            const fixes = await autoFixFailedBlocks(report.results, blocks);
            await job.updateProgress(90);

            log.info(
              { repositoryId, failed: report.failed, fixed: fixes.length },
              'Auto-fix complete'
            );
            break;
          }
        }

        await job.updateProgress(100);
        log.info({ repositoryId, action }, 'Doc tests runtime job completed');
      } catch (error) {
        log.error({ error, repositoryId, action }, 'Doc tests runtime job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Doc tests runtime worker started');
  return worker;
}
