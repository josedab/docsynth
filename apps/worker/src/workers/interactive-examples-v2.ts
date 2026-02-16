/**
 * Interactive Code Examples V2 Worker
 */

import { createWorker, QUEUE_NAMES, type InteractiveExampleV2JobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import {
  generateExamplesFromDocument,
  validateExamples,
} from '../../../api/src/services/interactive-examples-v2.service.js';

const log = createLogger('interactive-examples-v2-worker');

export function startInteractiveExampleV2Worker() {
  const worker = createWorker(
    QUEUE_NAMES.INTERACTIVE_EXAMPLE_V2,
    async (job) => {
      const data = job.data as InteractiveExampleV2JobData;
      const { repositoryId, documentId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting interactive example processing');
      await job.updateProgress(10);

      try {
        if (action === 'validate') {
          const result = await validateExamples(repositoryId);
          await job.updateProgress(100);
          log.info(
            { repositoryId, total: result.total, valid: result.valid },
            'Example validation completed'
          );
        } else if (action === 'generate' && documentId) {
          const examples = await generateExamplesFromDocument(documentId, repositoryId);
          await job.updateProgress(100);
          log.info({ documentId, generated: examples.length }, 'Example generation completed');
        } else if (action === 'update') {
          // Re-generate all examples for the repository
          const documents = await prisma.document.findMany({
            where: { repositoryId },
            select: { id: true },
          });

          let total = 0;
          for (const doc of documents) {
            const examples = await generateExamplesFromDocument(doc.id, repositoryId);
            total += examples.length;
            await job.updateProgress(10 + (80 * (documents.indexOf(doc) + 1)) / documents.length);
          }

          await job.updateProgress(100);
          log.info({ repositoryId, generated: total }, 'Example update completed');
        }
      } catch (error) {
        log.error({ error, repositoryId }, 'Interactive example processing failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Interactive examples V2 worker started');
  return worker;
}
