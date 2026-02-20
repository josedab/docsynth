/**
 * Docs GitOps Worker
 *
 * Processes documentation-as-code GitOps jobs: planning doc changes,
 * applying plans, detecting drift, and validating configuration.
 */

import { createWorker, QUEUE_NAMES, type DocsGitOpsJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  planDocChanges,
  applyPlan,
  detectDrift,
} from '../../../api/src/services/docs-gitops.service.js';

const log = createLogger('docs-gitops-worker');

export function startDocsGitOpsWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOCS_GITOPS,
    async (job) => {
      const data = job.data as DocsGitOpsJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting docs gitops job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'plan': {
            await job.updateProgress(10);
            const plan = await planDocChanges(repositoryId, data.options);
            await job.updateProgress(80);

            log.info(
              { repositoryId, changesPlanned: plan.changes?.length ?? 0 },
              'Doc change plan created'
            );
            break;
          }

          case 'apply': {
            await job.updateProgress(10);
            await applyPlan(repositoryId, data.planId!);
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Plan applied successfully');
            break;
          }

          case 'drift-detect': {
            await job.updateProgress(10);
            const drift = await detectDrift(repositoryId);
            await job.updateProgress(90);

            log.info({ repositoryId, driftDetected: drift.hasDrift }, 'Drift detection complete');
            break;
          }

          case 'validate-config': {
            await job.updateProgress(10);
            // Config validation uses the plan function in dry-run mode
            await planDocChanges(repositoryId, { ...data.options, dryRun: true });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Configuration validated');
            break;
          }

          default: {
            throw new Error(`Unknown docs gitops action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Docs gitops job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Docs gitops job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Docs gitops worker started');
  return worker;
}
