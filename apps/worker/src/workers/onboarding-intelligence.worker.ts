/**
 * Onboarding Intelligence Worker
 *
 * Tracks developer onboarding journeys, optimizes learning paths,
 * computes time-to-productivity metrics, and generates onboarding reports.
 */

import { createWorker, QUEUE_NAMES, type OnboardingIntelligenceJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  trackJourney,
  optimizePath,
  computeMetrics,
  generateReport,
} from '../../../api/src/services/onboarding-intelligence.service.js';

const log = createLogger('onboarding-intelligence-worker');

export function startOnboardingIntelligenceWorker() {
  const worker = createWorker(
    QUEUE_NAMES.ONBOARDING_INTELLIGENCE,
    async (job) => {
      const data = job.data as OnboardingIntelligenceJobData;
      const { repositoryId, action, userId, role } = data;

      log.info(
        { jobId: job.id, repositoryId, action, userId, role },
        'Starting onboarding intelligence job'
      );
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'track-journey': {
            log.info({ repositoryId, userId }, 'Tracking onboarding journey event');
            await job.updateProgress(20);
            await trackJourney(repositoryId, userId!, data.journeyEvent!);
            await job.updateProgress(90);
            break;
          }

          case 'optimize-path': {
            log.info({ repositoryId, role }, 'Optimizing learning path');
            await job.updateProgress(20);
            await optimizePath(repositoryId, role);
            await job.updateProgress(90);
            break;
          }

          case 'compute-metrics': {
            log.info({ repositoryId }, 'Computing onboarding metrics');
            await job.updateProgress(20);
            await computeMetrics(repositoryId);
            await job.updateProgress(90);
            break;
          }

          case 'generate-report': {
            log.info({ repositoryId }, 'Generating onboarding report');
            await job.updateProgress(20);
            await generateReport(repositoryId);
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown onboarding intelligence action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Onboarding intelligence job completed');
      } catch (error) {
        log.error(
          { error, jobId: job.id, repositoryId, action },
          'Onboarding intelligence job failed'
        );
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Onboarding intelligence worker started');
  return worker;
}
