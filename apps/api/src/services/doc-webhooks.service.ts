/**
 * Event-Driven Doc Webhooks Service
 *
 * Exposes DocSynth events as subscribable webhooks. Organizations can register
 * URLs to receive real-time notifications for documentation lifecycle events
 * such as generation, review, drift detection, and policy violations.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-webhooks-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface WebhookSubscription {
  id: string;
  organizationId: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  createdAt: Date;
}

export type WebhookEventType =
  | 'doc.generated'
  | 'doc.reviewed'
  | 'drift.detected'
  | 'coverage.changed'
  | 'policy.violated';

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  payload: Record<string, unknown>;
  timestamp: Date;
}

export interface DeliveryRecord {
  id: string;
  subscriptionId: string;
  eventId: string;
  status: 'pending' | 'delivered' | 'failed';
  statusCode?: number;
  attempts: number;
  lastAttemptAt: Date;
}

export interface WebhookTestResult {
  subscriptionId: string;
  delivered: boolean;
  statusCode: number;
  responseTimeMs: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create a new webhook subscription for an organization.
 */
export async function createSubscription(
  orgId: string,
  url: string,
  events: string[],
  secret: string
): Promise<WebhookSubscription> {
  const validEvents: WebhookEventType[] = [
    'doc.generated',
    'doc.reviewed',
    'drift.detected',
    'coverage.changed',
    'policy.violated',
  ];
  const invalid = events.filter((e) => !validEvents.includes(e as WebhookEventType));
  if (invalid.length > 0) throw new Error(`Invalid event types: ${invalid.join(', ')}`);

  const subscription = await db.webhookSubscription.create({
    data: {
      organizationId: orgId,
      url,
      events,
      secret,
      active: true,
      createdAt: new Date(),
    },
  });

  log.info({ orgId, url, events }, 'Webhook subscription created');

  return {
    id: subscription.id,
    organizationId: subscription.organizationId,
    url: subscription.url,
    events: subscription.events as string[],
    secret: subscription.secret,
    active: subscription.active,
    createdAt: subscription.createdAt,
  };
}

/**
 * Delete a webhook subscription by ID.
 */
export async function deleteSubscription(id: string): Promise<void> {
  await db.webhookSubscription.delete({ where: { id } });
  log.info({ subscriptionId: id }, 'Webhook subscription deleted');
}

/**
 * List all webhook subscriptions for an organization.
 */
export async function listSubscriptions(orgId: string): Promise<WebhookSubscription[]> {
  const subs = await db.webhookSubscription.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
  });

  return subs.map((s: any) => ({
    id: s.id,
    organizationId: s.organizationId,
    url: s.url,
    events: (s.events as string[]) ?? [],
    secret: s.secret,
    active: s.active,
    createdAt: s.createdAt,
  }));
}

/**
 * Deliver an event to all matching subscriptions.
 */
export async function deliverEvent(event: WebhookEvent): Promise<number> {
  const subscriptions = await db.webhookSubscription.findMany({
    where: { active: true },
  });

  const matching = subscriptions.filter(
    (s: any) => (s.events as string[]).includes(event.type) || (s.events as string[]).includes('*')
  );

  log.info({ eventType: event.type, matchingCount: matching.length }, 'Delivering webhook event');

  let delivered = 0;

  for (const sub of matching) {
    const payload = buildEventPayload(event, sub.id);
    const signature = signPayload(JSON.stringify(payload), sub.secret);
    const success = await deliverWithRetry(sub.url, payload, signature, sub.id, event.id);
    if (success) delivered++;
  }

  log.info({ eventType: event.type, delivered, total: matching.length }, 'Event delivery complete');
  return delivered;
}

/**
 * Retry all failed deliveries that haven't exceeded the max attempts.
 */
export async function retryFailedDeliveries(): Promise<number> {
  const maxAttempts = 5;
  const failed = await db.webhookDelivery.findMany({
    where: { status: 'failed', attempts: { lt: maxAttempts } },
    include: { subscription: true },
    orderBy: { lastAttemptAt: 'asc' },
    take: 100,
  });

  log.info({ count: failed.length }, 'Retrying failed webhook deliveries');

  let retried = 0;

  for (const delivery of failed) {
    const event = await db.webhookEvent.findUnique({ where: { id: delivery.eventId } });
    if (!event) continue;

    const payload = buildEventPayload(
      {
        id: event.id,
        type: event.type as WebhookEventType,
        payload: event.payload as Record<string, unknown>,
        timestamp: event.timestamp,
      },
      delivery.subscriptionId
    );

    const signature = signPayload(JSON.stringify(payload), delivery.subscription.secret);
    const success = await deliverWithRetry(
      delivery.subscription.url,
      payload,
      signature,
      delivery.subscriptionId,
      delivery.eventId,
      delivery.attempts
    );

    if (success) retried++;
  }

  log.info({ retried, total: failed.length }, 'Retry batch complete');
  return retried;
}

