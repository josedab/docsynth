import { Worker, Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import { QUEUE_NAMES, getRedisConnection, type ADRGenerationJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { ADRGeneratorService } from '../services/adr-generator.js';

const log = createLogger('adr-generation-worker');

const adrGenerator = new ADRGeneratorService();

async function processADRGeneration(job: Job<ADRGenerationJobData>): Promise<void> {
  const { repositoryId, pullRequestId, title, context } = job.data;

  log.info({ repositoryId, pullRequestId }, 'Starting ADR generation');

  try {
    await job.updateProgress(10);

    // Get repository
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repository) {
      throw new Error(`Repository not found: ${repositoryId}`);
    }

    // Get next ADR number by counting existing ADR documents
    const existingADRDocs = await prisma.document.count({
      where: { repositoryId, type: 'ADR' },
    });

    const adrNumber = existingADRDocs + 1;

    await job.updateProgress(30);

    let adrContext: Parameters<typeof adrGenerator.generateADR>[0] | null = null;

    // If we have a PR, get its context
    if (pullRequestId) {
      const prEvent = await prisma.pREvent.findFirst({
        where: { repositoryId, prNumber: parseInt(pullRequestId, 10) },
      });

      if (prEvent) {
        // Get owner from fullName (format: owner/repo)
        const [owner] = repository.fullName.split('/');
        adrContext = {
          prTitle: prEvent.title,
          prBody: prEvent.body,
          prNumber: prEvent.prNumber,
          owner: owner || repository.fullName,
          repo: repository.name,
          changes: [], // Would fetch from GitHub
          intent: null, // Would come from intent inference
          existingADRs: [],
        };
      }
    }

    await job.updateProgress(50);

    // Get existing ADRs for context
    const existingADRs = await prisma.document.findMany({
      where: { repositoryId, type: 'ADR' },
      select: { title: true },
    });

    if (adrContext) {
      adrContext.existingADRs = existingADRs.map((a: { title: string }) => a.title);
    }

    await job.updateProgress(70);

    // Generate ADR
    let adrResult;
    if (adrContext) {
      adrResult = await adrGenerator.generateADR(adrContext);
    } else if (title && context) {
      // Manual ADR creation
      adrResult = {
        document: {
          type: 'ADR' as const,
          title: title,
          content: `# ${title}\n\n## Status\n\nProposed\n\n## Context\n\n${context}\n\n## Decision\n\nTo be determined.\n\n## Consequences\n\nTo be assessed.`,
          path: `docs/adr/ADR-${adrNumber.toString().padStart(4, '0')}.md`,
        },
        tokensUsed: 0,
        adrNumber,
      };
    } else {
      throw new Error('Either pullRequestId or title+context must be provided');
    }

    await job.updateProgress(90);

    // Create as a document (ADRs are stored as documents)
    await prisma.document.create({
      data: {
        repositoryId,
        type: 'ADR',
        path: adrResult.document.path,
        title: adrResult.document.title,
        content: adrResult.document.content,
        version: 1,
        metadata: {
          adrNumber: adrResult.adrNumber,
          status: 'proposed',
          relatedPRs: pullRequestId ? [pullRequestId] : [],
        },
      },
    });

    await job.updateProgress(100);

    log.info(
      { repositoryId, adrNumber: adrResult.adrNumber, title: adrResult.document.title },
      'ADR generated'
    );
  } catch (error) {
    log.error({ error, repositoryId, pullRequestId }, 'ADR generation failed');
    throw error;
  }
}

export function startADRGenerationWorker(): Worker<ADRGenerationJobData> {
  const worker = new Worker<ADRGenerationJobData>(
    QUEUE_NAMES.ADR_GENERATION,
    processADRGeneration,
    {
      connection: getRedisConnection(),
      concurrency: 2,
    }
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'ADR generation job completed');
  });

  worker.on('failed', (job, error) => {
    log.error({ jobId: job?.id, error: error.message }, 'ADR generation job failed');
  });

  log.info('ADR generation worker started');
  return worker;
}
