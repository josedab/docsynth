/**
 * Doc Migration Engine Routes
 *
 * API endpoints for previewing, starting, and executing documentation
 * migrations between formats, platforms, or structures.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  previewMigration,
  startMigration,
  executeMigration,
  getMigrationStatus,
  getMigrationHistory,
} from '../services/doc-migration-engine.service.js';

const log = createLogger('doc-migration-engine-routes');
const app = new Hono();

/**
 * POST /preview - Preview a documentation migration
 */
app.post('/preview', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      sourceFormat: string;
      targetFormat: string;
      options?: Record<string, unknown>;
    }>();

    if (!body.repositoryId || !body.sourceFormat || !body.targetFormat) {
      return c.json(
        { success: false, error: 'repositoryId, sourceFormat, and targetFormat are required' },
        400
      );
    }

    const result = await previewMigration(
      body.repositoryId,
      body.sourceFormat,
      body.targetFormat,
      body.options
    );
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to preview migration');
    return c.json({ success: false, error: 'Failed to preview migration' }, 500);
  }
});

/**
 * POST /start - Start a new migration job
 */
app.post('/start', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      sourceFormat: string;
      targetFormat: string;
      installationId: number;
      options?: Record<string, unknown>;
    }>();

    if (!body.repositoryId || !body.sourceFormat || !body.targetFormat || !body.installationId) {
      return c.json(
        {
          success: false,
          error: 'repositoryId, sourceFormat, targetFormat, and installationId are required',
        },
        400
      );
    }

    const job = await addJob(QUEUE_NAMES.DOC_MIGRATION_ENGINE, {
      repositoryId: body.repositoryId,
      sourceFormat: body.sourceFormat,
      targetFormat: body.targetFormat,
      installationId: body.installationId,
      options: body.options,
    });

    const migration = await startMigration(
      body.repositoryId,
      body.sourceFormat,
      body.targetFormat,
      job.id
    );
    return c.json({ success: true, data: migration }, 201);
  } catch (error) {
    log.error({ error }, 'Failed to start migration');
    return c.json({ success: false, error: 'Failed to start migration' }, 500);
  }
});

/**
 * POST /execute/:jobId - Execute a specific migration job
 */
app.post('/execute/:jobId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const result = await executeMigration(jobId);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to execute migration');
    return c.json({ success: false, error: 'Failed to execute migration' }, 500);
  }
});

/**
 * GET /status/:jobId - Get the status of a migration job
 */
app.get('/status/:jobId', requireAuth, async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const status = await getMigrationStatus(jobId);

    if (!status) {
      return c.json({ success: false, error: 'Migration job not found' }, 404);
    }

    return c.json({ success: true, data: status });
  } catch (error) {
    log.error({ error }, 'Failed to get migration status');
    return c.json({ success: false, error: 'Failed to get migration status' }, 500);
  }
});

/**
 * GET /history/:organizationId - Get migration history for an organization
 */
app.get('/history/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const organizationId = c.req.param('organizationId');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const history = await getMigrationHistory(organizationId, limit);
    return c.json({ success: true, data: history });
  } catch (error) {
    log.error({ error }, 'Failed to get migration history');
    return c.json({ success: false, error: 'Failed to get migration history' }, 500);
  }
});

export { app as docMigrationEngineRoutes };
