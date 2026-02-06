import { Hono } from 'hono';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { ValidationError } from '@docsynth/utils';
import { cacheService, CACHE_KEYS, CACHE_TTLS } from '../services/cache.service.js';
import {
  calculateROIMetrics,
  getUsageMetrics,
  getProductivityMetrics,
  calculateROI,
  getROITrends,
  getTopSearchGaps,
  getSatisfactionScore,
  trackUsageEvent,
  generateROIReport,
  type DocUsageEvent,
} from '../services/roi-analytics.service.js';

const app = new Hono();

// ============================================================================
// Dashboard - Comprehensive ROI Dashboard
// ============================================================================

app.get('/dashboard', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { days = '30' } = c.req.query();

  const daysNum = parseInt(days, 10);
  if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
    throw new ValidationError('days must be between 1 and 365');
  }

  // Calculate period
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - daysNum);

  // Check cache first
  const cacheKey = `${CACHE_KEYS.ANALYTICS_SUMMARY}:roi:${orgId}:${days}`;
  const cached = await cacheService.get<unknown>(cacheKey);
  if (cached) {
    return c.json({
      success: true,
      data: cached,
      cached: true,
    });
  }

  // Calculate comprehensive metrics
  const metrics = await calculateROIMetrics(orgId, { start, end });

  // Get additional context
  const [searchGaps, satisfaction] = await Promise.all([
    getTopSearchGaps(orgId, 5),
    getSatisfactionScore(orgId),
  ]);

  const dashboardData = {
    ...metrics,
    insights: {
      searchGaps,
      satisfaction,
    },
  };

  // Cache for 5 minutes
  await cacheService.set(cacheKey, dashboardData, {
    ttl: CACHE_TTLS.MEDIUM,
    tags: [`org:${orgId}`, 'roi-analytics'],
  });

  return c.json({
    success: true,
    data: dashboardData,
    cached: false,
  });
});

// ============================================================================
// Usage Metrics
// ============================================================================

app.get('/usage', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { startDate, endDate } = c.req.query();

  if (!startDate || !endDate) {
    throw new ValidationError('startDate and endDate are required');
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new ValidationError('Invalid date format');
  }

  if (start >= end) {
    throw new ValidationError('startDate must be before endDate');
  }

  const usage = await getUsageMetrics(orgId, { start, end });

  return c.json({
    success: true,
    data: {
      period: { start, end },
      usage,
    },
  });
});

// ============================================================================
// Productivity Metrics
// ============================================================================

app.get('/productivity', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { days = '30' } = c.req.query();

  const daysNum = parseInt(days, 10);
  if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
    throw new ValidationError('days must be between 1 and 365');
  }

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - daysNum);

  const productivity = await getProductivityMetrics(orgId, { start, end });

  return c.json({
    success: true,
    data: {
      period: { start, end, days: daysNum },
      productivity,
    },
  });
});

// ============================================================================
// ROI Calculation
// ============================================================================

app.get('/roi', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { days = '30', hourlyRate = '75' } = c.req.query();

  const daysNum = parseInt(days, 10);
  const hourlyRateNum = parseFloat(hourlyRate);

  if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
    throw new ValidationError('days must be between 1 and 365');
  }

  if (isNaN(hourlyRateNum) || hourlyRateNum < 0 || hourlyRateNum > 1000) {
    throw new ValidationError('hourlyRate must be between 0 and 1000');
  }

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - daysNum);

  const roi = await calculateROI(orgId, { start, end }, hourlyRateNum);

  return c.json({
    success: true,
    data: {
      period: { start, end, days: daysNum },
      roi,
    },
  });
});

// ============================================================================
// ROI Trends
// ============================================================================

app.get('/trends', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { days = '30' } = c.req.query();

  const daysNum = parseInt(days, 10);
  if (isNaN(daysNum) || daysNum < 1 || daysNum > 90) {
    throw new ValidationError('days must be between 1 and 90');
  }

  // Check cache
  const cacheKey = `${CACHE_KEYS.ANALYTICS_SUMMARY}:trends:${orgId}:${days}`;
  const cached = await cacheService.get<unknown>(cacheKey);
  if (cached) {
    return c.json({
      success: true,
      data: cached,
      cached: true,
    });
  }

  const trends = await getROITrends(orgId, daysNum);

  // Cache for 15 minutes
  await cacheService.set(cacheKey, trends, {
    ttl: CACHE_TTLS.LONG,
    tags: [`org:${orgId}`, 'roi-trends'],
  });

  return c.json({
    success: true,
    data: trends,
    cached: false,
  });
});

// ============================================================================
// Search Gaps
// ============================================================================

