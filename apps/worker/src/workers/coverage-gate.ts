/**
 * Coverage Gate Worker
 *
 * Processes documentation coverage checks and creates
 * GitHub Check Runs to enforce coverage thresholds.
 */

import { Worker, Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import {
  QUEUE_NAMES,
  getRedisConnection,
  type CoverageGateJobData,
} from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { CoverageGateService } from '../services/coverage-gate.js';

const log = createLogger('coverage-gate-worker');
const coverageGateService = new CoverageGateService();

async function processCoverageGate(job: Job<CoverageGateJobData>): Promise<void> {
  const { repositoryId, installationId, owner, repo, prNumber, commitSha, branch } = job.data;

  log.info({ repositoryId, commitSha, prNumber }, 'Processing coverage gate job');

  try {
    await job.updateProgress(10);

    // Get repository
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repository) {
      throw new Error(`Repository not found: ${repositoryId}`);
    }

    // Get coverage gate config
    const config = await coverageGateService.getConfig(repositoryId);

    if (!config.enabled) {
      log.info({ repositoryId }, 'Coverage gate not enabled, skipping');
      return;
    }

    await job.updateProgress(20);

    // Get previous coverage for comparison
    const previousPercent = await coverageGateService.getPreviousCoverage(repositoryId, branch);

    await job.updateProgress(30);

    // Analyze coverage
    const result = await coverageGateService.analyzeCoverage(
      repositoryId,
      installationId,
      owner,
      repo,
      commitSha,
      branch
    );

    await job.updateProgress(70);

    // Create GitHub Check Run
    const checkResult = await coverageGateService.createCheckRun(
      installationId,
      owner,
      repo,
      commitSha,
      result,
      config,
      previousPercent
    );

    await job.updateProgress(85);

    // Store coverage report
    const passed = checkResult.conclusion === 'success';
    await coverageGateService.storeCoverageReport(
      repositoryId,
      commitSha,
      branch,
      prNumber || null,
      result,
      checkResult.checkRunId,
      passed
    );

    await job.updateProgress(100);

    log.info(
      {
        repositoryId,
        commitSha,
        coverage: result.coveragePercent,
        conclusion: checkResult.conclusion,
        checkRunId: checkResult.checkRunId,
      },
      'Coverage gate completed'
    );
  } catch (error) {
    log.error({ error, repositoryId, commitSha }, 'Coverage gate job failed');
    throw error;
  }
}

export function startCoverageGateWorker(): Worker<CoverageGateJobData> {
  const worker = new Worker<CoverageGateJobData>(
    QUEUE_NAMES.COVERAGE_GATE,
    processCoverageGate,
    {
      connection: getRedisConnection(),
      concurrency: 2,
    }
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Coverage gate job completed');
  });

  worker.on('failed', (job, error) => {
    log.error({ jobId: job?.id, error: error.message }, 'Coverage gate job failed');
  });

  log.info('Coverage gate worker started');
  return worker;
}