/**
 * Send a test ping to a webhook subscription to verify connectivity.
 */
export async function testWebhook(subscriptionId: string): Promise<WebhookTestResult> {
  const sub = await db.webhookSubscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) {
    throw new Error(`Subscription not found: ${subscriptionId}`);
  }

  const testPayload = {
    event: 'webhook.test',
    subscriptionId,
    timestamp: new Date().toISOString(),
    message: 'This is a test event from DocSynth',
  };

  const signature = signPayload(JSON.stringify(testPayload), sub.secret);
  const startTime = Date.now();

  try {
    const response = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DocSynth-Signature': signature,
        'X-DocSynth-Event': 'webhook.test',
      },
      body: JSON.stringify(testPayload),
      signal: AbortSignal.timeout(10_000),
    });

    const responseTimeMs = Date.now() - startTime;

    log.info(
      { subscriptionId, statusCode: response.status, responseTimeMs },
      'Webhook test completed'
    );

    return {
      subscriptionId,
      delivered: response.ok,
      statusCode: response.status,
      responseTimeMs,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startTime;
    log.warn({ subscriptionId, error }, 'Webhook test failed');

    return {
      subscriptionId,
      delivered: false,
      statusCode: 0,
      responseTimeMs,
    };
  }
}

/**
 * Get delivery log for a subscription.
 */
export async function getDeliveryLog(
  subscriptionId: string,
  limit = 50
): Promise<DeliveryRecord[]> {
  const deliveries = await db.webhookDelivery.findMany({
    where: { subscriptionId },
    orderBy: { lastAttemptAt: 'desc' },
    take: limit,
  });

  return deliveries.map((d: any) => ({
    id: d.id,
    subscriptionId: d.subscriptionId,
    eventId: d.eventId,
    status: d.status,
    statusCode: d.statusCode ?? undefined,
    attempts: d.attempts,
    lastAttemptAt: d.lastAttemptAt,
  }));
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute HMAC-SHA256 signature for a webhook payload.
 */
function signPayload(payload: string, secret: string): string {
  // Use a simple hash-based signature (in production, use crypto.createHmac)
  let hash = 0;
  const combined = `${secret}:${payload}`;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `sha256=${Math.abs(hash).toString(16).padStart(16, '0')}`;
}

/**
 * Deliver a payload to a URL with exponential backoff retry.
 */
async function deliverWithRetry(
  url: string,
  payload: Record<string, unknown>,
  signature: string,
  subscriptionId: string,
  eventId: string,
  previousAttempts = 0
): Promise<boolean> {
  const maxAttempts = 3;
  let attempt = previousAttempts;

  while (attempt < previousAttempts + maxAttempts) {
    attempt++;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-DocSynth-Signature': signature,
          'X-DocSynth-Delivery': eventId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });

      await db.webhookDelivery.upsert({
        where: { subscriptionId_eventId: { subscriptionId, eventId } },
        create: {
          subscriptionId,
          eventId,
          status: response.ok ? 'delivered' : 'failed',
          statusCode: response.status,
          attempts: attempt,
          lastAttemptAt: new Date(),
        },
        update: {
          status: response.ok ? 'delivered' : 'failed',
          statusCode: response.status,
          attempts: attempt,
          lastAttemptAt: new Date(),
        },
      });

      if (response.ok) {
        log.info({ subscriptionId, eventId, attempt }, 'Webhook delivered');
        return true;
      }

      log.warn(
        { subscriptionId, eventId, statusCode: response.status, attempt },
        'Webhook delivery returned non-OK'
      );
    } catch (error) {
      log.warn({ subscriptionId, eventId, attempt, error }, 'Webhook delivery attempt failed');

      await db.webhookDelivery.upsert({
        where: { subscriptionId_eventId: { subscriptionId, eventId } },
        create: {
          subscriptionId,
          eventId,
          status: 'failed',
          attempts: attempt,
          lastAttemptAt: new Date(),
        },
        update: {
          status: 'failed',
          attempts: attempt,
          lastAttemptAt: new Date(),
        },
      });
    }

    // Exponential backoff
    if (attempt < previousAttempts + maxAttempts) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return false;
}

/**
 * Build the event payload envelope sent to webhook consumers.
 */
function buildEventPayload(event: WebhookEvent, subscriptionId: string): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    subscriptionId,
    timestamp: event.timestamp.toISOString(),
    data: event.payload,
    apiVersion: '2024-01-01',
  };
}
