/**
 * Auto-Healing Documentation Worker
 */

import { createWorker, QUEUE_NAMES, addJob, type AutoHealingJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import {
  runHealingScan,
  getHealingConfig,
} from '../../../api/src/services/auto-healing.service.js';

const log = createLogger('auto-healing-worker');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export function startAutoHealingWorker() {
  const worker = createWorker(
    QUEUE_NAMES.AUTO_HEALING,
    async (job) => {
      const data = job.data as AutoHealingJobData;
      const { repositoryId, triggeredBy, scanTypes } = data;

      log.info({ jobId: job.id, repositoryId, triggeredBy }, 'Starting auto-healing scan');
      await job.updateProgress(10);

      try {
        const config = await getHealingConfig(repositoryId);
        if (!config.enabled) {
          log.info({ repositoryId }, 'Auto-healing disabled for this repository');
          return;
        }

        const result = await runHealingScan(repositoryId, scanTypes as any);
        await job.updateProgress(80);

        await db.healingScan.create({
          data: {
            repositoryId,
            triggeredBy,
            issuesFound: result.issuesFound,
            issuesFixed: result.issuesFixed,
            issues: result.issues,
            prCreated: result.prCreated,
            prUrl: result.prUrl,
            status: 'completed',
          },
        });

        await job.updateProgress(100);
        log.info(
          { repositoryId, issuesFound: result.issuesFound, issuesFixed: result.issuesFixed },
          'Auto-healing scan completed'
        );
      } catch (error) {
        log.error({ error, repositoryId }, 'Auto-healing scan failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Auto-healing worker started');
  return worker;
}

/**
 * Schedule periodic auto-healing scans for all enabled repositories
 */
export async function schedulePeriodicAutoHealing(): Promise<void> {
  log.info('Scheduling periodic auto-healing scans');

  const configs = await db.healingConfig.findMany({
    where: { enabled: true },
    select: { repositoryId: true },
  });

  for (const config of configs) {
    try {
      await addJob(
        QUEUE_NAMES.AUTO_HEALING,
        {
          repositoryId: config.repositoryId as string,
          triggeredBy: 'scheduled' as const,
        },
        { jobId: `healing-scheduled-${config.repositoryId}` }
      );
    } catch (error) {
      log.error({ error, repositoryId: config.repositoryId }, 'Failed to schedule healing');
    }
  }

  log.info({ count: configs.length }, 'Scheduled auto-healing scans');
}
