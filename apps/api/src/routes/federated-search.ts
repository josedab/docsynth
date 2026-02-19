/**
 * Federated Search Routes
 *
 * Cross-repo unified documentation search and navigation.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  buildIndex,
  search,
  buildNavigationTree,
  detectCrossRepoLinks,
} from '../services/federated-search.service.js';

const log = createLogger('federated-search-routes');
const app = new Hono();

app.post('/index', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ organizationId: string; repositoryIds?: string[] }>();

  if (!body.organizationId)
    return c.json({ success: false, error: 'organizationId is required' }, 400);

  try {
    const index = await buildIndex(body.organizationId, body.repositoryIds);
    return c.json({ success: true, data: index });
  } catch (error) {
    log.error({ error }, 'Failed to build index');
    return c.json({ success: false, error: 'Failed to build index' }, 500);
  }
});

app.post('/index/async', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ organizationId: string; repositoryIds?: string[] }>();

  if (!body.organizationId)
    return c.json({ success: false, error: 'organizationId is required' }, 400);

  try {
    await addJob(QUEUE_NAMES.FEDERATED_SEARCH, {
      organizationId: body.organizationId,
      action: 'reindex-all' as const,
      repositoryIds: body.repositoryIds,
    });
    return c.json({ success: true, data: { message: 'Indexing queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to queue indexing');
    return c.json({ success: false, error: 'Failed to queue indexing' }, 500);
  }
});

app.post('/search', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    organizationId: string;
    query: string;
    repositoryIds?: string[];
    limit?: number;
    offset?: number;
  }>();

  if (!body.organizationId || !body.query) {
    return c.json({ success: false, error: 'organizationId and query are required' }, 400);
  }

  try {
    const results = await search(body.organizationId, body.query, body);
    return c.json({ success: true, data: results });
  } catch (error) {
    log.error({ error }, 'Failed to search');
    return c.json({ success: false, error: 'Failed to search' }, 500);
  }
});

app.get('/navigation/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  const organizationId = c.req.param('organizationId');

  try {
    const tree = await buildNavigationTree(organizationId);
    return c.json({ success: true, data: tree });
  } catch (error) {
    log.error({ error, organizationId }, 'Failed to build navigation');
    return c.json({ success: false, error: 'Failed to build navigation' }, 500);
  }
});

app.get('/cross-links/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  const organizationId = c.req.param('organizationId');

  try {
    const links = await detectCrossRepoLinks(organizationId);
    return c.json({ success: true, data: links });
  } catch (error) {
    log.error({ error, organizationId }, 'Failed to detect cross-repo links');
    return c.json({ success: false, error: 'Failed to detect links' }, 500);
  }
});

export { app as federatedSearchRoutes };
