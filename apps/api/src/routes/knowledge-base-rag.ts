/**
 * Knowledge Base RAG Routes
 *
 * API endpoints for indexing repositories into the knowledge base,
 * querying with RAG, and generating proactive documentation suggestions.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  queryKnowledgeBase,
  getIndexStatus,
  getProactiveSuggestions,
} from '../services/knowledge-base-rag.service.js';

const log = createLogger('knowledge-base-rag-routes');
const app = new Hono();

/**
 * POST /index - Index a repository into the knowledge base
 */
app.post('/index', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      installationId: number;
      options?: Record<string, unknown>;
    }>();

    if (!body.repositoryId || !body.installationId) {
      return c.json({ success: false, error: 'repositoryId and installationId are required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.KNOWLEDGE_BASE_RAG, {
      repositoryId: body.repositoryId,
      installationId: body.installationId,
      options: body.options,
    });

    return c.json({
      success: true,
      data: { jobId: job.id, message: 'Repository indexing queued' },
    });
  } catch (error) {
    log.error({ error }, 'Failed to queue repository indexing');
    return c.json({ success: false, error: 'Failed to queue repository indexing' }, 500);
  }
});

/**
 * POST /query - Query the knowledge base
 */
app.post('/query', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      query: string;
      repositoryId?: string;
      organizationId?: string;
      limit?: number;
    }>();

    if (!body.query) {
      return c.json({ success: false, error: 'query is required' }, 400);
    }

    const result = await queryKnowledgeBase(
      body.query,
      body.repositoryId,
      body.organizationId,
      body.limit
    );
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to query knowledge base');
    return c.json({ success: false, error: 'Failed to query knowledge base' }, 500);
  }
});

/**
 * GET /status/:organizationId - Get indexing status for an organization
 */
app.get('/status/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const organizationId = c.req.param('organizationId');
    const status = await getIndexStatus(organizationId);
    return c.json({ success: true, data: status });
  } catch (error) {
    log.error({ error }, 'Failed to get index status');
    return c.json({ success: false, error: 'Failed to get index status' }, 500);
  }
});

/**
 * POST /suggestions - Get proactive documentation suggestions
 */
app.post('/suggestions', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      context?: Record<string, unknown>;
    }>();

    if (!body.repositoryId) {
      return c.json({ success: false, error: 'repositoryId is required' }, 400);
    }

    const suggestions = await getProactiveSuggestions(body.repositoryId, body.context);
    return c.json({ success: true, data: suggestions });
  } catch (error) {
    log.error({ error }, 'Failed to get proactive suggestions');
    return c.json({ success: false, error: 'Failed to get proactive suggestions' }, 500);
  }
});

export { app as knowledgeBaseRAGRoutes };
