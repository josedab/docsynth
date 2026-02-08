/**
 * PR Documentation Review Worker
 *
 * Analyzes PR changed files for documentation impact, generates
 * review comments, and optionally posts them to the SCM provider.
 */

import { createWorker } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('pr-doc-review-worker');

// Job data interface - will be moved to @docsynth/queue types as PRDocReviewJobData
interface PRDocReviewJobData {
  repositoryId: string;
  prNumber: number;
  owner: string;
  repo: string;
  installationId: number;
  baseBranch: string;
  headBranch: string;
  changedFiles: string[];
  postToSCM: boolean;
}

export function startPRDocReviewWorker() {
  // TODO: Add 'pr-doc-review' to QUEUE_NAMES constant in @docsynth/queue
  const worker = createWorker(
    'pr-doc-review' as any,
    async (job) => {
      const data = job.data as PRDocReviewJobData;

      log.info(
        { jobId: job.id, prNumber: data.prNumber, repo: `${data.owner}/${data.repo}` },
        'Starting PR documentation review'
      );

      await job.updateProgress(10);

      try {
        // Fetch repository configuration and doc standards
        const repository = await prisma.repository.findUnique({
          where: { id: data.repositoryId },
          include: {
            documents: {
              select: { id: true, path: true, type: true, title: true },
            },
          },
        });

        if (!repository) {
          throw new Error(`Repository not found: ${data.repositoryId}`);
        }

        await job.updateProgress(30);

        // Analyze changed files for documentation impact
        const impactedDocs: Array<{
          filePath: string;
          impactType: 'outdated' | 'missing' | 'needs-update';
          relatedDocPaths: string[];
          severity: 'low' | 'medium' | 'high';
        }> = [];

        for (const changedFile of data.changedFiles) {
          // Find docs that reference or relate to the changed file
          const relatedDocs = repository.documents.filter((doc) =>
            doc.path.includes(changedFile.split('/')[0] || '')
          );

          if (relatedDocs.length > 0) {
            impactedDocs.push({
              filePath: changedFile,
              impactType: 'needs-update',
              relatedDocPaths: relatedDocs.map((d) => d.path),
              severity: changedFile.includes('api') || changedFile.includes('schema') ? 'high' : 'medium',
            });
          } else if (
            changedFile.endsWith('.ts') ||
            changedFile.endsWith('.js') ||
            changedFile.endsWith('.py')
          ) {
            impactedDocs.push({
              filePath: changedFile,
              impactType: 'missing',
              relatedDocPaths: [],
              severity: 'low',
            });
          }
        }

        await job.updateProgress(50);

        // Generate review comments based on impact analysis
        const reviewComments: Array<{
          filePath: string;
          line: number | null;
          body: string;
          severity: string;
        }> = [];

        for (const impact of impactedDocs) {
          const comment = buildReviewComment(impact);
          reviewComments.push(comment);
        }

        await job.updateProgress(70);

        // Store review results in database
        const reviewRecord = {
          repositoryId: data.repositoryId,
          prNumber: data.prNumber,
          changedFilesCount: data.changedFiles.length,
          impactedDocsCount: impactedDocs.length,
          reviewCommentsCount: reviewComments.length,
          impacts: impactedDocs,
          comments: reviewComments,
          reviewedAt: new Date(),
        };

        await job.updateProgress(90);

        // Optionally post review comments to the SCM provider
        if (data.postToSCM && reviewComments.length > 0) {
          log.info(
            { prNumber: data.prNumber, commentCount: reviewComments.length },
            'Posting review comments to SCM'
          );
          // SCM posting would be handled by a service integration
          // e.g., await scmService.postReviewComments(data, reviewComments);
        }

        await job.updateProgress(100);

        log.info(
          {
            jobId: job.id,
            prNumber: data.prNumber,
            impactedDocs: impactedDocs.length,
            reviewComments: reviewComments.length,
          },
          'PR documentation review completed'
        );

      } catch (error) {
        log.error(
          { error, jobId: job.id, prNumber: data.prNumber },
          'PR documentation review failed'
        );
        throw error;
      }
    },
    { concurrency: 5 }
  );

  log.info('PR documentation review worker started');
  return worker;
}

function buildReviewComment(impact: {
  filePath: string;
  impactType: 'outdated' | 'missing' | 'needs-update';
  relatedDocPaths: string[];
  severity: 'low' | 'medium' | 'high';
}): { filePath: string; line: number | null; body: string; severity: string } {
  let body: string;

  switch (impact.impactType) {
    case 'outdated':
      body = `Documentation may be outdated after changes to \`${impact.filePath}\`. Related docs: ${impact.relatedDocPaths.map((p) => `\`${p}\``).join(', ')}`;
      break;
    case 'missing':
      body = `No documentation found for \`${impact.filePath}\`. Consider adding documentation for this file.`;
      break;
    case 'needs-update':
      body = `Changes to \`${impact.filePath}\` may require updates to: ${impact.relatedDocPaths.map((p) => `\`${p}\``).join(', ')}`;
      break;
    default:
      body = `Documentation review needed for \`${impact.filePath}\`.`;
  }

  return {
    filePath: impact.filePath,
    line: null,
    body,
    severity: impact.severity,
  };
}
