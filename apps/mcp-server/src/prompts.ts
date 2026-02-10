/**
 * MCP Prompts
 *
 * Pre-built prompt templates for common documentation workflows.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DocsynthClient } from './client.js';

export function registerPrompts(server: McpServer, client: DocsynthClient): void {
  // ──────────────────────────────────────────────────────────────────────────
  // document-function: Generate documentation for a function
  // ──────────────────────────────────────────────────────────────────────────

  server.prompt(
    'document-function',
    'Generate documentation for a specific function, including parameters, return values, examples, and edge cases.',
    {
      functionName: z.string().describe('The name of the function to document'),
      functionCode: z.string().describe('The source code of the function'),
      repositoryId: z.string().optional().describe('Repository ID for context'),
    },
    async ({ functionName, functionCode, repositoryId }) => {
      let context = '';
      if (repositoryId) {
        const health = await client.getHealthDashboard(repositoryId);
        if (health.success) {
          context = `\n\nRepository health context: ${JSON.stringify(health.data)}`;
        }
      }

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Generate comprehensive documentation for the following function.

## Function: ${functionName}

\`\`\`
${functionCode}
\`\`\`

Please include:
1. A clear description of what this function does
2. Parameter documentation with types and descriptions
3. Return value documentation
4. At least 2 usage examples
5. Edge cases and error handling notes
6. Any relevant related functions or types${context}`,
            },
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // review-docs: Review documentation quality
  // ──────────────────────────────────────────────────────────────────────────

  server.prompt(
    'review-docs',
    'Review and suggest improvements for existing documentation content.',
    {
      documentation: z.string().describe('The documentation content to review'),
      docType: z
        .enum(['readme', 'api-reference', 'guide', 'tutorial', 'adr'])
        .optional()
        .describe('Type of documentation'),
    },
    async ({ documentation, docType }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Review the following ${docType ?? 'documentation'} for quality, accuracy, and completeness.

## Documentation to Review

${documentation}

Please evaluate and provide specific suggestions for:
1. **Clarity**: Is the writing clear and unambiguous?
2. **Completeness**: Are there missing sections or gaps?
3. **Accuracy**: Are code examples correct and up-to-date?
4. **Structure**: Is the organization logical and scannable?
5. **Examples**: Are there enough practical examples?
6. **Terminology**: Is technical vocabulary used consistently?

Provide a quality score (1-10) and prioritized list of improvements.`,
            },
          },
        ],
      };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // explain-codebase: Explain codebase architecture using docs
  // ──────────────────────────────────────────────────────────────────────────

  server.prompt(
    'explain-codebase',
    'Explain the architecture and key concepts of a codebase using its documentation and knowledge graph.',
    {
      repositoryId: z.string().describe('Repository ID to explain'),
      focusArea: z.string().optional().describe('Specific area to focus on (e.g., "authentication", "data layer")'),
    },
    async ({ repositoryId, focusArea }) => {
      const [docs, health] = await Promise.all([
        client.listDocuments(repositoryId),
        client.getHealthDashboard(repositoryId),
      ]);

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Based on the following documentation inventory and health data, explain the architecture of this codebase${focusArea ? ` with a focus on: ${focusArea}` : ''}.

## Available Documentation
${JSON.stringify(docs.data, null, 2)}

## Health Metrics
${JSON.stringify(health.data, null, 2)}

Please provide:
1. A high-level architecture overview
2. Key components and their responsibilities
3. Data flow and dependencies
4. Important patterns and conventions
5. ${focusArea ? `Deep dive into: ${focusArea}` : 'Areas that need better documentation'}`,
            },
          },
        ],
      };
    }
  );
}
