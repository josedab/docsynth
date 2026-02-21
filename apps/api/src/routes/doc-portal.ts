/**
 * Doc Portal Routes
 *
 * API endpoints for managing documentation portals including creation,
 * building, analytics, and public page resolution.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  createPortal,
  getPortal,
  updatePortal,
  listPortals,
  getPortalAnalytics,
  resolvePortalPage,
} from '../services/doc-portal.service.js';

const log = createLogger('doc-portal-routes');
const app = new Hono();

/**
 * POST /create - Create a new documentation portal
 */
app.post('/create', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      organizationId: string;
      name: string;
      config?: Record<string, unknown>;
    }>();

    if (!body.organizationId || !body.name) {
      return c.json({ success: false, error: 'organizationId and name are required' }, 400);
    }

    const portal = await createPortal(body.organizationId, body.name, body.config);
    return c.json({ success: true, data: portal });
  } catch (error) {
    log.error({ error }, 'Failed to create portal');
    return c.json({ success: false, error: 'Failed to create portal' }, 500);
  }
});

/**
 * POST /build/:portalId - Queue a portal build
 */
app.post('/build/:portalId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const portalId = c.req.param('portalId');

    const job = await addJob(QUEUE_NAMES.DOC_PORTAL, {
      portalId,
      action: 'build' as const,
    });

    return c.json({ success: true, data: { jobId: job.id, message: 'Portal build queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to queue portal build');
    return c.json({ success: false, error: 'Failed to queue portal build' }, 500);
  }
});

/**
 * GET /portal/:portalId - Get portal details
 */
app.get('/portal/:portalId', requireAuth, async (c) => {
  try {
    const portal = await getPortal(c.req.param('portalId'));
    if (!portal) return c.json({ success: false, error: 'Portal not found' }, 404);
    return c.json({ success: true, data: portal });
  } catch (error) {
    log.error({ error }, 'Failed to get portal');
    return c.json({ success: false, error: 'Failed to get portal' }, 500);
  }
});

/**
 * POST /portal/:portalId - Update portal configuration
 */
app.post('/portal/:portalId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ name?: string; config?: Record<string, unknown> }>();
    const portal = await updatePortal(c.req.param('portalId'), body);
    return c.json({ success: true, data: portal });
  } catch (error) {
    log.error({ error }, 'Failed to update portal');
    return c.json({ success: false, error: 'Failed to update portal' }, 500);
  }
});

/**
 * GET /list/:organizationId - List portals for an organization
 */
app.get('/list/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const portals = await listPortals(c.req.param('organizationId'));
    return c.json({ success: true, data: portals });
  } catch (error) {
    log.error({ error }, 'Failed to list portals');
    return c.json({ success: false, error: 'Failed to list portals' }, 500);
  }
});

/**
 * GET /analytics/:portalId - Get portal analytics
 */
app.get('/analytics/:portalId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const analytics = await getPortalAnalytics(c.req.param('portalId'));
    return c.json({ success: true, data: analytics });
  } catch (error) {
    log.error({ error }, 'Failed to get portal analytics');
    return c.json({ success: false, error: 'Failed to get portal analytics' }, 500);
  }
});

/**
 * GET /page/:portalId/* - Resolve a public portal page (no auth)
 */
app.get('/page/:portalId/*', async (c) => {
  try {
    const portalId = c.req.param('portalId');
    const pagePath = c.req.path.replace(`/page/${portalId}/`, '') || '/';
    const page = await resolvePortalPage(portalId, pagePath);
    if (!page) return c.json({ success: false, error: 'Page not found' }, 404);
    return c.json({ success: true, data: page });
  } catch (error) {
    log.error({ error }, 'Failed to resolve portal page');
    return c.json({ success: false, error: 'Failed to resolve portal page' }, 500);
  }
});

export { app as docPortalRoutes };
