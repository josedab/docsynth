import { Worker, Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import { QUEUE_NAMES, getRedisConnection, type DocReviewCopilotJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { docReviewService } from '../services/doc-review.js';

const log = createLogger('doc-review-copilot-worker');

async function processDocReview(job: Job<DocReviewCopilotJobData>): Promise<void> {
  const { repositoryId, documentId, pullRequestId, content, styleGuideId, checkAccuracy } = job.data;

  log.info({ repositoryId, documentId, pullRequestId }, 'Starting doc review');

  const startTime = Date.now();

  // Create review record
  const review = await prisma.docReview.create({
    data: {
      repositoryId,
      documentId,
      pullRequestId,
      reviewType: pullRequestId ? 'pr_review' : documentId ? 'manual' : 'scheduled',
      status: 'in_progress',
    },
  });

  try {
    await job.updateProgress(10);

    // Get document content
    let docContent = content;
    let docType = 'README';

    if (documentId && !content) {
      const document = await prisma.document.findUnique({
        where: { id: documentId },
      });
      if (document) {
        docContent = document.content;
        docType = document.type;
      }
    }

    if (!docContent) {
      throw new Error('No content to review');
    }

    await job.updateProgress(20);

    // Get style guide if specified
    let styleGuide;
    if (styleGuideId) {
      const guide = await prisma.styleGuide.findUnique({
        where: { id: styleGuideId },
      });
      if (guide) {
        styleGuide = {
          rules: guide.rules as Array<{ pattern: string; replacement?: string; message: string; severity: 'error' | 'warning' | 'suggestion' | 'info' }>,
          terminology: (guide.examples as Array<{ bad: string; good: string }>)?.reduce(
            (acc, ex) => ({ ...acc, [ex.bad]: ex.good }),
            {}
          ) || {},
        };
      }
    }

    await job.updateProgress(30);

    // Get code context for accuracy checking
    const codeContext: Array<{ path: string; content: string }> = [];
    if (checkAccuracy !== false) {
      // Get repository files for context
      const repo = await prisma.repository.findUnique({
        where: { id: repositoryId },
        include: { documents: { take: 10, select: { path: true, content: true } } },
      });

      if (repo?.documents) {
        codeContext.push(
          ...repo.documents
            .filter((d): d is typeof d & { content: string } => d.content !== null)
            .map((d) => ({ path: d.path, content: d.content }))
        );
      }
    }

    await job.updateProgress(50);

    // Perform review
    const result = await docReviewService.reviewDocument({
      content: docContent,
      documentType: docType,
      codeContext,
      styleGuide,
    });

    await job.updateProgress(80);

    // Save suggestions as comments
    for (const suggestion of result.suggestions) {
      await prisma.docReviewComment.create({
        data: {
          reviewId: review.id,
          category: suggestion.category,
          severity: suggestion.severity,
          lineStart: suggestion.lineStart,
          lineEnd: suggestion.lineEnd,
          originalText: suggestion.originalText,
          suggestion: suggestion.suggestion,
          explanation: suggestion.explanation,
          codeRef: suggestion.codeRef,
        },
      });
    }

    // Update review record
    const processingMs = Date.now() - startTime;
    await prisma.docReview.update({
      where: { id: review.id },
      data: {
        status: 'completed',
        overallScore: result.overallScore,
        accuracyScore: result.accuracyScore,
        clarityScore: result.clarityScore,
        styleScore: result.styleScore,
        issuesFound: result.suggestions.length,
        suggestions: result.suggestions as unknown as object,
        codeReferences: result.codeReferences as unknown as object,
        processingMs,
      },
    });

    await job.updateProgress(100);

    log.info(
      {
        reviewId: review.id,
        score: result.overallScore,
        issues: result.suggestions.length,
        processingMs,
      },
      'Doc review completed'
    );
  } catch (error) {
    await prisma.docReview.update({
      where: { id: review.id },
      data: { status: 'failed' },
    });
    throw error;
  }
}

export function startDocReviewCopilotWorker(): Worker<DocReviewCopilotJobData> {
  const worker = new Worker<DocReviewCopilotJobData>(
    QUEUE_NAMES.DOC_REVIEW_COPILOT,
    processDocReview,
    {
      connection: getRedisConnection(),
      concurrency: 3,
    }
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Doc review job completed');
  });

  worker.on('failed', (job, error) => {
    log.error({ jobId: job?.id, error: error.message }, 'Doc review job failed');
  });

  log.info('Doc review copilot worker started');
  return worker;
}
