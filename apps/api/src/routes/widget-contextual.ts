/**
 * Widget Contextual Routes
 *
 * Contextual documentation widget endpoints.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  resolveContext,
  getWidgetConfig,
  createWidgetConfig,
  updateWidgetConfig,
  generateEmbedSnippet,
  getWidgetAnalytics,
} from '../services/widget-contextual.service.js';

const log = createLogger('widget-contextual-routes');
const app = new Hono();

app.post('/resolve', async (c) => {
  const body = await c.req.json<{
    widgetId: string;
    urlPath?: string;
    apiEndpoint?: string;
    searchQuery?: string;
    userRole?: string;
  }>();

  if (!body.widgetId) return c.json({ success: false, error: 'widgetId is required' }, 400);

  try {
    const result = await resolveContext(body.widgetId, body);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error, widgetId: body.widgetId }, 'Failed to resolve context');
    return c.json({ success: false, error: 'Failed to resolve context' }, 500);
  }
});

app.post('/create', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    theme?: 'light' | 'dark' | 'auto';
    position?: 'bottom-right' | 'bottom-left' | 'sidebar';
    enableSearch?: boolean;
    enableChat?: boolean;
    contextRules?: Array<{ urlPattern: string; docPath: string; priority: number }>;
    allowedOrigins?: string[];
  }>();

  if (!body.repositoryId) return c.json({ success: false, error: 'repositoryId is required' }, 400);

  try {
    const config = await createWidgetConfig({
      repositoryId: body.repositoryId,
      theme: body.theme ?? 'auto',
      position: body.position ?? 'bottom-right',
      enableSearch: body.enableSearch ?? true,
      enableChat: body.enableChat ?? false,
      contextRules: body.contextRules ?? [],
      allowedOrigins: body.allowedOrigins ?? [],
      branding: true,
    });
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error }, 'Failed to create widget');
    return c.json({ success: false, error: 'Failed to create widget' }, 500);
  }
});

app.get('/config/:widgetId', requireAuth, requireOrgAccess, async (c) => {
  const widgetId = c.req.param('widgetId');
  try {
    const config = await getWidgetConfig(widgetId);
    if (!config) return c.json({ success: false, error: 'Widget not found' }, 404);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error, widgetId }, 'Failed to get widget config');
    return c.json({ success: false, error: 'Failed to get config' }, 500);
  }
});

app.post('/config/:widgetId', requireAuth, requireOrgAccess, async (c) => {
  const widgetId = c.req.param('widgetId');
  const body =
    await c.req.json<Partial<{ theme: string; enableSearch: boolean; enableChat: boolean }>>();

  try {
    const config = await updateWidgetConfig(widgetId, body as any);
    if (!config) return c.json({ success: false, error: 'Widget not found' }, 404);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error, widgetId }, 'Failed to update widget');
    return c.json({ success: false, error: 'Failed to update widget' }, 500);
  }
});

app.get('/embed/:widgetId', async (c) => {
  const widgetId = c.req.param('widgetId');
  const baseUrl = c.req.url.split('/api/')[0] ?? '';

  try {
    const snippet = generateEmbedSnippet(widgetId, baseUrl);
    return c.json({ success: true, data: snippet });
  } catch (error) {
    log.error({ error, widgetId }, 'Failed to generate embed snippet');
    return c.json({ success: false, error: 'Failed to generate snippet' }, 500);
  }
});

app.get('/analytics/:widgetId', requireAuth, requireOrgAccess, async (c) => {
  const widgetId = c.req.param('widgetId');
  const days = parseInt(c.req.query('days') || '30', 10);

  try {
    const analytics = await getWidgetAnalytics(widgetId, days);
    return c.json({ success: true, data: analytics });
  } catch (error) {
    log.error({ error, widgetId }, 'Failed to get widget analytics');
    return c.json({ success: false, error: 'Failed to get analytics' }, 500);
  }
});

export { app as widgetContextualRoutes };
