/**
 * Doc Dependency Graph Worker
 *
 * Builds and analyzes documentation dependency graphs: graph construction,
 * blast-radius computation, broken-reference detection, and graph export.
 */

import { createWorker, QUEUE_NAMES, type DocDepGraphJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  buildGraph,
  computeBlastRadius,
  detectBrokenReferences,
  exportGraph,
} from '../../../api/src/services/doc-dep-graph.service.js';

const log = createLogger('doc-dep-graph-worker');

export function startDocDepGraphWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_DEP_GRAPH,
    async (job) => {
      const data = job.data as DocDepGraphJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc dep graph job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'build-graph': {
            log.info({ repositoryId }, 'Building dependency graph');
            await job.updateProgress(20);
            await buildGraph(repositoryId);
            await job.updateProgress(90);
            break;
          }

          case 'compute-blast-radius': {
            log.info({ repositoryId }, 'Computing blast radius');
            await job.updateProgress(20);
            await computeBlastRadius(repositoryId, data.documentId);
            await job.updateProgress(90);
            break;
          }

          case 'detect-broken-refs': {
            log.info({ repositoryId }, 'Detecting broken references');
            await job.updateProgress(20);
            await detectBrokenReferences(repositoryId);
            await job.updateProgress(90);
            break;
          }

          case 'export-graph': {
            log.info({ repositoryId }, 'Exporting dependency graph');
            await job.updateProgress(20);
            await exportGraph(repositoryId, data.format);
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc dep graph action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc dep graph job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc dep graph job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Doc dep graph worker started');
  return worker;
}
