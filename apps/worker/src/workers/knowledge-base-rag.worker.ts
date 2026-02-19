/**
 * Knowledge Base RAG Worker
 *
 * Indexes repositories into a unified knowledge base, handles RAG queries
 * with citation tracking, and surfaces proactive documentation suggestions.
 */

import { createWorker, QUEUE_NAMES, type KnowledgeBaseRAGJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  indexRepository,
  queryKnowledgeBase,
} from '../../../api/src/services/knowledge-base-rag.service.js';

const log = createLogger('knowledge-base-rag-worker');

export function startKnowledgeBaseRAGWorker() {
  const worker = createWorker(
    QUEUE_NAMES.KNOWLEDGE_BASE_RAG,
    async (job) => {
      const data = job.data as KnowledgeBaseRAGJobData;
      const { organizationId, repositoryId, action, sources } = data;

      log.info(
        { jobId: job.id, organizationId, repositoryId, action },
        'Starting knowledge base RAG job'
      );
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'index-full': {
            log.info({ organizationId, repositoryId }, 'Running full index');
            await job.updateProgress(10);
            await indexRepository(organizationId, repositoryId!, sources ?? [], 'full');
            await job.updateProgress(90);
            break;
          }

          case 'index-incremental': {
            log.info({ organizationId, repositoryId }, 'Running incremental index');
            await job.updateProgress(10);
            await indexRepository(organizationId, repositoryId!, sources ?? [], 'incremental');
            await job.updateProgress(90);
            break;
          }

          case 'query': {
            log.info({ organizationId, query: data.query }, 'Processing RAG query');
            await job.updateProgress(20);
            await queryKnowledgeBase(organizationId, data.query!, data.options);
            await job.updateProgress(90);
            break;
          }

          case 'surface-proactive': {
            log.info({ organizationId }, 'Surfacing proactive suggestions');
            await job.updateProgress(20);
            await queryKnowledgeBase(organizationId, '', {
              ...data.options,
              proactive: true,
            });
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown knowledge base RAG action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, organizationId, action }, 'Knowledge base RAG job completed');
      } catch (error) {
        log.error(
          { error, jobId: job.id, organizationId, action },
          'Knowledge base RAG job failed'
        );
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Knowledge base RAG worker started');
  return worker;
}
