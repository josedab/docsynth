import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/types',
  'packages/config',
  'packages/utils',
  'packages/github',
  'packages/queue',
  'packages/core',
  'packages/github-action',
  'apps/api',
  'apps/worker',
  'apps/mcp-server',
  'apps/cli',
  'apps/web',
]);
