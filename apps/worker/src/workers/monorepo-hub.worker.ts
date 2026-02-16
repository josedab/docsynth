/**
 * Monorepo Hub Worker
 *
 * Handles background workspace discovery, documentation generation,
 * and periodic refresh of monorepo maps.
 */

import { createWorker } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('monorepo-hub-worker');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

interface MonorepoHubJobData {
  repositoryId: string;
  type: 'discover' | 'generate' | 'refresh';
}

export function startMonorepoHubWorker() {
  const worker = createWorker(
    'monorepo-hub' as any,
    async (job) => {
      const data = job.data as MonorepoHubJobData;
      const startTime = Date.now();

      log.info(
        { jobId: job.id, repositoryId: data.repositoryId, type: data.type },
        'Starting monorepo hub job'
      );

      await job.updateProgress(10);

      try {
        const repository = await prisma.repository.findUnique({
          where: { id: data.repositoryId },
        });

        if (!repository) {
          throw new Error(`Repository not found: ${data.repositoryId}`);
        }

        await job.updateProgress(30);

        switch (data.type) {
          case 'discover':
            await handleDiscover(data.repositoryId);
            break;
          case 'generate':
            await handleGenerate(data.repositoryId);
            break;
          case 'refresh':
            await handleRefresh(data.repositoryId);
            break;
        }

        await job.updateProgress(100);

        const duration = Date.now() - startTime;
        log.info(
          { jobId: job.id, repositoryId: data.repositoryId, duration },
          'Monorepo hub job completed'
        );
      } catch (error) {
        log.error(
          { error, jobId: job.id, repositoryId: data.repositoryId },
          'Monorepo hub job failed'
        );
        throw error;
      }
    },
    { concurrency: 2 }
  );

  return worker;
}

// ============================================================================
// Job Handlers
// ============================================================================

async function handleDiscover(repositoryId: string) {
  log.info({ repositoryId }, 'Running workspace discovery');

  const existing = await db.monorepoHub.findUnique({ where: { repositoryId } });
  if (existing) {
    log.info({ repositoryId }, 'Monorepo map already exists, skipping discovery');
    return;
  }

  // In production this would fetch the root package.json via the GitHub client
  log.info({ repositoryId }, 'Workspace discovery complete (stub)');
}

async function handleGenerate(repositoryId: string) {
  log.info({ repositoryId }, 'Running doc generation for undocumented packages');

  const map = await db.monorepoHub.findUnique({ where: { repositoryId } });
  if (!map) {
    log.warn({ repositoryId }, 'No monorepo map found, skipping generation');
    return;
  }

  const packages = (map.packages ?? []) as Array<{ name: string; hasReadme: boolean }>;
  const undocumented = packages.filter((p) => !p.hasReadme);

  log.info(
    { repositoryId, total: packages.length, undocumented: undocumented.length },
    'Doc generation summary'
  );
}

async function handleRefresh(repositoryId: string) {
  log.info({ repositoryId }, 'Refreshing monorepo map');

  const existing = await db.monorepoHub.findUnique({ where: { repositoryId } });
  if (existing) {
    await db.monorepoHub.update({
      where: { repositoryId },
      data: { updatedAt: new Date() },
    });
  }

  log.info({ repositoryId }, 'Monorepo map refresh complete');
}
