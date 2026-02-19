/**
 * Doc Agent Worker
 *
 * Orchestrates agentic documentation cycles: planning, generation,
 * validation, self-correction, and full end-to-end cycles.
 */

import { createWorker, QUEUE_NAMES, type DocAgentJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { executeAgentCycle } from '../../../api/src/services/doc-agent.service.js';

const log = createLogger('doc-agent-worker');

export function startDocAgentWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_AGENT,
    async (job) => {
      const data = job.data as DocAgentJobData;
      const { repositoryId, action, prNumber } = data;

      log.info({ jobId: job.id, repositoryId, action, prNumber }, 'Starting doc agent job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'plan': {
            log.info({ repositoryId }, 'Planning documentation changes');
            await job.updateProgress(20);
            await executeAgentCycle(repositoryId, 'plan', data.context);
            await job.updateProgress(90);
            break;
          }

          case 'generate': {
            log.info({ repositoryId }, 'Generating documentation');
            await job.updateProgress(20);
            await executeAgentCycle(repositoryId, 'generate', data.context);
            await job.updateProgress(90);
            break;
          }

          case 'validate': {
            log.info({ repositoryId }, 'Validating generated documentation');
            await job.updateProgress(20);
            await executeAgentCycle(repositoryId, 'validate', data.context);
            await job.updateProgress(90);
            break;
          }

          case 'self-correct': {
            log.info({ repositoryId }, 'Self-correcting documentation');
            await job.updateProgress(20);
            await executeAgentCycle(repositoryId, 'self-correct', data.context);
            await job.updateProgress(90);
            break;
          }

          case 'full-cycle': {
            log.info({ repositoryId }, 'Running full agent cycle');
            const maxIterations = data.context?.maxIterations ?? 3;

            for (let i = 0; i < maxIterations; i++) {
              const progress = 10 + Math.floor((80 * i) / maxIterations);
              await job.updateProgress(progress);
              await executeAgentCycle(repositoryId, 'full-cycle', {
                ...data.context,
                iteration: i,
              });
            }

            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc agent action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc agent job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc agent job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Doc agent worker started');
  return worker;
}
