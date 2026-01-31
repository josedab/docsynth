import { createWorker, QUEUE_NAMES, addJob, type IntentInferenceJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { GitHubClient } from '@docsynth/github';
import { createLogger } from '@docsynth/utils';
import type { FileChange } from '@docsynth/types';
import { intentInferenceService } from '../services/intent-inference.js';

const log = createLogger('intent-inference-worker');

export function startIntentInferenceWorker() {
  const worker = createWorker(
    QUEUE_NAMES.INTENT_INFERENCE,
    async (job) => {
      const data = job.data as IntentInferenceJobData;

      log.info({ jobId: job.id, changeAnalysisId: data.changeAnalysisId }, 'Processing intent inference');

      // Update generation job status
      await prisma.generationJob.update({
        where: { changeAnalysisId: data.changeAnalysisId },
        data: { status: 'INFERRING', startedAt: new Date() },
      });

      await job.updateProgress(10);

      // Get change analysis with PR event
      const changeAnalysis = await prisma.changeAnalysis.findUnique({
        where: { id: data.changeAnalysisId },
        include: {
          prEvent: {
            include: {
              repository: true,
            },
          },
        },
      });

      if (!changeAnalysis) {
        throw new Error(`Change analysis ${data.changeAnalysisId} not found`);
      }

      await job.updateProgress(20);

      // Create GitHub client
      const client = GitHubClient.forInstallation(data.installationId);

      // Parse repository full name
      const [owner, repo] = changeAnalysis.prEvent.repository.githubFullName.split('/');
      if (!owner || !repo) {
        throw new Error('Invalid repository name');
      }

      // Run intent inference
      const changes = changeAnalysis.changes as unknown as FileChange[];
      const result = await intentInferenceService.inferIntent(
        client,
        owner,
        repo,
        changeAnalysis.prEvent.prNumber,
        changes,
        changeAnalysis.prEvent.title,
        changeAnalysis.prEvent.body
      );

      await job.updateProgress(70);

      // Save intent context
      const intentContext = await prisma.intentContext.create({
        data: {
          changeAnalysisId: data.changeAnalysisId,
          businessPurpose: result.businessPurpose,
          technicalApproach: result.technicalApproach,
          alternativesConsidered: result.alternativesConsidered,
          targetAudience: result.targetAudience,
          keyConcepts: result.keyConcepts,
          sources: JSON.parse(JSON.stringify(result.sources)),
        },
      });

      await job.updateProgress(85);

      // Update generation job with intent context
      await prisma.generationJob.update({
        where: { changeAnalysisId: data.changeAnalysisId },
        data: { intentContextId: intentContext.id },
      });

      // Queue documentation generation
      await addJob(QUEUE_NAMES.DOC_GENERATION, {
        changeAnalysisId: data.changeAnalysisId,
        intentContextId: intentContext.id,
        repositoryId: data.repositoryId,
        installationId: data.installationId,
      });

      log.info(
        { changeAnalysisId: data.changeAnalysisId, intentContextId: intentContext.id },
        'Intent inference complete, queued for generation'
      );

      await job.updateProgress(100);
    },
    { concurrency: 2 }
  );

  log.info('Intent inference worker started');

  return worker;
}
