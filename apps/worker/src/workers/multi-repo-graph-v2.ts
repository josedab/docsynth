/**
 * Multi-Repo Knowledge Graph V2 Worker
 */

import { createWorker, QUEUE_NAMES, type MultiRepoGraphV2JobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { buildKnowledgeGraph } from '../../../api/src/services/multi-repo-graph-v2.service.js';

const log = createLogger('multi-repo-graph-v2-worker');

export function startMultiRepoGraphV2Worker() {
  const worker = createWorker(
    QUEUE_NAMES.MULTI_REPO_GRAPH,
    async (job) => {
      const data = job.data as MultiRepoGraphV2JobData;
      const { organizationId, repositoryIds } = data;

      log.info({ jobId: job.id, organizationId }, 'Starting knowledge graph build');
      await job.updateProgress(10);

      try {
        const result = await buildKnowledgeGraph(organizationId, repositoryIds);
        await job.updateProgress(100);

        log.info(
          { organizationId, nodes: result.stats.totalNodes, edges: result.stats.totalEdges },
          'Knowledge graph build completed'
        );
      } catch (error) {
        log.error({ error, organizationId }, 'Knowledge graph build failed');
        throw error;
      }
    },
    { concurrency: 1 }
  );

  log.info('Multi-repo graph V2 worker started');
  return worker;
}
