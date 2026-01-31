import { createWorker, QUEUE_NAMES, addJob, type DocGenerationJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { GitHubClient } from '@docsynth/github';
import { createLogger } from '@docsynth/utils';
import type { FileChange, DocumentType } from '@docsynth/types';
import { docGeneratorService } from '../services/doc-generator.js';

const log = createLogger('doc-generation-worker');

export function startDocGenerationWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_GENERATION,
    async (job) => {
      const data = job.data as DocGenerationJobData;

      log.info({ jobId: job.id, changeAnalysisId: data.changeAnalysisId }, 'Processing doc generation');

      // Update job status
      await prisma.generationJob.update({
        where: { changeAnalysisId: data.changeAnalysisId },
        data: { status: 'GENERATING' },
      });

      await job.updateProgress(10);

      // Get change analysis with all related data
      const changeAnalysis = await prisma.changeAnalysis.findUnique({
        where: { id: data.changeAnalysisId },
        include: {
          prEvent: {
            include: {
              repository: true,
            },
          },
          intentContext: true,
        },
      });

      if (!changeAnalysis) {
        throw new Error(`Change analysis ${data.changeAnalysisId} not found`);
      }

      await job.updateProgress(20);

      // Create GitHub client
      const client = GitHubClient.forInstallation(data.installationId);

      // Parse repository info
      const [owner, repo] = changeAnalysis.prEvent.repository.githubFullName.split('/');
      if (!owner || repo === undefined) {
        throw new Error('Invalid repository name');
      }

      // Get existing README if any
      let existingReadme: string | null = null;
      try {
        existingReadme = await client.getFileContent(
          owner,
          repo,
          'README.md',
          changeAnalysis.prEvent.repository.defaultBranch
        );
      } catch {
        // README doesn't exist
      }

      await job.updateProgress(30);

      // Build generation context
      const intent = changeAnalysis.intentContext
        ? {
            businessPurpose: changeAnalysis.intentContext.businessPurpose,
            technicalApproach: changeAnalysis.intentContext.technicalApproach,
            keyConcepts: changeAnalysis.intentContext.keyConcepts as string[],
            targetAudience: changeAnalysis.intentContext.targetAudience,
          }
        : null;

      // Generate documentation
      const result = await docGeneratorService.generateDocumentation(client, {
        prTitle: changeAnalysis.prEvent.title,
        prBody: changeAnalysis.prEvent.body,
        prNumber: changeAnalysis.prEvent.prNumber,
        owner,
        repo,
        changes: changeAnalysis.changes as unknown as FileChange[],
        intent,
        existingReadme,
      });

      await job.updateProgress(70);

      // Save generated documents
      for (const doc of result.documents) {
        // Upsert document
        const document = await prisma.document.upsert({
          where: {
            repositoryId_path: {
              repositoryId: data.repositoryId,
              path: doc.path,
            },
          },
          create: {
            repositoryId: data.repositoryId,
            path: doc.path,
            type: doc.type.toUpperCase().replace('-', '_') as DocumentType,
            title: doc.title,
            content: doc.content,
            generatedFromPR: changeAnalysis.prEvent.prNumber,
          },
          update: {
            content: doc.content,
            version: { increment: 1 },
            generatedFromPR: changeAnalysis.prEvent.prNumber,
          },
        });

        // Create version record
        const genJob = await prisma.generationJob.findUnique({
          where: { changeAnalysisId: data.changeAnalysisId },
        });

        await prisma.docVersion.create({
          data: {
            documentId: document.id,
            content: doc.content,
            version: document.version,
            prSha: changeAnalysis.prEvent.payload
              ? (changeAnalysis.prEvent.payload as { pull_request?: { head?: { sha?: string } } }).pull_request?.head?.sha ?? null
              : null,
            generationJobId: genJob?.id,
          },
        });
      }

      await job.updateProgress(85);

      // Update generation job with result
      await prisma.generationJob.update({
        where: { changeAnalysisId: data.changeAnalysisId },
        data: {
          status: 'REVIEWING',
          result: JSON.parse(JSON.stringify({
            documents: result.documents,
            metrics: {
              totalTokensUsed: result.tokensUsed,
              documentsGenerated: result.documents.length,
            },
          })),
        },
      });

      // Queue review step
      const genJob = await prisma.generationJob.findUnique({
        where: { changeAnalysisId: data.changeAnalysisId },
      });

      if (genJob) {
        await addJob(QUEUE_NAMES.DOC_REVIEW, {
          generationJobId: genJob.id,
          repositoryId: data.repositoryId,
        });
      }

      log.info(
        { changeAnalysisId: data.changeAnalysisId, documents: result.documents.length },
        'Documentation generated, queued for review'
      );

      await job.updateProgress(100);
    },
    {
      concurrency: 2,
      limiter: {
        max: 10,
        duration: 60000,
      },
    }
  );

  log.info('Doc generation worker started');

  return worker;
}
