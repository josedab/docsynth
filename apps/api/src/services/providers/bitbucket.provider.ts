// ============================================================================
// Bitbucket Provider Implementation
// ============================================================================
// This module implements the SCMProvider interface for Bitbucket using direct
// REST API calls. No external Bitbucket SDK is used - all operations use fetch.
// Bitbucket API documentation: https://developer.atlassian.com/cloud/bitbucket/rest/

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

const log = createLogger('bitbucket-provider');

export interface BitbucketProviderConfig {
  username: string;
  appPassword: string;
  baseUrl?: string; // Defaults to https://api.bitbucket.org/2.0
}

export class BitbucketProvider implements SCMProvider {
  public readonly type: SCMProviderType = 'bitbucket';
  private username: string;
  private appPassword: string;
  private baseUrl: string;

  constructor(config: BitbucketProviderConfig) {
    this.username = config.username;
    this.appPassword = config.appPassword;
    this.baseUrl = config.baseUrl ?? 'https://api.bitbucket.org/2.0';
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private async fetchBitbucket<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const auth = Buffer.from(`${this.username}:${this.appPassword}`).toString('base64');

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error({ status: response.status, url, errorText }, 'Bitbucket API request failed');
      throw new ExternalServiceError(
        'Bitbucket',
        new Error(`HTTP ${response.status}: ${errorText}`)
      );
    }

