/**
 * MCP Tools
 *
 * Exposes DocSynth capabilities as callable tools for AI agents.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DocsynthClient } from './client.js';

export function registerTools(server: McpServer, client: DocsynthClient): void {
  // ──────────────────────────────────────────────────────────────────────────
  // search-docs: Semantic search across documentation
  // ──────────────────────────────────────────────────────────────────────────

  server.tool(
    'search-docs',
    'Search documentation using semantic search with citations. Returns relevant documentation passages with source references.',
    {
      repositoryId: z.string().describe('The repository ID to search within'),
      query: z.string().describe('Natural language search query'),
    },
    async ({ repositoryId, query }) => {
      const result = await client.searchDocuments(repositoryId, query);
      return {
        content: [
          {
            type: 'text' as const,
            text: result.success
              ? JSON.stringify(result.data, null, 2)
              : `Search failed: ${result.error ?? 'Unknown error'}`,
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // check-doc-health: Get documentation health score
  // ──────────────────────────────────────────────────────────────────────────

  server.tool(
    'check-doc-health',
    'Check documentation health metrics for a repository including freshness, completeness, and accuracy scores.',
    {
      repositoryId: z.string().describe('The repository ID to check'),
    },
    async ({ repositoryId }) => {
      const result = await client.getHealthDashboard(repositoryId);
      return {
        content: [
          {
            type: 'text' as const,
            text: result.success
              ? JSON.stringify(result.data, null, 2)
              : `Health check failed: ${result.error ?? 'Unknown error'}`,
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // get-doc-coverage: Get documentation coverage report
  // ──────────────────────────────────────────────────────────────────────────

  server.tool(
    'get-doc-coverage',
    'Get documentation coverage report showing which exports, functions, and modules are documented vs undocumented.',
    {
      repositoryId: z.string().describe('The repository ID to check coverage for'),
    },
    async ({ repositoryId }) => {
      const result = await client.getCoverage(repositoryId);
      return {
        content: [
          {
            type: 'text' as const,
            text: result.success
              ? JSON.stringify(result.data, null, 2)
              : `Coverage check failed: ${result.error ?? 'Unknown error'}`,
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // trigger-doc-generation: Trigger documentation generation
  // ──────────────────────────────────────────────────────────────────────────

  server.tool(
    'trigger-doc-generation',
    'Trigger AI documentation generation for a repository. Supports README, API Reference, Changelog, Guide, Tutorial, Architecture, and ADR document types.',
    {
      repositoryId: z.string().describe('The repository ID to generate docs for'),
      docType: z
        .enum(['README', 'API_REFERENCE', 'CHANGELOG', 'GUIDE', 'TUTORIAL', 'ARCHITECTURE', 'ADR'])
        .optional()
        .describe('Document type to generate (default: README)'),
    },
    async ({ repositoryId, docType }) => {
      const result = await client.triggerGeneration(repositoryId, docType);
      return {
        content: [
          {
            type: 'text' as const,
            text: result.success
              ? `Documentation generation triggered. Job: ${JSON.stringify(result.data)}`
              : `Generation failed: ${result.error ?? 'Unknown error'}`,
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // get-drift-predictions: Check for documentation drift
  // ──────────────────────────────────────────────────────────────────────────

  server.tool(
    'get-drift-predictions',
    'Get predictions about which documentation sections are likely to become stale based on code change velocity.',
    {
      repositoryId: z.string().describe('The repository ID to check drift for'),
    },
    async ({ repositoryId }) => {
      const result = await client.getDriftPredictions(repositoryId);
      return {
        content: [
          {
            type: 'text' as const,
            text: result.success
              ? JSON.stringify(result.data, null, 2)
              : `Drift prediction failed: ${result.error ?? 'Unknown error'}`,
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // chat-with-docs: Ask questions about documentation
  // ──────────────────────────────────────────────────────────────────────────

  server.tool(
    'chat-with-docs',
    'Ask a natural language question about the repository documentation. Uses RAG to provide accurate, citation-backed answers.',
    {
      repositoryId: z.string().describe('The repository ID to query'),
      question: z.string().describe('The question to ask about the documentation'),
      sessionId: z.string().optional().describe('Optional session ID for conversation continuity'),
    },
    async ({ repositoryId, question, sessionId }) => {
      const result = await client.chatWithDocs(repositoryId, question, sessionId);
      return {
        content: [
          {
            type: 'text' as const,
            text: result.success
              ? JSON.stringify(result.data, null, 2)
              : `Chat failed: ${result.error ?? 'Unknown error'}`,
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // query-knowledge-graph: Explore code knowledge graph
  // ──────────────────────────────────────────────────────────────────────────

  server.tool(
    'query-knowledge-graph',
    'Query the code knowledge graph to find relationships between entities, modules, and concepts in the codebase.',
    {
      repositoryId: z.string().describe('The repository ID to query'),
      query: z.string().describe('Search query for knowledge graph entities'),
    },
    async ({ repositoryId, query }) => {
      const result = await client.queryKnowledgeGraph(repositoryId, query);
      return {
        content: [
          {
            type: 'text' as const,
            text: result.success
              ? JSON.stringify(result.data, null, 2)
              : `Knowledge graph query failed: ${result.error ?? 'Unknown error'}`,
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // list-repositories: List available repositories
  // ──────────────────────────────────────────────────────────────────────────

  server.tool(
    'list-repositories',
    'List all repositories connected to DocSynth for the organization.',
    {
      organizationId: z.string().describe('The organization ID'),
    },
    async ({ organizationId }) => {
      const result = await client.listRepositories(organizationId);
      return {
        content: [
          {
            type: 'text' as const,
            text: result.success
              ? JSON.stringify(result.data, null, 2)
              : `Failed to list repositories: ${result.error ?? 'Unknown error'}`,
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // get-document: Retrieve a specific document
  // ──────────────────────────────────────────────────────────────────────────

  server.tool(
    'get-document',
    'Retrieve the full content of a specific documentation document by ID.',
    {
      documentId: z.string().describe('The document ID to retrieve'),
    },
    async ({ documentId }) => {
      const result = await client.getDocument(documentId);
      return {
        content: [
          {
            type: 'text' as const,
            text: result.success
              ? JSON.stringify(result.data, null, 2)
              : `Failed to get document: ${result.error ?? 'Unknown error'}`,
          },
        ],
      };
    }
  );
}
