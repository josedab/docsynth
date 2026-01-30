import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { billingService } from '../services/billing.js';
import { ValidationError } from '@docsynth/utils';

const app = new Hono();

// Get subscription info
app.get('/', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: orgId },
    include: {
      organization: {
        select: { name: true, subscriptionTier: true },
      },
    },
  });

  if (!subscription) {
    return c.json({
      success: true,
      data: {
        tier: 'free',
        status: 'active',
        hasPaymentMethod: false,
      },
    });
  }

  return c.json({
    success: true,
    data: {
      tier: subscription.tier.toLowerCase(),
      status: subscription.status.toLowerCase(),
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      hasPaymentMethod: !!subscription.stripeCustomerId,
    },
  });
});

// Get usage
app.get('/usage', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const usage = await billingService.getUsage(orgId);

  return c.json({
    success: true,
    data: usage,
  });
});

// Create/update subscription
app.post('/subscribe', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json();
  const tier = body.tier as string;

  if (!['free', 'pro', 'team', 'enterprise'].includes(tier)) {
    throw new ValidationError('Invalid tier');
  }

  const result = await billingService.createSubscription(orgId, tier.toUpperCase() as 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE');

  return c.json({
    success: true,
    data: result,
  });
});

// Cancel subscription
app.post('/cancel', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  await billingService.cancelSubscription(orgId);

  return c.json({
    success: true,
    data: { message: 'Subscription canceled' },
  });
});

// Get invoices
app.get('/invoices', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const invoices = await billingService.getInvoices(orgId);

  return c.json({
    success: true,
    data: invoices,
  });
});

// Get billing portal URL
app.post('/portal', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const url = await billingService.createBillingPortalSession(orgId);

  return c.json({
    success: true,
    data: { url },
  });
});

// Create checkout session for subscription
app.post('/checkout', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json();
  const tier = body.tier as string;

  if (!['pro', 'team', 'enterprise'].includes(tier)) {
    throw new ValidationError('Invalid tier for checkout');
  }

  const baseUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const result = await billingService.createCheckoutSession(
    orgId,
    tier.toUpperCase() as 'PRO' | 'TEAM' | 'ENTERPRISE',
    `${baseUrl}/dashboard/settings?billing=success`,
    `${baseUrl}/dashboard/settings?billing=canceled`
  );

  return c.json({
    success: true,
    data: result,
  });
});

// Stripe webhook
app.post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  const rawBody = await c.req.text();

  if (!signature) {
    throw new ValidationError('Missing Stripe signature');
  }

  // In production, verify the webhook signature
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (webhookSecret) {
    // Would verify with Stripe here
  }

  const event = JSON.parse(rawBody);
  await billingService.handleWebhook(event);

  return c.json({ received: true });
});

// Check limits
app.get('/limits', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const limits = await billingService.checkLimits(orgId);

  return c.json({
    success: true,
    data: limits,
  });
});

export { app as billingRoutes };
