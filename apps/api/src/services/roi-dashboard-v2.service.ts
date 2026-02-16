/**
 * Documentation ROI Dashboard V2 Service
 *
 * Quantifies documentation impact: time saved in onboarding, support ticket reduction,
 * meeting reduction. Provides executive-friendly reports with $ values.
 */

import { prisma } from '@docsynth/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface ROIMetric {
  category: 'onboarding' | 'support_deflection' | 'meeting_reduction' | 'knowledge_sharing';
  label: string;
  hoursSaved: number;
  costSavedUSD: number;
  confidence: number;
}

export interface ROIDashboardResult {
  organizationId: string;
  period: { start: string; end: string };
  metrics: ROIMetric[];
  totalHoursSaved: number;
  totalCostSavedUSD: number;
  docUsageStats: {
    pageViews: number;
    uniqueVisitors: number;
    searchQueries: number;
    avgTimeOnPageSec: number;
  };
  comparisonPrevPeriod: {
    hoursSavedDelta: number;
    costSavedDelta: number;
  };
}

const DEFAULT_HOURLY_RATE = 75; // USD per developer hour

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Compute ROI dashboard for an organization
 */
export async function computeROIDashboard(
  organizationId: string,
  periodDays: number = 30
): Promise<ROIDashboardResult> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const prevStartDate = new Date(startDate.getTime() - periodDays * 24 * 60 * 60 * 1000);

  // Collect usage events for the current period
  const usageEvents = await db.docUsageEvent.findMany({
    where: {
      organizationId,
      createdAt: { gte: startDate, lte: endDate },
    },
  });

  // Collect usage for previous period for comparison
  const prevUsageEvents = await db.docUsageEvent.findMany({
    where: {
      organizationId,
      createdAt: { gte: prevStartDate, lte: startDate },
    },
  });

  // Get org repository count for scaling metrics
  const repoCount = await prisma.repository.count({
    where: { organizationId },
  });

  // Get document stats
  const docCount = await prisma.document.count({
    where: { repository: { organizationId } },
  });

  // Compute usage stats
  const pageViews = usageEvents.filter(
    (e: { eventType: string }) => e.eventType === 'page_view'
  ).length;
  const searches = usageEvents.filter(
    (e: { eventType: string }) => e.eventType === 'search'
  ).length;
  const visitors = new Set(
    usageEvents.map((e: { visitorId: string | null }) => e.visitorId).filter(Boolean)
  );

  // Compute ROI metrics
  const metrics: ROIMetric[] = [
    computeOnboardingROI(docCount, visitors.size, periodDays),
    computeSupportDeflectionROI(searches, pageViews, periodDays),
    computeMeetingReductionROI(pageViews, visitors.size, periodDays),
    computeKnowledgeSharingROI(docCount, repoCount, periodDays),
  ];

  const totalHoursSaved = metrics.reduce((sum, m) => sum + m.hoursSaved, 0);
  const totalCostSavedUSD = metrics.reduce((sum, m) => sum + m.costSavedUSD, 0);

  // Previous period metrics for comparison
  const prevPageViews = prevUsageEvents.filter(
    (e: { eventType: string }) => e.eventType === 'page_view'
  ).length;
  const prevSearches = prevUsageEvents.filter(
    (e: { eventType: string }) => e.eventType === 'search'
  ).length;
  const prevVisitors = new Set(
    prevUsageEvents.map((e: { visitorId: string | null }) => e.visitorId).filter(Boolean)
  );

  const prevMetrics: ROIMetric[] = [
    computeOnboardingROI(docCount, prevVisitors.size, periodDays),
    computeSupportDeflectionROI(prevSearches, prevPageViews, periodDays),
    computeMeetingReductionROI(prevPageViews, prevVisitors.size, periodDays),
    computeKnowledgeSharingROI(docCount, repoCount, periodDays),
  ];

  const prevTotalHours = prevMetrics.reduce((sum, m) => sum + m.hoursSaved, 0);
  const prevTotalCost = prevMetrics.reduce((sum, m) => sum + m.costSavedUSD, 0);

  const result: ROIDashboardResult = {
    organizationId,
    period: { start: startDate.toISOString(), end: endDate.toISOString() },
    metrics,
    totalHoursSaved,
    totalCostSavedUSD,
    docUsageStats: {
      pageViews,
      uniqueVisitors: visitors.size,
      searchQueries: searches,
      avgTimeOnPageSec: pageViews > 0 ? 120 : 0, // Estimated average
    },
    comparisonPrevPeriod: {
      hoursSavedDelta: totalHoursSaved - prevTotalHours,
      costSavedDelta: totalCostSavedUSD - prevTotalCost,
    },
  };

  // Persist dashboard result
  await db.roiDashboard.create({
    data: {
      organizationId,
      periodStart: startDate,
      periodEnd: endDate,
      metrics: result.metrics,
      totalHoursSaved: result.totalHoursSaved,
      totalCostSaved: result.totalCostSavedUSD,
      docUsageStats: result.docUsageStats,
      comparisonDelta: result.comparisonPrevPeriod,
    },
  });

  return result;
}

