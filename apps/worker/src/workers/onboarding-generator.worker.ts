/**
 * Onboarding Generator Worker
 *
 * Processes onboarding path generation jobs.
 */

import { createWorker, QUEUE_NAMES, type OnboardingGeneratorJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  analyzeTopology,
  generateOnboardingPath,
} from '../../../api/src/services/onboarding-generator.service.js';

const log = createLogger('onboarding-generator-worker');

export function startOnboardingGeneratorWorker() {
  const worker = createWorker(
    QUEUE_NAMES.ONBOARDING_GENERATOR,
    async (job) => {
      const data = job.data as OnboardingGeneratorJobData;
      const { repositoryId, role, action } = data;

      log.info({ jobId: job.id, repositoryId, role, action }, 'Starting onboarding generator job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'analyze-topology': {
            const topology = await analyzeTopology(repositoryId);
            await job.updateProgress(80);
            log.info(
              { repositoryId, entryPoints: topology.entryPoints.length },
              'Topology analysis complete'
            );
            break;
          }

          case 'generate-path': {
            await job.updateProgress(10);
            const path = await generateOnboardingPath(repositoryId, role, data.options);
            await job.updateProgress(90);
            log.info({ repositoryId, role, steps: path.steps.length }, 'Onboarding path generated');
            break;
          }

          case 'update-path': {
            if (data.pathId) {
              await analyzeTopology(repositoryId);
              await generateOnboardingPath(repositoryId, role, data.options);
            }
            await job.updateProgress(90);
            break;
          }
        }

        await job.updateProgress(100);
        log.info({ repositoryId, action }, 'Onboarding generator job completed');
      } catch (error) {
        log.error({ error, repositoryId, action }, 'Onboarding generator job failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Onboarding generator worker started');
  return worker;
}
