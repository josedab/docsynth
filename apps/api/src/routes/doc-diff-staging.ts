/**
 * Doc Diff Staging Routes
 *
 * API endpoints for computing documentation diffs, staging changes,
 * and previewing staged documents before applying.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  applyStagingDecisions,
  previewStagedDocument,
  getDiff,
} from '../services/doc-diff-staging.service.js';

const log = createLogger('doc-diff-staging-routes');
const app = new Hono();

/**
 * POST /compute - Compute a documentation diff
 */
app.post('/compute', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      sourcePath: string;
      targetPath: string;
      options?: Record<string, unknown>;
    }>();

    if (!body.repositoryId || !body.sourcePath || !body.targetPath) {
      return c.json(
        { success: false, error: 'repositoryId, sourcePath, and targetPath are required' },
        400
      );
    }

    const job = await addJob(QUEUE_NAMES.DOC_DIFF_STAGING, {
      repositoryId: body.repositoryId,
      sourcePath: body.sourcePath,
      targetPath: body.targetPath,
      options: body.options,
    });

    return c.json({ success: true, data: { jobId: job.id, message: 'Diff computation queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to compute diff');
    return c.json({ success: false, error: 'Failed to compute diff' }, 500);
  }
});

/**
 * POST /stage - Apply staging decisions to a diff
 */
app.post('/stage', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      diffId: string;
      decisions: Array<{ sectionId: string; action: string }>;
    }>();

    if (!body.diffId || !body.decisions) {
      return c.json({ success: false, error: 'diffId and decisions are required' }, 400);
    }

    const result = await applyStagingDecisions(body.diffId, body.decisions);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to apply staging decisions');
    return c.json({ success: false, error: 'Failed to apply staging decisions' }, 500);
  }
});

/**
 * POST /preview - Preview a staged document
 */
app.post('/preview', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      diffId: string;
      format?: string;
    }>();

    if (!body.diffId) {
      return c.json({ success: false, error: 'diffId is required' }, 400);
    }

    const result = await previewStagedDocument(body.diffId, body.format);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to preview staged document');
    return c.json({ success: false, error: 'Failed to preview staged document' }, 500);
  }
});

/**
 * GET /diff/:diffId - Get a specific diff
 */
app.get('/diff/:diffId', requireAuth, async (c) => {
  try {
    const diffId = c.req.param('diffId');
    const diff = await getDiff(diffId);

    if (!diff) {
      return c.json({ success: false, error: 'Diff not found' }, 404);
    }

    return c.json({ success: true, data: diff });
  } catch (error) {
    log.error({ error }, 'Failed to get diff');
    return c.json({ success: false, error: 'Failed to get diff' }, 500);
  }
});

export { app as docDiffStagingRoutes };
