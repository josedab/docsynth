/**
 * Doc Migration Engine Worker
 *
 * Connects to external documentation platforms (Confluence, Notion, GitBook, etc.),
 * imports content, converts formats, and supports bidirectional sync.
 */

import { createWorker, QUEUE_NAMES, type DocMigrationEngineJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { executeMigration } from '../../../api/src/services/doc-migration-engine.service.js';

const log = createLogger('doc-migration-engine-worker');

export function startDocMigrationEngineWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_MIGRATION_ENGINE,
    async (job) => {
      const data = job.data as DocMigrationEngineJobData;
      const { organizationId, action, source, targetRepositoryId } = data;

      log.info(
        { jobId: job.id, organizationId, action, source, targetRepositoryId },
        'Starting doc migration engine job'
      );
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'connect': {
            log.info({ source, organizationId }, 'Connecting to external platform');
            await job.updateProgress(20);
            await executeMigration(data, 'connect');
            await job.updateProgress(90);
            break;
          }

          case 'import': {
            log.info({ source, targetRepositoryId }, 'Importing documentation');
            await job.updateProgress(10);
            await executeMigration(data, 'import');
            await job.updateProgress(90);
            break;
          }

          case 'convert': {
            log.info({ source, targetRepositoryId }, 'Converting documentation format');
            await job.updateProgress(20);
            await executeMigration(data, 'convert');
            await job.updateProgress(90);
            break;
          }

          case 'sync-bidirectional': {
            log.info({ source, targetRepositoryId }, 'Running bidirectional sync');
            await job.updateProgress(10);
            await executeMigration(data, 'sync-bidirectional');
            await job.updateProgress(90);
            break;
          }

          case 'validate': {
            log.info({ targetRepositoryId }, 'Validating migrated documentation');
            await job.updateProgress(20);
            await executeMigration(data, 'validate');
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc migration engine action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info(
          { jobId: job.id, organizationId, action, source },
          'Doc migration engine job completed'
        );
      } catch (error) {
        log.error(
          { error, jobId: job.id, organizationId, action, source },
          'Doc migration engine job failed'
        );
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Doc migration engine worker started');
  return worker;
}
