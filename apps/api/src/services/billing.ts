import { prisma } from '@docsynth/database';
import { createLogger, AppError } from '@docsynth/utils';
import { TIER_LIMITS } from '@docsynth/config';
import type { SubscriptionTier, SubscriptionStatus } from '@docsynth/types';
import Stripe from 'stripe';

const log = createLogger('billing-service');

// Price IDs (would come from environment in production)
const PRICE_IDS: Record<SubscriptionTier, string> = {
  FREE: '',
  PRO: process.env.STRIPE_PRICE_PRO ?? 'price_pro',
  TEAM: process.env.STRIPE_PRICE_TEAM ?? 'price_team',
  ENTERPRISE: process.env.STRIPE_PRICE_ENTERPRISE ?? 'price_enterprise',
};

export class BillingService {
  private stripe: Stripe | null = null;

  constructor() {
    if (process.env.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      log.info('Stripe client initialized');
    } else {
      log.warn('Stripe not configured - running in mock mode');
    }
  }

  async createCustomer(organizationId: string, email: string, name: string): Promise<string> {
    if (!this.stripe) {
      log.warn('Stripe not configured, returning mock customer ID');
      return `cus_mock_${organizationId}`;
    }

    const customer = await this.stripe.customers.create({
      email,
      name,
      metadata: {
        organizationId,
      },
    });

    // Update subscription record
    await prisma.subscription.update({
      where: { organizationId },
      data: { stripeCustomerId: customer.id },
    });

    log.info({ organizationId, customerId: customer.id }, 'Created Stripe customer');
    return customer.id;
  }

