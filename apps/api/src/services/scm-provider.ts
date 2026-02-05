// ============================================================================
// SCM Provider Interface & Types
// ============================================================================
// This module defines the abstraction layer for Source Code Management providers
// (GitHub, GitLab, Bitbucket). It provides a unified interface to interact with
// different SCM platforms, enabling DocSynth to work across multiple providers.

export type SCMProviderType = 'github' | 'gitlab' | 'bitbucket';

// ============================================================================
// Main Provider Interface
// ============================================================================

export interface SCMProvider {
  type: SCMProviderType;

  // Repository operations
  getRepository(owner: string, repo: string): Promise<SCMRepository>;
  getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<SCMFileContent>;
  listFiles(owner: string, repo: string, path?: string, ref?: string): Promise<SCMFile[]>;

  // Pull/Merge Request operations
  getPullRequest(owner: string, repo: string, prNumber: number): Promise<SCMPullRequest>;
  listPullRequests(owner: string, repo: string, state?: string): Promise<SCMPullRequest[]>;
  getPRFiles(owner: string, repo: string, prNumber: number): Promise<SCMChangedFile[]>;
  createPRComment(owner: string, repo: string, prNumber: number, body: string): Promise<void>;

  // Commit operations
  getCommit(owner: string, repo: string, sha: string): Promise<SCMCommit>;
  listCommits(owner: string, repo: string, since?: Date): Promise<SCMCommit[]>;
  compareCommits(owner: string, repo: string, base: string, head: string): Promise<SCMComparison>;

  // Webhook operations
  parseWebhookPayload(headers: Record<string, string>, body: unknown): SCMWebhookEvent | null;
  verifyWebhookSignature(headers: Record<string, string>, body: string, secret: string): boolean;

  // Check/Status operations
  createCheckRun(owner: string, repo: string, data: SCMCheckRunInput): Promise<SCMCheckRun>;
  updateCheckRun(
    owner: string,
    repo: string,
    checkRunId: number,
    data: Partial<SCMCheckRunInput>
  ): Promise<void>;
}

// ============================================================================
// Repository Types
// ============================================================================

export interface SCMRepository {
  id: number;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  language: string | null;
  url: string;
}

// ============================================================================
// Pull/Merge Request Types
// ============================================================================

export interface SCMPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  author: string;
  baseBranch: string;
  headBranch: string;
  mergedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SCMChangedFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  patch?: string;
}

// ============================================================================
// Commit Types
// ============================================================================

export interface SCMCommit {
  sha: string;
  message: string;
  author: string;
  date: Date;
  files?: string[];
}

export interface SCMComparison {
  ahead: number;
  behind: number;
  commits: SCMCommit[];
  files: SCMChangedFile[];
}

// ============================================================================
// File Types
// ============================================================================

export interface SCMFileContent {
  path: string;
  content: string;
  encoding: string;
  sha: string;
}

export interface SCMFile {
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface SCMWebhookEvent {
  type: 'push' | 'pull_request' | 'merge_request' | 'comment';
  action?: string;
  repository: {
    owner: string;
    name: string;
    fullName: string;
  };
  payload: Record<string, unknown>;
}

// ============================================================================
// Check/Status Types
// ============================================================================

export interface SCMCheckRunInput {
  name: string;
  headSha: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral';
  title?: string;
  summary?: string;
}

export interface SCMCheckRun {
  id: number;
  name: string;
  status: string;
}
