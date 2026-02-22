/**
 * Doc Federation Worker
 *
 * Manages federated documentation networks: trust establishment,
 * cross-repository reference resolution, index synchronization,
 * and trust revocation.
 */

import { createWorker, QUEUE_NAMES, type DocFederationJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  establishTrust,
  resolveReference,
  syncFederatedIndex,
  revokeTrust,
} from '../../../api/src/services/doc-federation.service.js';

const log = createLogger('doc-federation-worker');

export function startDocFederationWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_FEDERATION,
    async (job) => {
      const data = job.data as DocFederationJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc federation job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'establish-trust': {
            log.info({ repositoryId }, 'Establishing federation trust');
            await job.updateProgress(20);
            await establishTrust(repositoryId, data.remoteRepositoryId);
            await job.updateProgress(90);
            break;
          }

          case 'resolve-reference': {
            log.info({ repositoryId }, 'Resolving federated reference');
            await job.updateProgress(20);
            await resolveReference(repositoryId, data.reference);
            await job.updateProgress(90);
            break;
          }

          case 'sync-index': {
            log.info({ repositoryId }, 'Synchronizing federated index');
            await job.updateProgress(20);
            await syncFederatedIndex(repositoryId);
            await job.updateProgress(90);
            break;
          }

          case 'revoke-trust': {
            log.info({ repositoryId }, 'Revoking federation trust');
            await job.updateProgress(20);
            await revokeTrust(repositoryId, data.remoteRepositoryId);
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc federation action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc federation job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc federation job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Doc federation worker started');
  return worker;
}
