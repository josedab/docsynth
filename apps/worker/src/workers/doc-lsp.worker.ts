/**
 * Doc LSP Worker
 *
 * Processes language-server-protocol-style documentation jobs: diagnostics,
 * completions, reference resolution, and workspace indexing.
 */

import { createWorker, QUEUE_NAMES, type DocLSPJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  diagnoseDocument,
  getCompletions,
  resolveReference,
  indexWorkspace,
} from '../../../api/src/services/doc-lsp.service.js';

const log = createLogger('doc-lsp-worker');

export function startDocLSPWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_LSP,
    async (job) => {
      const data = job.data as DocLSPJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc LSP job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'diagnose': {
            log.info({ repositoryId }, 'Running document diagnostics');
            await job.updateProgress(20);
            await diagnoseDocument(repositoryId, data.documentUri);
            await job.updateProgress(90);
            break;
          }

          case 'complete': {
            log.info({ repositoryId }, 'Generating completions');
            await job.updateProgress(20);
            await getCompletions(repositoryId, data.documentUri, data.position);
            await job.updateProgress(90);
            break;
          }

          case 'resolve-reference': {
            log.info({ repositoryId }, 'Resolving reference');
            await job.updateProgress(20);
            await resolveReference(repositoryId, data.reference);
            await job.updateProgress(90);
            break;
          }

          case 'index-workspace': {
            log.info({ repositoryId }, 'Indexing workspace');
            await job.updateProgress(20);
            await indexWorkspace(repositoryId);
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc LSP action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc LSP job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc LSP job failed');
        throw error;
      }
    },
    { concurrency: 5 }
  );

  log.info('Doc LSP worker started');
  return worker;
}
