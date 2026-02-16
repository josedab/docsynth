/**
 * Embeddable Documentation Widget Routes
 *
 * Manages widget configuration, embed code generation,
 * event tracking, search, chat, and analytics.
 */

import { Hono } from 'hono';
import { createLogger, ValidationError, NotFoundError } from '@docsynth/utils';
import { requireAuth } from '../middleware/auth.js';
import {
  createWidgetConfig,
  getWidgetConfig,
  updateWidgetConfig,
  deleteWidgetConfig,
  trackWidgetEvent,
  getWidgetAnalytics,
  generateWidgetToken,
} from '../services/widget.service.js';
import { generateEmbedSnippet, validateWidgetConfig } from '@docsynth/widget';

const log = createLogger('widget-routes');

const app = new Hono();

// ============================================================================
// Widget Config CRUD
// ============================================================================

/**
 * Create widget config for an organization.
 * POST /create
 */
app.post('/create', requireAuth, async (c) => {
  const body = await c.req.json<{ orgId: string; config: Record<string, unknown> }>();

  if (!body.orgId) {
    throw new ValidationError('orgId is required');
  }

  const validation = validateWidgetConfig(body.config ?? {});
  if (!validation.valid) {
    throw new ValidationError(`Invalid widget config: ${validation.errors.join(', ')}`);
  }

  const result = await createWidgetConfig(body.orgId, body.config ?? {});
  log.info({ widgetId: result.id }, 'Widget config created');

  return c.json({ success: true, data: result });
});

/**
 * Get widget config (public, no auth required — for widget to load).
 * GET /config/:widgetId
 */
app.get('/config/:widgetId', async (c) => {
  const widgetId = c.req.param('widgetId');
  const config = await getWidgetConfig(widgetId);

  if (!config) {
    throw new NotFoundError(`Widget config not found: ${widgetId}`);
  }

  return c.json({ success: true, data: config });
});

/**
 * Update widget config.
 * PUT /config/:widgetId
 */
app.put('/config/:widgetId', requireAuth, async (c) => {
  const widgetId = c.req.param('widgetId');
  const body = await c.req.json<{ config: Record<string, unknown> }>();

  const validation = validateWidgetConfig(body.config ?? {});
  if (!validation.valid) {
    throw new ValidationError(`Invalid widget config: ${validation.errors.join(', ')}`);
  }

  const result = await updateWidgetConfig(widgetId, body.config ?? {});
  log.info({ widgetId }, 'Widget config updated');

  return c.json({ success: true, data: result });
});

/**
 * Delete widget config.
 * DELETE /:widgetId
 */
app.delete('/:widgetId', requireAuth, async (c) => {
  const widgetId = c.req.param('widgetId');
  await deleteWidgetConfig(widgetId);
  log.info({ widgetId }, 'Widget config deleted');

  return c.json({ success: true, message: 'Widget config deleted' });
});

// ============================================================================
// Event Tracking
// ============================================================================

/**
 * Track widget events (uses widget token).
 * POST /events/:widgetId
 */
app.post('/events/:widgetId', async (c) => {
  const widgetId = c.req.param('widgetId');
  const body = await c.req.json<{ type: string; metadata?: Record<string, unknown> }>();

  if (!body.type || !['impression', 'search', 'chat', 'feedback'].includes(body.type)) {
    throw new ValidationError('type must be one of: impression, search, chat, feedback');
  }

  const result = await trackWidgetEvent(widgetId, {
    type: body.type as 'impression' | 'search' | 'chat' | 'feedback',
    metadata: body.metadata,
  });

  return c.json({ success: true, data: result });
});

// ============================================================================
// Analytics
// ============================================================================

/**
 * Get widget analytics.
 * GET /analytics/:widgetId
 */
app.get('/analytics/:widgetId', requireAuth, async (c) => {
  const widgetId = c.req.param('widgetId');
  const startParam = c.req.query('start');
  const endParam = c.req.query('end');

  const start = startParam ? new Date(startParam) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endParam ? new Date(endParam) : new Date();

  const analytics = await getWidgetAnalytics(widgetId, { start, end });

  return c.json({ success: true, data: analytics });
});

// ============================================================================
// Embed Code
// ============================================================================

/**
 * Get embed snippet for a widget.
 * GET /embed-code/:widgetId
 */
app.get('/embed-code/:widgetId', requireAuth, async (c) => {
  const widgetId = c.req.param('widgetId');
  const config = await getWidgetConfig(widgetId);

  if (!config) {
    throw new NotFoundError(`Widget config not found: ${widgetId}`);
  }

  const snippet = generateEmbedSnippet({
    ...(config.config as Record<string, unknown>),
    apiKey: widgetId,
  });

  return c.json({ success: true, data: { snippet } });
});

// ============================================================================
// Widget Search & Chat
// ============================================================================

/**
 * Widget search endpoint (uses widget token).
 * POST /search/:widgetId
 */
app.post('/search/:widgetId', async (c) => {
  const widgetId = c.req.param('widgetId');
  const body = await c.req.json<{ query: string }>();

  if (!body.query) {
    throw new ValidationError('query is required');
  }

  log.info({ widgetId, query: body.query }, 'Widget search');

  // Placeholder: real implementation would query vector index
  return c.json({
    success: true,
    data: { widgetId, query: body.query, results: [] },
  });
});

/**
 * Widget chat endpoint (uses widget token).
 * POST /chat/:widgetId
 */
app.post('/chat/:widgetId', async (c) => {
  const widgetId = c.req.param('widgetId');
  const body = await c.req.json<{
    message: string;
    history?: Array<{ role: string; content: string }>;
  }>();

  if (!body.message) {
    throw new ValidationError('message is required');
  }

  log.info({ widgetId }, 'Widget chat');

  // Placeholder: real implementation would use RAG pipeline
  return c.json({
    success: true,
    data: { widgetId, message: body.message, response: '' },
  });
});

// ============================================================================
// Token Generation
// ============================================================================

/**
 * Generate a short-lived widget token.
 * POST /token/:widgetId (requireAuth)
 */
app.post('/token/:widgetId', requireAuth, async (c) => {
  const widgetId = c.req.param('widgetId');
  const body = await c.req.json<{ orgId: string }>();

  if (!body.orgId) {
    throw new ValidationError('orgId is required');
  }

  const token = await generateWidgetToken(body.orgId, widgetId);

  return c.json({ success: true, data: token });
});

export { app as widgetRoutes };
