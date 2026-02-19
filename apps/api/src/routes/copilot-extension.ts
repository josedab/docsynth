/**
 * Copilot Extension Routes
 *
 * API endpoints for the GitHub Copilot extension integration,
 * handling commands, chat streaming, and conversation history.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth } from '../middleware/auth.js';
import {
  handleCommand,
  storeMessage,
  getConversationHistory,
} from '../services/copilot-extension.service.js';

const log = createLogger('copilot-extension-routes');
const app = new Hono();

/**
 * POST /command - Handle a Copilot command (no auth required, called by Copilot)
 */
app.post('/command', async (c) => {
  try {
    const body = await c.req.json<{
      command: string;
      args?: string[];
      context?: Record<string, unknown>;
    }>();

    if (!body.command) {
      return c.json({ success: false, error: 'command is required' }, 400);
    }

    const result = await handleCommand(body.command, body.args, body.context);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to handle command');
    return c.json({ success: false, error: 'Failed to handle command' }, 500);
  }
});

/**
 * POST /chat - Stream a chat response via the Copilot extension
 */
app.post('/chat', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      conversationId: string;
      message: string;
      repositoryId?: string;
    }>();

    if (!body.conversationId || !body.message) {
      return c.json({ success: false, error: 'conversationId and message are required' }, 400);
    }

    await storeMessage(body.conversationId, body.message, 'user');

    const job = await addJob(QUEUE_NAMES.COPILOT_EXTENSION, {
      conversationId: body.conversationId,
      message: body.message,
      repositoryId: body.repositoryId,
    });

    return c.json({ success: true, data: { jobId: job.id, message: 'Chat response queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to process chat message');
    return c.json({ success: false, error: 'Failed to process chat message' }, 500);
  }
});

/**
 * GET /conversation/:conversationId - Get conversation history
 */
app.get('/conversation/:conversationId', requireAuth, async (c) => {
  try {
    const conversationId = c.req.param('conversationId');
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const history = await getConversationHistory(conversationId, limit);
    return c.json({ success: true, data: history });
  } catch (error) {
    log.error({ error }, 'Failed to get conversation history');
    return c.json({ success: false, error: 'Failed to get conversation history' }, 500);
  }
});

export { app as copilotExtensionRoutes };
