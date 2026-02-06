/**
 * Polling Worker
 *
 * Handles webhook-less change detection through scheduled polling of GitHub repositories.
 * Polls GitHub API for new commits and PRs, queuing change analysis jobs when changes are detected.
 */

import { createWorker, QUEUE_NAMES, addJob, type PollingJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { GitHubClient } from '@docsynth/github';

const log = createLogger('polling-worker');

interface PollingConfig {
  enabled: boolean;
  intervalMinutes: number;
  mode: 'polling' | 'webhook' | 'hybrid';
  lastPolledAt: Date | null;
  lastCommitSha: string | null;
  watchBranches: string[];
}

interface PollResult {
  repositoryId: string;
  newCommits: Array<{ sha: string; message: string; author: string; date: Date }>;
  newPRs: Array<{ number: number; title: string; state: string; merged: boolean }>;
  hasChanges: boolean;
  polledAt: Date;
}

export function startPollingWorker() {
  const worker = createWorker(
    QUEUE_NAMES.POLLING,
    async (job) => {
      const data = job.data as PollingJobData;
      const { repositoryId, installationId, owner, repo, manual = false } = data;

      log.info({ jobId: job.id, repositoryId, manual }, 'Starting repository poll');

      await job.updateProgress(10);

      try {
        // Get polling config
        const repository = await prisma.repository.findUnique({
          where: { id: repositoryId },
          select: { config: true, metadata: true },
        });

        if (!repository) {
          throw new Error('Repository not found');
        }

        const config = repository.config as Record<string, unknown> | null;
        const metadata = repository.metadata as Record<string, unknown> | null;
        const pollingConfig = (config?.polling as Record<string, unknown>) || {};
        const pollingMetadata = (metadata?.polling as Record<string, unknown>) || {};

        const pollingSettings: PollingConfig = {
          enabled: (pollingConfig.enabled as boolean) ?? false,
          intervalMinutes: (pollingConfig.intervalMinutes as number) ?? 30,
          mode: (pollingConfig.mode as 'polling' | 'webhook' | 'hybrid') ?? 'polling',
          lastPolledAt: pollingMetadata.lastPolledAt ? new Date(pollingMetadata.lastPolledAt as string) : null,
          lastCommitSha: (pollingMetadata.lastCommitSha as string) || null,
          watchBranches: (pollingConfig.watchBranches as string[]) ?? ['main', 'master', 'develop'],
        };

        // Skip if polling is disabled (unless manual)
        if (!pollingSettings.enabled && !manual) {
          log.info({ repositoryId }, 'Polling disabled for repository, skipping');
          return { skipped: true, reason: 'Polling disabled' };
        }

        await job.updateProgress(20);

        // Initialize GitHub client
        const client = GitHubClient.forInstallation(installationId);

        const result: PollResult = {
          repositoryId,
          newCommits: [],
          newPRs: [],
          hasChanges: false,
          polledAt: new Date(),
        };

        // Poll each watched branch for new commits
        for (const branch of pollingSettings.watchBranches) {
          try {
            const latestCommitSha = await client.getLatestCommitSha(owner, repo, branch);

            // If this is the first poll or branch changed, get commits
            if (!pollingSettings.lastCommitSha || pollingSettings.lastCommitSha !== latestCommitSha) {
              // Get commits since last poll
              const commits = await getCommitsSince(
                client,
                owner,
                repo,
                branch,
                pollingSettings.lastPolledAt || new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24h if first poll
              );

              result.newCommits.push(...commits);
            }
          } catch (error) {
            log.warn({ error, branch, repositoryId }, 'Failed to poll branch');
          }
        }

        await job.updateProgress(60);

        // Poll for new PRs
        const prs = await getRecentPRs(
          client,
          owner,
          repo,
          pollingSettings.lastPolledAt || new Date(Date.now() - 24 * 60 * 60 * 1000)
        );
        result.newPRs.push(...prs);

        result.hasChanges = result.newCommits.length > 0 || result.newPRs.length > 0;

        await job.updateProgress(80);

        // Queue CHANGE_ANALYSIS jobs for each new commit
        for (const commit of result.newCommits) {
          try {
            // Check if we have a PR for this commit
            const prForCommit = result.newPRs.find((pr) => pr.state === 'open');

            if (prForCommit) {
              // Check if PR event already exists
              const existingPREvent = await prisma.pREvent.findFirst({
                where: {
                  repositoryId,
                  prNumber: prForCommit.number,
                },
              });

              if (!existingPREvent) {
                // Create PR event
                const prEvent = await prisma.pREvent.create({
                  data: {
                    repositoryId,
                    prNumber: prForCommit.number,
                    action: 'OPENED',
                    title: prForCommit.title,
                    body: null,
                    baseBranch: 'main',
                    headBranch: 'feature',
                    authorUsername: commit.author,
                    payload: {
                      source: 'polling',
                      commit: commit.sha,
                    },
                  },
                });

                // Queue change analysis
                await addJob(QUEUE_NAMES.CHANGE_ANALYSIS, {
                  prEventId: prEvent.id,
                  repositoryId,
                  installationId,
                  owner,
                  repo,
                  prNumber: prForCommit.number,
                });

                log.info(
                  { repositoryId, prNumber: prForCommit.number, commitSha: commit.sha },
                  'Queued change analysis for PR'
                );
              }
            }
          } catch (error) {
            log.error({ error, commit: commit.sha }, 'Failed to queue change analysis');
          }
        }

        // Update polling metadata
        const updatedMetadata = {
          ...(metadata || {}),
          polling: {
            ...(pollingMetadata || {}),
            lastPolledAt: result.polledAt.toISOString(),
            lastCommitSha: result.newCommits[0]?.sha || pollingSettings.lastCommitSha,
          },
        };

        // Record poll result in history
        const pollingHistory = (metadata?.pollingHistory as Array<{
          id: string;
          repositoryId: string;
          polledAt: Date;
          commitSha: string | null;
          newCommitsCount: number;
          newPRsCount: number;
          hasChanges: boolean;
          error: string | null;
          details: PollResult | null;
        }>) || [];

        const newHistoryEntry = {
          id: `poll_${Date.now()}`,
          repositoryId,
          polledAt: result.polledAt,
          commitSha: result.newCommits[0]?.sha || null,
          newCommitsCount: result.newCommits.length,
          newPRsCount: result.newPRs.length,
          hasChanges: result.hasChanges,
          error: null,
          details: result,
        };

        updatedMetadata.pollingHistory = [newHistoryEntry, ...pollingHistory].slice(0, 50);

        await prisma.repository.update({
          where: { id: repositoryId },
          data: { metadata: updatedMetadata },
        });

        await job.updateProgress(100);

        log.info(
          {
            repositoryId,
            newCommits: result.newCommits.length,
            newPRs: result.newPRs.length,
            hasChanges: result.hasChanges,
          },
          'Repository poll completed'
        );

        return result;
      } catch (error) {
        log.error({ error, repositoryId }, 'Polling job failed');

        // Record error in history
        try {
          const repository = await prisma.repository.findUnique({
            where: { id: repositoryId },
            select: { metadata: true },
          });

          if (repository) {
            const metadata = repository.metadata as Record<string, unknown> | null;
            const pollingHistory = (metadata?.pollingHistory as Array<{
              id: string;
              repositoryId: string;
              polledAt: Date;
              commitSha: string | null;
              newCommitsCount: number;
              newPRsCount: number;
              hasChanges: boolean;
              error: string | null;
              details: PollResult | null;
            }>) || [];

            const errorEntry = {
              id: `poll_${Date.now()}`,
              repositoryId,
              polledAt: new Date(),
              commitSha: null,
              newCommitsCount: 0,
              newPRsCount: 0,
              hasChanges: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              details: null,
            };

            await prisma.repository.update({
              where: { id: repositoryId },
              data: {
                metadata: {
                  ...(metadata || {}),
                  pollingHistory: [errorEntry, ...pollingHistory].slice(0, 50),
                },
              },
            });
          }
        } catch (recordError) {
          log.error({ recordError }, 'Failed to record polling error');
        }

        throw error;
      }
    },
    { concurrency: 5 }
  );

  log.info('Polling worker started');
  return worker;
}

/**
 * Schedule periodic polling for all repositories with polling enabled
 */
export async function schedulePeriodicPolling(): Promise<void> {
  log.info('Scheduling periodic polling runs');

  try {
    // Find all repositories with polling enabled
    const repositories = await prisma.repository.findMany({
      where: {
        enabled: true,
      },
      select: {
        id: true,
        installationId: true,
        fullName: true,
        config: true,
        metadata: true,
      },
    });

    let scheduled = 0;

    for (const repo of repositories) {
      const config = repo.config as Record<string, unknown> | null;
      const metadata = repo.metadata as Record<string, unknown> | null;
      const pollingConfig = (config?.polling as Record<string, unknown>) || {};
      const pollingMetadata = (metadata?.polling as Record<string, unknown>) || {};

      const enabled = (pollingConfig.enabled as boolean) ?? false;
      const intervalMinutes = (pollingConfig.intervalMinutes as number) ?? 30;
      const lastPolledAt = pollingMetadata.lastPolledAt ? new Date(pollingMetadata.lastPolledAt as string) : null;

      if (!enabled) {
        continue;
      }

      // Check if it's time to poll
      const now = new Date();
      if (lastPolledAt) {
        const nextPollTime = new Date(lastPolledAt.getTime() + intervalMinutes * 60 * 1000);
        if (now < nextPollTime) {
          // Not time yet
          continue;
        }
      }

      // Queue polling job
      const [owner, repoName] = repo.fullName.split('/');
      if (!owner || !repoName) {
        log.warn({ repositoryId: repo.id, fullName: repo.fullName }, 'Invalid repository fullName');
        continue;
      }

      try {
        await addJob(QUEUE_NAMES.POLLING, {
          repositoryId: repo.id,
          installationId: repo.installationId,
          owner,
          repo: repoName,
          manual: false,
        });

        scheduled++;
      } catch (error) {
        log.error({ error, repositoryId: repo.id }, 'Failed to schedule polling job');
      }
    }

    log.info({ scheduled, total: repositories.length }, 'Periodic polling scheduled');
  } catch (error) {
    log.error({ error }, 'Failed to schedule periodic polling');
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get commits since a specific date
 */
async function getCommitsSince(
  client: GitHubClient,
  owner: string,
  repo: string,
  branch: string,
  since: Date
): Promise<Array<{ sha: string; message: string; author: string; date: Date }>> {
  try {
    const octokit = (client as unknown as { octokit: { repos: { listCommits: (params: unknown) => Promise<{ data: unknown[] }> } } }).octokit;
    const { data: commits } = await octokit.repos.listCommits({
      owner,
      repo,
      sha: branch,
      since: since.toISOString(),
      per_page: 100,
    });

    return commits.map((commit: {
      sha: string;
      commit: { message: string; author: { name: string; date: string } };
    }) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: new Date(commit.commit.author.date),
    }));
  } catch (error) {
    log.warn({ error, branch }, 'Failed to get commits since date');
    return [];
  }
}

/**
 * Get recent PRs (opened, updated, or merged since date)
 */
async function getRecentPRs(
  client: GitHubClient,
  owner: string,
  repo: string,
  since: Date
): Promise<Array<{ number: number; title: string; state: string; merged: boolean }>> {
  try {
    const octokit = (client as unknown as { octokit: { pulls: { list: (params: unknown) => Promise<{ data: unknown[] }> } } }).octokit;
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      state: 'all',
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
    });

    const recentPRs = (prs as Array<{
      number: number;
      title: string;
      state: string;
      merged: boolean;
      updated_at: string;
    }>).filter((pr) => new Date(pr.updated_at) > since);

    return recentPRs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      merged: pr.merged,
    }));
  } catch (error) {
    log.warn({ error }, 'Failed to get recent PRs');
    return [];
  }
}
