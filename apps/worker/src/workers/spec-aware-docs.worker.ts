/**
 * OpenAPI/GraphQL Spec-Aware Documentation Worker
 *
 * Background worker for processing API spec parsing, documentation
 * generation, diffing, and changelog creation from OpenAPI and GraphQL specs.
 */

import { createWorker, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { prisma } from '@docsynth/database';

const log = createLogger('spec-aware-docs-worker');

interface SpecAwareDocsJobData {
  repositoryId: string;
  specContent: string;
  specType: 'openapi' | 'graphql';
  language?: string;
  action: 'generate' | 'diff' | 'changelog';
  oldSpecContent?: string;
  version?: string;
}

export function startSpecAwareDocsWorker() {
  const worker = createWorker(
    QUEUE_NAMES.SPEC_AWARE_DOCS,
    async (job) => {
      const data = job.data as SpecAwareDocsJobData;
      const startTime = Date.now();

      log.info(
        {
          jobId: job.id,
          repositoryId: data.repositoryId,
          action: data.action,
          specType: data.specType,
        },
        'Starting spec-aware documentation processing'
      );

      await job.updateProgress(10);

      try {
        // Validate repository
        const repository = await prisma.repository.findUnique({
          where: { id: data.repositoryId },
        });

        if (!repository) {
          throw new Error(`Repository not found: ${data.repositoryId}`);
        }

        await job.updateProgress(30);

        // Process based on action
        switch (data.action) {
          case 'generate':
            await processGeneration(data);
            break;
          case 'diff':
            await processDiff(data);
            break;
          case 'changelog':
            await processChangelog(data);
            break;
          default:
            throw new Error(`Unknown action: ${data.action}`);
        }

        await job.updateProgress(90);

        const durationMs = Date.now() - startTime;

        await job.updateProgress(100);

        log.info(
          {
            jobId: job.id,
            repositoryId: data.repositoryId,
            action: data.action,
            durationMs,
          },
          'Spec-aware documentation processing completed'
        );
      } catch (error) {
        log.error(
          { error, jobId: job.id, repositoryId: data.repositoryId },
          'Spec-aware documentation processing failed'
        );
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Spec-aware documentation worker started');
  return worker;
}

async function processGeneration(data: SpecAwareDocsJobData): Promise<void> {
  log.info(
    { repositoryId: data.repositoryId, specType: data.specType, language: data.language },
    'Processing spec-aware documentation generation'
  );

  // In production, this would:
  // 1. Parse the spec content
  // 2. Generate documentation for each endpoint/type
  // 3. Store the generated docs in the database
  // 4. Optionally create a PR with the generated docs
}

async function processDiff(data: SpecAwareDocsJobData): Promise<void> {
  log.info({ repositoryId: data.repositoryId, specType: data.specType }, 'Processing spec diff');

  // In production, this would:
  // 1. Parse both old and new specs
  // 2. Compute the diff
  // 3. Store the diff results
  // 4. Notify subscribers of breaking changes
}

async function processChangelog(data: SpecAwareDocsJobData): Promise<void> {
  log.info(
    { repositoryId: data.repositoryId, specType: data.specType, version: data.version },
    'Processing spec changelog generation'
  );

  // In production, this would:
  // 1. Parse both specs and compute diff
  // 2. Generate formatted changelog
  // 3. Store the changelog entry
  // 4. Optionally publish to configured targets
}
