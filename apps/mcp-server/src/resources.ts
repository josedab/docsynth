/**
 * MCP Resources
 *
 * Exposes DocSynth documentation as browseable resources for AI agents.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DocsynthClient } from './client.js';

export function registerResources(server: McpServer, client: DocsynthClient): void {
  // ──────────────────────────────────────────────────────────────────────────
  // docsynth://docs/{documentId} - Individual document content
  // ──────────────────────────────────────────────────────────────────────────

  server.resource(
    'document',
    'docsynth://docs/{documentId}',
    {
      description: 'Retrieve a DocSynth document by ID',
      mimeType: 'application/json',
    },
    async (uri) => {
      const documentId = uri.pathname.split('/').pop() ?? '';
      const result = await client.getDocument(documentId);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(result.data ?? { error: result.error }, null, 2),
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // docsynth://repos/{repositoryId}/health - Repository health summary
  // ──────────────────────────────────────────────────────────────────────────

  server.resource(
    'repository-health',
    'docsynth://repos/{repositoryId}/health',
    {
      description: 'Get documentation health summary for a repository',
      mimeType: 'application/json',
    },
    async (uri) => {
      const parts = uri.pathname.split('/');
      const repositoryId = parts[2] ?? '';
      const result = await client.getHealthDashboard(repositoryId);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(result.data ?? { error: result.error }, null, 2),
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // docsynth://repos/{repositoryId}/coverage - Coverage report
  // ──────────────────────────────────────────────────────────────────────────

  server.resource(
    'repository-coverage',
    'docsynth://repos/{repositoryId}/coverage',
    {
      description: 'Get documentation coverage report for a repository',
      mimeType: 'application/json',
    },
    async (uri) => {
      const parts = uri.pathname.split('/');
      const repositoryId = parts[2] ?? '';
      const result = await client.getCoverage(repositoryId);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(result.data ?? { error: result.error }, null, 2),
          },
        ],
      };
    }
  );
}
