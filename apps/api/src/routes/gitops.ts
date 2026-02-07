/**
 * GitOps Configuration Routes
 *
 * API endpoints for managing .docsynth/ directory-based configuration.
 * Supports validating, parsing, diffing, and applying GitOps configs.
 */

import { Hono } from 'hono';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { ValidationError } from '@docsynth/utils';
import { prisma } from '@docsynth/database';
import {
  validateConfig,
  parseYAMLConfig,
  diffConfigs,
  generateScaffoldConfig,
  DEFAULT_CONFIG,
  type GitOpsConfig,
} from '../services/gitops-config.service.js';

const app = new Hono();

// ============================================================================
// Get Scaffold Config
// ============================================================================

app.get('/scaffold', async (c) => {
  const format = c.req.query('format') ?? 'yaml';

  if (format === 'yaml') {
    return c.text(generateScaffoldConfig(), 200, {
      'Content-Type': 'text/yaml',
      'Content-Disposition': 'attachment; filename="docsynth.yml"',
    });
  }

  return c.json({
    success: true,
    data: DEFAULT_CONFIG,
  });
});

// ============================================================================
// Validate Config
// ============================================================================

app.post('/validate', async (c) => {
  const body = await c.req.json<{ config: unknown; format?: 'json' | 'yaml' }>();

  let config: unknown;
  if (body.format === 'yaml' && typeof body.config === 'string') {
    config = parseYAMLConfig(body.config);
  } else {
    config = body.config;
  }

  const result = validateConfig(config);

  return c.json({
    success: true,
    data: result,
  });
});

// ============================================================================
// Get Repository Config
// ============================================================================

app.get('/:repositoryId', requireAuth, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { id: true, config: true, metadata: true },
  });

  if (!repository) {
    throw new ValidationError('Repository not found');
  }

  const metadata = repository.metadata as Record<string, unknown> | null;
  const gitopsConfig = (metadata?.gitopsConfig as GitOpsConfig) ?? DEFAULT_CONFIG;

  return c.json({
    success: true,
    data: {
      repositoryId,
      config: gitopsConfig,
      isCustom: !!metadata?.gitopsConfig,
    },
  });
});

// ============================================================================
// Apply Config to Repository
// ============================================================================

app.put('/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const body = await c.req.json<{ config: unknown; format?: 'json' | 'yaml' }>();

  let config: unknown;
  if (body.format === 'yaml' && typeof body.config === 'string') {
    config = parseYAMLConfig(body.config);
  } else {
    config = body.config;
  }

  const validation = validateConfig(config);
  if (!validation.valid) {
    return c.json({
      success: false,
      error: { message: 'Invalid configuration', details: validation.errors },
    }, 400);
  }

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new ValidationError('Repository not found');
  }

  const metadata = (repository.metadata as Record<string, unknown>) ?? {};
  const oldConfig = (metadata.gitopsConfig as GitOpsConfig) ?? DEFAULT_CONFIG;
  const newConfig = config as GitOpsConfig;
  const diff = diffConfigs(oldConfig, newConfig);

  metadata.gitopsConfig = newConfig;
  metadata.gitopsConfigUpdatedAt = new Date().toISOString();

  await prisma.repository.update({
    where: { id: repositoryId },
    data: { metadata: metadata as object },
  });

  return c.json({
    success: true,
    data: {
      repositoryId,
      config: newConfig,
      diff,
      warnings: validation.warnings,
    },
  });
});

// ============================================================================
// Diff Config Changes
// ============================================================================

app.post('/diff', requireAuth, async (c) => {
  const body = await c.req.json<{
    oldConfig: GitOpsConfig;
    newConfig: GitOpsConfig;
  }>();

  if (!body.oldConfig || !body.newConfig) {
    throw new ValidationError('Both oldConfig and newConfig are required');
  }

  const diff = diffConfigs(body.oldConfig, body.newConfig);

  return c.json({
    success: true,
    data: diff,
  });
});

// ============================================================================
// Reset Config to Defaults
// ============================================================================

app.delete('/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new ValidationError('Repository not found');
  }

  const metadata = (repository.metadata as Record<string, unknown>) ?? {};
  delete metadata.gitopsConfig;
  delete metadata.gitopsConfigUpdatedAt;

  await prisma.repository.update({
    where: { id: repositoryId },
    data: { metadata: metadata as object },
  });

  return c.json({
    success: true,
    data: {
      repositoryId,
      config: DEFAULT_CONFIG,
      reset: true,
    },
  });
});

export { app as gitopsRoutes };
