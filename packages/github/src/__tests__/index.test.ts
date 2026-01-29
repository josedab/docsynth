import { describe, it, expect } from 'vitest';
import { GitHubClient } from '../index.js';

describe('GitHubClient', () => {
  it('should be exported', () => {
    expect(GitHubClient).toBeDefined();
  });

  it('should have static forInstallation method', () => {
    expect(GitHubClient.forInstallation).toBeDefined();
    expect(typeof GitHubClient.forInstallation).toBe('function');
  });
});
