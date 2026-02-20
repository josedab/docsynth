/**
 * Framework Templates Worker
 *
 * Detects project frameworks, applies framework-specific documentation
 * templates, and generates docs from template definitions.
 */

import { createWorker, QUEUE_NAMES, type FrameworkTemplatesJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  detectFramework,
  applyTemplate,
  generateFromTemplate,
} from '../../../api/src/services/framework-templates.service.js';

const log = createLogger('framework-templates-worker');

export function startFrameworkTemplatesWorker() {
  const worker = createWorker(
    QUEUE_NAMES.FRAMEWORK_TEMPLATES,
    async (job) => {
      const data = job.data as FrameworkTemplatesJobData;
      const { repositoryId, action, framework, templateId, targetPath } = data;

      log.info(
        { jobId: job.id, repositoryId, action, framework, templateId },
        'Starting framework templates job'
      );
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'detect-framework': {
            log.info({ repositoryId }, 'Detecting project framework');
            await job.updateProgress(20);
            await detectFramework(repositoryId);
            await job.updateProgress(90);
            break;
          }

          case 'apply-template': {
            log.info({ repositoryId, templateId, targetPath }, 'Applying template');
            await job.updateProgress(20);
            await applyTemplate(repositoryId, templateId!, targetPath!, data.variables);
            await job.updateProgress(90);
            break;
          }

          case 'generate-from-template': {
            log.info({ repositoryId, framework }, 'Generating docs from template');
            await job.updateProgress(20);
            await generateFromTemplate(repositoryId, framework!, data.variables);
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown framework templates action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Framework templates job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Framework templates job failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Framework templates worker started');
  return worker;
}