/**
 * Record a documentation usage event
 */
export async function trackDocUsage(
  organizationId: string,
  eventType: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await db.docUsageEvent.create({
    data: {
      organizationId,
      repositoryId: metadata.repositoryId as string | undefined,
      documentId: metadata.documentId as string | undefined,
      eventType,
      visitorId: metadata.visitorId as string | undefined,
      metadata,
    },
  });
}

/**
 * Get dashboard history
 */
export async function getROIDashboardHistory(organizationId: string, limit: number = 12) {
  return db.roiDashboard.findMany({
    where: { organizationId },
    orderBy: { generatedAt: 'desc' },
    take: limit,
  });
}

/**
 * Get usage analytics for a time period
 */
export async function getUsageAnalytics(organizationId: string, startDate: Date, endDate: Date) {
  const events = await db.docUsageEvent.findMany({
    where: {
      organizationId,
      createdAt: { gte: startDate, lte: endDate },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Group by day
  const byDay: Record<string, number> = {};
  for (const event of events) {
    const day = (event.createdAt as Date).toISOString().split('T')[0] || 'unknown';
    byDay[day] = (byDay[day] || 0) + 1;
  }

  // Group by event type
  const byType: Record<string, number> = {};
  for (const event of events) {
    const type = event.eventType as string;
    byType[type] = (byType[type] || 0) + 1;
  }

  return { byDay, byType, totalEvents: events.length };
}

// ============================================================================
// ROI Computation Functions
// ============================================================================

function computeOnboardingROI(docCount: number, visitors: number, _periodDays: number): ROIMetric {
  // Each new visitor reading docs saves ~2 hours vs asking colleagues
  const estimatedNewHires = Math.round(visitors * 0.1);
  const hoursSavedPerHire = 2;
  const hoursSaved = estimatedNewHires * hoursSavedPerHire;

  return {
    category: 'onboarding',
    label: 'Developer Onboarding Time Saved',
    hoursSaved,
    costSavedUSD: hoursSaved * DEFAULT_HOURLY_RATE,
    confidence: 0.6,
  };
}

function computeSupportDeflectionROI(
  searches: number,
  _pageViews: number,
  _periodDays: number
): ROIMetric {
  // Each successful doc search deflects ~0.5 hours of support
  const deflectedQuestions = Math.round(searches * 0.6);
  const hoursSavedPerDeflection = 0.5;
  const hoursSaved = deflectedQuestions * hoursSavedPerDeflection;

  return {
    category: 'support_deflection',
    label: 'Support Ticket Deflection',
    hoursSaved,
    costSavedUSD: hoursSaved * DEFAULT_HOURLY_RATE,
    confidence: 0.5,
  };
}

function computeMeetingReductionROI(
  pageViews: number,
  _visitors: number,
  _periodDays: number
): ROIMetric {
  // Good docs reduce "how does X work?" meetings
  const meetingsAvoided = Math.round(pageViews * 0.02);
  const hoursPerMeeting = 0.5;
  const attendeesPerMeeting = 3;
  const hoursSaved = meetingsAvoided * hoursPerMeeting * attendeesPerMeeting;

  return {
    category: 'meeting_reduction',
    label: 'Meetings Avoided',
    hoursSaved,
    costSavedUSD: hoursSaved * DEFAULT_HOURLY_RATE,
    confidence: 0.4,
  };
}

function computeKnowledgeSharingROI(
  docCount: number,
  repoCount: number,
  periodDays: number
): ROIMetric {
  // Well-documented repos save time for every developer who touches them
  const hoursSavedPerDoc = 0.5;
  const hoursSaved = docCount * hoursSavedPerDoc * (periodDays / 30);

  return {
    category: 'knowledge_sharing',
    label: 'Knowledge Sharing Efficiency',
    hoursSaved,
    costSavedUSD: hoursSaved * DEFAULT_HOURLY_RATE,
    confidence: 0.5,
  };
}
