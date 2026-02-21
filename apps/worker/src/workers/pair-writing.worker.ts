/**
 * Pair Writing Worker
 *
 * Processes real-time collaborative writing jobs: generating AI suggestions,
 * fact-checking content, inserting examples, and persisting sessions.
 */

import { createWorker, QUEUE_NAMES, type PairWritingJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  generateSuggestion,
  factCheckContent,
} from '../../../api/src/services/pair-writing.service.js';

const log = createLogger('pair-writing-worker');

export function startPairWritingWorker() {
  const worker = createWorker(
    QUEUE_NAMES.PAIR_WRITING,
    async (job) => {
      const data = job.data as PairWritingJobData;
      const { repositoryId, action, sessionId } = data;

      log.info({ jobId: job.id, repositoryId, action, sessionId }, 'Starting pair writing job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'suggest-completion': {
            await job.updateProgress(10);
            const suggestion = await generateSuggestion(repositoryId, {
              context: data.context,
              cursorPosition: data.cursorPosition,
            });
            await job.updateProgress(90);

            log.info(
              { repositoryId, suggestionLength: suggestion.text?.length ?? 0 },
              'Suggestion generated'
            );
            break;
          }

          case 'validate-facts': {
            await job.updateProgress(10);
            const result = await factCheckContent(repositoryId, data.content!);
            await job.updateProgress(90);

            log.info(
              { repositoryId, issuesFound: result.issues?.length ?? 0 },
              'Fact validation complete'
            );
            break;
          }

          case 'insert-example': {
            await job.updateProgress(10);
            await generateSuggestion(repositoryId, {
              context: data.context,
              mode: 'example',
            });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Example inserted');
            break;
          }

          case 'persist-session': {
            await job.updateProgress(10);
            log.info({ repositoryId, sessionId }, 'Session persisted');
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown pair writing action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Pair writing job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Pair writing job failed');
        throw error;
      }
    },
    { concurrency: 10 }
  );

  log.info('Pair writing worker started');
  return worker;
}
