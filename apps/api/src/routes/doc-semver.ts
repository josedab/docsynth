/**
 * Doc Semver Routes
 *
 * API endpoints for semantic versioning of documentation including
 * change classification, version bumping, tagging, and version history.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  classifyChange,
  bumpVersion,
  tagRelease,
  getVersionHistory,
  getDocAtVersion,
  diffVersions,
} from '../services/doc-semver.service.js';

const log = createLogger('doc-semver-routes');
const app = new Hono();

/**
 * POST /classify - Classify a documentation change
 */
app.post('/classify', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      filePath: string;
      diff: string;
    }>();

    if (!body.repositoryId || !body.filePath || !body.diff) {
      return c.json(
        { success: false, error: 'repositoryId, filePath, and diff are required' },
        400
      );
    }

    const classification = await classifyChange(body.repositoryId, body.filePath, body.diff);
    return c.json({ success: true, data: classification });
  } catch (error) {
    log.error({ error }, 'Failed to classify change');
    return c.json({ success: false, error: 'Failed to classify change' }, 500);
  }
});

/**
 * POST /bump - Bump the version of a document
 */
app.post('/bump', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      filePath: string;
      bumpType: string;
    }>();

    if (!body.repositoryId || !body.filePath || !body.bumpType) {
      return c.json(
        { success: false, error: 'repositoryId, filePath, and bumpType are required' },
        400
      );
    }

    const job = await addJob(QUEUE_NAMES.DOC_SEMVER, {
      repositoryId: body.repositoryId,
      action: 'bump',
      filePath: body.filePath,
    });

    const result = await bumpVersion(body.repositoryId, body.filePath, body.bumpType);

    log.info({ repositoryId: body.repositoryId, jobId: job.id }, 'Version bump queued');
    return c.json({ success: true, data: { jobId: job.id, result } });
  } catch (error) {
    log.error({ error }, 'Failed to bump version');
    return c.json({ success: false, error: 'Failed to bump version' }, 500);
  }
});

/**
 * POST /tag-release - Tag a documentation release
 */
app.post('/tag-release', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      version: string;
      message?: string;
    }>();

    if (!body.repositoryId || !body.version) {
      return c.json({ success: false, error: 'repositoryId and version are required' }, 400);
    }

    const tag = await tagRelease(body.repositoryId, body.version, body.message);
    log.info({ repositoryId: body.repositoryId, version: body.version }, 'Release tagged');
    return c.json({ success: true, data: tag });
  } catch (error) {
    log.error({ error }, 'Failed to tag release');
    return c.json({ success: false, error: 'Failed to tag release' }, 500);
  }
});

/**
 * GET /history/:repositoryId/:documentPath - Get version history
 */
app.get('/history/:repositoryId/:documentPath', requireAuth, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const documentPath = c.req.param('documentPath');
    const limit = parseInt(c.req.query('limit') || '20', 10);

    const history = await getVersionHistory(repositoryId, documentPath, limit);
    return c.json({ success: true, data: history });
  } catch (error) {
    log.error({ error }, 'Failed to get version history');
    return c.json({ success: false, error: 'Failed to get version history' }, 500);
  }
});

/**
 * GET /at-version - Get a document at a specific version
 */
app.get('/at-version', requireAuth, async (c) => {
  try {
    const repositoryId = c.req.query('repositoryId');
    const filePath = c.req.query('filePath');
    const version = c.req.query('version');

    if (!repositoryId || !filePath || !version) {
      return c.json(
        { success: false, error: 'repositoryId, filePath, and version are required' },
        400
      );
    }

    const doc = await getDocAtVersion(repositoryId, filePath, version);
    return c.json({ success: true, data: doc });
  } catch (error) {
    log.error({ error }, 'Failed to get doc at version');
    return c.json({ success: false, error: 'Failed to get doc at version' }, 500);
  }
});

/**
 * POST /diff - Diff two versions of a document
 */
app.post('/diff', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      filePath: string;
      fromVersion: string;
      toVersion: string;
    }>();

    if (!body.repositoryId || !body.filePath || !body.fromVersion || !body.toVersion) {
      return c.json(
        {
          success: false,
          error: 'repositoryId, filePath, fromVersion, and toVersion are required',
        },
        400
      );
    }

    const diff = await diffVersions(
      body.repositoryId,
      body.filePath,
      body.fromVersion,
      body.toVersion
    );
    return c.json({ success: true, data: diff });
  } catch (error) {
    log.error({ error }, 'Failed to diff versions');
    return c.json({ success: false, error: 'Failed to diff versions' }, 500);
  }
});

export { app as docSemverRoutes };
