/**
 * Pair Writing Routes
 *
 * API endpoints for AI-assisted pair writing sessions including
 * suggestion generation, fact checking, and session management.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  createSession,
  generateSuggestion,
  factCheckContent,
  acceptSuggestion,
  getSession,
  closeSession,
} from '../services/pair-writing.service.js';

const log = createLogger('pair-writing-routes');
const app = new Hono();

/**
 * POST /session - Create a new pair writing session
 */
app.post('/session', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ repositoryId: string; documentPath: string }>();

    if (!body.repositoryId || !body.documentPath) {
      return c.json({ success: false, error: 'repositoryId and documentPath are required' }, 400);
    }

    const session = await createSession(body.repositoryId, body.documentPath);
    return c.json({ success: true, data: session });
  } catch (error) {
    log.error({ error }, 'Failed to create pair writing session');
    return c.json({ success: false, error: 'Failed to create session' }, 500);
  }
});

/**
 * POST /suggest - Generate a writing suggestion
 */
app.post('/suggest', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      sessionId: string;
      context: string;
      cursorPosition?: number;
    }>();

    if (!body.sessionId || !body.context) {
      return c.json({ success: false, error: 'sessionId and context are required' }, 400);
    }

    const suggestion = await generateSuggestion(body.sessionId, body.context, body.cursorPosition);
    return c.json({ success: true, data: suggestion });
  } catch (error) {
    log.error({ error }, 'Failed to generate suggestion');
    return c.json({ success: false, error: 'Failed to generate suggestion' }, 500);
  }
});

/**
 * POST /fact-check - Fact check content against source code
 */
app.post('/fact-check', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ sessionId: string; content: string }>();

    if (!body.sessionId || !body.content) {
      return c.json({ success: false, error: 'sessionId and content are required' }, 400);
    }

    const result = await factCheckContent(body.sessionId, body.content);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to fact check content');
    return c.json({ success: false, error: 'Failed to fact check content' }, 500);
  }
});

/**
 * POST /accept - Accept a writing suggestion
 */
app.post('/accept', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ sessionId: string; suggestionId: string }>();

    if (!body.sessionId || !body.suggestionId) {
      return c.json({ success: false, error: 'sessionId and suggestionId are required' }, 400);
    }

    const result = await acceptSuggestion(body.sessionId, body.suggestionId);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to accept suggestion');
    return c.json({ success: false, error: 'Failed to accept suggestion' }, 500);
  }
});

/**
 * GET /session/:sessionId - Get session details
 */
app.get('/session/:sessionId', requireAuth, async (c) => {
  try {
    const session = await getSession(c.req.param('sessionId'));
    if (!session) return c.json({ success: false, error: 'Session not found' }, 404);
    return c.json({ success: true, data: session });
  } catch (error) {
    log.error({ error }, 'Failed to get session');
    return c.json({ success: false, error: 'Failed to get session' }, 500);
  }
});

/**
 * POST /session/:sessionId/close - Close a pair writing session
 */
app.post('/session/:sessionId/close', requireAuth, async (c) => {
  try {
    const result = await closeSession(c.req.param('sessionId'));
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to close session');
    return c.json({ success: false, error: 'Failed to close session' }, 500);
  }
});

export { app as pairWritingRoutes };
