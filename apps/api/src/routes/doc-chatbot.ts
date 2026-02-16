/**
 * Documentation Chatbot Routes
 *
 * API endpoints for embeddable documentation chatbot.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  processMessage,
  getChatbotConfig,
  upsertChatbotConfig,
  getChatbotAnalytics,
  rateConversation,
  escalateConversation,
  getWidgetScript,
  type ChatbotConfig,
} from '../services/doc-chatbot.service.js';

const log = createLogger('doc-chatbot-routes');

const app = new Hono();

/**
 * POST /message - Send a message to the chatbot
 */
app.post('/message', async (c) => {
  const body = await c.req.json<{
    chatbotConfigId: string;
    conversationId: string;
    message: string;
    visitorId: string;
  }>();

  if (!body.chatbotConfigId || !body.message || !body.visitorId) {
    return c.json(
      { success: false, error: 'chatbotConfigId, message, and visitorId are required' },
      400
    );
  }

  try {
    const response = await processMessage(
      body.chatbotConfigId,
      body.conversationId || `conv-${Date.now()}`,
      body.message,
      body.visitorId
    );
    return c.json({ success: true, data: response });
  } catch (error) {
    log.error({ error }, 'Chatbot message processing failed');
    return c.json({ success: false, error: 'Processing failed' }, 500);
  }
});

/**
 * GET /config/:repositoryId - Get chatbot configuration
 */
app.get('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const config = await getChatbotConfig(c.req.param('repositoryId'));
  if (!config) return c.json({ success: false, error: 'No chatbot configured' }, 404);
  return c.json({ success: true, data: config });
});

/**
 * PUT /config/:repositoryId - Create or update chatbot config
 */
app.put('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<Partial<ChatbotConfig>>();

  try {
    const config = await upsertChatbotConfig(c.req.param('repositoryId'), body);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error }, 'Config update failed');
    return c.json({ success: false, error: 'Update failed' }, 500);
  }
});

/**
 * GET /analytics/:chatbotConfigId - Get chatbot analytics
 */
app.get('/analytics/:chatbotConfigId', requireAuth, async (c) => {
  const days = parseInt(c.req.query('days') || '30', 10);

  try {
    const analytics = await getChatbotAnalytics(c.req.param('chatbotConfigId'), days);
    return c.json({ success: true, data: analytics });
  } catch (error) {
    log.error({ error }, 'Analytics retrieval failed');
    return c.json({ success: false, error: 'Failed to get analytics' }, 500);
  }
});

/**
 * POST /rate/:conversationId - Rate a conversation
 */
app.post('/rate/:conversationId', async (c) => {
  const body = await c.req.json<{ satisfaction: number }>();

  if (!body.satisfaction || body.satisfaction < 1 || body.satisfaction > 5) {
    return c.json({ success: false, error: 'satisfaction must be 1-5' }, 400);
  }

  await rateConversation(c.req.param('conversationId'), body.satisfaction);
  return c.json({ success: true });
});

/**
 * POST /escalate/:conversationId - Escalate to human support
 */
app.post('/escalate/:conversationId', async (c) => {
  await escalateConversation(c.req.param('conversationId'));
  return c.json({ success: true });
});

/**
 * GET /widget/:repositoryId - Get embeddable widget script
 */
app.get('/widget/:repositoryId', async (c) => {
  const script = await getWidgetScript(c.req.param('repositoryId'));
  if (!script) return c.json({ success: false, error: 'No chatbot configured' }, 404);
  return c.json({ success: true, data: { script } });
});

export { app as docChatbotRoutes };
