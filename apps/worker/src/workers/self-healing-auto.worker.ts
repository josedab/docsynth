/**
 * Self-Healing Auto Worker
 *
 * Processes autonomous drift assessment and regeneration jobs.
 */

import { createWorker, QUEUE_NAMES, type SelfHealingAutoJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  assessDrift,
  regenerateSections,
} from '../../../api/src/services/self-healing-auto.service.js';

const log = createLogger('self-healing-auto-worker');

export function startSelfHealingAutoWorker() {
  const worker = createWorker(
    QUEUE_NAMES.SELF_HEALING_AUTO,
    async (job) => {
      const data = job.data as SelfHealingAutoJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting self-healing auto job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'assess-drift': {
            const assessment = await assessDrift(repositoryId);
            await job.updateProgress(50);

            if (
              assessment.recommendation === 'regenerate' ||
              assessment.recommendation === 'urgent-regenerate'
            ) {
              await regenerateSections(repositoryId, {
                driftThreshold: data.driftThreshold,
                confidenceMinimum: data.confidenceMinimum,
                maxSections: data.maxSectionsPerRun,
              });
            }
            await job.updateProgress(90);

            log.info(
              {
                repositoryId,
                drift: assessment.overallDrift,
                recommendation: assessment.recommendation,
              },
              'Drift assessment and healing complete'
            );
            break;
          }

          case 'regenerate': {
            const result = await regenerateSections(repositoryId, {
              driftThreshold: data.driftThreshold,
              confidenceMinimum: data.confidenceMinimum,
              maxSections: data.maxSectionsPerRun,
            });
            await job.updateProgress(90);

            log.info(
              {
                repositoryId,
                regenerated: result.sectionsRegenerated,
                skipped: result.sectionsSkipped,
              },
              'Regeneration complete'
            );
            break;
          }

          case 'create-pr': {
            log.info({ repositoryId }, 'PR creation triggered');
            await job.updateProgress(90);
            break;
          }
        }

        await job.updateProgress(100);
        log.info({ repositoryId, action }, 'Self-healing auto job completed');
      } catch (error) {
        log.error({ error, repositoryId, action }, 'Self-healing auto job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Self-healing auto worker started');
  return worker;
}
