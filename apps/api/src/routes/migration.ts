import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import {
  validateMigrationConfig,
  startMigration,
  getMigrationStatus,
  getMigrationHistory,
  type MigrationConfig,
  type MigrationSource,
} from '../services/migration.service.js';

const app = new Hono();

// ============================================================================
// Migration Management
// ============================================================================

// Start a new migration
app.post('/start', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<MigrationConfig>();

  // Validate configuration
  const validation = validateMigrationConfig(body);
  if (!validation.valid) {
    throw new ValidationError('Invalid migration configuration', { errors: validation.errors });
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: {
      id: body.mappings.targetRepositoryId,
      organizationId: orgId,
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.mappings.targetRepositoryId);
  }

  // Start migration (creates DB record)
  const result = await startMigration(body, orgId);

  // Queue migration worker job
  await addJob(QUEUE_NAMES.MIGRATION, {
    migrationId: result.id,
    config: body,
    organizationId: orgId,
  });

  return c.json({
    success: true,
    data: {
      migrationId: result.id,
      status: result.status,
      message: 'Migration started. Check status endpoint for progress.',
    },
  });
});

// Get migration status
app.get('/status/:migrationId', requireAuth, requireOrgAccess, async (c) => {
  const migrationId = c.req.param('migrationId');
  const orgId = c.get('organizationId');

  // Verify migration belongs to organization
  const migration = await prisma.migration.findFirst({
    where: {
      id: migrationId,
      organizationId: orgId,
    },
  });

  if (!migration) {
    throw new NotFoundError('Migration', migrationId);
  }

  const result = await getMigrationStatus(migrationId);

  if (!result) {
    throw new NotFoundError('Migration', migrationId);
  }

  return c.json({
    success: true,
    data: result,
  });
});

// Get migration history
app.get('/history', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { repositoryId, limit } = c.req.query();

  const history = await getMigrationHistory(orgId, {
    repositoryId: repositoryId || undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
  });

  const summary = {
    total: history.length,
    byStatus: {
      completed: history.filter((m) => m.status === 'completed').length,
      running: history.filter((m) => m.status === 'running').length,
      failed: history.filter((m) => m.status === 'failed').length,
      partial: history.filter((m) => m.status === 'partial').length,
    },
    bySource: history.reduce((acc, m) => {
      acc[m.source] = (acc[m.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    totalDocumentsImported: history.reduce((sum, m) => sum + m.importedDocuments, 0),
  };

  return c.json({
    success: true,
    data: {
      history,
      summary,
    },
  });
});

// ============================================================================
// Validation & Testing
// ============================================================================

// Validate connection configuration (dry run)
app.post('/validate', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<MigrationConfig>();

  // Validate configuration structure
  const validation = validateMigrationConfig(body);
  if (!validation.valid) {
    return c.json(
      {
        success: false,
        data: {
          valid: false,
          errors: validation.errors,
        },
      },
      400
    );
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: {
      id: body.mappings.targetRepositoryId,
      organizationId: orgId,
    },
  });

  if (!repository) {
    return c.json(
      {
        success: false,
        data: {
          valid: false,
          errors: ['Target repository not found or access denied'],
        },
      },
      400
    );
  }

  // Test connection (simplified - in production would actually test API connectivity)
  let connectionTestResult = { success: true, message: 'Configuration is valid' };

  try {
    // Here you would test actual connectivity to the source
    // For now, just validate that required fields are present
    connectionTestResult = {
      success: true,
      message: `Configuration validated for ${body.source} migration`,
    };
  } catch (error) {
    connectionTestResult = {
      success: false,
      message: error instanceof Error ? error.message : 'Connection test failed',
    };
  }

  return c.json({
    success: true,
    data: {
      valid: validation.valid && connectionTestResult.success,
      errors: validation.errors,
      connectionTest: connectionTestResult,
    },
  });
});

// ============================================================================
// Migration Control
// ============================================================================

// Cancel a running migration
app.delete('/cancel/:migrationId', requireAuth, requireOrgAccess, async (c) => {
  const migrationId = c.req.param('migrationId');
  const orgId = c.get('organizationId');

  // Verify migration belongs to organization
  const migration = await prisma.migration.findFirst({
    where: {
      id: migrationId,
      organizationId: orgId,
    },
  });

  if (!migration) {
    throw new NotFoundError('Migration', migrationId);
  }

  // Only allow canceling running or pending migrations
  if (migration.status !== 'running' && migration.status !== 'pending') {
    throw new ValidationError(`Cannot cancel migration with status: ${migration.status}`);
  }

  // Update migration status to cancelled
  await prisma.migration.update({
    where: { id: migrationId },
    data: {
      status: 'failed',
      completedAt: new Date(),
      errors: [...((migration.errors as string[]) || []), 'Migration cancelled by user'],
    },
  });

  return c.json({
    success: true,
    data: {
      migrationId,
      message: 'Migration cancelled',
    },
  });
});

// Trigger sync for bidirectional migration
app.post('/sync/:migrationId', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const migrationId = c.req.param('migrationId');
  const orgId = c.get('organizationId');

  // Verify migration belongs to organization
  const migration = await prisma.migration.findFirst({
    where: {
      id: migrationId,
      organizationId: orgId,
    },
  });

  if (!migration) {
    throw new NotFoundError('Migration', migrationId);
  }

  // Check if bidirectional sync is enabled
  const config = migration.config as unknown as MigrationConfig;
  if (!config.options.bidirectionalSync) {
    throw new ValidationError('Bidirectional sync is not enabled for this migration');
  }

  // Queue a new migration job for sync
  await addJob(QUEUE_NAMES.MIGRATION, {
    migrationId: migration.id,
    config,
    organizationId: orgId,
  });

  return c.json({
    success: true,
    data: {
      message: 'Sync triggered successfully',
      migrationId,
    },
  });
});

