/**
 * Doc Impact Analysis Worker
 *
 * Analyzes documentation impact for pull requests and posts
 * automated comments showing which documentation will become stale.
 */

import { createWorker, QUEUE_NAMES, type DocImpactJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { createInstallationOctokit } from '@docsynth/github';
import {
  analyzeDocImpact,
  generateImpactComment,
  getImpactConfig,
  type ChangedFile,
} from '../../../api/src/services/doc-impact.service.js';

const log = createLogger('doc-impact-worker');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export function startDocImpactWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_IMPACT,
    async (job) => {
      const data = job.data as DocImpactJobData;
      const { repositoryId, prNumber, installationId, owner, repo } = data;

      log.info({ jobId: job.id, repositoryId, prNumber }, 'Starting doc impact analysis');

      await job.updateProgress(5);

      try {
        // Get configuration
        const config = await getImpactConfig(repositoryId);

        if (!config.enabled) {
          log.info({ repositoryId }, 'Doc impact analysis is disabled for this repository');
          return { skipped: true, reason: 'disabled' };
        }

        await job.updateProgress(10);

        // Get GitHub client
        const octokit = createInstallationOctokit(installationId);
        if (!octokit) {
          throw new Error('Failed to create GitHub client');
        }

        // Fetch PR details
        const { data: pr } = await octokit.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
        });

        await job.updateProgress(20);

        // Fetch changed files from PR
        const { data: files } = await octokit.pulls.listFiles({
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100,
        });

        log.info({ prNumber, fileCount: files.length }, 'Fetched changed files from PR');

        await job.updateProgress(30);

        // Convert GitHub files to our ChangedFile format
        const changedFiles: ChangedFile[] = files.map((file) => ({
          filename: file.filename,
          status: (file.status as 'added' | 'modified' | 'removed' | 'renamed') || 'modified',
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch,
        }));

        // Apply path filters
        const filteredFiles = changedFiles.filter((file) => {
          // Include paths filter
          if (config.includePaths.length > 0) {
            const included = config.includePaths.some((pattern) =>
              file.filename.includes(pattern)
            );
            if (!included) return false;
          }

          // Exclude paths filter
          if (config.excludePaths.length > 0) {
            const excluded = config.excludePaths.some((pattern) =>
              file.filename.includes(pattern)
            );
            if (excluded) return false;
          }

          return true;
        });

        log.info(
          { originalCount: changedFiles.length, filteredCount: filteredFiles.length },
          'Applied path filters'
        );

        await job.updateProgress(40);

        // Perform impact analysis
        const analysis = await analyzeDocImpact(repositoryId, prNumber, filteredFiles);

        await job.updateProgress(70);

        // Filter by confidence threshold
        const filteredImpactedDocs = analysis.impactedDocs.filter(
          (doc) => doc.confidenceScore >= config.confidenceThreshold
        );

        // Filter by risk threshold
        const riskLevels = { low: 1, medium: 2, high: 3 };
        const minRiskLevel = riskLevels[config.riskThreshold];
        const significantDocs = filteredImpactedDocs.filter(
          (doc) => riskLevels[doc.stalenessRisk] >= minRiskLevel
        );

        log.info(
          {
            totalImpacted: filteredImpactedDocs.length,
            significantDocs: significantDocs.length,
            overallRisk: analysis.overallRisk,
          },
          'Impact analysis completed'
        );

        // Update analysis with filtered results
        analysis.impactedDocs = significantDocs;

        // Store analysis result
        const analysisRecord = await db.docImpactAnalysis.create({
          data: {
            repositoryId,
            prNumber,
            impactedDocs: analysis.impactedDocs,
            overallRisk: analysis.overallRisk,
            summary: analysis.summary,
            approved: false,
            metadata: {
              totalFilesChanged: changedFiles.length,
              filteredFilesCount: filteredFiles.length,
              confidenceThreshold: config.confidenceThreshold,
              riskThreshold: config.riskThreshold,
            },
          },
        });

        await job.updateProgress(80);

        // Post comment to PR if auto-comment is enabled
        if (config.autoComment && significantDocs.length > 0) {
          try {
            const comment = await generateImpactComment(analysis);

            // Check if we've already commented on this PR
            const { data: existingComments } = await octokit.issues.listComments({
              owner,
              repo,
              issue_number: prNumber,
              per_page: 100,
            });

            const docSynthComment = existingComments.find(
              (c) => c.user?.login === 'github-actions[bot]' || c.body?.includes('Documentation Impact Analysis')
            );

            if (docSynthComment) {
              // Update existing comment
              await octokit.issues.updateComment({
                owner,
                repo,
                comment_id: docSynthComment.id,
                body: comment,
              });

              log.info({ prNumber, commentId: docSynthComment.id }, 'Updated existing PR comment');
            } else {
              // Create new comment
              const { data: newComment } = await octokit.issues.createComment({
                owner,
                repo,
                issue_number: prNumber,
                body: comment,
              });

              log.info({ prNumber, commentId: newComment.id }, 'Created new PR comment');
            }

            // Update analysis record with comment info
            await db.docImpactAnalysis.update({
              where: { id: analysisRecord.id },
              data: {
                commentPosted: true,
                commentPostedAt: new Date(),
              },
            });
          } catch (error) {
            log.error({ error, prNumber }, 'Failed to post PR comment');
            // Don't fail the job if commenting fails
          }
        }

        await job.updateProgress(100);

        log.info(
          {
            repositoryId,
            prNumber,
            analysisId: analysisRecord.id,
            impactedDocs: significantDocs.length,
          },
          'Doc impact analysis completed'
        );

        return {
          analysisId: analysisRecord.id,
          impactedDocs: significantDocs.length,
          overallRisk: analysis.overallRisk,
          commentPosted: config.autoComment && significantDocs.length > 0,
        };
      } catch (error) {
        log.error({ error, repositoryId, prNumber }, 'Doc impact analysis failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Doc impact worker started');
  return worker;
}