app.get('/search-gaps', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { limit = '10' } = c.req.query();

  const limitNum = parseInt(limit, 10);
  if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
    throw new ValidationError('limit must be between 1 and 50');
  }

  const searchGaps = await getTopSearchGaps(orgId, limitNum);

  return c.json({
    success: true,
    data: {
      searchGaps,
      total: searchGaps.length,
    },
  });
});

// ============================================================================
// Satisfaction Score
// ============================================================================

app.get('/satisfaction', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  // Check cache
  const cacheKey = `${CACHE_KEYS.ANALYTICS_SUMMARY}:satisfaction:${orgId}`;
  const cached = await cacheService.get<unknown>(cacheKey);
  if (cached) {
    return c.json({
      success: true,
      data: cached,
      cached: true,
    });
  }

  const satisfaction = await getSatisfactionScore(orgId);

  // Cache for 15 minutes
  await cacheService.set(cacheKey, satisfaction, {
    ttl: CACHE_TTLS.LONG,
    tags: [`org:${orgId}`, 'satisfaction'],
  });

  return c.json({
    success: true,
    data: satisfaction,
    cached: false,
  });
});

// ============================================================================
// Track Usage Event
// ============================================================================

app.post('/event', requireAuth, async (c) => {
  const body = await c.req.json<Partial<DocUsageEvent>>().catch(() => ({} as Partial<DocUsageEvent>));

  if (!body.type) {
    throw new ValidationError('type is required');
  }

  if (!['view', 'search', 'chat', 'edit', 'feedback'].includes(body.type)) {
    throw new ValidationError('Invalid event type');
  }

  const event: DocUsageEvent = {
    type: body.type as DocUsageEvent['type'],
    documentId: body.documentId,
    repositoryId: body.repositoryId,
    userId: c.get('userId'),
    metadata: body.metadata || {},
    timestamp: new Date(),
  };

  // Track event asynchronously (fire and forget)
  trackUsageEvent(event).catch((error) => {
    console.error('Failed to track event:', error);
  });

  // Invalidate relevant caches
  if (event.repositoryId) {
    const orgId = c.get('organizationId');
    cacheService.invalidateByTag(`org:${orgId}`).catch(() => {
      // Ignore cache invalidation errors
    });
  }

  return c.json({
    success: true,
    data: {
      message: 'Event tracked',
    },
  });
});

// ============================================================================
// Submit Feedback
// ============================================================================

app.post('/feedback', requireAuth, async (c) => {
  const body = await c.req.json<{
    documentId: string;
    repositoryId: string;
    helpful: boolean;
    reason?: string;
    comment?: string;
  }>().catch(() => ({} as { documentId: string; repositoryId: string; helpful: boolean; reason?: string; comment?: string }));

  if (!body.documentId || !body.repositoryId) {
    throw new ValidationError('documentId and repositoryId are required');
  }

  if (typeof body.helpful !== 'boolean') {
    throw new ValidationError('helpful must be a boolean');
  }

  // Track as feedback event
  const event: DocUsageEvent = {
    type: 'feedback',
    documentId: body.documentId,
    repositoryId: body.repositoryId,
    userId: c.get('userId'),
    metadata: {
      helpful: body.helpful,
      reason: body.reason,
      comment: body.comment,
      sessionId: 'web', // Could be extracted from request headers
    },
    timestamp: new Date(),
  };

  await trackUsageEvent(event);

  // Invalidate satisfaction cache
  const orgId = c.get('organizationId');
  await cacheService.invalidateByTag(`org:${orgId}`);

  return c.json({
    success: true,
    data: {
      message: 'Feedback submitted',
    },
  });
});

// ============================================================================
// Export Report
// ============================================================================

app.get('/export', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { format = 'json', days = '30' } = c.req.query();

  if (!['json', 'csv', 'pdf'].includes(format)) {
    throw new ValidationError('format must be json, csv, or pdf');
  }

  const daysNum = parseInt(days, 10);
  if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
    throw new ValidationError('days must be between 1 and 365');
  }

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - daysNum);

  const report = await generateROIReport(
    orgId,
    { start, end },
    format as 'json' | 'csv' | 'pdf'
  );

  if (format === 'json') {
    return c.json({
      success: true,
      data: report,
    });
  }

  if (format === 'csv') {
    return c.text(report as string, 200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="roi-report-${orgId}-${days}d.csv"`,
    });
  }

  // PDF format
  return c.json({
    success: true,
    data: report,
    message: 'PDF format not yet implemented, returning JSON',
  });
});

// ============================================================================
// Cache Management
// ============================================================================

app.delete('/cache', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const invalidated = await cacheService.invalidateByTag(`org:${orgId}`);

  return c.json({
    success: true,
    data: {
      message: 'Cache invalidated',
      keysInvalidated: invalidated,
    },
  });
});

export { app as roiAnalyticsRoutes };
