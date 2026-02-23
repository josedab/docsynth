/**
 * Doc Health Badge Worker
 *
 * Computes documentation health metrics and renders badges: score
 * computation, badge rendering, GitHub status checks, and org leaderboards.
 */

import { createWorker, QUEUE_NAMES, type DocHealthBadgeJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  computeHealthScore,
  renderBadge,
  postStatusCheck,
  getOrgLeaderboard,
} from '../../../api/src/services/doc-health-badge.service.js';

const log = createLogger('doc-health-badge-worker');

export function startDocHealthBadgeWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_HEALTH_BADGE,
    async (job) => {
      const data = job.data as DocHealthBadgeJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc health badge job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'compute-score': {
            log.info({ repositoryId }, 'Computing health score');
            await job.updateProgress(20);
            await computeHealthScore(repositoryId);
            await job.updateProgress(90);
            break;
          }

          case 'render-badge': {
            log.info({ repositoryId }, 'Rendering health badge');
            await job.updateProgress(20);
            await renderBadge(repositoryId, data.format);
            await job.updateProgress(90);
            break;
          }

          case 'post-status-check': {
            log.info({ repositoryId }, 'Posting status check');
            await job.updateProgress(20);
            await postStatusCheck(repositoryId, data.commitSha);
            await job.updateProgress(90);
            break;
          }

          case 'update-leaderboard': {
            log.info({ repositoryId }, 'Updating org leaderboard');
            await job.updateProgress(20);
            await getOrgLeaderboard(data.orgId);
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc health badge action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc health badge job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc health badge job failed');
        throw error;
      }
    },
    { concurrency: 5 }
  );

  log.info('Doc health badge worker started');
  return worker;
}