  async createSubscription(
    organizationId: string,
    tier: SubscriptionTier
  ): Promise<{ subscriptionId: string; clientSecret?: string }> {
    if (tier === 'FREE') {
      // Free tier doesn't need Stripe subscription
      await this.updateSubscriptionTier(organizationId, 'FREE');
      return { subscriptionId: 'free' };
    }

    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
      include: { organization: true },
    });

    if (!subscription) {
      throw new AppError('Subscription not found', 'SUBSCRIPTION_NOT_FOUND', 404);
    }

    if (!this.stripe) {
      // Mock subscription for development
      const mockId = `sub_mock_${Date.now()}`;
      await prisma.subscription.update({
        where: { organizationId },
        data: {
          tier: tier.toUpperCase() as SubscriptionTier,
          stripeSubscriptionId: mockId,
          status: 'ACTIVE',
        },
      });
      return { subscriptionId: mockId };
    }

    // Ensure customer exists
    let customerId = subscription.stripeCustomerId;
    if (!customerId) {
      customerId = await this.createCustomer(
        organizationId,
        `org-${organizationId}@docsynth.io`,
        subscription.organization.name
      );
    }

    // Create Stripe subscription
    const stripeSubscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: PRICE_IDS[tier] }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent', 'items.data'],
    });

    // Get period from first subscription item
    const firstItem = stripeSubscription.items.data[0];
    const periodStart = firstItem?.current_period_start 
      ? new Date(firstItem.current_period_start * 1000) 
      : new Date();
    const periodEnd = firstItem?.current_period_end 
      ? new Date(firstItem.current_period_end * 1000) 
      : new Date();

    // Update database
    await prisma.subscription.update({
      where: { organizationId },
      data: {
        tier: tier.toUpperCase() as SubscriptionTier,
        stripeSubscriptionId: stripeSubscription.id,
        status: this.mapStripeStatus(stripeSubscription.status),
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });

    log.info({ organizationId, subscriptionId: stripeSubscription.id }, 'Created subscription');

    // Extract client secret for payment if available
    let clientSecret: string | undefined;
    const latestInvoice = stripeSubscription.latest_invoice;
    if (typeof latestInvoice === 'object' && latestInvoice !== null) {
      const invoice = latestInvoice as unknown as Record<string, unknown>;
      const paymentIntent = invoice.payment_intent;
      if (typeof paymentIntent === 'object' && paymentIntent !== null) {
        const pi = paymentIntent as Record<string, unknown>;
        if (typeof pi.client_secret === 'string') {
          clientSecret = pi.client_secret;
        }
      }
    }

    return {
      subscriptionId: stripeSubscription.id,
      clientSecret,
    };
  }

  async cancelSubscription(organizationId: string): Promise<void> {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription?.stripeSubscriptionId) {
      throw new AppError('No active subscription', 'NO_SUBSCRIPTION', 400);
    }

    if (this.stripe && !subscription.stripeSubscriptionId.startsWith('sub_mock')) {
      await this.stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
    }

    await prisma.subscription.update({
      where: { organizationId },
      data: {
        status: 'CANCELED',
        tier: 'FREE',
      },
    });

    log.info({ organizationId }, 'Subscription canceled');
  }

  async updateSubscriptionTier(organizationId: string, tier: SubscriptionTier): Promise<void> {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription) {
      throw new AppError('Subscription not found', 'SUBSCRIPTION_NOT_FOUND', 404);
    }

    if (
      this.stripe &&
      subscription.stripeSubscriptionId &&
      !subscription.stripeSubscriptionId.startsWith('sub_mock') &&
      tier !== 'FREE'
    ) {
      // Update Stripe subscription
      const stripeSubscription = await this.stripe.subscriptions.retrieve(
        subscription.stripeSubscriptionId
      );

      const itemId = stripeSubscription.items.data[0]?.id;
      if (itemId) {
        await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          items: [
            {
              id: itemId,
              price: PRICE_IDS[tier],
            },
          ],
        });
      }
    }

    await prisma.subscription.update({
      where: { organizationId },
      data: { tier: tier.toUpperCase() as SubscriptionTier },
    });

    // Update organization tier
    await prisma.organization.update({
      where: { id: organizationId },
      data: { subscriptionTier: tier.toUpperCase() as SubscriptionTier },
    });

    log.info({ organizationId, tier }, 'Subscription tier updated');
  }

  async getUsage(organizationId: string): Promise<{
    currentPeriod: { start: Date; end: Date };
    usage: {
      repositories: number;
      generations: number;
      tokensUsed: number;
    };
    limits: {
      maxRepositories: number;
      maxGenerationsPerMonth: number;
    };
  }> {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription) {
      throw new AppError('Subscription not found', 'SUBSCRIPTION_NOT_FOUND', 404);
    }

    const tier = subscription.tier.toLowerCase() as SubscriptionTier;
    const limits = TIER_LIMITS[tier];

    // Get current period usage
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const usageRecords = await prisma.usageRecord.findMany({
      where: {
        organizationId,
        period: currentPeriod,
      },
    });

    const totalGenerations = usageRecords.reduce((sum, r) => sum + r.generationsCount, 0);
    const totalTokens = usageRecords.reduce((sum, r) => sum + r.tokensUsed, 0);

    const repoCount = await prisma.repository.count({
      where: { organizationId, enabled: true },
    });

    return {
      currentPeriod: {
        start: subscription.currentPeriodStart,
        end: subscription.currentPeriodEnd,
      },
      usage: {
        repositories: repoCount,
        generations: totalGenerations,
        tokensUsed: totalTokens,
      },
      limits: {
        maxRepositories: limits?.maxRepositories ?? 3,
        maxGenerationsPerMonth: limits?.maxGenerationsPerMonth ?? 50,
      },
    };
  }

  async checkLimits(organizationId: string): Promise<{
    canGenerate: boolean;
    canAddRepository: boolean;
    reason?: string;
  }> {
    const usage = await this.getUsage(organizationId);

    const canGenerate =
      usage.limits.maxGenerationsPerMonth === -1 ||
      usage.usage.generations < usage.limits.maxGenerationsPerMonth;

    const canAddRepository =
      usage.limits.maxRepositories === -1 ||
      usage.usage.repositories < usage.limits.maxRepositories;

    return {
      canGenerate,
      canAddRepository,
      reason: !canGenerate
        ? 'Monthly generation limit reached'
        : !canAddRepository
          ? 'Repository limit reached'
          : undefined,
    };
  }

  async getInvoices(organizationId: string): Promise<
    Array<{
      id: string;
      amount: number;
      status: string;
      date: Date;
      url: string;
    }>
  > {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription?.stripeCustomerId || !this.stripe) {
      return [];
    }

    try {
      const invoices = await this.stripe.invoices.list({
        customer: subscription.stripeCustomerId,
        limit: 12,
      });

      return invoices.data.map((invoice) => ({
        id: invoice.id,
        amount: (invoice.amount_due ?? 0) / 100,
        status: invoice.status ?? 'unknown',
        date: invoice.created ? new Date(invoice.created * 1000) : new Date(),
        url: invoice.hosted_invoice_url ?? '',
      }));
    } catch (error) {
      log.error({ error, organizationId }, 'Failed to fetch invoices');
      return [];
    }
  }

  async createBillingPortalSession(organizationId: string): Promise<string> {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!subscription?.stripeCustomerId) {
      throw new AppError('No billing customer', 'NO_CUSTOMER', 400);
    }

    if (!this.stripe) {
      return `${process.env.APP_URL}/dashboard/billing`;
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${process.env.APP_URL}/dashboard/billing`,
    });

    return session.url;
  }

  async handleWebhook(event: Stripe.Event): Promise<void> {
    log.info({ type: event.type }, 'Processing Stripe webhook');

    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.syncSubscription(subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        log.info({ invoiceId: invoice.id }, 'Payment succeeded');
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        log.warn({ invoiceId: invoice.id }, 'Payment failed');
        // Could trigger notification here
        break;
      }

      default:
        log.debug({ type: event.type }, 'Unhandled webhook event');
    }
  }

  private async syncSubscription(stripeSubscription: Stripe.Subscription): Promise<void> {
    const subscription = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: stripeSubscription.id },
    });

    if (!subscription) {
      log.warn({ subscriptionId: stripeSubscription.id }, 'Subscription not found');
      return;
    }

    // Get period from first subscription item
    const firstItem = stripeSubscription.items.data[0];
    const periodStart = firstItem?.current_period_start 
      ? new Date(firstItem.current_period_start * 1000) 
      : new Date();
    const periodEnd = firstItem?.current_period_end 
      ? new Date(firstItem.current_period_end * 1000) 
      : new Date();

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: this.mapStripeStatus(stripeSubscription.status),
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });
  }

  async createCheckoutSession(
    organizationId: string,
    tier: SubscriptionTier,
    successUrl: string,
    cancelUrl: string
  ): Promise<{ sessionId: string; url: string }> {
    if (!this.stripe) {
      return { sessionId: 'mock_session', url: successUrl };
    }

    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
      include: { organization: true },
    });

    if (!subscription) {
      throw new AppError('Subscription not found', 'SUBSCRIPTION_NOT_FOUND', 404);
    }

    // Get or create customer
    let customerId = subscription.stripeCustomerId;
    if (!customerId) {
      customerId = await this.createCustomer(
        organizationId,
        `org-${organizationId}@docsynth.io`,
        subscription.organization.name
      );
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [
        {
          price: PRICE_IDS[tier],
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        organizationId,
        tier,
      },
    });

    return { sessionId: session.id, url: session.url ?? successUrl };
  }

  private mapStripeStatus(status: string): SubscriptionStatus {
    const mapping: Record<string, SubscriptionStatus> = {
      active: 'ACTIVE',
      canceled: 'CANCELED',
      past_due: 'PAST_DUE',
      trialing: 'TRIALING',
      unpaid: 'UNPAID',
    };
    return mapping[status] ?? 'ACTIVE';
  }
}

export const billingService = new BillingService();
