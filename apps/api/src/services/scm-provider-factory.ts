// ============================================================================
// SCM Provider Factory
// ============================================================================
// This module provides factory functions to create SCM provider instances
// and detect which provider to use based on repository URLs.

import { ValidationError } from '@docsynth/utils';
import type { SCMProvider, SCMProviderType } from './scm-provider.js';
import { GitHubProvider, type GitHubProviderConfig } from './providers/github.provider.js';
import { GitLabProvider, type GitLabProviderConfig } from './providers/gitlab.provider.js';
import { BitbucketProvider, type BitbucketProviderConfig } from './providers/bitbucket.provider.js';

// ============================================================================
// Provider Configuration Types
// ============================================================================

export type ProviderConfig = GitHubProviderConfig | GitLabProviderConfig | BitbucketProviderConfig;

export interface ProviderConfigWithType {
  type: SCMProviderType;
  config: ProviderConfig;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates an SCM provider instance based on the provider type and configuration
 *
 * @param type - The SCM provider type (github, gitlab, bitbucket)
 * @param config - Provider-specific configuration
 * @returns An instance of the SCM provider
 * @throws {ValidationError} If the provider type is not supported
 *
 * @example
 * ```typescript
 * const provider = createSCMProvider('github', {
 *   installationId: 12345,
 * });
 * ```
 */
export function createSCMProvider(type: SCMProviderType, config: ProviderConfig): SCMProvider {
  switch (type) {
    case 'github':
      return new GitHubProvider(config as GitHubProviderConfig);
    case 'gitlab':
      return new GitLabProvider(config as GitLabProviderConfig);
    case 'bitbucket':
      return new BitbucketProvider(config as BitbucketProviderConfig);
    default:
      throw new ValidationError(`Unsupported SCM provider type: ${type as string}`);
  }
}

// ============================================================================
// Provider Detection
// ============================================================================

/**
 * Detects the SCM provider type from a repository URL
 *
 * @param repoUrl - The repository URL (HTTPS or SSH)
 * @returns The detected provider type
 * @throws {ValidationError} If the provider cannot be detected from the URL
 *
 * @example
 * ```typescript
 * detectProvider('https://github.com/owner/repo') // => 'github'
 * detectProvider('git@gitlab.com:owner/repo.git') // => 'gitlab'
 * detectProvider('https://bitbucket.org/owner/repo') // => 'bitbucket'
 * ```
 */
export function detectProvider(repoUrl: string): SCMProviderType {
  const url = repoUrl.toLowerCase().trim();

  // GitHub patterns
  if (
    url.includes('github.com') ||
    url.startsWith('git@github.com:') ||
    url.match(/^https?:\/\/github\.com\//)
  ) {
    return 'github';
  }

  // GitLab patterns
  if (
    url.includes('gitlab.com') ||
    url.includes('gitlab.') ||
    url.startsWith('git@gitlab.com:') ||
    url.match(/^https?:\/\/gitlab\./)
  ) {
    return 'gitlab';
  }

  // Bitbucket patterns
  if (
    url.includes('bitbucket.org') ||
    url.includes('bitbucket.') ||
    url.startsWith('git@bitbucket.org:') ||
    url.match(/^https?:\/\/bitbucket\.org\//)
  ) {
    return 'bitbucket';
  }

  throw new ValidationError(`Unable to detect SCM provider from URL: ${repoUrl}`);
}

/**
 * Parses a repository URL to extract owner and repo name
 *
 * @param repoUrl - The repository URL
 * @returns An object containing the owner and repo name
 * @throws {ValidationError} If the URL format is invalid
 *
 * @example
 * ```typescript
 * parseRepoUrl('https://github.com/owner/repo')
 * // => { owner: 'owner', repo: 'repo' }
 *
 * parseRepoUrl('git@github.com:owner/repo.git')
 * // => { owner: 'owner', repo: 'repo' }
 * ```
 */
export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const url = repoUrl.trim();

  // SSH format: git@host:owner/repo.git
  const sshMatch = url.match(/^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return {
      owner: sshMatch[1] ?? '',
      repo: sshMatch[2] ?? '',
    };
  }

  // HTTPS format: https://host/owner/repo or https://host/owner/repo.git
  const httpsMatch = url.match(/^https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return {
      owner: httpsMatch[1] ?? '',
      repo: httpsMatch[2] ?? '',
    };
  }

  throw new ValidationError(`Invalid repository URL format: ${repoUrl}`);
}

/**
 * Checks if a provider type is supported
 *
 * @param type - The provider type to check
 * @returns True if the provider is supported
 */
export function isSupportedProvider(type: string): type is SCMProviderType {
  return type === 'github' || type === 'gitlab' || type === 'bitbucket';
}

/**
 * Gets a list of all supported provider types
 *
 * @returns An array of supported provider types
 */
export function getSupportedProviders(): SCMProviderType[] {
  return ['github', 'gitlab', 'bitbucket'];
}

/**
 * Gets provider capabilities and features
 *
 * @param type - The provider type
 * @returns An object describing the provider's capabilities
 */
export function getProviderCapabilities(type: SCMProviderType): {
  name: string;
  checkRuns: boolean;
  webhookSignatureVerification: boolean;
  fileOperations: boolean;
  prOperations: boolean;
  commitOperations: boolean;
} {
  switch (type) {
    case 'github':
      return {
        name: 'GitHub',
        checkRuns: true,
        webhookSignatureVerification: true,
        fileOperations: true,
        prOperations: true,
        commitOperations: true,
      };
    case 'gitlab':
      return {
        name: 'GitLab',
        checkRuns: true, // Uses commit statuses
        webhookSignatureVerification: true,
        fileOperations: true,
        prOperations: true, // Called Merge Requests in GitLab
        commitOperations: true,
      };
    case 'bitbucket':
      return {
        name: 'Bitbucket',
        checkRuns: true, // Uses build statuses
        webhookSignatureVerification: false, // Limited webhook signature support
        fileOperations: true,
        prOperations: true,
        commitOperations: true,
      };
  }
}
