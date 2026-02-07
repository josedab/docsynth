import { describe, it, expect } from 'vitest';
import {
  detectProvider,
  parseRepoUrl,
  isSupportedProvider,
  getSupportedProviders,
  getProviderCapabilities,
} from '../../services/scm-provider-factory.js';

describe('SCM Provider Factory', () => {
  describe('detectProvider', () => {
    it('should detect GitHub from HTTPS URL', () => {
      expect(detectProvider('https://github.com/owner/repo')).toBe('github');
    });

    it('should detect GitHub from SSH URL', () => {
      expect(detectProvider('git@github.com:owner/repo.git')).toBe('github');
    });

    it('should detect GitLab from HTTPS URL', () => {
      expect(detectProvider('https://gitlab.com/owner/repo')).toBe('gitlab');
    });

    it('should detect GitLab from SSH URL', () => {
      expect(detectProvider('git@gitlab.com:owner/repo.git')).toBe('gitlab');
    });

    it('should detect GitLab from self-hosted URL', () => {
      expect(detectProvider('https://gitlab.example.com/owner/repo')).toBe('gitlab');
    });

    it('should detect Bitbucket from HTTPS URL', () => {
      expect(detectProvider('https://bitbucket.org/owner/repo')).toBe('bitbucket');
    });

    it('should detect Bitbucket from SSH URL', () => {
      expect(detectProvider('git@bitbucket.org:owner/repo.git')).toBe('bitbucket');
    });

    it('should throw error for unknown provider', () => {
      expect(() => detectProvider('https://example.com/owner/repo')).toThrow(
        'Unable to detect SCM provider'
      );
    });
  });

  describe('parseRepoUrl', () => {
    it('should parse HTTPS URL', () => {
      const result = parseRepoUrl('https://github.com/owner/repo');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should parse HTTPS URL with .git extension', () => {
      const result = parseRepoUrl('https://github.com/owner/repo.git');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should parse SSH URL', () => {
      const result = parseRepoUrl('git@github.com:owner/repo.git');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should parse SSH URL without .git extension', () => {
      const result = parseRepoUrl('git@github.com:owner/repo');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should throw error for invalid URL format', () => {
      expect(() => parseRepoUrl('invalid-url')).toThrow('Invalid repository URL format');
    });
  });

  describe('isSupportedProvider', () => {
    it('should return true for github', () => {
      expect(isSupportedProvider('github')).toBe(true);
    });

    it('should return true for gitlab', () => {
      expect(isSupportedProvider('gitlab')).toBe(true);
    });

    it('should return true for bitbucket', () => {
      expect(isSupportedProvider('bitbucket')).toBe(true);
    });

    it('should return false for unknown provider', () => {
      expect(isSupportedProvider('unknown')).toBe(false);
    });
  });

  describe('getSupportedProviders', () => {
    it('should return all supported providers', () => {
      const providers = getSupportedProviders();
      expect(providers).toEqual(['github', 'gitlab', 'bitbucket']);
    });
  });

  describe('getProviderCapabilities', () => {
    it('should return GitHub capabilities', () => {
      const capabilities = getProviderCapabilities('github');
      expect(capabilities).toEqual({
        name: 'GitHub',
        checkRuns: true,
        webhookSignatureVerification: true,
        fileOperations: true,
        prOperations: true,
        commitOperations: true,
      });
    });

    it('should return GitLab capabilities', () => {
      const capabilities = getProviderCapabilities('gitlab');
      expect(capabilities).toEqual({
        name: 'GitLab',
        checkRuns: true,
        webhookSignatureVerification: true,
        fileOperations: true,
        prOperations: true,
        commitOperations: true,
      });
    });

    it('should return Bitbucket capabilities', () => {
      const capabilities = getProviderCapabilities('bitbucket');
      expect(capabilities).toEqual({
        name: 'Bitbucket',
        checkRuns: true,
        webhookSignatureVerification: false,
        fileOperations: true,
        prOperations: true,
        commitOperations: true,
      });
    });
  });
});