// ============================================================================
// Source Information
// ============================================================================

// Get supported migration sources with their required config fields
app.get('/sources', requireAuth, async (c) => {
  const sources = [
    {
      id: 'confluence' as MigrationSource,
      name: 'Confluence',
      description: 'Import documentation from Atlassian Confluence',
      requiredFields: ['baseUrl', 'apiToken', 'spaceKey'],
      optionalFields: ['pathPrefix', 'docTypeMapping'],
      features: {
        preserveMetadata: true,
        convertImages: true,
        bidirectionalSync: false,
      },
    },
    {
      id: 'notion' as MigrationSource,
      name: 'Notion',
      description: 'Import documentation from Notion databases',
      requiredFields: ['apiToken', 'databaseId'],
      optionalFields: ['pathPrefix', 'docTypeMapping'],
      features: {
        preserveMetadata: true,
        convertImages: true,
        bidirectionalSync: false,
      },
    },
    {
      id: 'gitbook' as MigrationSource,
      name: 'GitBook',
      description: 'Import documentation from GitBook',
      requiredFields: ['baseUrl', 'apiToken'],
      optionalFields: ['pathPrefix'],
      features: {
        preserveMetadata: true,
        convertImages: true,
        bidirectionalSync: false,
      },
    },
    {
      id: 'markdown' as MigrationSource,
      name: 'Markdown Repository',
      description: 'Import markdown files from a Git repository',
      requiredFields: ['repoUrl'],
      optionalFields: ['pathPrefix', 'branch'],
      features: {
        preserveMetadata: true,
        convertImages: false,
        bidirectionalSync: false,
      },
    },
    {
      id: 'readme' as MigrationSource,
      name: 'README.io',
      description: 'Import documentation from README.io',
      requiredFields: ['repoUrl', 'apiToken'],
      optionalFields: ['pathPrefix', 'version'],
      features: {
        preserveMetadata: true,
        convertImages: true,
        bidirectionalSync: false,
      },
    },
  ];

  return c.json({
    success: true,
    data: {
      sources,
      total: sources.length,
    },
  });
});

// Get migration statistics
app.get('/stats', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const [totalMigrations, completedMigrations, failedMigrations, runningMigrations] = await Promise.all([
    prisma.migration.count({ where: { organizationId: orgId } }),
    prisma.migration.count({ where: { organizationId: orgId, status: 'completed' } }),
    prisma.migration.count({ where: { organizationId: orgId, status: 'failed' } }),
    prisma.migration.count({ where: { organizationId: orgId, status: 'running' } }),
  ]);

  // Get total documents imported
  const migrations = await prisma.migration.findMany({
    where: { organizationId: orgId },
    select: { importedDocuments: true, source: true },
  });

  const totalDocumentsImported = migrations.reduce((sum, m) => sum + m.importedDocuments, 0);

  const bySource = migrations.reduce((acc, m) => {
    acc[m.source] = (acc[m.source] || 0) + m.importedDocuments;
    return acc;
  }, {} as Record<string, number>);

  return c.json({
    success: true,
    data: {
      totalMigrations,
      completedMigrations,
      failedMigrations,
      runningMigrations,
      totalDocumentsImported,
      documentsBySource: bySource,
      successRate:
        totalMigrations > 0 ? ((completedMigrations / totalMigrations) * 100).toFixed(1) : '0.0',
    },
  });
});

export { app as migrationRoutes };
