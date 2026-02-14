import { describe, it, expect } from 'vitest';
import { getLoginUrl } from '../lib/api.js';

describe('Web App - API utilities', () => {
  it('getLoginUrl returns the correct auth URL', () => {
    const url = getLoginUrl();
    expect(url).toContain('/auth/github/url');
    expect(url).toMatch(/^https?:\/\//);
  });

  it('getLoginUrl uses default API URL when env var is not set', () => {
    const url = getLoginUrl();
    expect(url).toBe('http://localhost:3001/auth/github/url');
  });
});
