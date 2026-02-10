import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocsynthClient } from '../client.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('DocsynthClient', () => {
  let client: DocsynthClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new DocsynthClient('http://localhost:3001', 'test-token');
  });

  const mockResponse = (data: unknown) => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ success: true, data }),
    });
  };

  it('should call health endpoint', async () => {
    mockResponse({ status: 'ok' });
    const result = await client.getHealth();

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/health',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
    expect(result.success).toBe(true);
  });

  it('should call search endpoint with correct params', async () => {
    mockResponse({ results: [] });
    await client.searchDocuments('repo-1', 'how does auth work');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/citations/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repositoryId: 'repo-1',
          query: 'how does auth work',
          limit: 10,
        }),
      })
    );
  });

  it('should call health dashboard for a repository', async () => {
    mockResponse({ score: 85 });
    const result = await client.getHealthDashboard('repo-1');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/health-dashboard/repo-1',
      expect.any(Object)
    );
    expect(result.data).toEqual({ score: 85 });
  });

  it('should call coverage endpoint', async () => {
    mockResponse({ coveragePercent: 75 });
    await client.getCoverage('repo-1');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/coverage/repo-1',
      expect.any(Object)
    );
  });

  it('should call drift predictions endpoint', async () => {
    mockResponse({ predictions: [] });
    await client.getDriftPredictions('repo-1');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/drift-prediction/repo-1',
      expect.any(Object)
    );
  });

  it('should trigger doc generation', async () => {
    mockResponse({ jobId: 'job-1' });
    await client.triggerGeneration('repo-1', 'API_REFERENCE');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/jobs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repositoryId: 'repo-1',
          type: 'doc-generation',
          docType: 'API_REFERENCE',
        }),
      })
    );
  });

  it('should send chat message', async () => {
    mockResponse({ answer: 'The auth uses JWT tokens.' });
    await client.chatWithDocs('repo-1', 'How does auth work?', 'session-1');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/chat',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repositoryId: 'repo-1',
          message: 'How does auth work?',
          sessionId: 'session-1',
        }),
      })
    );
  });

  it('should list repositories', async () => {
    mockResponse({ repositories: [] });
    await client.listRepositories('org-1');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/repositories?organizationId=org-1',
      expect.any(Object)
    );
  });

  it('should not include auth header when token is empty', async () => {
    const noAuthClient = new DocsynthClient('http://localhost:3001', '');
    mockResponse({});
    await noAuthClient.getHealth();

    const calledHeaders = mockFetch.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(calledHeaders['Authorization']).toBeUndefined();
  });
});
