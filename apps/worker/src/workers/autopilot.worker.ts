/**
 * Documentation Autopilot Worker
 *
 * Processes autopilot jobs: repo analysis, style learning, and baseline generation.
 */

import { createWorker, QUEUE_NAMES, type DocAutopilotJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  analyzeRepository,
  generateBaseline,
} from '../../../api/src/services/autopilot.service.js';

const log = createLogger('autopilot-worker');

export function startAutopilotWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_AUTOPILOT,
    async (job) => {
      const data = job.data as DocAutopilotJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting autopilot job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'analyze': {
            await job.updateProgress(10);
            const analysis = await analyzeRepository(repositoryId, {
              depth: data.options?.depth ?? 'shallow',
              includePatterns: data.options?.includePatterns,
              excludePatterns: data.options?.excludePatterns,
            });
            await job.updateProgress(80);

            log.info(
              {
                repositoryId,
                languages: analysis.languages.length,
                apis: analysis.publicAPIs.length,
              },
              'Repository analysis complete'
            );
            break;
          }

          case 'generate-baseline': {
            await job.updateProgress(10);
            const docs = await generateBaseline(repositoryId);
            await job.updateProgress(90);

            log.info({ repositoryId, docsGenerated: docs.length }, 'Baseline generation complete');
            break;
          }

          case 'learn-style': {
            await job.updateProgress(10);
            await analyzeRepository(repositoryId, { depth: 'deep' });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Style learning complete');
            break;
          }
        }

        await job.updateProgress(100);
        log.info({ repositoryId, action }, 'Autopilot job completed');
      } catch (error) {
        log.error({ error, repositoryId, action }, 'Autopilot job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Autopilot worker started');
  return worker;
}
