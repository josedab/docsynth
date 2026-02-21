/**
 * Offline Sync Worker
 *
 * Processes offline synchronization jobs: preparing content bundles,
 * resolving conflicts, syncing changes, and evicting stale entries.
 */

import { createWorker, QUEUE_NAMES, type OfflineSyncJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  prepareSyncBundle,
  syncChanges,
  resolveConflicts,
} from '../../../api/src/services/offline-sync.service.js';

const log = createLogger('offline-sync-worker');

export function startOfflineSyncWorker() {
  const worker = createWorker(
    QUEUE_NAMES.OFFLINE_SYNC,
    async (job) => {
      const data = job.data as OfflineSyncJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting offline sync job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'prepare-bundle': {
            await job.updateProgress(10);
            const bundle = await prepareSyncBundle(repositoryId, data.options);
            await job.updateProgress(90);

            log.info(
              { repositoryId, bundleSize: bundle.size, documents: bundle.documentCount },
              'Sync bundle prepared'
            );
            break;
          }

          case 'resolve-conflicts': {
            await job.updateProgress(10);
            const resolution = await resolveConflicts(repositoryId, data.conflictIds!);
            await job.updateProgress(90);

            log.info({ repositoryId, resolved: resolution.resolvedCount }, 'Conflicts resolved');
            break;
          }

          case 'sync-changes': {
            await job.updateProgress(10);
            const syncResult = await syncChanges(repositoryId, data.changeSet!);
            await job.updateProgress(90);

            log.info(
              { repositoryId, synced: syncResult.syncedCount, conflicts: syncResult.conflictCount },
              'Changes synced'
            );
            break;
          }

          case 'evict-stale': {
            await job.updateProgress(10);
            await prepareSyncBundle(repositoryId, { evictStale: true });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Stale entries evicted');
            break;
          }

          default: {
            throw new Error(`Unknown offline sync action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Offline sync job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Offline sync job failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Offline sync worker started');
  return worker;
}
