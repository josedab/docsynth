#!/usr/bin/env node

/**
 * DocSynth MCP Server
 *
 * Exposes DocSynth documentation capabilities via the Model Context Protocol,
 * enabling AI coding agents (Claude Code, Cursor, Windsurf) to query
 * documentation health, trigger generation, and search knowledge graphs.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';
import { DocsynthClient } from './client.js';

const API_BASE_URL = process.env.DOCSYNTH_API_URL ?? 'http://localhost:3001';
const API_TOKEN = process.env.DOCSYNTH_API_TOKEN ?? '';

async function main() {
  const server = new McpServer({
    name: 'docsynth',
    version: '0.1.0',
  });

  const client = new DocsynthClient(API_BASE_URL, API_TOKEN);

  registerTools(server, client);
  registerResources(server, client);
  registerPrompts(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error starting MCP server:', error);
  process.exit(1);
});
