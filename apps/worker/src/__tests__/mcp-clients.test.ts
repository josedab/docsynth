import { describe, it, expect } from 'vitest';
import { JiraMCPClient } from '../services/jira-mcp.js';
import { SlackMCPClient } from '../services/slack-mcp.js';
import { LinearMCPClient } from '../services/linear-mcp.js';

describe('MCP Clients', () => {
  describe('JiraMCPClient', () => {
    it('should instantiate with config', () => {
      const client = new JiraMCPClient({
        baseUrl: 'https://example.atlassian.net',
        email: 'test@example.com',
        apiToken: 'test-token',
        projectKey: 'TEST',
      });
      expect(client).toBeInstanceOf(JiraMCPClient);
    });

    it('should extract issue keys from text', () => {
      const client = new JiraMCPClient({
        baseUrl: 'https://example.atlassian.net',
        email: 'test@example.com',
        apiToken: 'test-token',
      });

      const text = 'Fixes PROJ-123 and relates to PROJ-456, TEST-789';
      const keys = client.extractIssueKeys(text);

      expect(keys).toContain('PROJ-123');
      expect(keys).toContain('PROJ-456');
      expect(keys).toContain('TEST-789');
      expect(keys).toHaveLength(3);
    });

    it('should return empty array for text without issue keys', () => {
      const client = new JiraMCPClient({
        baseUrl: 'https://example.atlassian.net',
        email: 'test@example.com',
        apiToken: 'test-token',
      });

      const text = 'This is a regular commit message without issue references';
      const keys = client.extractIssueKeys(text);

      expect(keys).toHaveLength(0);
    });

    it('should deduplicate issue keys', () => {
      const client = new JiraMCPClient({
        baseUrl: 'https://example.atlassian.net',
        email: 'test@example.com',
        apiToken: 'test-token',
      });

      const text = 'PROJ-123 is fixed, see PROJ-123 for details';
      const keys = client.extractIssueKeys(text);

      expect(keys).toEqual(['PROJ-123']);
    });
  });

  describe('SlackMCPClient', () => {
    it('should instantiate with config', () => {
      const client = new SlackMCPClient({
        botToken: 'xoxb-test-token',
        defaultChannel: 'C123456',
      });
      expect(client).toBeInstanceOf(SlackMCPClient);
    });

    it('should instantiate without default channel', () => {
      const client = new SlackMCPClient({
        botToken: 'xoxb-test-token',
      });
      expect(client).toBeInstanceOf(SlackMCPClient);
    });
  });

  describe('LinearMCPClient', () => {
    it('should instantiate with config', () => {
      const client = new LinearMCPClient({
        apiKey: 'lin_api_test_key',
        teamId: 'team-123',
      });
      expect(client).toBeInstanceOf(LinearMCPClient);
    });

    it('should instantiate without team ID', () => {
      const client = new LinearMCPClient({
        apiKey: 'lin_api_test_key',
      });
      expect(client).toBeInstanceOf(LinearMCPClient);
    });

    it('should extract issue identifiers from text', () => {
      const client = new LinearMCPClient({
        apiKey: 'lin_api_test_key',
      });

      const text = 'Implements ENG-123 and fixes BUG-456';
      const identifiers = client.extractIssueIdentifiers(text);

      expect(identifiers).toContain('ENG-123');
      expect(identifiers).toContain('BUG-456');
      expect(identifiers).toHaveLength(2);
    });

    it('should return empty array for text without identifiers', () => {
      const client = new LinearMCPClient({
        apiKey: 'lin_api_test_key',
      });

      const text = 'Regular text without issue references';
      const identifiers = client.extractIssueIdentifiers(text);

      expect(identifiers).toHaveLength(0);
    });
  });
});
