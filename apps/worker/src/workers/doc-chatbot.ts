/**
 * Documentation Chatbot Worker
 */

import { createWorker, QUEUE_NAMES, type DocChatbotJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { processMessage } from '../../../api/src/services/doc-chatbot.service.js';

const log = createLogger('doc-chatbot-worker');

export function startDocChatbotWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_CHATBOT,
    async (job) => {
      const data = job.data as DocChatbotJobData;
      const { chatbotConfigId, conversationId, message, visitorId } = data;

      log.info({ jobId: job.id, conversationId }, 'Processing chatbot message');
      await job.updateProgress(10);

      try {
        const response = await processMessage(chatbotConfigId, conversationId, message, visitorId);
        await job.updateProgress(100);

        log.info({ conversationId, confidence: response.confidence }, 'Chatbot message processed');
      } catch (error) {
        log.error({ error, conversationId }, 'Chatbot processing failed');
        throw error;
      }
    },
    { concurrency: 5 }
  );

  log.info('Doc chatbot worker started');
  return worker;
}
