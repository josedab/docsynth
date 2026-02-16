/**
 * Smart Monorepo Documentation Hub Routes
 *
 * Endpoints for workspace discovery, dependency graph navigation,
 * documentation coverage, and stub doc generation.
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger, ValidationError, NotFoundError } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  discoverWorkspaces,
  generateHubNavigation,
  calculateDocCoverage,
  generatePackageDocs,
  saveMonorepoMap,
  getMonorepoMap,
  getHubConfig,
  updateHubConfig,
} from '../services/monorepo-hub.service.js';

const log = createLogger('monorepo-hub-routes');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

// ============================================================================
// Workspace Discovery
// ============================================================================

/**
 * Discover workspaces from root package.json content.
 * POST /discover
 */
app.post('/discover', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    rootContent: string;
  }>();

  if (!body.repositoryId || !body.rootContent) {
    throw new ValidationError('repositoryId and rootContent are required');
  }

  const repository = await prisma.repository.findUnique({
    where: { id: body.repositoryId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  const map = discoverWorkspaces(body.rootContent);
  const record = await saveMonorepoMap(body.repositoryId, map);

  log.info(
    { repositoryId: body.repositoryId, packages: map.packages.length },
    'Workspaces discovered'
  );

  return c.json({ success: true, data: { map, record } }, 200);
});

// ============================================================================
// Monorepo Map
// ============================================================================

/**
 * Get the monorepo map for a repository.
 * GET /map/:repositoryId
 */
app.get('/map/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const record = await getMonorepoMap(repositoryId);

  if (!record) {
    throw new NotFoundError('MonorepoMap', repositoryId);
  }

  return c.json({ success: true, data: record }, 200);
});

// ============================================================================
// Navigation
// ============================================================================

/**
 * Get hub navigation tree for a repository.
 * GET /navigation/:repositoryId
 */
app.get('/navigation/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const record = await getMonorepoMap(repositoryId);

  if (!record) {
    throw new NotFoundError('MonorepoMap', repositoryId);
  }

  const navigation = generateHubNavigation(record);

  return c.json({ success: true, data: navigation }, 200);
});

// ============================================================================
// Documentation Coverage
// ============================================================================

/**
 * Get documentation coverage for a repository.
 * GET /coverage/:repositoryId
 */
app.get('/coverage/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const record = await getMonorepoMap(repositoryId);

  if (!record) {
    throw new NotFoundError('MonorepoMap', repositoryId);
  }

  const coverage = calculateDocCoverage(record);

  return c.json({ success: true, data: { repositoryId, coverage } }, 200);
});

// ============================================================================
// Generate Docs
// ============================================================================

/**
 * Queue doc generation for undocumented packages.
 * POST /generate/:repositoryId
 */
app.post('/generate/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const record = await getMonorepoMap(repositoryId);

  if (!record) {
    throw new NotFoundError('MonorepoMap', repositoryId);
  }

  const undocumented = (record.packages ?? []).filter((p: { hasReadme: boolean }) => !p.hasReadme);

  const docs = undocumented.map(
    (pkg: {
      name: string;
      path: string;
      version: string;
      description: string;
      dependencies: string[];
      devDependencies: string[];
      internalDeps: string[];
      docFiles: string[];
      hasReadme: boolean;
      exports: string[];
    }) => generatePackageDocs(pkg)
  );

  // Queue a background job for deeper generation
  await addJob(QUEUE_NAMES.MONOREPO_HUB as any, {
    repositoryId,
    type: 'generate',
  });

  log.info(
    { repositoryId, count: undocumented.length },
    'Queued doc generation for undocumented packages'
  );

  return c.json({ success: true, data: { generated: docs.length, docs } }, 200);
});

// ============================================================================
// Hub Config
// ============================================================================

/**
 * Get hub configuration for a repository.
 * GET /config/:repositoryId
 */
app.get('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const config = await getHubConfig(repositoryId);

  return c.json({ success: true, data: config }, 200);
});

/**
 * Update hub configuration for a repository.
 * PUT /config/:repositoryId
 */
app.put('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const body = await c.req.json<{
    enabled?: boolean;
    autoDiscover?: boolean;
    includePaths?: string[];
    excludePaths?: string[];
    generateNavigation?: boolean;
  }>();

  const updated = await updateHubConfig(repositoryId, body);

  log.info({ repositoryId }, 'Hub config updated');

  return c.json({ success: true, data: updated }, 200);
});

// ============================================================================
// Recent Changes
// ============================================================================

/**
 * Get recent workspace changes for a repository.
 * GET /changes/:repositoryId
 */
app.get('/changes/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  const changes = await db.monorepoHubChange.findMany({
    where: { repositoryId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return c.json({ success: true, data: changes }, 200);
});

export { app as monorepoHubRoutes };
