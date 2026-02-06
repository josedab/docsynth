/**
 * Migration Worker
 *
 * Handles importing documentation from external sources (Confluence, Notion, GitBook, etc.)
 * and converting them to DocSynth format.
 */

import { createWorker, QUEUE_NAMES, type MigrationJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import {
  importFromConfluence,
  importFromNotion,
  importFromGitBook,
  importFromMarkdown,
  createOrUpdateDocument,
  type MigrationConfig,
  type MigrationResult,
  type SourceDocument,
  type MigratedDocument,
} from '../../../api/src/services/migration.service.js';

const log = createLogger('migration-worker');

export function startMigrationWorker() {
  const worker = createWorker(
    QUEUE_NAMES.MIGRATION,
    async (job) => {
      const data = job.data as MigrationJobData;
      const { migrationId, config, organizationId } = data;

      log.info({ jobId: job.id, migrationId, source: config.source }, 'Starting migration');

      await job.updateProgress(5);

      try {
        // Update migration status to running
        await prisma.migration.update({
          where: { id: migrationId },
          data: { status: 'running' },
        });

        // Step 1: Fetch documents from source
        await job.updateProgress(10);
        log.info({ migrationId, source: config.source }, 'Fetching documents from source');

        let sourceDocuments: SourceDocument[] = [];

        try {
          switch (config.source) {
            case 'confluence':
              sourceDocuments = await importFromConfluence(config);
              break;

            case 'notion':
              sourceDocuments = await importFromNotion(config);
              break;

            case 'gitbook':
              sourceDocuments = await importFromGitBook(config);
              break;

            case 'markdown':
            case 'readme':
              sourceDocuments = await importFromMarkdown(config);
              break;

            default:
              throw new Error(`Unsupported migration source: ${config.source}`);
          }
        } catch (error) {
          log.error({ error, migrationId, source: config.source }, 'Failed to fetch source documents');
          throw error;
        }

        await job.updateProgress(30);

        const totalDocuments = sourceDocuments.length;
        log.info({ migrationId, totalDocuments }, 'Documents fetched from source');

        // Update migration with total count
        await prisma.migration.update({
          where: { id: migrationId },
          data: { totalDocuments },
        });

        // Step 2: Process each document
        const migratedDocuments: MigratedDocument[] = [];
        let importedCount = 0;
        let skippedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];

        for (let i = 0; i < sourceDocuments.length; i++) {
          const sourceDoc = sourceDocuments[i];
          if (!sourceDoc) continue;

          log.info(
            { migrationId, docIndex: i + 1, totalDocuments, docPath: sourceDoc.path },
            'Processing document'
          );

          try {
            // Create or update document in DocSynth
            const result = await createOrUpdateDocument(sourceDoc, config, organizationId);
            migratedDocuments.push(result);

            // Track status
            switch (result.status) {
              case 'imported':
                importedCount++;
                break;
              case 'updated':
                importedCount++;
                break;
              case 'skipped':
                skippedCount++;
                break;
              case 'failed':
                failedCount++;
                if (result.error) {
                  errors.push(`${result.sourcePath}: ${result.error}`);
                }
                break;
            }

            // Update progress periodically
            const progress = 30 + Math.floor((i / totalDocuments) * 60);
            await job.updateProgress(progress);

            // Update migration record with current progress
            await prisma.migration.update({
              where: { id: migrationId },
              data: {
                importedDocuments: importedCount,
                skippedDocuments: skippedCount,
                failedDocuments: failedCount,
                documents: migratedDocuments as unknown as Record<string, unknown>[],
                errors,
              },
            });
          } catch (error) {
            log.error({ error, migrationId, sourceDoc }, 'Failed to process document');

            // Continue on error (don't fail entire migration for one document)
            failedCount++;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`${sourceDoc.path}: ${errorMessage}`);

            migratedDocuments.push({
              sourceId: sourceDoc.id,
              sourcePath: sourceDoc.path,
              targetDocumentId: null,
              targetPath: sourceDoc.path,
              status: 'failed',
              contentHash: '',
              error: errorMessage,
            });
          }
        }

        await job.updateProgress(95);

        // Step 3: Finalize migration
        const status: MigrationResult['status'] =
          failedCount === 0 ? 'completed' :
          importedCount > 0 ? 'partial' :
          'failed';

        await prisma.migration.update({
          where: { id: migrationId },
          data: {
            status,
            totalDocuments,
            importedDocuments: importedCount,
            skippedDocuments: skippedCount,
            failedDocuments: failedCount,
            documents: migratedDocuments as unknown as Record<string, unknown>[],
            errors,
            completedAt: new Date(),
          },
        });

        await job.updateProgress(100);

        log.info(
          {
            migrationId,
            status,
            totalDocuments,
            importedCount,
            skippedCount,
            failedCount,
          },
          'Migration completed'
        );

        return {
          migrationId,
          status,
          totalDocuments,
          importedDocuments: importedCount,
          skippedDocuments: skippedCount,
          failedDocuments: failedCount,
        };
      } catch (error) {
        log.error({ error, migrationId }, 'Migration job failed');

        // Update migration record with failure
        await prisma.migration.update({
          where: { id: migrationId },
          data: {
            status: 'failed',
            errors: [error instanceof Error ? error.message : 'Unknown error'],
            completedAt: new Date(),
          },
        });

        throw error;
      }
    },
    { concurrency: 2 } // Allow 2 concurrent migrations
  );

  log.info('Migration worker started');
  return worker;
}
