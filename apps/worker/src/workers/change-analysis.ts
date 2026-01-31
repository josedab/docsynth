import { createWorker, QUEUE_NAMES, addJob, type ChangeAnalysisJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { GitHubClient } from '@docsynth/github';
import { createLogger } from '@docsynth/utils';
import { changeAnalyzerService } from '../services/change-analyzer.js';

const log = createLogger('change-analysis-worker');

export function startChangeAnalysisWorker() {
  const worker = createWorker(
    QUEUE_NAMES.CHANGE_ANALYSIS,
    async (job) => {
      const data = job.data as ChangeAnalysisJobData;

      log.info({ jobId: job.id, prNumber: data.prNumber }, 'Processing change analysis');

      // Update job progress
      await job.updateProgress(10);

      // Create GitHub client for this installation
      const client = GitHubClient.forInstallation(data.installationId);

      // Get PR details (used for context, logged below)
      await client.getPullRequest(data.owner, data.repo, data.prNumber);
      await job.updateProgress(30);

      // Analyze changes
      const analysis = await changeAnalyzerService.analyzeChanges(
        client,
        data.owner,
        data.repo,
        data.prNumber
      );
      await job.updateProgress(70);

      // Save change analysis to database
      const changeAnalysis = await prisma.changeAnalysis.create({
        data: {
          prEventId: data.prEventId,
          changes: JSON.parse(JSON.stringify(analysis.changes)),
          documentationImpact: JSON.parse(JSON.stringify(analysis.documentationImpact)),
          priority: analysis.priority.toUpperCase() as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE',
          requiresDocumentation: analysis.requiresDocumentation,
        },
      });

      await job.updateProgress(80);

      // If documentation is required, create generation job and queue next step
      if (analysis.requiresDocumentation) {
        // Create generation job record
        const generationJob = await prisma.generationJob.create({
          data: {
            changeAnalysisId: changeAnalysis.id,
            status: 'PENDING',
          },
        });

        // Queue intent inference
        await addJob(
          QUEUE_NAMES.INTENT_INFERENCE,
          {
            changeAnalysisId: changeAnalysis.id,
            repositoryId: data.repositoryId,
            installationId: data.installationId,
          },
          { jobId: generationJob.id }
        );

        log.info(
          { changeAnalysisId: changeAnalysis.id, generationJobId: generationJob.id },
          'Queued for intent inference'
        );
      } else {
        log.info({ prNumber: data.prNumber }, 'No documentation required for this PR');
      }

      await job.updateProgress(100);
    },
    { concurrency: 3 }
  );

  log.info('Change analysis worker started');

  return worker;
}
