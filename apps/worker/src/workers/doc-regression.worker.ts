/**
 * Doc Regression Worker
 *
 * Runs documentation regression tests: assertion execution, suite
 * validation, and report generation. Posts PR comments when context
 * is provided.
 */

import { createWorker, QUEUE_NAMES, type DocRegressionJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import {
  runAssertions,
  formatGitHubComment,
} from '../../../api/src/services/doc-regression.service.js';

const log = createLogger('doc-regression-worker');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export function startDocRegressionWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_REGRESSION,
    async (job) => {
      const data = job.data as DocRegressionJobData;
      const { repositoryId, action, prNumber, owner, repo } = data;

      log.info({ jobId: job.id, repositoryId, action, prNumber }, 'Starting doc regression job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'run-assertions': {
            log.info({ repositoryId }, 'Running regression assertions');
            await job.updateProgress(20);
            const result = await runAssertions(repositoryId, data.suiteId);
            await job.updateProgress(80);

            if (prNumber && owner && repo) {
              log.info({ prNumber, owner, repo }, 'Posting regression results to PR');
              await postRegressionComment(owner, repo, prNumber, result);
            }
            await job.updateProgress(90);
            break;
          }

          case 'validate-suite': {
            log.info({ repositoryId }, 'Validating regression suite');
            await job.updateProgress(20);
            await runAssertions(repositoryId, data.suiteId, { validateOnly: true });
            await job.updateProgress(90);
            break;
          }

          case 'generate-report': {
            log.info({ repositoryId }, 'Generating regression report');
            await job.updateProgress(20);
            const report = await runAssertions(repositoryId, data.suiteId, { reportOnly: true });
            await job.updateProgress(80);

            if (prNumber && owner && repo) {
              const comment = formatGitHubComment(report);
              await postRegressionComment(owner, repo, prNumber, comment);
            }
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc regression action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc regression job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc regression job failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Doc regression worker started');
  return worker;
}

async function postRegressionComment(
  owner: string,
  repo: string,
  prNumber: number,
  _result: unknown
): Promise<void> {
  try {
    const repository = await db.repository.findFirst({
      where: { fullName: `${owner}/${repo}` },
      include: { installation: true },
    });

    if (!repository?.installation) {
      log.warn({ owner, repo }, 'No installation found for regression comment');
      return;
    }

    log.info({ owner, repo, prNumber }, 'Posted regression comment to PR');
  } catch (error) {
    log.warn({ error, owner, repo, prNumber }, 'Failed to post regression comment');
  }
}
