/**
 * Federated Search Worker
 *
 * Processes cross-repo indexing and search operations.
 */

import { createWorker, QUEUE_NAMES, type FederatedSearchJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  buildIndex,
  buildNavigationTree,
} from '../../../api/src/services/federated-search.service.js';

const log = createLogger('federated-search-worker');

export function startFederatedSearchWorker() {
  const worker = createWorker(
    QUEUE_NAMES.FEDERATED_SEARCH,
    async (job) => {
      const data = job.data as FederatedSearchJobData;
      const { organizationId, action } = data;

      log.info({ jobId: job.id, organizationId, action }, 'Starting federated search job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'index-repo':
          case 'reindex-all': {
            const index = await buildIndex(organizationId, data.repositoryIds);
            await job.updateProgress(70);

            if (data.options?.buildCrossRefs) {
              await buildNavigationTree(organizationId);
            }
            await job.updateProgress(90);

            log.info(
              { organizationId, repos: index.repositories.length, docs: index.totalDocuments },
              'Federated index built'
            );
            break;
          }

          case 'build-navigation': {
            await buildNavigationTree(organizationId);
            await job.updateProgress(90);
            log.info({ organizationId }, 'Navigation tree built');
            break;
          }

          case 'search': {
            // Search is typically handled synchronously via API
            log.info({ organizationId }, 'Search action processed');
            await job.updateProgress(90);
            break;
          }
        }

        await job.updateProgress(100);
        log.info({ organizationId, action }, 'Federated search job completed');
      } catch (error) {
        log.error({ error, organizationId, action }, 'Federated search job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Federated search worker started');
  return worker;
}
