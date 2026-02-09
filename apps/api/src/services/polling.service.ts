import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { GitHubClient } from '@docsynth/github';

const log = createLogger('polling-service');

// ============================================================================
// Types
// ============================================================================

export interface PollingConfig {
  enabled: boolean;
  intervalMinutes: number; // 5-60
  mode: 'polling' | 'webhook' | 'hybrid';
  lastPolledAt: Date | null;
  lastCommitSha: string | null;
  watchBranches: string[];
}

export interface PollResult {
  repositoryId: string;
  newCommits: Array<{ sha: string; message: string; author: string; date: Date }>;
  newPRs: Array<{ number: number; title: string; state: string; merged: boolean }>;
  hasChanges: boolean;
  polledAt: Date;
}

export interface PollingStatus {
  repositoryId: string;
  enabled: boolean;
  lastPolledAt: Date | null;
  lastCommitSha: string | null;
  nextPollAt: Date | null;
  intervalMinutes: number;
  watchBranches: string[];
  mode: 'polling' | 'webhook' | 'hybrid';
}

export interface PollingHistory {
  id: string;
  repositoryId: string;
  polledAt: Date;
  commitSha: string | null;
  newCommitsCount: number;
  newPRsCount: number;
  hasChanges: boolean;
  error: string | null;
  details: PollResult | null;
}

// ============================================================================
// Configuration Management
// ============================================================================

/**
 * Get polling configuration for a repository
 */
export async function getPollingConfig(repositoryId: string): Promise<PollingConfig> {
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

  return {
    enabled: (pollingConfig.enabled as boolean) ?? false,
    intervalMinutes: (pollingConfig.intervalMinutes as number) ?? 30,
    mode: (pollingConfig.mode as 'polling' | 'webhook' | 'hybrid') ?? 'polling',
    lastPolledAt: pollingMetadata.lastPolledAt ? new Date(pollingMetadata.lastPolledAt as string) : null,
    lastCommitSha: (pollingMetadata.lastCommitSha as string) || null,
    watchBranches: (pollingConfig.watchBranches as string[]) ?? ['main', 'master', 'develop'],
  };
}

/**
 * Update polling configuration for a repository
 */
export async function updatePollingConfig(
  repositoryId: string,
  configUpdate: Partial<PollingConfig>
): Promise<PollingConfig> {
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { config: true, metadata: true },
  });

  if (!repository) {
    throw new Error('Repository not found');
  }

  const currentConfig = repository.config as Record<string, unknown> | null;
  const currentMetadata = repository.metadata as Record<string, unknown> | null;
  const currentPollingConfig = (currentConfig?.polling as Record<string, unknown>) || {};
  const currentPollingMetadata = (currentMetadata?.polling as Record<string, unknown>) || {};

  // Validate interval
  if (configUpdate.intervalMinutes !== undefined) {
    if (configUpdate.intervalMinutes < 5 || configUpdate.intervalMinutes > 60) {
      throw new Error('intervalMinutes must be between 5 and 60');
    }
  }

  // Validate mode
  if (configUpdate.mode !== undefined) {
    if (!['polling', 'webhook', 'hybrid'].includes(configUpdate.mode)) {
      throw new Error('mode must be polling, webhook, or hybrid');
    }
  }

  // Build updated config
  const updatedPollingConfig = {
    enabled: configUpdate.enabled ?? currentPollingConfig.enabled ?? false,
    intervalMinutes: configUpdate.intervalMinutes ?? currentPollingConfig.intervalMinutes ?? 30,
    mode: configUpdate.mode ?? currentPollingConfig.mode ?? 'polling',
    watchBranches: configUpdate.watchBranches ?? currentPollingConfig.watchBranches ?? ['main', 'master', 'develop'],
  };

  const updatedPollingMetadata = {
    lastPolledAt: configUpdate.lastPolledAt ?? currentPollingMetadata.lastPolledAt ?? null,
    lastCommitSha: configUpdate.lastCommitSha ?? currentPollingMetadata.lastCommitSha ?? null,
  };

  // Update repository
  await prisma.repository.update({
    where: { id: repositoryId },
    data: {
      config: {
        ...(currentConfig || {}),
        polling: updatedPollingConfig,
      },
      metadata: {
        ...(currentMetadata || {}),
        polling: updatedPollingMetadata,
      },
    },
  });

  log.info({ repositoryId, enabled: updatedPollingConfig.enabled }, 'Polling config updated');

  return {
    enabled: updatedPollingConfig.enabled as boolean,
    intervalMinutes: updatedPollingConfig.intervalMinutes as number,
    mode: updatedPollingConfig.mode as 'polling' | 'webhook' | 'hybrid',
    lastPolledAt: updatedPollingMetadata.lastPolledAt ? new Date(updatedPollingMetadata.lastPolledAt as string) : null,
    lastCommitSha: updatedPollingMetadata.lastCommitSha as string | null,
    watchBranches: updatedPollingConfig.watchBranches as string[],
  };
}