/**
 * Schedule impact analysis for PRs that haven't been analyzed yet
 */
export async function scheduleUnanalyzedPRs(): Promise<void> {
  log.info('Scheduling impact analysis for unanalyzed PRs');

  // Get recent PRs that haven't been analyzed
  const recentPRs = await prisma.pREvent.findMany({
    where: {
      action: 'opened',
      createdAt: {
        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
      },
    },
    include: {
      repository: true,
    },
    take: 50,
  });

  for (const pr of recentPRs) {
    try {
      // Check if already analyzed
      const existing = await db.docImpactAnalysis.findFirst({
        where: {
          repositoryId: pr.repositoryId,
          prNumber: pr.prNumber,
        },
      });

      if (existing) continue;

      // Check if doc impact is enabled
      const config = await getImpactConfig(pr.repositoryId);
      if (!config.enabled) continue;

      // Parse owner/repo
      const [owner, repo] = pr.repository.fullName.split('/');
      if (!owner || !repo) continue;

      // Queue analysis
      await prisma.$queryRaw`
        INSERT INTO bull_jobs (queue, data, created_at)
        VALUES (
          ${QUEUE_NAMES.DOC_IMPACT},
          ${JSON.stringify({
            repositoryId: pr.repositoryId,
            prNumber: pr.prNumber,
            installationId: pr.repository.installationId,
            owner,
            repo,
          })},
          NOW()
        )
      `;

      log.info({ prNumber: pr.prNumber, repositoryId: pr.repositoryId }, 'Queued impact analysis for unanalyzed PR');
    } catch (error) {
      log.error({ error, prId: pr.id }, 'Failed to queue impact analysis');
    }
  }

  log.info({ count: recentPRs.length }, 'Completed scheduling unanalyzed PRs');
}
