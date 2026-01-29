import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { createLogger, withRetry, ExternalServiceError } from '@docsynth/utils';
import type { GitHubPullRequest, GitHubFile, GitHubInstallation } from '@docsynth/types';

const log = createLogger('github-client');

// ============================================================================
// GitHub App Client Factory
// ============================================================================

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
}

let appConfig: GitHubAppConfig | null = null;

export function initializeGitHubApp(config: GitHubAppConfig): void {
  appConfig = config;
}

function getAppConfig(): GitHubAppConfig {
  if (!appConfig) {
    throw new Error('GitHub App not initialized. Call initializeGitHubApp first.');
  }
  return appConfig;
}

export function createAppOctokit(): Octokit {
  const config = getAppConfig();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.appId,
      privateKey: config.privateKey,
    },
  });
}

export function createInstallationOctokit(installationId: number): Octokit {
  const config = getAppConfig();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.appId,
      privateKey: config.privateKey,
      installationId,
    },
  });
}

// ============================================================================
// GitHub Client Class
// ============================================================================

export class GitHubClient {
  private octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  static forInstallation(installationId: number): GitHubClient {
    return new GitHubClient(createInstallationOctokit(installationId));
  }

  // ==========================================================================
  // Pull Request Operations
  // ==========================================================================

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequest> {
    return withRetry(
      async () => {
        const { data } = await this.octokit.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
        });

        return {
          number: data.number,
          title: data.title,
          body: data.body,
          state: data.state as 'open' | 'closed',
          merged: data.merged,
          draft: data.draft ?? false,
          head: {
            ref: data.head.ref,
            sha: data.head.sha,
          },
          base: {
            ref: data.base.ref,
            sha: data.base.sha,
          },
          user: {
            login: data.user?.login ?? 'unknown',
            id: data.user?.id ?? 0,
          },
          createdAt: new Date(data.created_at),
          updatedAt: new Date(data.updated_at),
          mergedAt: data.merged_at ? new Date(data.merged_at) : null,
          htmlUrl: data.html_url,
        };
      },
      { maxAttempts: 3 }
    ).catch((error) => {
      log.error({ error, owner, repo, prNumber }, 'Failed to get pull request');
      throw new ExternalServiceError('GitHub', error instanceof Error ? error : undefined);
    });
  }

  async getPullRequestFiles(owner: string, repo: string, prNumber: number): Promise<GitHubFile[]> {
    return withRetry(
      async () => {
        const files: GitHubFile[] = [];
        let page = 1;

        while (true) {
          const { data } = await this.octokit.pulls.listFiles({
            owner,
            repo,
            pull_number: prNumber,
            per_page: 100,
            page,
          });

          if (data.length === 0) break;

          files.push(
            ...data.map((file) => ({
              filename: file.filename,
              status: file.status as GitHubFile['status'],
              additions: file.additions,
              deletions: file.deletions,
              changes: file.changes,
              patch: file.patch,
              previousFilename: file.previous_filename,
            }))
          );

          if (data.length < 100) break;
          page++;
        }

        return files;
      },
      { maxAttempts: 3 }
    );
  }

  async getPullRequestDiff(owner: string, repo: string, prNumber: number): Promise<string> {
    return withRetry(async () => {
      const { data } = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
        mediaType: { format: 'diff' },
      });

      return data as unknown as string;
    });
  }

  // ==========================================================================
  // File Operations
  // ==========================================================================

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      if ('content' in data && data.encoding === 'base64') {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }

      return null;
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getDirectoryContents(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<{ name: string; path: string; type: 'file' | 'dir' }[]> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      if (!Array.isArray(data)) {
        return [];
      }

      return data.map((item) => ({
        name: item.name,
        path: item.path,
        type: item.type as 'file' | 'dir',
      }));
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return [];
      }
      throw error;
    }
  }

  // ==========================================================================
  // Branch Operations
  // ==========================================================================

  async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    fromSha: string
  ): Promise<void> {
    await this.octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: fromSha,
    });
  }

  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const { data } = await this.octokit.repos.get({ owner, repo });
    return data.default_branch;
  }

  async getLatestCommitSha(owner: string, repo: string, branch: string): Promise<string> {
    const { data } = await this.octokit.repos.getBranch({
      owner,
      repo,
      branch,
    });
    return data.commit.sha;
  }

  // ==========================================================================
  // Commit & PR Creation
  // ==========================================================================

  async createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    branch: string,
    existingSha?: string
  ): Promise<string> {
    const { data } = await this.octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
      sha: existingSha,
    });

    return data.commit.sha ?? '';
  }

  async createPullRequest(
    owner: string,
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string
  ): Promise<{ number: number; url: string }> {
    const { data } = await this.octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
    });

    return {
      number: data.number,
      url: data.html_url,
    };
  }

  async addLabels(owner: string, repo: string, issueNumber: number, labels: string[]): Promise<void> {
    await this.octokit.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels,
    });
  }

  // ==========================================================================
  // PR Comments (for Preview Feature)
  // ==========================================================================

  async createPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<{ id: number; url: string }> {
    const { data } = await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });

    return {
      id: data.id,
      url: data.html_url,
    };
  }

  async updatePRComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string
  ): Promise<void> {
    await this.octokit.issues.updateComment({
      owner,
      repo,
      comment_id: commentId,
      body,
    });
  }

  async findDocSynthComment(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<{ id: number; body: string } | null> {
    const { data: comments } = await this.octokit.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    });

    const docSynthComment = comments.find(
      (comment) =>
        comment.body?.includes('<!-- docsynth-preview -->') &&
        comment.user?.type === 'Bot'
    );

    if (docSynthComment) {
      return {
        id: docSynthComment.id,
        body: docSynthComment.body ?? '',
      };
    }

    return null;
  }

  // ==========================================================================
  // Installation Operations
  // ==========================================================================

  async getInstallation(installationId: number): Promise<GitHubInstallation> {
    const appOctokit = createAppOctokit();
    const { data } = await appOctokit.apps.getInstallation({
      installation_id: installationId,
    });

    return {
      id: data.id,
      account: {
        id: data.account?.id ?? 0,
        login: (data.account as { login?: string })?.login ?? 'unknown',
        type: data.target_type as 'User' | 'Organization',
        avatarUrl: (data.account as { avatar_url?: string })?.avatar_url ?? '',
      },
      repositorySelection: data.repository_selection as 'all' | 'selected',
      permissions: data.permissions as Record<string, string>,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  }

  async listInstallationRepos(): Promise<
    { id: number; fullName: string; name: string; private: boolean; defaultBranch: string }[]
  > {
    const repos: {
      id: number;
      fullName: string;
      name: string;
      private: boolean;
      defaultBranch: string;
    }[] = [];
    let page = 1;

    while (true) {
      const { data } = await this.octokit.apps.listReposAccessibleToInstallation({
        per_page: 100,
        page,
      });

      repos.push(
        ...data.repositories.map((repo) => ({
          id: repo.id,
          fullName: repo.full_name,
          name: repo.name,
          private: repo.private,
          defaultBranch: repo.default_branch,
        }))
      );

      if (data.repositories.length < 100) break;
      page++;
    }

    return repos;
  }
}

// ============================================================================
// OAuth Helpers
// ============================================================================

export interface OAuthTokenResponse {
  accessToken: string;
  tokenType: string;
  scope: string;
}

export async function exchangeCodeForToken(code: string): Promise<OAuthTokenResponse> {
  const config = getAppConfig();

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    throw new ExternalServiceError('GitHub OAuth');
  }

  const data = (await response.json()) as {
    access_token: string;
    token_type: string;
    scope: string;
  };

  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    scope: data.scope,
  };
}

export async function getUserFromToken(
  accessToken: string
): Promise<{ id: number; login: string; email: string | null; avatarUrl: string }> {
  const octokit = new Octokit({ auth: accessToken });
  const { data: user } = await octokit.users.getAuthenticated();

  let email: string | null = user.email;

  if (!email) {
    const { data: emails } = await octokit.users.listEmailsForAuthenticatedUser();
    const primaryEmail = emails.find((e) => e.primary);
    email = primaryEmail?.email ?? null;
  }

  return {
    id: user.id,
    login: user.login,
    email,
    avatarUrl: user.avatar_url,
  };
}

export { Octokit };