    return response.json() as Promise<T>;
  }

  // ==========================================================================
  // Repository Operations
  // ==========================================================================

  async getRepository(owner: string, repo: string): Promise<SCMRepository> {
    try {
      const repository = await this.fetchBitbucket<{
        uuid: string;
        name: string;
        full_name: string;
        mainbranch?: { name: string };
        is_private: boolean;
        description: string | null;
        language: string;
        links: { html: { href: string } };
      }>(`/repositories/${owner}/${repo}`);

      return {
        id: parseInt(repository.uuid.replace(/[{}]/g, ''), 16),
        name: repository.name,
        fullName: repository.full_name,
        defaultBranch: repository.mainbranch?.name ?? 'main',
        private: repository.is_private,
        description: repository.description,
        language: repository.language,
        url: repository.links.html.href,
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
      // Get file metadata first
      const metadata = await this.fetchBitbucket<{
        path: string;
        commit: { hash: string };
      }>(`/repositories/${owner}/${repo}/src/${ref}/${path}?format=meta`);

      // Get file content
      const response = await fetch(
        `${this.baseUrl}/repositories/${owner}/${repo}/src/${ref}/${path}`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.username}:${this.appPassword}`).toString('base64')}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch file content: ${response.status}`);
      }

      const content = await response.text();

      return {
        path: metadata.path,
        content,
        encoding: 'utf-8',
        sha: metadata.commit.hash,
      };
    } catch (error) {
      log.error({ error, owner, repo, path }, 'Failed to get file content');
      throw error;
    }
  }

  async listFiles(owner: string, repo: string, path = '', ref = 'main'): Promise<SCMFile[]> {
    try {
      const result = await this.fetchBitbucket<{
        values: Array<{
          path: string;
          type: string;
          size?: number;
        }>;
      }>(`/repositories/${owner}/${repo}/src/${ref}/${path}`);

      return result.values.map((item) => ({
        path: item.path,
        type: item.type === 'commit_directory' ? 'dir' : 'file',
        size: item.size,
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
      const pr = await this.fetchBitbucket<{
        id: number;
        title: string;
        description: string | null;
        state: string;
        author: { display_name: string };
        destination: { branch: { name: string } };
        source: { branch: { name: string } };
        merge_commit: { hash: string } | null;
        created_on: string;
        updated_on: string;
      }>(`/repositories/${owner}/${repo}/pullrequests/${prNumber}`);

      let state: 'open' | 'closed' | 'merged';
      if (pr.state === 'MERGED') {
        state = 'merged';
      } else if (pr.state === 'OPEN') {
        state = 'open';
      } else {
        state = 'closed';
      }

      return {
        number: pr.id,
        title: pr.title,
        body: pr.description,
        state,
        author: pr.author.display_name,
        baseBranch: pr.destination.branch.name,
        headBranch: pr.source.branch.name,
        mergedAt: pr.merge_commit ? new Date(pr.updated_on) : null,
        createdAt: new Date(pr.created_on),
        updatedAt: new Date(pr.updated_on),
      };
    } catch (error) {
      log.error({ error, owner, repo, prNumber }, 'Failed to get pull request');
      throw error;
    }
  }

  async listPullRequests(owner: string, repo: string, state = 'OPEN'): Promise<SCMPullRequest[]> {
    try {
      const result = await this.fetchBitbucket<{
        values: Array<{
          id: number;
          title: string;
          description: string | null;
          state: string;
          author: { display_name: string };
          destination: { branch: { name: string } };
          source: { branch: { name: string } };
          merge_commit: { hash: string } | null;
          created_on: string;
          updated_on: string;
        }>;
      }>(`/repositories/${owner}/${repo}/pullrequests?state=${state}&pagelen=100`);

      return result.values.map((pr) => {
        let mappedState: 'open' | 'closed' | 'merged';
        if (pr.state === 'MERGED') {
          mappedState = 'merged';
        } else if (pr.state === 'OPEN') {
          mappedState = 'open';
        } else {
          mappedState = 'closed';
        }

        return {
          number: pr.id,
          title: pr.title,
          body: pr.description,
          state: mappedState,
          author: pr.author.display_name,
          baseBranch: pr.destination.branch.name,
          headBranch: pr.source.branch.name,
          mergedAt: pr.merge_commit ? new Date(pr.updated_on) : null,
          createdAt: new Date(pr.created_on),
          updatedAt: new Date(pr.updated_on),
        };
      });
    } catch (error) {
      log.error({ error, owner, repo, state }, 'Failed to list pull requests');
      throw error;
    }
  }

  async getPRFiles(owner: string, repo: string, prNumber: number): Promise<SCMChangedFile[]> {
    try {
      const result = await this.fetchBitbucket<{
        values: Array<{
          old?: { path: string };
          new?: { path: string };
          status: string;
          lines_added: number;
          lines_removed: number;
        }>;
      }>(`/repositories/${owner}/${repo}/pullrequests/${prNumber}/diffstat`);

      return result.values.map((file) => {
        let status: SCMChangedFile['status'];
        let filename: string;

        if (file.status === 'added') {
          status = 'added';
          filename = file.new?.path ?? '';
        } else if (file.status === 'removed') {
          status = 'removed';
          filename = file.old?.path ?? '';
        } else if (file.status === 'renamed') {
          status = 'renamed';
          filename = file.new?.path ?? '';
        } else {
          status = 'modified';
          filename = file.new?.path ?? file.old?.path ?? '';
        }

        return {
          filename,
          status,
          additions: file.lines_added,
          deletions: file.lines_removed,
          patch: undefined, // Bitbucket API doesn't provide patches in diffstat
        };
      });
    } catch (error) {
      log.error({ error, owner, repo, prNumber }, 'Failed to get pull request files');
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
      await this.fetchBitbucket(`/repositories/${owner}/${repo}/pullrequests/${prNumber}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          content: {
            raw: body,
          },
        }),
      });
    } catch (error) {
      log.error({ error, owner, repo, prNumber }, 'Failed to create pull request comment');
      throw error;
    }
  }

  // ==========================================================================
  // Commit Operations
  // ==========================================================================

  async getCommit(owner: string, repo: string, sha: string): Promise<SCMCommit> {
    try {
      const commit = await this.fetchBitbucket<{
        hash: string;
        message: string;
        author: { user: { display_name: string } };
        date: string;
      }>(`/repositories/${owner}/${repo}/commit/${sha}`);

      return {
        sha: commit.hash,
        message: commit.message,
        author: commit.author.user.display_name,
        date: new Date(commit.date),
        files: undefined,
      };
    } catch (error) {
      log.error({ error, owner, repo, sha }, 'Failed to get commit');
      throw error;
    }
  }

  async listCommits(owner: string, repo: string, since?: Date): Promise<SCMCommit[]> {
    try {
      // Bitbucket doesn't support filtering by date directly
      const result = await this.fetchBitbucket<{
        values: Array<{
          hash: string;
          message: string;
          author: { user: { display_name: string } };
          date: string;
        }>;
      }>(`/repositories/${owner}/${repo}/commits?pagelen=100`);

      let commits = result.values.map((commit) => ({
        sha: commit.hash,
        message: commit.message,
        author: commit.author.user.display_name,
        date: new Date(commit.date),
      }));

      // Filter by date if provided
      if (since) {
        commits = commits.filter((c) => c.date >= since);
      }

      return commits;
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
      // Get commits between base and head
      const commitsResult = await this.fetchBitbucket<{
        values: Array<{
          hash: string;
          message: string;
          author: { user: { display_name: string } };
          date: string;
        }>;
      }>(`/repositories/${owner}/${repo}/commits/${head}?exclude=${base}&pagelen=100`);

      // Get diff between base and head
      const diffResult = await this.fetchBitbucket<{
        values: Array<{
          old?: { path: string };
          new?: { path: string };
          status: string;
          lines_added: number;
          lines_removed: number;
        }>;
      }>(`/repositories/${owner}/${repo}/diffstat/${base}..${head}`);

      const commits = commitsResult.values.map((commit) => ({
        sha: commit.hash,
        message: commit.message,
        author: commit.author.user.display_name,
        date: new Date(commit.date),
      }));

      const files = diffResult.values.map((file) => {
        let status: SCMChangedFile['status'];
        let filename: string;

        if (file.status === 'added') {
          status = 'added';
          filename = file.new?.path ?? '';
        } else if (file.status === 'removed') {
          status = 'removed';
          filename = file.old?.path ?? '';
        } else if (file.status === 'renamed') {
          status = 'renamed';
          filename = file.new?.path ?? '';
        } else {
          status = 'modified';
          filename = file.new?.path ?? file.old?.path ?? '';
        }

        return {
          filename,
          status,
          additions: file.lines_added,
          deletions: file.lines_removed,
          patch: undefined,
        };
      });

      return {
        ahead: commits.length,
        behind: 0, // Bitbucket doesn't provide behind count in this API
        commits,
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
      const event = headers['x-event-key'];
      if (!event) {
        return null;
      }

      const payload = body as Record<string, unknown>;

      let eventType: SCMWebhookEvent['type'];
      let repository: { owner: string; name: string; fullName: string } | null = null;

      switch (event) {
        case 'repo:push':
          eventType = 'push';
          {
            const repo = payload.repository as { full_name: string } | undefined;
            if (repo) {
              const parts = repo.full_name.split('/');
              repository = {
                owner: parts[0] ?? '',
                name: parts[1] ?? '',
                fullName: repo.full_name,
              };
            }
          }
          break;
        case 'pullrequest:created':
        case 'pullrequest:updated':
        case 'pullrequest:fulfilled':
        case 'pullrequest:rejected':
          eventType = 'pull_request';
          {
            const pr = payload.pullrequest as
              | { destination: { repository: { full_name: string } } }
              | undefined;
            if (pr) {
              const parts = pr.destination.repository.full_name.split('/');
              repository = {
                owner: parts[0] ?? '',
                name: parts[1] ?? '',
                fullName: pr.destination.repository.full_name,
              };
            }
          }
          break;
        case 'pullrequest:comment_created':
        case 'pullrequest:comment_updated':
          eventType = 'comment';
          {
            const pr = payload.pullrequest as
              | { destination: { repository: { full_name: string } } }
              | undefined;
            if (pr) {
              const parts = pr.destination.repository.full_name.split('/');
              repository = {
                owner: parts[0] ?? '',
                name: parts[1] ?? '',
                fullName: pr.destination.repository.full_name,
              };
            }
          }
          break;
        default:
          return null;
      }

      if (!repository) {
        return null;
      }

      return {
        type: eventType,
        action: event.split(':')[1],
        repository,
        payload,
      };
    } catch (error) {
      log.error({ error }, 'Failed to parse Bitbucket webhook payload');
      return null;
    }
  }

  verifyWebhookSignature(headers: Record<string, string>, body: string, secret: string): boolean {
    try {
      // Bitbucket doesn't provide webhook signatures by default
      // You need to implement custom verification or use Bitbucket's IP whitelist
      // For now, we'll check if the webhook has the expected user agent
      const userAgent = headers['user-agent'];
      if (!userAgent || !userAgent.includes('Bitbucket-Webhooks')) {
        return false;
      }

      // If a secret is provided, verify it as a custom header
      if (secret) {
        const providedSecret = headers['x-bitbucket-token'];
        if (!providedSecret) {
          return false;
        }
        return timingSafeEqual(Buffer.from(providedSecret), Buffer.from(secret));
      }

      return true;
    } catch (error) {
      log.error({ error }, 'Failed to verify Bitbucket webhook signature');
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
      // Bitbucket uses commit build statuses
      let state: string;
      if (data.status === 'completed') {
        state = data.conclusion === 'success' ? 'SUCCESSFUL' : 'FAILED';
      } else if (data.status === 'in_progress') {
        state = 'INPROGRESS';
      } else {
        state = 'STOPPED';
      }

      const status = await this.fetchBitbucket<{
        uuid: string;
        key: string;
        state: string;
      }>(`/repositories/${owner}/${repo}/commit/${data.headSha}/statuses/build`, {
        method: 'POST',
        body: JSON.stringify({
          key: data.name,
          state,
          name: data.name,
          description: data.summary,
          url: undefined,
        }),
      });

      return {
        id: parseInt(status.uuid.replace(/[{}]/g, ''), 16),
        name: status.key,
        status: status.state,
      };
    } catch (error) {
      log.error({ error, owner, repo }, 'Failed to create build status');
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
      // Bitbucket doesn't support updating build statuses
      // We need to create a new one instead
      if (!data.headSha) {
        log.warn({ checkRunId }, 'Cannot update Bitbucket status without headSha');
        return;
      }

      let state: string | undefined;
      if (data.status === 'completed') {
        state = data.conclusion === 'success' ? 'SUCCESSFUL' : 'FAILED';
      } else if (data.status === 'in_progress') {
        state = 'INPROGRESS';
      } else if (data.status === 'queued') {
        state = 'STOPPED';
      }

      await this.fetchBitbucket(`/repositories/${owner}/${repo}/commit/${data.headSha}/statuses/build`, {
        method: 'POST',
        body: JSON.stringify({
          key: data.name ?? 'DocSynth',
          state,
          name: data.name ?? 'DocSynth',
          description: data.summary,
        }),
      });
    } catch (error) {
      log.error({ error, owner, repo, checkRunId }, 'Failed to update build status');
      throw error;
    }
  }
}
