import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JiraMCPClient } from '../services/jira-mcp.js';
import { SlackMCPClient } from '../services/slack-mcp.js';
import { LinearMCPClient } from '../services/linear-mcp.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('MCP Clients Integration Tests', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('JiraMCPClient Integration', () => {
    const client = new JiraMCPClient({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@example.com',
      apiToken: 'test-token',
      projectKey: 'TEST',
      rateLimitPerMinute: 100,
      cacheTtlMs: 60000,
    });

    it('should search issues successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issues: [
            {
              id: '10001',
              key: 'TEST-123',
              fields: {
                summary: 'Test Issue',
                description: { content: [{ content: [{ text: 'Description text' }] }] },
                status: { name: 'Open' },
                issuetype: { name: 'Bug' },
                priority: { name: 'High' },
                assignee: { displayName: 'John Doe' },
                reporter: { displayName: 'Jane Doe' },
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-15T00:00:00.000Z',
                labels: ['bug', 'critical'],
                comment: {
                  comments: [
                    {
                      id: 'c1',
                      author: { displayName: 'Commenter' },
                      body: { content: [{ content: [{ text: 'A comment' }] }] },
                      created: '2026-01-02T00:00:00.000Z',
                    },
                  ],
                },
              },
            },
          ],
          total: 1,
        }),
      });

      const result = await client.searchIssues('key = "TEST-123"', 1);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.key).toBe('TEST-123');
      expect(result.issues[0]?.summary).toBe('Test Issue');
      expect(result.issues[0]?.status).toBe('Open');
      expect(result.total).toBe(1);
    });

    it('should use cache for repeated getIssue calls', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          issues: [
            {
              id: '10001',
              key: 'TEST-456',
              fields: {
                summary: 'Cached Issue',
                description: null,
                status: { name: 'Done' },
                issuetype: { name: 'Task' },
                priority: { name: 'Low' },
                assignee: null,
                reporter: { displayName: 'Reporter' },
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-01T00:00:00.000Z',
                labels: [],
              },
            },
          ],
          total: 1,
        }),
      });

      // First call - should fetch
      const result1 = await client.getIssue('TEST-456');
      expect(result1.key).toBe('TEST-456');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result2 = await client.getIssue('TEST-456');
      expect(result2.key).toBe('TEST-456');
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1, used cache
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(client.searchIssues('invalid', 1)).rejects.toThrow('Jira API error');
    });

    it('should extract context for PR correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          issues: [
            {
              id: '10001',
              key: 'PROJ-789',
              fields: {
                summary: 'Feature Request',
                description: { content: [{ content: [{ text: 'Implement new feature' }] }] },
                status: { name: 'In Progress' },
                issuetype: { name: 'Story' },
                priority: { name: 'Medium' },
                assignee: { displayName: 'Dev' },
                reporter: { displayName: 'PM' },
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-10T00:00:00.000Z',
                labels: ['feature'],
              },
            },
          ],
          total: 1,
        }),
      });

      const context = await client.getContextForPR(
        'Implement feature PROJ-789',
        'This PR implements PROJ-789'
      );

      expect(context.issues).toHaveLength(1);
      expect(context.issues[0]?.key).toBe('PROJ-789');
      expect(context.summary).toContain('PROJ-789');
    });
  });

  describe('SlackMCPClient Integration', () => {
    const client = new SlackMCPClient({
      botToken: 'xoxb-test-token',
      defaultChannel: 'C123456',
      rateLimitPerMinute: 50,
      cacheTtlMs: 60000,
    });

    it('should search messages successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          messages: {
            matches: [
              {
                ts: '1234567890.123456',
                channel: { id: 'C123', name: 'general' },
                user: 'U123',
                username: 'testuser',
                text: 'Test message about feature',
                permalink: 'https://slack.com/archives/C123/p1234567890',
              },
            ],
            total: 1,
          },
        }),
      });

      const result = await client.searchMessages('feature', 10);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.text).toBe('Test message about feature');
      expect(result.messages[0]?.channelName).toBe('general');
      expect(result.total).toBe(1);
    });

    it('should cache channel info', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          channel: {
            id: 'C999',
            name: 'dev-channel',
            is_private: false,
            topic: { value: 'Development discussions' },
            purpose: { value: 'Dev talk' },
          },
        }),
      });

      // First call
      const info1 = await client.getChannelInfo('C999');
      expect(info1.name).toBe('dev-channel');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const info2 = await client.getChannelInfo('C999');
      expect(info2.name).toBe('dev-channel');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle Slack API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'channel_not_found',
        }),
      });

      await expect(client.getChannelInfo('invalid')).rejects.toThrow('Slack API error');
    });

    it('should post messages successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          ts: '1234567890.999999',
          channel: 'C123',
          message: { text: 'Hello world' },
        }),
      });

      const result = await client.postMessage('C123', 'Hello world');

      expect(result.ts).toBe('1234567890.999999');
      expect(result.text).toBe('Hello world');
    });
  });

  describe('LinearMCPClient Integration', () => {
    it('should fetch teams successfully', async () => {
      const client = new LinearMCPClient({
        apiKey: 'lin_api_test',
        teamId: 'team-123',
        rateLimitPerMinute: 25,
        cacheTtlMs: 60000,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            teams: {
              nodes: [
                { id: 't1', name: 'Engineering', key: 'ENG' },
                { id: 't2', name: 'Design', key: 'DES' },
              ],
            },
          },
        }),
      });

      const teams = await client.getTeams();

      expect(teams).toHaveLength(2);
      expect(teams[0]?.name).toBe('Engineering');
      expect(teams[1]?.key).toBe('DES');
    });

    it('should cache teams', async () => {
      const client = new LinearMCPClient({
        apiKey: 'lin_api_test_cache',
        teamId: 'team-456',
        rateLimitPerMinute: 25,
        cacheTtlMs: 60000,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            teams: {
              nodes: [{ id: 't1', name: 'Cached Team', key: 'CT' }],
            },
          },
        }),
      });

      // First call
      const teams1 = await client.getTeams();
      expect(teams1).toHaveLength(1);
      const callCountAfterFirst = mockFetch.mock.calls.length;

      // Second call - should use cache
      const teams2 = await client.getTeams();
      expect(teams2).toHaveLength(1);
      expect(mockFetch.mock.calls.length).toBe(callCountAfterFirst); // No additional calls
    });

    it('should search issues with filters', async () => {
      const client = new LinearMCPClient({
        apiKey: 'lin_api_test_search',
        teamId: 'team-789',
        rateLimitPerMinute: 25,
        cacheTtlMs: 60000,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            issues: {
              nodes: [
                {
                  id: 'i1',
                  identifier: 'ENG-100',
                  title: 'Test Issue',
                  description: 'A test issue',
                  state: { name: 'Todo' },
                  priority: 2,
                  priorityLabel: 'High',
                  assignee: { name: 'Dev' },
                  creator: { name: 'PM' },
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-10T00:00:00.000Z',
                  labels: { nodes: [{ name: 'bug' }] },
                  url: 'https://linear.app/team/issue/ENG-100',
                  comments: { nodes: [] },
                },
              ],
            },
          },
        }),
      });

      const issues = await client.searchIssues('test');

      expect(issues).toHaveLength(1);
      expect(issues[0]?.identifier).toBe('ENG-100');
      expect(issues[0]?.state).toBe('Todo');
    });

    it('should handle GraphQL errors', async () => {
      const client = new LinearMCPClient({
        apiKey: 'lin_api_test_gql_error',
        teamId: 'team-error',
        rateLimitPerMinute: 25,
        cacheTtlMs: 1, // Very short cache to avoid interference
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errors: [{ message: 'Invalid query' }],
        }),
      });

      await expect(client.getTeams()).rejects.toThrow('Linear GraphQL error');
    });

    it('should handle HTTP errors', async () => {
      const client = new LinearMCPClient({
        apiKey: 'lin_api_test_http_error',
        teamId: 'team-http-error',
        rateLimitPerMinute: 25,
        cacheTtlMs: 1, // Very short cache to avoid interference
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(client.getTeams()).rejects.toThrow('Linear API error');
    });
  });
});
