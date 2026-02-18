/**
 * Coverage CI Gate Routes
 *
 * AST-based documentation coverage analysis with CI/CD enforcement.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  scanCoverage,
  getCoverageTrends,
  getThresholds,
  updateThresholds,
  formatCoverageComment,
} from '../services/coverage-ci-gate.service.js';

const log = createLogger('coverage-ci-gate-routes');
const app = new Hono();

app.post('/scan', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string; prNumber?: number }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  try {
    const report = await scanCoverage(body.repositoryId, { prNumber: body.prNumber });
    return c.json({ success: true, data: report });
  } catch (error) {
    log.error({ error, repositoryId: body.repositoryId }, 'Failed to scan coverage');
    return c.json({ success: false, error: 'Failed to scan coverage' }, 500);
  }
});

app.post('/scan/async', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string; prNumber?: number }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  try {
    await addJob(QUEUE_NAMES.COVERAGE_CI_GATE, {
      repositoryId: body.repositoryId,
      prNumber: body.prNumber,
      action: 'scan' as const,
    });
    return c.json({ success: true, data: { message: 'Coverage scan queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to queue coverage scan');
    return c.json({ success: false, error: 'Failed to queue scan' }, 500);
  }
});

app.get('/report/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  try {
    const report = await scanCoverage(repositoryId);
    const comment = formatCoverageComment(report);
    return c.json({ success: true, data: { report, formattedComment: comment } });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get coverage report');
    return c.json({ success: false, error: 'Failed to get report' }, 500);
  }
});

app.get('/trends/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const days = parseInt(c.req.query('days') || '30', 10);

  try {
    const trends = await getCoverageTrends(repositoryId, days);
    return c.json({ success: true, data: trends });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get coverage trends');
    return c.json({ success: false, error: 'Failed to get trends' }, 500);
  }
});

app.get('/thresholds/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  try {
    const thresholds = await getThresholds(repositoryId);
    return c.json({ success: true, data: thresholds });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get thresholds');
    return c.json({ success: false, error: 'Failed to get thresholds' }, 500);
  }
});

app.post('/thresholds', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    minPublicApiCoverage?: number;
    minOverallCoverage?: number;
    blockOnFailure?: boolean;
  }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  try {
    const thresholds = await updateThresholds(body.repositoryId, body);
    return c.json({ success: true, data: thresholds });
  } catch (error) {
    log.error({ error }, 'Failed to update thresholds');
    return c.json({ success: false, error: 'Failed to update thresholds' }, 500);
  }
});

export { app as coverageCIGateRoutes };
