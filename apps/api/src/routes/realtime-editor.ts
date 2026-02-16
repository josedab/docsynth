/**
 * Real-Time Collaborative Editor Routes
 *
 * Endpoints for managing collaborative editing sessions,
 * applying operations, cursor tracking, version history,
 * and AI writing suggestions.
 */

import { Hono } from 'hono';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  createSession,
  joinSession,
  leaveSession,
  applyOperation,
  getDocument,
  updateCursorPosition,
  getSessionUsers,
  getVersionHistory,
  revertToVersion,
  getAISuggestions,
  applyAISuggestion,
  getSession,
} from '../services/realtime-editor.service.js';

const log = createLogger('realtime-editor-routes');

const app = new Hono();

// ============================================================================
// Session Management
// ============================================================================

/**
 * POST /sessions - Create a new editing session
 */
app.post('/sessions', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json();
    const { documentId } = body;
    const userId = c.get('userId') as string;

    if (!documentId) {
      return c.json({ success: false, error: 'documentId is required' }, 400);
    }

    const session = await createSession(documentId, userId);

    return c.json({ success: true, data: session });
  } catch (error) {
    log.error({ error }, 'Failed to create session');
    return c.json({ success: false, error: 'Failed to create session' }, 500);
  }
});

/**
 * GET /sessions/:sessionId - Get session info
 */
app.get('/sessions/:sessionId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    const session = await getSession(sessionId);

    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    return c.json({ success: true, data: session });
  } catch (error) {
    log.error({ error }, 'Failed to get session');
    return c.json({ success: false, error: 'Failed to get session' }, 500);
  }
});

/**
 * POST /sessions/:sessionId/join - Join a session
 */
app.post('/sessions/:sessionId/join', requireAuth, requireOrgAccess, async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    const body = await c.req.json();
    const userId = c.get('userId') as string;
    const { displayName } = body;

    const session = await joinSession(sessionId, userId, displayName ?? 'Anonymous');

    return c.json({ success: true, data: session });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to join session';
    log.error({ error }, message);
    return c.json({ success: false, error: message }, 500);
  }
});

/**
 * POST /sessions/:sessionId/leave - Leave a session
 */
app.post('/sessions/:sessionId/leave', requireAuth, requireOrgAccess, async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    const userId = c.get('userId') as string;

    await leaveSession(sessionId, userId);

    return c.json({ success: true, data: { message: 'Left session' } });
  } catch (error) {
    log.error({ error }, 'Failed to leave session');
    return c.json({ success: false, error: 'Failed to leave session' }, 500);
  }
});

/**
 * POST /sessions/:sessionId/operations - Apply an edit operation
 */
app.post('/sessions/:sessionId/operations', requireAuth, requireOrgAccess, async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    const body = await c.req.json();
    const userId = c.get('userId') as string;

    const operation = {
      ...body,
      userId,
      timestamp: Date.now(),
    };

    const doc = await applyOperation(sessionId, operation);

    return c.json({ success: true, data: doc });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply operation';
    log.error({ error }, message);
    return c.json({ success: false, error: message }, 500);
  }
});

/**
 * POST /sessions/:sessionId/cursor - Update cursor position
 */
app.post('/sessions/:sessionId/cursor', requireAuth, requireOrgAccess, async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    const body = await c.req.json();
    const userId = c.get('userId') as string;

    await updateCursorPosition(sessionId, userId, body);

    return c.json({ success: true, data: { message: 'Cursor updated' } });
  } catch (error) {
    log.error({ error }, 'Failed to update cursor');
    return c.json({ success: false, error: 'Failed to update cursor' }, 500);
  }
});

/**
 * GET /sessions/:sessionId/users - Get active editors
 */
app.get('/sessions/:sessionId/users', requireAuth, requireOrgAccess, async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    const users = await getSessionUsers(sessionId);

    return c.json({ success: true, data: users });
  } catch (error) {
    log.error({ error }, 'Failed to get session users');
    return c.json({ success: false, error: 'Failed to get session users' }, 500);
  }
});

// ============================================================================
// Document Management
// ============================================================================

/**
 * GET /documents/:documentId - Get document state
 */
app.get('/documents/:documentId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const documentId = c.req.param('documentId');
    const doc = await getDocument(documentId);

    if (!doc) {
      return c.json({ success: false, error: 'Document not found' }, 404);
    }

    return c.json({ success: true, data: doc });
  } catch (error) {
    log.error({ error }, 'Failed to get document');
    return c.json({ success: false, error: 'Failed to get document' }, 500);
  }
});

/**
 * GET /documents/:documentId/history - Get version history
 */
app.get('/documents/:documentId/history', requireAuth, requireOrgAccess, async (c) => {
  try {
    const documentId = c.req.param('documentId');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);

    const history = await getVersionHistory(documentId, limit);

    return c.json({ success: true, data: history });
  } catch (error) {
    log.error({ error }, 'Failed to get version history');
    return c.json({ success: false, error: 'Failed to get version history' }, 500);
  }
});

/**
 * POST /documents/:documentId/revert - Revert to a version
 */
app.post('/documents/:documentId/revert', requireAuth, requireOrgAccess, async (c) => {
  try {
    const documentId = c.req.param('documentId');
    const body = await c.req.json();
    const { version } = body;

    if (version === undefined) {
      return c.json({ success: false, error: 'version is required' }, 400);
    }

    const doc = await revertToVersion(documentId, version);

    return c.json({ success: true, data: doc });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to revert document';
    log.error({ error }, message);
    return c.json({ success: false, error: message }, 500);
  }
});

// ============================================================================
// AI Suggestions
// ============================================================================

/**
 * POST /documents/:documentId/ai-suggestions - Get AI suggestions
 */
app.post('/documents/:documentId/ai-suggestions', requireAuth, requireOrgAccess, async (c) => {
  try {
    const documentId = c.req.param('documentId');
    const body = await c.req.json();

    const suggestions = await getAISuggestions(documentId, {
      cursorLine: body.cursorLine ?? 0,
      cursorCol: body.cursorCol ?? 0,
      selectedText: body.selectedText,
    });

    // Queue background AI suggestion generation for deeper analysis
    try {
      await addJob(
        QUEUE_NAMES.REALTIME_EDITOR,
        {
          action: 'ai-suggestions',
          documentId,
          context: body,
        },
        { jobId: `realtime-ai-${documentId}-${Date.now()}` }
      );
    } catch {
      // Queue may not be available
    }

    return c.json({ success: true, data: suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get AI suggestions';
    log.error({ error }, message);
    return c.json({ success: false, error: message }, 500);
  }
});

/**
 * POST /documents/:documentId/apply-suggestion - Apply an AI suggestion
 */
app.post('/documents/:documentId/apply-suggestion', requireAuth, requireOrgAccess, async (c) => {
  try {
    const documentId = c.req.param('documentId');
    const body = await c.req.json();
    const { suggestionId } = body;

    if (!suggestionId) {
      return c.json({ success: false, error: 'suggestionId is required' }, 400);
    }

    const doc = await applyAISuggestion(documentId, suggestionId);

    return c.json({ success: true, data: doc });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply suggestion';
    log.error({ error }, message);
    return c.json({ success: false, error: message }, 500);
  }
});

export { app as realtimeEditorRoutes };
