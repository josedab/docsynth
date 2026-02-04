import { Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { createWorker, QUEUE_NAMES, DriftPredictionJobData, addJob } from '@docsynth/queue';
import { driftPredictorService } from '../services/drift-predictor.js';

const log = createLogger('drift-prediction-worker');

async function processDriftPrediction(job: Job<DriftPredictionJobData>): Promise<void> {
  const { repositoryId, installationId, owner, repo, scheduled } = job.data;

  log.info({ repositoryId, owner, repo, scheduled }, 'Starting drift prediction');

  try {
    // Run drift prediction analysis
    const result = await driftPredictorService.predictDrift({
      repositoryId,
      installationId,
      owner,
      repo,
    });

    await job.updateProgress(50);

    // Create alerts for high-risk predictions
    const highRiskPredictions = result.predictions.filter(p => p.riskLevel === 'critical' || p.riskLevel === 'high');

    for (const prediction of highRiskPredictions) {
      // Check if there's already an active alert for this document
      const existingAlert = await prisma.healthAlert.findFirst({
        where: {
          repositoryId,
          documentId: prediction.documentId,
          alertType: 'drift-predicted',
          acknowledged: false,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Within last week
        },
      });

      if (!existingAlert) {
        const repository = await prisma.repository.findUnique({
          where: { id: repositoryId },
          select: { organizationId: true },
        });

        if (repository) {
          await prisma.healthAlert.create({
            data: {
              organizationId: repository.organizationId,
              repositoryId,
              documentId: prediction.documentId,
              alertType: 'drift-predicted',
              severity: prediction.riskLevel === 'critical' ? 'critical' : 'warning',
              title: `Predicted documentation drift: ${prediction.documentPath}`,
              message: `This documentation has a ${prediction.driftProbability}% probability of becoming outdated. ${prediction.suggestedActions[0] || 'Review recommended.'}`,
              metadata: {
                driftProbability: prediction.driftProbability,
                riskLevel: prediction.riskLevel,
                signals: prediction.signals,
                relatedPRs: prediction.relatedPRs.slice(0, 5),
                affectedFiles: prediction.affectedFiles.slice(0, 10),
                suggestedActions: prediction.suggestedActions,
                predictedDriftDate: prediction.predictedDriftDate,
              },
            },
          });
        }
      }
    }

    await job.updateProgress(80);

    // Queue notifications for critical predictions
    if (highRiskPredictions.length > 0) {
      const repository = await prisma.repository.findUnique({
        where: { id: repositoryId },
        select: { organizationId: true, name: true },
      });

      if (repository) {
        const criticalCount = highRiskPredictions.filter(p => p.riskLevel === 'critical').length;
        const highCount = highRiskPredictions.filter(p => p.riskLevel === 'high').length;

        await addJob(QUEUE_NAMES.NOTIFICATIONS, {
          type: 'slack',
          recipient: repository.organizationId,
          subject: `DocSynth Drift Prediction: ${highRiskPredictions.length} docs at risk in ${repository.name}`,
          body: [
            `📊 **Drift Prediction Report for ${repository.name}**`,
            '',
            criticalCount > 0 ? `🔴 ${criticalCount} critical risk document(s)` : null,
            highCount > 0 ? `🟠 ${highCount} high risk document(s)` : null,
            '',
            '**Top concerns:**',
            ...highRiskPredictions.slice(0, 3).map(p => `• ${p.documentPath} (${p.driftProbability}% drift probability)`),
            '',
            'View full report in the DocSynth dashboard.',
          ].filter(Boolean).join('\n'),
          metadata: {
            repositoryId,
            predictions: highRiskPredictions.slice(0, 10),
            riskDistribution: result.riskDistribution,
          },
        });
      }
    }

    await job.updateProgress(100);

    log.info(
      {
        repositoryId,
        totalDocs: result.totalDocuments,
        predictions: result.predictions.length,
        riskDistribution: result.riskDistribution,
      },
      'Drift prediction completed'
    );
  } catch (error) {
    log.error({ error, repositoryId }, 'Drift prediction failed');
    throw error;
  }
}

export function startDriftPredictionWorker() {
  return createWorker(QUEUE_NAMES.DRIFT_PREDICTION, processDriftPrediction, {
    concurrency: 2,
    limiter: { max: 10, duration: 60000 },
  });
}

export async function schedulePeriodicDriftPredictions(): Promise<void> {
  log.info('Scheduling periodic drift predictions');

  // Get all enabled repositories
  const repositories = await prisma.repository.findMany({
    where: { enabled: true },
    select: {
      id: true,
      installationId: true,
      githubFullName: true,
    },
  });

  for (const repo of repositories) {
    const [owner, repoName] = repo.githubFullName.split('/');
    if (!owner || !repoName) continue;

    await addJob(
      QUEUE_NAMES.DRIFT_PREDICTION,
      {
        repositoryId: repo.id,
        installationId: repo.installationId,
        owner,
        repo: repoName,
        scheduled: true,
      },
      { jobId: `drift-prediction-${repo.id}-${Date.now()}` }
    );
  }

  log.info({ count: repositories.length }, 'Scheduled drift predictions');
}
