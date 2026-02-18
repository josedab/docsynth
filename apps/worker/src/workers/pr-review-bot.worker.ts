/**
 * PR Review Bot Worker
 *
 * Processes PR analysis jobs and posts inline doc suggestions.
 */

import { createWorker, QUEUE_NAMES, type PRReviewBotJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { createInstallationOctokit } from '@docsynth/github';
import {
  analyzePRAndSuggest,
  formatAsGitHubReviewComments,
} from '../../../api/src/services/pr-review-bot.service.js';

const log = createLogger('pr-review-bot-worker');

export function startPRReviewBotWorker() {
  const worker = createWorker(
    QUEUE_NAMES.PR_REVIEW_BOT,
    async (job) => {
      const data = job.data as PRReviewBotJobData;
      const { repositoryId, prNumber, installationId, owner, repo, action } = data;

      log.info({ jobId: job.id, repositoryId, prNumber, action }, 'Starting PR review bot job');
      await job.updateProgress(5);

      try {
        if (action !== 'analyze-and-suggest') {
          log.info({ action }, 'Skipping non-analysis action');
          await job.updateProgress(100);
          return;
        }

        const octokit = createInstallationOctokit(installationId);
        if (!octokit) throw new Error('Failed to create GitHub client');

        // Fetch PR files
        const { data: files } = await octokit.pulls.listFiles({
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100,
        });
        await job.updateProgress(20);

        const changedFiles = files.map((f) => ({
          filename: f.filename,
          patch: f.patch,
          status: f.status || 'modified',
          additions: f.additions,
          deletions: f.deletions,
        }));

        // Analyze and generate suggestions
        const result = await analyzePRAndSuggest(repositoryId, prNumber, changedFiles);
        await job.updateProgress(60);

        // Post review if there are suggestions
        if (result.suggestions.length > 0) {
          const reviewComments = formatAsGitHubReviewComments(result.suggestions);

          try {
            await octokit.pulls.createReview({
              owner,
              repo,
              pull_number: prNumber,
              body: `## 📝 DocSynth Review Bot\n\n${result.summary}\n\n<sub>Confidence: ${Math.round(result.overallConfidence * 100)}% | ${result.stats.suggestionsGenerated} suggestion(s)</sub>`,
              event: 'COMMENT',
              comments: reviewComments.map((c) => ({
                path: c.path,
                position: c.position,
                body: c.body,
              })),
            });

            log.info(
              { prNumber, suggestions: result.suggestions.length },
              'Posted review with suggestions'
            );
          } catch (reviewError) {
            // Fall back to single comment if review creation fails
            log.warn(
              { error: reviewError, prNumber },
              'Failed to create review, posting summary comment'
            );
            await octokit.issues.createComment({
              owner,
              repo,
              issue_number: prNumber,
              body: `## 📝 DocSynth Review Bot\n\n${result.summary}\n\nFound ${result.suggestions.length} documentation suggestion(s). Review the changes for details.`,
            });
          }
        }

        await job.updateProgress(100);
        log.info(
          { repositoryId, prNumber, suggestions: result.suggestions.length },
          'PR review bot job completed'
        );
      } catch (error) {
        log.error({ error, repositoryId, prNumber }, 'PR review bot job failed');
        throw error;
      }
    },
    { concurrency: 5 }
  );

  log.info('PR review bot worker started');
  return worker;
}
