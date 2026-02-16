/**
 * Smart Documentation Diff Viewer Routes
 *
 * API endpoints for semantic diff analysis between code and doc changes.
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  analyzeSmartDiff,
  addDiffComment,
  updateSectionApproval,
  getSmartDiff,
} from '../services/smart-diff.service.js';

const log = createLogger('smart-diff-routes');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

/**
 * POST /analyze - Create a smart diff for a PR
 */
app.post('/analyze', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    prNumber: number;
    installationId: number;
    changedFiles?: Array<{ filename: string; patch?: string; status: string }>;
  }>();

  const { repositoryId, prNumber, installationId, changedFiles } = body;

  if (!repositoryId || !prNumber) {
    return c.json({ success: false, error: 'repositoryId and prNumber are required' }, 400);
  }

  if (changedFiles && changedFiles.length > 0) {
    try {
      const result = await analyzeSmartDiff(repositoryId, prNumber, changedFiles);

      const record = await db.smartDiff.create({
        data: {
          repositoryId,
          prNumber,
          codeDiffSummary: result.codeDiffSummary,
          docDiffSections: result.docDiffSections,
          approvalStatus: 'pending',
        },
      });

      return c.json({ success: true, data: { id: record.id, ...result } });
    } catch (error) {
      log.error({ error, repositoryId, prNumber }, 'Smart diff analysis failed');
      return c.json({ success: false, error: 'Analysis failed' }, 500);
    }
  }

  const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });
  if (!repository) return c.json({ success: false, error: 'Repository not found' }, 404);

  const [owner, repo] = repository.fullName.split('/');
  const job = await addJob(QUEUE_NAMES.SMART_DIFF, {
    repositoryId,
    prNumber,
    installationId,
    owner: owner!,
    repo: repo!,
  });

  return c.json({ success: true, data: { jobId: job.id, message: 'Smart diff analysis queued' } });
});

/**
 * GET /:smartDiffId - Get a smart diff with comments
 */
app.get('/:smartDiffId', requireAuth, async (c) => {
  const diff = await getSmartDiff(c.req.param('smartDiffId'));
  if (!diff) return c.json({ success: false, error: 'Smart diff not found' }, 404);
  return c.json({ success: true, data: diff });
});

/**
 * GET /pr/:repositoryId/:prNumber - Get smart diff for a PR
 */
app.get('/pr/:repositoryId/:prNumber', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const prNumber = parseInt(c.req.param('prNumber'), 10);

  const diff = await db.smartDiff.findFirst({
    where: { repositoryId, prNumber },
    orderBy: { createdAt: 'desc' },
  });

  if (!diff) return c.json({ success: false, error: 'No smart diff found for this PR' }, 404);
  return c.json({ success: true, data: diff });
});

/**
 * POST /:smartDiffId/comment - Add a comment to a diff section
 */
app.post('/:smartDiffId/comment', requireAuth, async (c) => {
  const smartDiffId = c.req.param('smartDiffId');
  const body = await c.req.json<{
    sectionId: string;
    content: string;
    author: string;
    parentId?: string;
  }>();

  if (!body.sectionId || !body.content || !body.author) {
    return c.json({ success: false, error: 'sectionId, content, and author are required' }, 400);
  }

  const comment = await addDiffComment(
    smartDiffId,
    body.sectionId,
    body.author,
    body.content,
    body.parentId
  );
  return c.json({ success: true, data: comment });
});

/**
 * PUT /:smartDiffId/section/:sectionId/approve - Approve/reject a section
 */
app.put('/:smartDiffId/section/:sectionId/approve', requireAuth, async (c) => {
  const { smartDiffId } = c.req.param() as { smartDiffId: string };
  const sectionId = c.req.param('sectionId');
  const body = await c.req.json<{ approved: boolean }>();

  await updateSectionApproval(smartDiffId, sectionId, body.approved);
  return c.json({ success: true });
});

/**
 * GET /history/:repositoryId - Get smart diff history
 */
app.get('/history/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const limit = parseInt(c.req.query('limit') || '20', 10);

  const diffs = await db.smartDiff.findMany({
    where: { repositoryId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return c.json({ success: true, data: diffs });
});

export { app as smartDiffRoutes };
