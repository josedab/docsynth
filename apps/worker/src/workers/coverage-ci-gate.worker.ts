/**
 * Coverage CI Gate Worker
 *
 * Processes coverage scan jobs and enforces CI gates.
 */

import { createWorker, QUEUE_NAMES, type CoverageCIGateJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { createInstallationOctokit } from '@docsynth/github';
import {
  scanCoverage,
  formatCoverageComment,
} from '../../../api/src/services/coverage-ci-gate.service.js';

const log = createLogger('coverage-ci-gate-worker');

export function startCoverageCIGateWorker() {
  const worker = createWorker(
    QUEUE_NAMES.COVERAGE_CI_GATE,
    async (job) => {
      const data = job.data as CoverageCIGateJobData;
      const { repositoryId, prNumber, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting coverage CI gate job');
      await job.updateProgress(5);

      try {
        const report = await scanCoverage(repositoryId, { prNumber });
        await job.updateProgress(70);

        // Post coverage comment on PR if applicable
        if (prNumber && data.installationId && data.owner && data.repo) {
          const octokit = createInstallationOctokit(data.installationId);
          if (octokit) {
            const comment = formatCoverageComment(report);

            const { data: existingComments } = await octokit.issues.listComments({
              owner: data.owner,
              repo: data.repo,
              issue_number: prNumber,
              per_page: 100,
            });

            const existing = existingComments.find((c) =>
              c.body?.includes('Documentation Coverage Report')
            );

            if (existing) {
              await octokit.issues.updateComment({
                owner: data.owner,
                repo: data.repo,
                comment_id: existing.id,
                body: comment,
              });
            } else {
              await octokit.issues.createComment({
                owner: data.owner,
                repo: data.repo,
                issue_number: prNumber,
                body: comment,
              });
            }
          }
        }

        await job.updateProgress(100);
        log.info(
          { repositoryId, coverage: report.coveragePercentage, passed: report.gateResult.passed },
          'Coverage CI gate job completed'
        );
      } catch (error) {
        log.error({ error, repositoryId }, 'Coverage CI gate job failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Coverage CI gate worker started');
  return worker;
}
