/**
 * Framework Templates Routes
 *
 * API endpoints for detecting frameworks in repositories, listing
 * available templates, rendering templates, and managing custom templates.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  detectFrameworks,
  listTemplates,
  getTemplate,
  renderTemplate,
  createCustomTemplate,
} from '../services/framework-templates.service.js';

const log = createLogger('framework-templates-routes');
const app = new Hono();

/**
 * POST /detect/:repositoryId - Detect frameworks used in a repository
 */
app.post('/detect/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const body = await c.req.json<{
      installationId?: number;
      options?: Record<string, unknown>;
    }>();

    const result = await detectFrameworks(repositoryId, body.installationId, body.options);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to detect frameworks');
    return c.json({ success: false, error: 'Failed to detect frameworks' }, 500);
  }
});

/**
 * GET /templates - List all available documentation templates
 */
app.get('/templates', requireAuth, async (c) => {
  try {
    const category = c.req.query('category');
    const framework = c.req.query('framework');
    const templates = await listTemplates(category, framework);
    return c.json({ success: true, data: templates });
  } catch (error) {
    log.error({ error }, 'Failed to list templates');
    return c.json({ success: false, error: 'Failed to list templates' }, 500);
  }
});

/**
 * GET /template/:templateId - Get a specific template
 */
app.get('/template/:templateId', requireAuth, async (c) => {
  try {
    const templateId = c.req.param('templateId');
    const template = await getTemplate(templateId);

    if (!template) {
      return c.json({ success: false, error: 'Template not found' }, 404);
    }

    return c.json({ success: true, data: template });
  } catch (error) {
    log.error({ error }, 'Failed to get template');
    return c.json({ success: false, error: 'Failed to get template' }, 500);
  }
});

/**
 * POST /render - Render a template with provided data
 */
app.post('/render', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      templateId: string;
      data: Record<string, unknown>;
      format?: string;
    }>();

    if (!body.templateId || !body.data) {
      return c.json({ success: false, error: 'templateId and data are required' }, 400);
    }

    const result = await renderTemplate(body.templateId, body.data, body.format);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to render template');
    return c.json({ success: false, error: 'Failed to render template' }, 500);
  }
});

/**
 * POST /custom - Create a custom template
 */
app.post('/custom', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      content: string;
      category: string;
      framework?: string;
      metadata?: Record<string, unknown>;
    }>();

    if (!body.name || !body.content || !body.category) {
      return c.json({ success: false, error: 'name, content, and category are required' }, 400);
    }

    const template = await createCustomTemplate(
      body.name,
      body.content,
      body.category,
      body.framework,
      body.metadata
    );
    return c.json({ success: true, data: template }, 201);
  } catch (error) {
    log.error({ error }, 'Failed to create custom template');
    return c.json({ success: false, error: 'Failed to create custom template' }, 500);
  }
});

export { app as frameworkTemplatesRoutes };
