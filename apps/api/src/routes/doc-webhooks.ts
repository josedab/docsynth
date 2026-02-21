/**
 * Doc Webhooks Routes
 *
 * API endpoints for managing documentation webhook subscriptions,
 * testing deliveries, and viewing delivery logs.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  testWebhook,
  getDeliveryLog,
} from '../services/doc-webhooks.service.js';

const log = createLogger('doc-webhooks-routes');
const app = new Hono();

/**
 * POST /subscribe - Create a webhook subscription
 */
app.post('/subscribe', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      organizationId: string;
      url: string;
      events: string[];
      secret?: string;
    }>();

    if (!body.organizationId || !body.url || !body.events) {
      return c.json({ success: false, error: 'organizationId, url, and events are required' }, 400);
    }

    const subscription = await createSubscription(
      body.organizationId,
      body.url,
      body.events,
      body.secret
    );
    return c.json({ success: true, data: subscription });
  } catch (error) {
    log.error({ error }, 'Failed to create subscription');
    return c.json({ success: false, error: 'Failed to create subscription' }, 500);
  }
});

/**
 * DELETE /subscription/:id - Delete a webhook subscription
 */
app.delete('/subscription/:id', requireAuth, requireOrgAccess, async (c) => {
  try {
    await deleteSubscription(c.req.param('id'));
    return c.json({ success: true, data: { message: 'Subscription deleted' } });
  } catch (error) {
    log.error({ error }, 'Failed to delete subscription');
    return c.json({ success: false, error: 'Failed to delete subscription' }, 500);
  }
});

/**
 * GET /subscriptions/:organizationId - List subscriptions for an organization
 */
app.get('/subscriptions/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const subscriptions = await listSubscriptions(c.req.param('organizationId'));
    return c.json({ success: true, data: subscriptions });
  } catch (error) {
    log.error({ error }, 'Failed to list subscriptions');
    return c.json({ success: false, error: 'Failed to list subscriptions' }, 500);
  }
});

/**
 * POST /test/:subscriptionId - Send a test webhook event
 */
app.post('/test/:subscriptionId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const result = await testWebhook(c.req.param('subscriptionId'));
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to test webhook');
    return c.json({ success: false, error: 'Failed to test webhook' }, 500);
  }
});

/**
 * GET /deliveries/:subscriptionId - Get delivery log for a subscription
 */
app.get('/deliveries/:subscriptionId', requireAuth, async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const deliveries = await getDeliveryLog(c.req.param('subscriptionId'), limit);
    return c.json({ success: true, data: deliveries });
  } catch (error) {
    log.error({ error }, 'Failed to get delivery log');
    return c.json({ success: false, error: 'Failed to get delivery log' }, 500);
  }
});

export { app as docWebhooksRoutes };
