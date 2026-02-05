// ============================================================================
// GitLab Provider Implementation
// ============================================================================
// This module implements the SCMProvider interface for GitLab using direct
// REST API calls. No external GitLab SDK is used - all operations use fetch.
// GitLab API documentation: https://docs.gitlab.com/ee/api/

import { timingSafeEqual } from 'crypto';
import { createLogger, ExternalServiceError } from '@docsynth/utils';
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

const log = createLogger('gitlab-provider');

export interface GitLabProviderConfig {
  token: string;
  baseUrl?: string; // Defaults to https://gitlab.com/api/v4
}

export class GitLabProvider implements SCMProvider {
  public readonly type: SCMProviderType = 'gitlab';
  private token: string;
  private baseUrl: string;

  constructor(config: GitLabProviderConfig) {
    this.token = config.token;
    this.baseUrl = config.baseUrl ?? 'https://gitlab.com/api/v4';
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private async fetchGitLab<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error({ status: response.status, url, errorText }, 'GitLab API request failed');
      throw new ExternalServiceError('GitLab', new Error(`HTTP ${response.status}: ${errorText}`));
    }

    return response.json() as Promise<T>;
  }

  private encodeProjectPath(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  // ==========================================================================
  // Repository Operations
  // ==========================================================================

  async getRepository(owner: string, repo: string): Promise<SCMRepository> {
    try {
      const projectPath = this.encodeProjectPath(owner, repo);
      const project = await this.fetchGitLab<{
        id: number;
        name: string;
        path_with_namespace: string;
        default_branch: string;
        visibility: string;
        description: string | null;
        web_url: string;
      }>(`/projects/${projectPath}`);

      return {
        id: project.id,
        name: project.name,
        fullName: project.path_with_namespace,
        defaultBranch: project.default_branch,
        private: project.visibility === 'private',
        description: project.description,
        language: null, // GitLab doesn't provide a single primary language
        url: project.web_url,
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
    ref = 'main'
  ): Promise<SCMFileContent> {
    try {
      const projectPath = this.encodeProjectPath(owner, repo);
      const encodedPath = encodeURIComponent(path);

      const file = await this.fetchGitLab<{
        file_path: string;
        content: string;
        encoding: string;
        blob_id: string;
      }>(`/projects/${projectPath}/repository/files/${encodedPath}?ref=${ref}`);

      const content =
        file.encoding === 'base64'
          ? Buffer.from(file.content, 'base64').toString('utf-8')
          : file.content;

      return {
        path: file.file_path,
        content,
        encoding: file.encoding,
        sha: file.blob_id,
      };
    } catch (error) {
      log.error({ error, owner, repo, path }, 'Failed to get file content');
      throw error;
    }
  }

  async listFiles(owner: string, repo: string, path = '', ref = 'main'): Promise<SCMFile[]> {
    try {
      const projectPath = this.encodeProjectPath(owner, repo);

      const tree = await this.fetchGitLab<
        Array<{
          path: string;
          type: string;
          mode: string;
        }>
      >(`/projects/${projectPath}/repository/tree?path=${encodeURIComponent(path)}&ref=${ref}`);

      return tree.map((item) => ({
        path: item.path,
        type: item.type === 'tree' ? 'dir' : 'file',
        size: undefined,
      }));
    } catch (error) {
      log.error({ error, owner, repo, path }, 'Failed to list files');
      throw error;
    }
  }

  // ==========================================================================
  // Pull Request (Merge Request) Operations
  // ==========================================================================

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<SCMPullRequest> {
    try {
      const projectPath = this.encodeProjectPath(owner, repo);

      const mr = await this.fetchGitLab<{
        iid: number;
        title: string;
        description: string | null;
        state: string;
        author: { username: string };
        target_branch: string;
        source_branch: string;
        merged_at: string | null;
        created_at: string;
        updated_at: string;
      }>(`/projects/${projectPath}/merge_requests/${prNumber}`);

      return {
        number: mr.iid,
        title: mr.title,
        body: mr.description,
        state: mr.merged_at ? 'merged' : mr.state === 'opened' ? 'open' : 'closed',
        author: mr.author.username,
        baseBranch: mr.target_branch,
        headBranch: mr.source_branch,
        mergedAt: mr.merged_at ? new Date(mr.merged_at) : null,
        createdAt: new Date(mr.created_at),
        updatedAt: new Date(mr.updated_at),
      };
    } catch (error) {
      log.error({ error, owner, repo, prNumber }, 'Failed to get merge request');
      throw error;
    }
  }

  async listPullRequests(owner: string, repo: string, state = 'opened'): Promise<SCMPullRequest[]> {
    try {
      const projectPath = this.encodeProjectPath(owner, repo);

      const mrs = await this.fetchGitLab<
        Array<{
          iid: number;
          title: string;
          description: string | null;
          state: string;
          author: { username: string };
          target_branch: string;
          source_branch: string;
          merged_at: string | null;
          created_at: string;
          updated_at: string;
        }>
      >(`/projects/${projectPath}/merge_requests?state=${state}&per_page=100`);

      return mrs.map((mr) => ({
        number: mr.iid,
        title: mr.title,
        body: mr.description,
        state: mr.merged_at ? 'merged' : mr.state === 'opened' ? 'open' : 'closed',
        author: mr.author.username,
        baseBranch: mr.target_branch,
        headBranch: mr.source_branch,
        mergedAt: mr.merged_at ? new Date(mr.merged_at) : null,
        createdAt: new Date(mr.created_at),
        updatedAt: new Date(mr.updated_at),
      }));
    } catch (error) {
      log.error({ error, owner, repo, state }, 'Failed to list merge requests');
      throw error;
    }
  }

  async getPRFiles(owner: string, repo: string, prNumber: number): Promise<SCMChangedFile[]> {
    try {
      const projectPath = this.encodeProjectPath(owner, repo);

      const changes = await this.fetchGitLab<{
        changes: Array<{
          old_path: string;
          new_path: string;
          new_file: boolean;
          deleted_file: boolean;
          renamed_file: boolean;
          diff: string;
        }>;
      }>(`/projects/${projectPath}/merge_requests/${prNumber}/changes`);

      return changes.changes.map((change) => {
        let status: SCMChangedFile['status'];
        if (change.new_file) {
          status = 'added';
        } else if (change.deleted_file) {
          status = 'removed';
        } else if (change.renamed_file) {
          status = 'renamed';
        } else {
          status = 'modified';
        }

        // Parse diff to count additions/deletions
        const lines = change.diff.split('\n');
        const additions = lines.filter((l) => l.startsWith('+')).length;
        const deletions = lines.filter((l) => l.startsWith('-')).length;

        return {
          filename: change.new_path,
          status,
          additions,
          deletions,
          patch: change.diff,
        };
      });
    } catch (error) {
      log.error({ error, owner, repo, prNumber }, 'Failed to get merge request files');
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
      const projectPath = this.encodeProjectPath(owner, repo);

      await this.fetchGitLab(`/projects/${projectPath}/merge_requests/${prNumber}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
    } catch (error) {
      log.error({ error, owner, repo, prNumber }, 'Failed to create merge request comment');
      throw error;
    }
  }

  // ==========================================================================
  // Commit Operations
  // ==========================================================================

  async getCommit(owner: string, repo: string, sha: string): Promise<SCMCommit> {
    try {
      const projectPath = this.encodeProjectPath(owner, repo);

      const commit = await this.fetchGitLab<{
        id: string;
        message: string;
        author_name: string;
        created_at: string;
        stats: { additions: number; deletions: number };
      }>(`/projects/${projectPath}/repository/commits/${sha}`);

      return {
        sha: commit.id,
        message: commit.message,
        author: commit.author_name,
        date: new Date(commit.created_at),
        files: undefined, // GitLab doesn't include file list in commit response by default
      };
    } catch (error) {
      log.error({ error, owner, repo, sha }, 'Failed to get commit');
      throw error;
    }
  }

  async listCommits(owner: string, repo: string, since?: Date): Promise<SCMCommit[]> {
    try {
      const projectPath = this.encodeProjectPath(owner, repo);
      const sinceParam = since ? `&since=${since.toISOString()}` : '';

      const commits = await this.fetchGitLab<
        Array<{
          id: string;
          message: string;
          author_name: string;
          created_at: string;
        }>
      >(`/projects/${projectPath}/repository/commits?per_page=100${sinceParam}`);

      return commits.map((commit) => ({
        sha: commit.id,
        message: commit.message,
        author: commit.author_name,
        date: new Date(commit.created_at),
      }));
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
      const projectPath = this.encodeProjectPath(owner, repo);

      const comparison = await this.fetchGitLab<{
        commits: Array<{
          id: string;
          message: string;
          author_name: string;
          created_at: string;
        }>;
        diffs: Array<{
          old_path: string;
          new_path: string;
          new_file: boolean;
          deleted_file: boolean;
          renamed_file: boolean;
          diff: string;
        }>;
      }>(`/projects/${projectPath}/repository/compare?from=${base}&to=${head}`);

      const files = comparison.diffs.map((diff) => {
        let status: SCMChangedFile['status'];
        if (diff.new_file) {
          status = 'added';
        } else if (diff.deleted_file) {
          status = 'removed';
        } else if (diff.renamed_file) {
          status = 'renamed';
        } else {
          status = 'modified';
        }

        const lines = diff.diff.split('\n');
        const additions = lines.filter((l) => l.startsWith('+')).length;
        const deletions = lines.filter((l) => l.startsWith('-')).length;

        return {
          filename: diff.new_path,
          status,
          additions,
          deletions,
          patch: diff.diff,
        };
      });

      return {
        ahead: comparison.commits.length,
        behind: 0, // GitLab compare doesn't provide behind count
        commits: comparison.commits.map((c) => ({
          sha: c.id,
          message: c.message,
          author: c.author_name,
          date: new Date(c.created_at),
        })),
        files,
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
      const event = headers['x-gitlab-event'];
      if (!event) {
        return null;
      }

      const payload = body as Record<string, unknown>;

      let eventType: SCMWebhookEvent['type'];
      let repository: { owner: string; name: string; fullName: string } | null = null;

      switch (event) {
        case 'Push Hook':
          eventType = 'push';
          {
            const project = payload.project as { path_with_namespace: string } | undefined;
            if (project) {
              const parts = project.path_with_namespace.split('/');
              repository = {
                owner: parts[0] ?? '',
                name: parts.slice(1).join('/'),
                fullName: project.path_with_namespace,
              };
            }
          }
          break;
        case 'Merge Request Hook':
          eventType = 'merge_request';
          {
            const project = payload.project as { path_with_namespace: string } | undefined;
            if (project) {
              const parts = project.path_with_namespace.split('/');
              repository = {
                owner: parts[0] ?? '',
                name: parts.slice(1).join('/'),
                fullName: project.path_with_namespace,
              };
            }
          }
          break;
        case 'Note Hook': {
          const objectAttributes = payload.object_attributes as
            | { noteable_type: string }
            | undefined;
          if (objectAttributes?.noteable_type === 'MergeRequest') {
            eventType = 'comment';
            const project = payload.project as { path_with_namespace: string } | undefined;
            if (project) {
              const parts = project.path_with_namespace.split('/');
              repository = {
                owner: parts[0] ?? '',
                name: parts.slice(1).join('/'),
                fullName: project.path_with_namespace,
              };
            }
          } else {
            return null;
          }
          break;
        }
        default:
          return null;
      }

      if (!repository) {
        return null;
      }

      return {
        type: eventType,
        action: (payload.object_attributes as { action?: string } | undefined)?.action,
        repository,
        payload,
      };
    } catch (error) {
      log.error({ error }, 'Failed to parse GitLab webhook payload');
      return null;
    }
  }

  verifyWebhookSignature(headers: Record<string, string>, body: string, secret: string): boolean {
    try {
      const token = headers['x-gitlab-token'];
      if (!token) {
        return false;
      }

      // GitLab uses a simple token comparison, not HMAC
      return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
    } catch (error) {
      log.error({ error }, 'Failed to verify GitLab webhook signature');
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
      const projectPath = this.encodeProjectPath(owner, repo);

      // GitLab uses commit statuses instead of check runs
      let state: string;
      if (data.status === 'completed') {
        state = data.conclusion === 'success' ? 'success' : 'failed';
      } else if (data.status === 'in_progress') {
        state = 'running';
      } else {
        state = 'pending';
      }

      const status = await this.fetchGitLab<{
        id: number;
        name: string;
        status: string;
      }>(`/projects/${projectPath}/statuses/${data.headSha}`, {
        method: 'POST',
        body: JSON.stringify({
          state,
          name: data.name,
          description: data.summary,
          target_url: undefined,
        }),
      });

      return {
        id: status.id,
        name: status.name,
        status: status.status,
      };
    } catch (error) {
      log.error({ error, owner, repo }, 'Failed to create commit status');
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
      // GitLab doesn't support updating commit statuses
      // We need to create a new one instead
      if (!data.headSha) {
        log.warn({ checkRunId }, 'Cannot update GitLab status without headSha');
        return;
      }

      const projectPath = this.encodeProjectPath(owner, repo);

      let state: string | undefined;
      if (data.status === 'completed') {
        state = data.conclusion === 'success' ? 'success' : 'failed';
      } else if (data.status === 'in_progress') {
        state = 'running';
      } else if (data.status === 'queued') {
        state = 'pending';
      }

      await this.fetchGitLab(`/projects/${projectPath}/statuses/${data.headSha}`, {
        method: 'POST',
        body: JSON.stringify({
          state,
          name: data.name ?? 'DocSynth',
          description: data.summary,
        }),
      });
    } catch (error) {
      log.error({ error, owner, repo, checkRunId }, 'Failed to update commit status');
      throw error;
    }
  }
}
