/**
 * Impact Scoring Worker
 *
 * Processes impact scoring jobs for PRs, including auto-triggered
 * documentation generation based on impact score thresholds.
 */

import { createWorker, QUEUE_NAMES, type ImpactScoringJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { createInstallationOctokit } from '@docsynth/github';
import {
  scoreChanges,
  getRecommendations,
  type ChangedFile,
} from '../../../api/src/services/impact-scoring.service.js';

const log = createLogger('impact-scoring-worker');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export function startImpactScoringWorker() {
  const worker = createWorker(
    QUEUE_NAMES.IMPACT_SCORING,
    async (job) => {
      const data = job.data as ImpactScoringJobData;
      const { repositoryId, prNumber, action } = data;

      log.info({ jobId: job.id, repositoryId, prNumber, action }, 'Starting impact scoring job');

      await job.updateProgress(5);

      try {
        // Get repository
        const repository = await prisma.repository.findUnique({
          where: { id: repositoryId },
        });

        if (!repository) {
          throw new Error(`Repository not found: ${repositoryId}`);
        }

        const [owner, repo] = repository.fullName.split('/');
        if (!owner || !repo) {
          throw new Error(`Invalid repository fullName: ${repository.fullName}`);
        }

        await job.updateProgress(10);

        // Get GitHub client
        const installationId = (repository as any).installationId;
        const octokit = createInstallationOctokit(installationId);
        if (!octokit) {
          throw new Error('Failed to create GitHub client');
        }

        // Fetch changed files from PR
        const { data: files } = await octokit.pulls.listFiles({
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100,
        });

        log.info({ prNumber, fileCount: files.length }, 'Fetched changed files from PR');

        await job.updateProgress(30);

        // Convert to ChangedFile format
        const changedFiles: ChangedFile[] = files.map((file) => ({
          filename: file.filename,
          status: (file.status as 'added' | 'modified' | 'removed' | 'renamed') || 'modified',
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch,
        }));

        // Score the changes
        const scoringResult = await scoreChanges(changedFiles);

        await job.updateProgress(60);

        // Get recommendations
        const recommendations = getRecommendations(scoringResult.score, changedFiles);

        await job.updateProgress(70);

        // Store the scoring result
        await db.docImpactAnalysis.create({
          data: {
            repositoryId,
            prNumber,
            impactedDocs: scoringResult.classifications,
            overallRisk:
              scoringResult.score >= 70 ? 'high' : scoringResult.score >= 40 ? 'medium' : 'low',
            summary: scoringResult.summary,
            approved: false,
            metadata: {
              score: scoringResult.score,
              breakdown: scoringResult.breakdown,
              action: action || 'worker-analysis',
              recommendationCount: recommendations.recommendations.length,
            },
          },
        });

        await job.updateProgress(85);

        // Post a comment on the PR if score is significant
        if (scoringResult.score >= 30) {
          try {
            const commentBody = formatScoringComment(scoringResult, recommendations);

            const { data: existingComments } = await octokit.issues.listComments({
              owner,
              repo,
              issue_number: prNumber,
              per_page: 100,
            });

            const existingScoreComment = existingComments.find((c) =>
              c.body?.includes('Documentation Impact Score')
            );

            if (existingScoreComment) {
              await octokit.issues.updateComment({
                owner,
                repo,
                comment_id: existingScoreComment.id,
                body: commentBody,
              });
              log.info(
                { prNumber, commentId: existingScoreComment.id },
                'Updated existing score comment'
              );
            } else {
              const { data: newComment } = await octokit.issues.createComment({
                owner,
                repo,
                issue_number: prNumber,
                body: commentBody,
              });
              log.info({ prNumber, commentId: newComment.id }, 'Created new score comment');
            }
          } catch (error) {
            log.error({ error, prNumber }, 'Failed to post scoring comment');
          }
        }

        await job.updateProgress(100);

        log.info(
          { repositoryId, prNumber, score: scoringResult.score, action },
          'Impact scoring job completed'
        );
      } catch (error) {
        log.error({ error, repositoryId, prNumber }, 'Impact scoring job failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Impact scoring worker started');
  return worker;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatScoringComment(
  scoring: { score: number; summary: string; breakdown: Record<string, number> },
  recommendations: {
    recommendations: Array<{ priority: string; action: string; reason: string }>;
    overallPriority: string;
  }
): string {
  const scoreEmoji = scoring.score >= 70 ? '🔴' : scoring.score >= 40 ? '🟡' : '🟢';

  let comment = `## 📊 Documentation Impact Score\n\n`;
  comment += `${scoreEmoji} **Score: ${scoring.score}/100**\n\n`;
  comment += `${scoring.summary}\n\n`;

  if (recommendations.recommendations.length > 0) {
    comment += `### Recommendations\n\n`;
    for (const rec of recommendations.recommendations.slice(0, 5)) {
      const priorityEmoji =
        rec.priority === 'critical'
          ? '🔴'
          : rec.priority === 'high'
            ? '🟠'
            : rec.priority === 'medium'
              ? '🟡'
              : '🟢';
      comment += `${priorityEmoji} **${rec.priority.toUpperCase()}**: ${rec.action}\n`;
      comment += `  _${rec.reason}_\n\n`;
    }
  }

  comment += `---\n`;
  comment += `<sub>Generated by DocSynth Impact Scoring | [View Details](#)</sub>\n`;

  return comment;
}
