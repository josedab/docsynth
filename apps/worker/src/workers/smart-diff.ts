/**
 * Smart Documentation Diff Worker
 */

import { createWorker, QUEUE_NAMES, type SmartDiffJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { createInstallationOctokit } from '@docsynth/github';
import { analyzeSmartDiff } from '../../../api/src/services/smart-diff.service.js';

const log = createLogger('smart-diff-worker');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export function startSmartDiffWorker() {
  const worker = createWorker(
    QUEUE_NAMES.SMART_DIFF,
    async (job) => {
      const data = job.data as SmartDiffJobData;
      const { repositoryId, prNumber, installationId, owner, repo } = data;

      log.info({ jobId: job.id, repositoryId, prNumber }, 'Starting smart diff analysis');
      await job.updateProgress(10);

      try {
        const octokit = createInstallationOctokit(installationId);
        if (!octokit) throw new Error('Failed to create GitHub client');

        const { data: files } = await octokit.pulls.listFiles({
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100,
        });

        await job.updateProgress(30);

        const changedFiles = files.map((f) => ({
          filename: f.filename,
          patch: f.patch,
          status: f.status || 'modified',
        }));

        const result = await analyzeSmartDiff(repositoryId, prNumber, changedFiles);
        await job.updateProgress(80);

        await db.smartDiff.create({
          data: {
            repositoryId,
            prNumber,
            codeDiffSummary: result.codeDiffSummary,
            docDiffSections: result.docDiffSections,
            approvalStatus: 'pending',
          },
        });

        await job.updateProgress(100);
        log.info(
          { repositoryId, prNumber, sections: result.docDiffSections.length },
          'Smart diff completed'
        );
      } catch (error) {
        log.error({ error, repositoryId, prNumber }, 'Smart diff failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Smart diff worker started');
  return worker;
}
