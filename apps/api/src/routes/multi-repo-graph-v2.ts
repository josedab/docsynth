/**
 * Multi-Repo Knowledge Graph V2 Routes
 *
 * API endpoints for cross-repository knowledge graph visualization.
 */

import { Hono } from 'hono';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  buildKnowledgeGraph,
  getKnowledgeGraph,
  getGraphSnapshots,
  searchGraphNodes,
  type GraphNodeType,
} from '../services/multi-repo-graph-v2.service.js';

const log = createLogger('multi-repo-graph-v2-routes');

const app = new Hono();

/**
 * POST /build - Build knowledge graph for an organization
 */
app.post('/build', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    organizationId: string;
    repositoryIds?: string[];
    async?: boolean;
  }>();

  if (!body.organizationId) {
    return c.json({ success: false, error: 'organizationId is required' }, 400);
  }

  if (body.async) {
    const job = await addJob(QUEUE_NAMES.MULTI_REPO_GRAPH, {
      organizationId: body.organizationId,
      repositoryIds: body.repositoryIds,
      includeDepAnalysis: true,
    });
    return c.json({ success: true, data: { jobId: job.id, message: 'Graph build queued' } });
  }

  try {
    const graph = await buildKnowledgeGraph(body.organizationId, body.repositoryIds);
    return c.json({ success: true, data: graph });
  } catch (error) {
    log.error({ error }, 'Graph build failed');
    return c.json({ success: false, error: 'Build failed' }, 500);
  }
});

/**
 * GET /:organizationId - Get current knowledge graph
 */
app.get('/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const graph = await getKnowledgeGraph(c.req.param('organizationId'));
    return c.json({ success: true, data: graph });
  } catch (error) {
    log.error({ error }, 'Failed to get graph');
    return c.json({ success: false, error: 'Failed to get graph' }, 500);
  }
});

/**
 * GET /:organizationId/search - Search graph nodes
 */
app.get('/:organizationId/search', requireAuth, requireOrgAccess, async (c) => {
  const query = c.req.query('q') || '';
  const nodeType = c.req.query('type') as GraphNodeType | undefined;

  if (!query) {
    return c.json({ success: false, error: 'Query parameter "q" is required' }, 400);
  }

  const nodes = await searchGraphNodes(c.req.param('organizationId'), query, nodeType);
  return c.json({ success: true, data: nodes });
});

/**
 * GET /:organizationId/snapshots - Get graph history
 */
app.get('/:organizationId/snapshots', requireAuth, requireOrgAccess, async (c) => {
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const snapshots = await getGraphSnapshots(c.req.param('organizationId'), limit);
  return c.json({ success: true, data: snapshots });
});

export { app as multiRepoGraphV2Routes };
