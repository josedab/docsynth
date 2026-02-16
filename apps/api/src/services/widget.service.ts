/**
 * Widget Management Service
 *
 * Manages embeddable documentation widget configurations,
 * event tracking, analytics, and token generation.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import crypto from 'node:crypto';

const log = createLogger('widget-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface WidgetConfigInput {
  apiUrl?: string;
  theme?: 'light' | 'dark' | 'auto';
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  primaryColor?: string;
  title?: string;
  placeholder?: string;
  features?: {
    search?: boolean;
    chat?: boolean;
    contextualHelp?: boolean;
    feedback?: boolean;
  };
  branding?: boolean;
  maxHeight?: string;
  zIndex?: number;
}

export interface WidgetEvent {
  type: 'impression' | 'search' | 'chat' | 'feedback';
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}

export interface WidgetAnalytics {
  widgetId: string;
  impressions: number;
  searches: number;
  chats: number;
  feedbacks: number;
  period: { start: Date; end: Date };
}

export interface DateRange {
  start: Date;
  end: Date;
}

// ============================================================================
// Widget Config CRUD
// ============================================================================

/**
 * Create a widget configuration for an organization.
 */
export async function createWidgetConfig(
  orgId: string,
  config: WidgetConfigInput
): Promise<{ id: string; orgId: string; config: WidgetConfigInput; createdAt: Date }> {
  log.info({ orgId }, 'Creating widget config');

  const id = crypto.randomUUID();
  const record = await db.widgetConfig.create({
    data: {
      id,
      orgId,
      config: JSON.parse(JSON.stringify(config)),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return { id: record.id, orgId: record.orgId, config: record.config, createdAt: record.createdAt };
}

/**
 * Get widget configuration (public, no auth required).
 */
export async function getWidgetConfig(
  widgetId: string
): Promise<{ id: string; orgId: string; config: WidgetConfigInput } | null> {
  const record = await db.widgetConfig.findUnique({ where: { id: widgetId } });
  if (!record) return null;
  return { id: record.id, orgId: record.orgId, config: record.config };
}

/**
 * Update widget configuration.
 */
export async function updateWidgetConfig(
  widgetId: string,
  config: WidgetConfigInput
): Promise<{ id: string; config: WidgetConfigInput; updatedAt: Date }> {
  log.info({ widgetId }, 'Updating widget config');

  const record = await db.widgetConfig.update({
    where: { id: widgetId },
    data: {
      config: JSON.parse(JSON.stringify(config)),
      updatedAt: new Date(),
    },
  });

  return { id: record.id, config: record.config, updatedAt: record.updatedAt };
}

/**
 * Delete a widget configuration.
 */
export async function deleteWidgetConfig(widgetId: string): Promise<void> {
  log.info({ widgetId }, 'Deleting widget config');
  await db.widgetConfig.delete({ where: { id: widgetId } });
}

// ============================================================================
// Event Tracking
// ============================================================================

/**
 * Track a widget event (impression, search, chat, feedback).
 */
export async function trackWidgetEvent(
  widgetId: string,
  event: WidgetEvent
): Promise<{ id: string }> {
  log.debug({ widgetId, type: event.type }, 'Tracking widget event');

  const record = await db.widgetEvent.create({
    data: {
      id: crypto.randomUUID(),
      widgetId,
      type: event.type,
      metadata: event.metadata ? JSON.parse(JSON.stringify(event.metadata)) : {},
      timestamp: event.timestamp ?? new Date(),
    },
  });

  return { id: record.id };
}

// ============================================================================
// Analytics
// ============================================================================

/**
 * Get widget analytics for a date range.
 */
export async function getWidgetAnalytics(
  widgetId: string,
  dateRange: DateRange
): Promise<WidgetAnalytics> {
  log.info({ widgetId, dateRange }, 'Fetching widget analytics');

  const events = await db.widgetEvent.findMany({
    where: {
      widgetId,
      timestamp: { gte: dateRange.start, lte: dateRange.end },
    },
  });

  const counts = { impressions: 0, searches: 0, chats: 0, feedbacks: 0 };
  for (const event of events) {
    switch (event.type) {
      case 'impression':
        counts.impressions++;
        break;
      case 'search':
        counts.searches++;
        break;
      case 'chat':
        counts.chats++;
        break;
      case 'feedback':
        counts.feedbacks++;
        break;
    }
  }

  return { widgetId, ...counts, period: dateRange };
}

// ============================================================================
// Token Generation
// ============================================================================

/**
 * Generate a short-lived auth token for widget API calls.
 */
export async function generateWidgetToken(
  orgId: string,
  widgetId: string
): Promise<{ token: string; expiresAt: Date }> {
  log.info({ orgId, widgetId }, 'Generating widget token');

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.widgetToken.create({
    data: {
      id: crypto.randomUUID(),
      token,
      orgId,
      widgetId,
      expiresAt,
      createdAt: new Date(),
    },
  });

  return { token, expiresAt };
}
