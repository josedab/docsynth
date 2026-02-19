/**
 * Copilot Extension Worker
 *
 * Processes asynchronous GitHub Copilot chat and command requests,
 * handling @docsynth slash commands in the IDE.
 */

import { createWorker, QUEUE_NAMES, type CopilotExtensionJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  handleCommand,
  storeMessage,
} from '../../../api/src/services/copilot-extension.service.js';

const log = createLogger('copilot-extension-worker');

export function startCopilotExtensionWorker() {
  const worker = createWorker(
    QUEUE_NAMES.COPILOT_EXTENSION,
    async (job) => {
      const data = job.data as CopilotExtensionJobData;
      const { command, repositoryId, userId, conversationId, message } = data;

      log.info(
        { jobId: job.id, command, repositoryId, userId, conversationId },
        'Starting copilot extension job'
      );
      await job.updateProgress(5);

      try {
        // Store the incoming message
        await storeMessage(conversationId, userId, message, 'user');
        await job.updateProgress(15);

        // Process the command
        const result = await handleCommand(command, {
          repositoryId,
          userId,
          conversationId,
          message,
          context: data.context,
        });
        await job.updateProgress(80);

        // Store the response
        await storeMessage(conversationId, 'assistant', result.response, 'assistant');
        await job.updateProgress(100);

        log.info({ jobId: job.id, command, conversationId }, 'Copilot extension job completed');
      } catch (error) {
        log.error(
          { error, jobId: job.id, command, conversationId },
          'Copilot extension job failed'
        );
        throw error;
      }
    },
    { concurrency: 10 }
  );

  log.info('Copilot extension worker started');
  return worker;
}
