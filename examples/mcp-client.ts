/**
 * DocSynth MCP Client Example
 *
 * Demonstrates how an AI agent connects to the DocSynth MCP server
 * and uses its tools, resources, and prompts.
 *
 * Prerequisites:
 *   1. Build the project: npm run build
 *   2. Start the API server: npm run dev
 *
 * Run: npx tsx examples/mcp-client.ts
 */

import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const MCP_SERVER_PATH = 'apps/mcp-server/dist/index.js';

async function main() {
  console.log('DocSynth MCP Client Example');
  console.log('='.repeat(50));
  console.log('');

  if (!existsSync(MCP_SERVER_PATH)) {
    console.error(`❌ MCP server not built: ${MCP_SERVER_PATH} not found.`);
    console.error('   Build it first with: npm run build');
    process.exit(1);
  }

  // ── Connect to MCP Server ──────────────────────────────────────────────

  console.log('Connecting to DocSynth MCP server...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [MCP_SERVER_PATH],
    env: {
      ...process.env,
      DOCSYNTH_API_URL: process.env.DOCSYNTH_API_URL ?? 'http://localhost:3001',
      DOCSYNTH_API_TOKEN: process.env.DOCSYNTH_API_TOKEN ?? '',
    },
  });

  const client = new Client({
    name: 'example-mcp-client',
    version: '1.0.0',
  });

  await client.connect(transport);
  console.log('Connected!\n');

  // ── List Available Tools ───────────────────────────────────────────────

  console.log('1. Available Tools:');
  const tools = await client.listTools();
  for (const tool of tools.tools) {
    console.log(`   - ${tool.name}: ${tool.description}`);
  }
  console.log('');

  // ── List Available Resources ───────────────────────────────────────────

  console.log('2. Available Resources:');
  const resources = await client.listResources();
  for (const resource of resources.resources) {
    console.log(`   - ${resource.uri}: ${resource.name}`);
  }
  console.log('');

  // ── List Available Prompts ─────────────────────────────────────────────

  console.log('3. Available Prompts:');
  const prompts = await client.listPrompts();
  for (const prompt of prompts.prompts) {
    console.log(`   - ${prompt.name}: ${prompt.description}`);
  }
  console.log('');

  // ── Call search-docs Tool ──────────────────────────────────────────────

  console.log('4. Searching docs for "authentication"...');
  try {
    const result = await client.callTool({
      name: 'search-docs',
      arguments: {
        query: 'authentication',
      },
    });
    console.log('   Result:', JSON.stringify(result, null, 2));
  } catch {
    console.log('   (requires seed data - run: npm run db:seed)');
  }
  console.log('');

  // ── Call check-doc-health Tool ─────────────────────────────────────────

  console.log('5. Checking documentation health...');
  try {
    const result = await client.callTool({
      name: 'check-doc-health',
      arguments: {},
    });
    console.log('   Result:', JSON.stringify(result, null, 2));
  } catch {
    console.log('   (requires seed data - run: npm run db:seed)');
  }
  console.log('');

  // ── Cleanup ────────────────────────────────────────────────────────────

  await client.close();
  console.log('Done!');
}

main().catch(console.error);
