/**
 * Compliance Assessment Worker
 *
 * Processes compliance assessments against regulatory frameworks
 * and generates compliance documentation.
 */

import { Worker, Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import {
  QUEUE_NAMES,
  getRedisConnection,
  type ComplianceAssessmentJobData,
} from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { ComplianceAssessmentService } from '../services/compliance-assessment.js';

const log = createLogger('compliance-assessment-worker');
const complianceService = new ComplianceAssessmentService();

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

async function processComplianceAssessment(
  job: Job<ComplianceAssessmentJobData>
): Promise<void> {
  const { repositoryId, reportId, installationId, owner, repo, framework, controlIds } =
    job.data;

  log.info({ repositoryId, reportId, framework }, 'Processing compliance assessment job');

  try {
    await job.updateProgress(10);

    // Update report status
    await db.complianceReport.update({
      where: { id: reportId },
      data: { status: 'scanning' },
    });

    await job.updateProgress(20);

    // Run assessment
    const result = await complianceService.assessCompliance(
      repositoryId,
      reportId,
      installationId,
      owner,
      repo,
      framework,
      controlIds
    );

    await job.updateProgress(70);

    // Update report status
    await db.complianceReport.update({
      where: { id: reportId },
      data: { status: 'generating' },
    });

    // Generate compliance documentation
    await complianceService.generateComplianceDoc(reportId, framework);

    await job.updateProgress(90);

    // Update final status
    await db.complianceReport.update({
      where: { id: reportId },
      data: { status: 'completed' },
    });

    await job.updateProgress(100);

    log.info(
      {
        repositoryId,
        reportId,
        framework,
        assessments: result.assessmentsCreated,
        score: result.overallScore,
      },
      'Compliance assessment completed'
    );
  } catch (error) {
    log.error({ error, repositoryId, reportId, framework }, 'Compliance assessment job failed');

    // Update report status to failed
    await db.complianceReport.update({
      where: { id: reportId },
      data: { status: 'failed' },
    });

    throw error;
  }
}

export function startComplianceAssessmentWorker(): Worker<ComplianceAssessmentJobData> {
  const worker = new Worker<ComplianceAssessmentJobData>(
    QUEUE_NAMES.COMPLIANCE_ASSESSMENT,
    processComplianceAssessment,
    {
      connection: getRedisConnection(),
      concurrency: 2,
    }
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Compliance assessment job completed');
  });

  worker.on('failed', (job, error) => {
    log.error({ jobId: job?.id, error: error.message }, 'Compliance assessment job failed');
  });

  log.info('Compliance assessment worker started');
  return worker;
}
