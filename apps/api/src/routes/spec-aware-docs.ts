/**
 * OpenAPI/GraphQL Spec-Aware Documentation Generation Routes
 *
 * API endpoints for parsing API specifications, diffing spec versions,
 * generating documentation from specs, and producing migration guides
 * and changelogs.
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger, ValidationError, NotFoundError } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  parseOpenAPISpec,
  parseGraphQLSchema,
  diffSpecs,
  generateEndpointDocs,
  generateMigrationGuide,
  generateAPIChangelog,
} from '../services/spec-parser.service.js';

const log = createLogger('spec-aware-docs-routes');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

// ============================================================================
// Parse API Spec
// ============================================================================

/**
 * Parse an API spec (OpenAPI or GraphQL)
 * POST /parse
 */
app.post('/parse', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    content: string;
    type: 'openapi' | 'graphql';
  }>();

  if (!body.content) {
    throw new ValidationError('content is required');
  }

  if (!body.type || !['openapi', 'graphql'].includes(body.type)) {
    throw new ValidationError('type must be one of: openapi, graphql');
  }

  try {
    if (body.type === 'openapi') {
      const endpoints = parseOpenAPISpec(body.content);
      log.info({ endpointCount: endpoints.length, type: body.type }, 'API spec parsed');

      return c.json({
        success: true,
        data: {
          type: 'openapi',
          endpoints,
          endpointCount: endpoints.length,
        },
      });
    } else {
      const types = parseGraphQLSchema(body.content);
      log.info({ typeCount: types.length, type: body.type }, 'GraphQL schema parsed');

      return c.json({
        success: true,
        data: {
          type: 'graphql',
          types,
          typeCount: types.length,
        },
      });
    }
  } catch (error) {
    log.error({ error, type: body.type }, 'Spec parsing failed');
    return c.json(
      {
        success: false,
        error: 'Failed to parse spec',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ============================================================================
// Diff Two Spec Versions
// ============================================================================

/**
 * Diff two API spec versions
 * POST /diff
 */
app.post('/diff', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    oldSpec: string;
    newSpec: string;
    type: 'openapi' | 'graphql';
  }>();

  if (!body.oldSpec || !body.newSpec) {
    throw new ValidationError('oldSpec and newSpec are required');
  }

  if (!body.type || !['openapi', 'graphql'].includes(body.type)) {
    throw new ValidationError('type must be one of: openapi, graphql');
  }

  try {
    const diff = diffSpecs(body.oldSpec, body.newSpec);

    log.info(
      {
        added: diff.added.length,
        removed: diff.removed.length,
        modified: diff.modified.length,
        breakingChanges: diff.breakingChanges.length,
      },
      'Spec diff completed'
    );

    return c.json({
      success: true,
      data: diff,
    });
  } catch (error) {
    log.error({ error }, 'Spec diff failed');
    return c.json(
      {
        success: false,
        error: 'Failed to diff specs',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ============================================================================
// Generate Docs from Spec
// ============================================================================

/**
 * Generate documentation from an API spec (queued for background processing)
 * POST /generate
 */
app.post('/generate', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    content: string;
    type: 'openapi' | 'graphql';
    language: string;
    repositoryId: string;
  }>();

  if (!body.content) {
    throw new ValidationError('content is required');
  }

  if (!body.type || !['openapi', 'graphql'].includes(body.type)) {
    throw new ValidationError('type must be one of: openapi, graphql');
  }

  if (!body.language) {
    throw new ValidationError('language is required');
  }

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  // Verify repository exists
  const repository = await prisma.repository.findUnique({
    where: { id: body.repositoryId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  try {
    // Generate docs synchronously for OpenAPI endpoints
    if (body.type === 'openapi') {
      const endpoints = parseOpenAPISpec(body.content);
      const docs = endpoints.map((endpoint) => ({
        endpoint: `${endpoint.method.toUpperCase()} ${endpoint.path}`,
        documentation: generateEndpointDocs(endpoint, body.language),
      }));

      // Also enqueue background job for full processing
      const job = await addJob(QUEUE_NAMES.SPEC_AWARE_DOCS, {
        repositoryId: body.repositoryId,
        specContent: body.content,
        specType: body.type,
        language: body.language,
        action: 'generate',
      });

      log.info(
        {
          jobId: job.id,
          repositoryId: body.repositoryId,
          endpointCount: endpoints.length,
          language: body.language,
        },
        'Spec-aware documentation generation started'
      );

      return c.json(
        {
          success: true,
          data: {
            jobId: job.id,
            endpointCount: endpoints.length,
            language: body.language,
            docs,
          },
        },
        201
      );
    }

    // For GraphQL, enqueue background job
    const job = await addJob(QUEUE_NAMES.SPEC_AWARE_DOCS, {
      repositoryId: body.repositoryId,
      specContent: body.content,
      specType: body.type,
      language: body.language,
      action: 'generate',
    });

    log.info(
      { jobId: job.id, repositoryId: body.repositoryId, type: body.type, language: body.language },
      'GraphQL spec-aware documentation generation queued'
    );

    return c.json(
      {
        success: true,
        data: {
          jobId: job.id,
          type: body.type,
          language: body.language,
          status: 'queued',
        },
      },
      201
    );
  } catch (error) {
    log.error({ error, repositoryId: body.repositoryId }, 'Spec-aware doc generation failed');
    return c.json(
      {
        success: false,
        error: 'Failed to generate documentation',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ============================================================================
// Generate Migration Guide from Diff
// ============================================================================

/**
 * Generate a migration guide from a spec diff
 * POST /migration-guide
 */
app.post('/migration-guide', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    oldSpec: string;
    newSpec: string;
    type: 'openapi' | 'graphql';
  }>();

  if (!body.oldSpec || !body.newSpec) {
    throw new ValidationError('oldSpec and newSpec are required');
  }

  if (!body.type || !['openapi', 'graphql'].includes(body.type)) {
    throw new ValidationError('type must be one of: openapi, graphql');
  }

  try {
    const diff = diffSpecs(body.oldSpec, body.newSpec);
    const guide = generateMigrationGuide(diff);

    log.info({ breakingChanges: diff.breakingChanges.length }, 'Migration guide generated');

    return c.json({
      success: true,
      data: {
        guide,
        breakingChangeCount: diff.breakingChanges.length,
        diff,
      },
    });
  } catch (error) {
    log.error({ error }, 'Migration guide generation failed');
    return c.json(
      {
        success: false,
        error: 'Failed to generate migration guide',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ============================================================================
// Generate Changelog from Diff
// ============================================================================

/**
 * Generate an API changelog entry from a spec diff
 * POST /changelog
 */
app.post('/changelog', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    oldSpec: string;
    newSpec: string;
    type: 'openapi' | 'graphql';
    version: string;
  }>();

  if (!body.oldSpec || !body.newSpec) {
    throw new ValidationError('oldSpec and newSpec are required');
  }

  if (!body.type || !['openapi', 'graphql'].includes(body.type)) {
    throw new ValidationError('type must be one of: openapi, graphql');
  }

  if (!body.version) {
    throw new ValidationError('version is required');
  }

  try {
    const diff = diffSpecs(body.oldSpec, body.newSpec);
    const changelog = generateAPIChangelog(diff, body.version);

    log.info(
      { version: body.version, breakingChanges: diff.breakingChanges.length },
      'API changelog generated'
    );

    return c.json({
      success: true,
      data: {
        version: body.version,
        changelog,
        summary: {
          added: diff.added.length,
          removed: diff.removed.length,
          modified: diff.modified.length,
          breakingChanges: diff.breakingChanges.length,
        },
      },
    });
  } catch (error) {
    log.error({ error }, 'Changelog generation failed');
    return c.json(
      {
        success: false,
        error: 'Failed to generate changelog',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ============================================================================
// Spec Parsing History
// ============================================================================

/**
 * Get spec parsing history for a repository
 * GET /history/:repositoryId
 */
app.get('/history/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  try {
    const [history, total] = await Promise.all([
      db.specParsingHistory.findMany({
        where: { repositoryId },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      db.specParsingHistory.count({ where: { repositoryId } }),
    ]);

    return c.json({
      success: true,
      data: {
        history,
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch spec parsing history');
    return c.json(
      {
        success: false,
        error: 'Failed to fetch history',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export { app as specAwareDocsRoutes };
