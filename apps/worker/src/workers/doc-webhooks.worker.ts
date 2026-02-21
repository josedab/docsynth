/**
 * Doc Webhooks Worker
 *
 * Processes documentation webhook jobs: delivering events to subscribers,
 * retrying failed deliveries, testing webhook endpoints, and cleaning up
 * dead-letter entries.
 */

import { createWorker, QUEUE_NAMES, type DocWebhooksJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  deliverEvent,
  retryFailedDeliveries,
  testWebhook,
} from '../../../api/src/services/doc-webhooks.service.js';

const log = createLogger('doc-webhooks-worker');

export function startDocWebhooksWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_WEBHOOKS,
    async (job) => {
      const data = job.data as DocWebhooksJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc webhooks job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'deliver': {
            await job.updateProgress(10);
            const result = await deliverEvent(repositoryId, data.eventId!, data.options);
            await job.updateProgress(90);

            log.info(
              { repositoryId, delivered: result.delivered, failed: result.failed },
              'Webhook event delivered'
            );
            break;
          }

          case 'retry': {
            await job.updateProgress(10);
            const retried = await retryFailedDeliveries(repositoryId, data.options);
            await job.updateProgress(90);

            log.info({ repositoryId, retriedCount: retried.count }, 'Failed deliveries retried');
            break;
          }

          case 'test': {
            await job.updateProgress(10);
            const testResult = await testWebhook(repositoryId, data.webhookId!);
            await job.updateProgress(90);

            log.info({ repositoryId, success: testResult.success }, 'Webhook test complete');
            break;
          }

          case 'cleanup-dead-letters': {
            await job.updateProgress(10);
            await retryFailedDeliveries(repositoryId, { cleanupOnly: true });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Dead-letter cleanup complete');
            break;
          }

          default: {
            throw new Error(`Unknown doc webhooks action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc webhooks job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc webhooks job failed');
        throw error;
      }
    },
    { concurrency: 5 }
  );

  log.info('Doc webhooks worker started');
  return worker;
}
