/**
 * Doc Dependency Graph Routes
 *
 * API endpoints for building and querying documentation dependency graphs,
 * blast radius computation, and broken reference detection.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  buildGraph,
  computeBlastRadius,
  detectBrokenReferences,
  exportGraph,
  getNodeDependencies,
} from '../services/doc-dep-graph.service.js';

const log = createLogger('doc-dep-graph-routes');
const app = new Hono();

/**
 * POST /build - Build a dependency graph for a repository
 */
app.post('/build', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      installationId: number;
    }>();

    if (!body.repositoryId || !body.installationId) {
      return c.json({ success: false, error: 'repositoryId and installationId are required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.DOC_DEP_GRAPH, {
      repositoryId: body.repositoryId,
      action: 'build',
      installationId: body.installationId,
    });

    const graph = await buildGraph(body.repositoryId, body.installationId);

    log.info({ repositoryId: body.repositoryId, jobId: job.id }, 'Dependency graph build started');
    return c.json({ success: true, data: { jobId: job.id, graph } });
  } catch (error) {
    log.error({ error }, 'Failed to build dependency graph');
    return c.json({ success: false, error: 'Failed to build dependency graph' }, 500);
  }
});

/**
 * POST /blast-radius - Compute blast radius for a document change
 */
app.post('/blast-radius', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      filePath: string;
    }>();

    if (!body.repositoryId || !body.filePath) {
      return c.json({ success: false, error: 'repositoryId and filePath are required' }, 400);
    }

    const result = await computeBlastRadius(body.repositoryId, body.filePath);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to compute blast radius');
    return c.json({ success: false, error: 'Failed to compute blast radius' }, 500);
  }
});

/**
 * GET /broken-refs/:repositoryId - Detect broken references
 */
app.get('/broken-refs/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const brokenRefs = await detectBrokenReferences(repositoryId);
    return c.json({ success: true, data: brokenRefs });
  } catch (error) {
    log.error({ error }, 'Failed to detect broken references');
    return c.json({ success: false, error: 'Failed to detect broken references' }, 500);
  }
});

/**
 * POST /export - Export the dependency graph in a specified format
 */
app.post('/export', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      format: string;
    }>();

    if (!body.repositoryId || !body.format) {
      return c.json({ success: false, error: 'repositoryId and format are required' }, 400);
    }

    const exported = await exportGraph(body.repositoryId, body.format);
    return c.json({ success: true, data: exported });
  } catch (error) {
    log.error({ error }, 'Failed to export graph');
    return c.json({ success: false, error: 'Failed to export graph' }, 500);
  }
});

/**
 * POST /node-deps - Get dependencies for a specific node
 */
app.post('/node-deps', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      nodeId: string;
      depth?: number;
    }>();

    if (!body.repositoryId || !body.nodeId) {
      return c.json({ success: false, error: 'repositoryId and nodeId are required' }, 400);
    }

    const deps = await getNodeDependencies(body.repositoryId, body.nodeId, body.depth);
    return c.json({ success: true, data: deps });
  } catch (error) {
    log.error({ error }, 'Failed to get node dependencies');
    return c.json({ success: false, error: 'Failed to get node dependencies' }, 500);
  }
});

export { app as docDepGraphRoutes };
