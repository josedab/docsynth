import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/types',
  'packages/config',
  'packages/utils',
  'packages/github',
  'packages/queue',
  'apps/api',
  'apps/worker',
  'apps/mcp-server',
]);