// ============================================================================
// Polling Operations
// ============================================================================

/**
 * Poll GitHub API for new commits and PRs since last poll
 */
export async function pollRepository(
  repositoryId: string,
  installationId: number,
  owner: string,
  repo: string
): Promise<PollResult> {
  const config = await getPollingConfig(repositoryId);
  const client = GitHubClient.forInstallation(installationId);

  const result: PollResult = {
    repositoryId,
    newCommits: [],
    newPRs: [],
    hasChanges: false,
    polledAt: new Date(),
  };

  try {
    // Poll each watched branch for new commits
    for (const branch of config.watchBranches) {
      try {
        const latestCommitSha = await client.getLatestCommitSha(owner, repo, branch);

        // If this is the first poll or branch changed, record the commit
        if (!config.lastCommitSha || config.lastCommitSha !== latestCommitSha) {
          // Get commit details
          const commits = await getCommitsSince(
            client,
            owner,
            repo,
            branch,
            config.lastPolledAt || new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24h if no lastPolledAt
          );

          result.newCommits.push(...commits);
        }
      } catch (error) {
        log.warn({ error, branch, repositoryId }, 'Failed to poll branch');
      }
    }

    // Poll for new PRs
    const prs = await getRecentPRs(
      client,
      owner,
      repo,
      config.lastPolledAt || new Date(Date.now() - 24 * 60 * 60 * 1000)
    );
    result.newPRs.push(...prs);

    result.hasChanges = result.newCommits.length > 0 || result.newPRs.length > 0;

    // Update polling metadata
    if (result.newCommits.length > 0) {
      const latestCommit = result.newCommits[0];
      if (latestCommit) {
        await updatePollingConfig(repositoryId, {
          lastPolledAt: result.polledAt,
          lastCommitSha: latestCommit.sha,
        });
      }
    } else {
      await updatePollingConfig(repositoryId, {
        lastPolledAt: result.polledAt,
      });
    }

    log.info(
      {
        repositoryId,
        newCommits: result.newCommits.length,
        newPRs: result.newPRs.length,
      },
      'Repository polled successfully'
    );
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to poll repository');
    throw error;
  }

  return result;
}

/**
 * Detect changes by comparing current state to last polled state
 */
export async function detectChanges(repositoryId: string, lastPolledAt: Date | null): Promise<boolean> {
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: {
      installationId: true,
      fullName: true,
    },
  });

  if (!repository) {
    throw new Error('Repository not found');
  }

  const [owner, repo] = repository.fullName.split('/');
  if (!owner || !repo) {
    throw new Error('Invalid repository fullName');
  }

  const result = await pollRepository(repositoryId, repository.installationId, owner, repo);
  return result.hasChanges;
}

/**
 * Get polling status for a repository
 */
export async function getPollingStatus(repositoryId: string): Promise<PollingStatus> {
  const config = await getPollingConfig(repositoryId);

  let nextPollAt: Date | null = null;
  if (config.enabled && config.lastPolledAt) {
    nextPollAt = new Date(config.lastPolledAt.getTime() + config.intervalMinutes * 60 * 1000);
  }

  return {
    repositoryId,
    enabled: config.enabled,
    lastPolledAt: config.lastPolledAt,
    lastCommitSha: config.lastCommitSha,
    nextPollAt,
    intervalMinutes: config.intervalMinutes,
    watchBranches: config.watchBranches,
    mode: config.mode,
  };
}

// ============================================================================
// History Management
// ============================================================================

/**
 * Get polling history for a repository
 */
export async function getPollingHistory(
  repositoryId: string,
  limit: number = 20
): Promise<PollingHistory[]> {
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { metadata: true },
  });

  if (!repository) {
    return [];
  }

  const metadata = repository.metadata as Record<string, unknown> | null;
  const history = (metadata?.pollingHistory as PollingHistory[]) || [];

  return history.slice(0, limit);
}

/**
 * Record a poll result in history
 */
export async function recordPollResult(result: PollResult, error?: string): Promise<void> {
  const repository = await prisma.repository.findUnique({
    where: { id: result.repositoryId },
    select: { metadata: true },
  });

  if (!repository) {
    return;
  }

  const metadata = repository.metadata as Record<string, unknown> | null;
  const history = (metadata?.pollingHistory as PollingHistory[]) || [];

  const newEntry: PollingHistory = {
    id: `poll_${Date.now()}`,
    repositoryId: result.repositoryId,
    polledAt: result.polledAt,
    commitSha: result.newCommits[0]?.sha || null,
    newCommitsCount: result.newCommits.length,
    newPRsCount: result.newPRs.length,
    hasChanges: result.hasChanges,
    error: error || null,
    details: result,
  };

  // Keep last 50 entries
  const updatedHistory = [newEntry, ...history].slice(0, 50);

  await prisma.repository.update({
    where: { id: result.repositoryId },
    data: {
      metadata: {
        ...(metadata || {}),
        pollingHistory: updatedHistory as any,
      },
    },
  });
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

    return (commits as any[]).map((commit: {
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
