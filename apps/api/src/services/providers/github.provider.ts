// ============================================================================
// GitHub Provider Implementation
// ============================================================================
// This module wraps the existing @docsynth/github package to implement the
// SCMProvider interface, enabling GitHub repositories to work through the
// unified provider abstraction.

import { createHmac, timingSafeEqual } from 'crypto';
import { GitHubClient } from '@docsynth/github';
import { createLogger } from '@docsynth/utils';
import type {
  SCMProvider,
  SCMProviderType,
  SCMRepository,
  SCMPullRequest,
  SCMChangedFile,
  SCMCommit,
  SCMComparison,
  SCMFileContent,
  SCMFile,
  SCMWebhookEvent,
  SCMCheckRunInput,
  SCMCheckRun,
} from '../scm-provider.js';

const log = createLogger('github-provider');

export interface GitHubProviderConfig {
  installationId: number;
}

export class GitHubProvider implements SCMProvider {
  public readonly type: SCMProviderType = 'github';
  private client: GitHubClient;

  constructor(config: GitHubProviderConfig) {
    this.client = GitHubClient.forInstallation(config.installationId);
  }

  // ==========================================================================
  // Repository Operations
  // ==========================================================================

  async getRepository(owner: string, repo: string): Promise<SCMRepository> {
    try {
      const client = this.client as GitHubClient & {
        octokit: { repos: { get: (params: { owner: string; repo: string }) => Promise<{ data: unknown }> } };
      };

      const { data } = await (client as unknown as { octokit: { repos: { get: (params: { owner: string; repo: string }) => Promise<{ data: unknown }> } } }).octokit.repos.get({
        owner,
        repo,
      });

      const repoData = data as {
        id: number;
        name: string;
        full_name: string;
        default_branch: string;
        private: boolean;
        description: string | null;
        language: string | null;
        html_url: string;
      };

      return {
        id: repoData.id,
        name: repoData.name,
        fullName: repoData.full_name,
        defaultBranch: repoData.default_branch,
        private: repoData.private,
        description: repoData.description,
        language: repoData.language,
        url: repoData.html_url,
      };
    } catch (error) {
      log.error({ error, owner, repo }, 'Failed to get repository');
      throw error;
    }
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<SCMFileContent> {
    try {
      const client = this.client as GitHubClient & {
        octokit: {
          repos: {
            getContent: (params: {
              owner: string;
              repo: string;
              path: string;
              ref?: string;
            }) => Promise<{
              data: {
                content?: string;
                encoding?: string;
                sha: string;
                type: string;
              };
            }>;
          };
        };
      };

      const { data } = await (client as unknown as { octokit: { repos: { getContent: (params: { owner: string; repo: string; path: string; ref?: string }) => Promise<{ data: { content?: string; encoding?: string; sha: string; type: string } }> } } }).octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      if (data.type !== 'file' || !data.content || !data.encoding) {
        throw new Error('Not a file or missing content');
      }

      const content =
        data.encoding === 'base64'
          ? Buffer.from(data.content, 'base64').toString('utf-8')
          : data.content;

      return {
        path,
        content,
        encoding: data.encoding,
        sha: data.sha,
      };
    } catch (error) {
      log.error({ error, owner, repo, path }, 'Failed to get file content');
      throw error;
    }
  }

  async listFiles(owner: string, repo: string, path = '', ref?: string): Promise<SCMFile[]> {
    try {
      const contents = await this.client.getDirectoryContents(owner, repo, path, ref);

      return contents.map((item) => ({
        path: item.path,
        type: item.type,
        size: undefined, // Size not provided by current implementation
      }));
    } catch (error) {
      log.error({ error, owner, repo, path }, 'Failed to list files');
      throw error;
    }
  }

  // ==========================================================================
  // Pull Request Operations
  // ==========================================================================

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<SCMPullRequest> {
    try {
      const pr = await this.client.getPullRequest(owner, repo, prNumber);

      return {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.merged ? 'merged' : pr.state,
        author: pr.user.login,
        baseBranch: pr.base.ref,
        headBranch: pr.head.ref,
        mergedAt: pr.mergedAt,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
      };
    } catch (error) {
      log.error({ error, owner, repo, prNumber }, 'Failed to get pull request');
      throw error;
    }
  }

  async listPullRequests(owner: string, repo: string, state = 'open'): Promise<SCMPullRequest[]> {
    try {
      const client = this.client as GitHubClient & {
        octokit: {
          pulls: {
            list: (params: {
              owner: string;
              repo: string;
              state: string;
              per_page: number;
            }) => Promise<{ data: unknown[] }>;
          };
        };
      };

      const { data } = await (client as unknown as { octokit: { pulls: { list: (params: { owner: string; repo: string; state: string; per_page: number }) => Promise<{ data: unknown[] }> } } }).octokit.pulls.list({
        owner,
        repo,
        state,
        per_page: 100,
      });

      return data.map((pr: unknown) => {
        const prData = pr as {
          number: number;
          title: string;
          body: string | null;
          state: 'open' | 'closed';
          merged_at: string | null;
          user: { login: string };
          base: { ref: string };
          head: { ref: string };
          created_at: string;
          updated_at: string;
        };

        return {
          number: prData.number,
          title: prData.title,
          body: prData.body,
          state: prData.merged_at ? 'merged' : prData.state,
          author: prData.user.login,
          baseBranch: prData.base.ref,
          headBranch: prData.head.ref,
          mergedAt: prData.merged_at ? new Date(prData.merged_at) : null,
          createdAt: new Date(prData.created_at),
          updatedAt: new Date(prData.updated_at),
        };
      });
    } catch (error) {
      log.error({ error, owner, repo, state }, 'Failed to list pull requests');
      throw error;
    }
  }

  async getPRFiles(owner: string, repo: string, prNumber: number): Promise<SCMChangedFile[]> {
    try {
      const files = await this.client.getPullRequestFiles(owner, repo, prNumber);

      return files.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
      }));
    } catch (error) {
      log.error({ error, owner, repo, prNumber }, 'Failed to get PR files');
      throw error;
    }
  }

  async createPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void> {
    try {
      await this.client.createPRComment(owner, repo, prNumber, body);
    } catch (error) {
      log.error({ error, owner, repo, prNumber }, 'Failed to create PR comment');
      throw error;
    }
  }

  // ==========================================================================
  // Commit Operations
  // ==========================================================================

  async getCommit(owner: string, repo: string, sha: string): Promise<SCMCommit> {
    try {
      const client = this.client as GitHubClient & {
        octokit: {
          repos: {
            getCommit: (params: {
              owner: string;
              repo: string;
              ref: string;
            }) => Promise<{ data: unknown }>;
          };
        };
      };

      const { data } = await (client as unknown as { octokit: { repos: { getCommit: (params: { owner: string; repo: string; ref: string }) => Promise<{ data: unknown }> } } }).octokit.repos.getCommit({
        owner,
        repo,
        ref: sha,
      });

      const commitData = data as {
        sha: string;
        commit: {
          message: string;
          author: { name: string; date: string };
        };
        files?: Array<{ filename: string }>;
      };

      return {
        sha: commitData.sha,
        message: commitData.commit.message,
        author: commitData.commit.author.name,
        date: new Date(commitData.commit.author.date),
        files: commitData.files?.map((f) => f.filename),
      };
    } catch (error) {
      log.error({ error, owner, repo, sha }, 'Failed to get commit');
      throw error;
    }
  }

  async listCommits(owner: string, repo: string, since?: Date): Promise<SCMCommit[]> {
    try {
      const client = this.client as GitHubClient & {
        octokit: {
          repos: {
            listCommits: (params: {
              owner: string;
              repo: string;
              since?: string;
              per_page: number;
            }) => Promise<{ data: unknown[] }>;
          };
        };
      };

      const { data } = await (client as unknown as { octokit: { repos: { listCommits: (params: { owner: string; repo: string; since?: string; per_page: number }) => Promise<{ data: unknown[] }> } } }).octokit.repos.listCommits({
        owner,
        repo,
        since: since?.toISOString(),
        per_page: 100,
      });

      return data.map((commit: unknown) => {
        const commitData = commit as {
          sha: string;
          commit: {
            message: string;
            author: { name: string; date: string };
          };
        };

        return {
          sha: commitData.sha,
          message: commitData.commit.message,
          author: commitData.commit.author.name,
          date: new Date(commitData.commit.author.date),
        };
      });
    } catch (error) {
      log.error({ error, owner, repo }, 'Failed to list commits');
      throw error;
    }
  }

  async compareCommits(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<SCMComparison> {
    try {
      const client = this.client as GitHubClient & {
        octokit: {
          repos: {
            compareCommits: (params: {
              owner: string;
              repo: string;
              base: string;
              head: string;
            }) => Promise<{ data: unknown }>;
          };
        };
      };

      const { data } = await (client as unknown as { octokit: { repos: { compareCommits: (params: { owner: string; repo: string; base: string; head: string }) => Promise<{ data: unknown }> } } }).octokit.repos.compareCommits({
        owner,
        repo,
        base,
        head,
      });

      const comparison = data as {
        ahead_by: number;
        behind_by: number;
        commits: Array<{
          sha: string;
          commit: {
            message: string;
            author: { name: string; date: string };
          };
        }>;
        files: Array<{
          filename: string;
          status: string;
          additions: number;
          deletions: number;
          patch?: string;
        }>;
      };

      return {
        ahead: comparison.ahead_by,
        behind: comparison.behind_by,
        commits: comparison.commits.map((c) => ({
          sha: c.sha,
          message: c.commit.message,
          author: c.commit.author.name,
          date: new Date(c.commit.author.date),
        })),
        files: comparison.files.map((f) => ({
          filename: f.filename,
          status: f.status as 'added' | 'modified' | 'removed' | 'renamed',
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
        })),
      };
    } catch (error) {
      log.error({ error, owner, repo, base, head }, 'Failed to compare commits');
      throw error;
    }
  }

  // ==========================================================================
  // Webhook Operations
  // ==========================================================================

  parseWebhookPayload(headers: Record<string, string>, body: unknown): SCMWebhookEvent | null {
    try {
      const event = headers['x-github-event'];
      if (!event) {
        return null;
      }

      const payload = body as Record<string, unknown>;
      const repo = payload.repository as { owner: { login: string }; name: string; full_name: string } | undefined;

      if (!repo) {
        return null;
      }

      let eventType: SCMWebhookEvent['type'];
      switch (event) {
        case 'push':
          eventType = 'push';
          break;
        case 'pull_request':
          eventType = 'pull_request';
          break;
        case 'issue_comment':
        case 'pull_request_review_comment':
          eventType = 'comment';
          break;
        default:
          return null;
      }

      return {
        type: eventType,
        action: payload.action as string | undefined,
        repository: {
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name,
        },
        payload,
      };
    } catch (error) {
      log.error({ error }, 'Failed to parse webhook payload');
      return null;
    }
  }

  verifyWebhookSignature(headers: Record<string, string>, body: string, secret: string): boolean {
    try {
      const signature = headers['x-hub-signature-256'];
      if (!signature) {
        return false;
      }

      const expectedSignature =
        'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

      return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch (error) {
      log.error({ error }, 'Failed to verify webhook signature');
      return false;
    }
  }

  // ==========================================================================
  // Check/Status Operations
  // ==========================================================================

  async createCheckRun(
    owner: string,
    repo: string,
    data: SCMCheckRunInput
  ): Promise<SCMCheckRun> {
    try {
      const client = this.client as GitHubClient & {
        octokit: {
          checks: {
            create: (params: {
              owner: string;
              repo: string;
              name: string;
              head_sha: string;
              status: string;
              conclusion?: string;
              output?: {
                title: string;
                summary: string;
              };
            }) => Promise<{ data: { id: number; name: string; status: string } }>;
          };
        };
      };

      const result = await (client as unknown as { octokit: { checks: { create: (params: { owner: string; repo: string; name: string; head_sha: string; status: string; conclusion?: string; output?: { title: string; summary: string } }) => Promise<{ data: { id: number; name: string; status: string } }> } } }).octokit.checks.create({
        owner,
        repo,
        name: data.name,
        head_sha: data.headSha,
        status: data.status,
        conclusion: data.conclusion,
        output:
          data.title && data.summary
            ? {
                title: data.title,
                summary: data.summary,
              }
            : undefined,
      });

      return {
        id: result.data.id,
        name: result.data.name,
        status: result.data.status,
      };
    } catch (error) {
      log.error({ error, owner, repo }, 'Failed to create check run');
      throw error;
    }
  }

  async updateCheckRun(
    owner: string,
    repo: string,
    checkRunId: number,
    data: Partial<SCMCheckRunInput>
  ): Promise<void> {
    try {
      const client = this.client as GitHubClient & {
        octokit: {
          checks: {
            update: (params: {
              owner: string;
              repo: string;
              check_run_id: number;
              status?: string;
              conclusion?: string;
              output?: {
                title: string;
                summary: string;
              };
            }) => Promise<unknown>;
          };
        };
      };

      await (client as unknown as { octokit: { checks: { update: (params: { owner: string; repo: string; check_run_id: number; status?: string; conclusion?: string; output?: { title: string; summary: string } }) => Promise<unknown> } } }).octokit.checks.update({
        owner,
        repo,
        check_run_id: checkRunId,
        status: data.status,
        conclusion: data.conclusion,
        output:
          data.title && data.summary
            ? {
                title: data.title,
                summary: data.summary,
              }
            : undefined,
      });
    } catch (error) {
      log.error({ error, owner, repo, checkRunId }, 'Failed to update check run');
      throw error;
    }
  }
}
