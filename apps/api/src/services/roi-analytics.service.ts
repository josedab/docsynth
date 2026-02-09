import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('roi-analytics-service');

// ============================================================================
// Types
// ============================================================================

export interface ROIMetrics {
  organizationId: string;
  period: { start: Date; end: Date; days: number };
  usage: UsageMetrics;
  productivity: ProductivityMetrics;
  roi: ROICalculation;
  trends: ROITrend[];
}

export interface UsageMetrics {
  totalDocViews: number;
  uniqueViewers: number;
  searchQueries: number;
  chatInteractions: number;
  topViewedDocs: Array<{ documentId: string; path: string; views: number }>;
  topSearchTerms: Array<{ term: string; count: number; hasResult: boolean }>;
  avgTimeOnPage: number; // seconds
}

export interface ProductivityMetrics {
  estimatedHoursSaved: number;
  onboardingTimeSavedHours: number;
  searchDeflectionRate: number; // % of queries answered by docs
  docsGeneratedAutomatically: number;
  docsManuallyCreated: number;
  automationRate: number; // % generated vs manual
  avgTimeToFirstDoc: number; // hours from repo setup to first doc
}

export interface ROICalculation {
  totalInvestment: {
    llmCosts: number;
    platformCosts: number;
    engineeringHours: number;
    totalCost: number;
  };
  totalReturn: {
    hoursSaved: number;
    hourlyRate: number; // configurable, default $75
    dollarsSaved: number;
  };
  roiPercent: number;
  paybackPeriodDays: number;
  costPerDocument: number;
}

export interface ROITrend {
  date: string;
  hoursSaved: number;
  docsGenerated: number;
  searchQueries: number;
  cumulativeROI: number;
}

export interface DocUsageEvent {
  type: 'view' | 'search' | 'chat' | 'edit' | 'feedback';
  documentId?: string;
  repositoryId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

interface SearchGap {
  query: string;
  searchCount: number;
  avgResults: number;
  suggestion: string;
}

interface SatisfactionScore {
  overall: number; // 0-100
  helpful: number;
  notHelpful: number;
  totalFeedback: number;
  breakdown: {
    unclear: number;
    outdated: number;
    incomplete: number;
    wrong: number;
    other: number;
  };
}

// ============================================================================
// Usage Metrics
// ============================================================================

export async function getUsageMetrics(
  organizationId: string,
  period: { start: Date; end: Date }
): Promise<UsageMetrics> {
  log.info({ organizationId, period }, 'Getting usage metrics');

  // Get all repositories for this organization
  const repositories = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const repositoryIds = repositories.map(r => r.id);

  if (repositoryIds.length === 0) {
    return {
      totalDocViews: 0,
      uniqueViewers: 0,
      searchQueries: 0,
      chatInteractions: 0,
      topViewedDocs: [],
      topSearchTerms: [],
      avgTimeOnPage: 0,
    };
  }

  // Get page views
  const pageViews = await prisma.docPageView.findMany({
    where: {
      repositoryId: { in: repositoryIds },
      createdAt: {
        gte: period.start,
        lt: period.end,
      },
    },
    select: {
      id: true,
      documentId: true,
      documentPath: true,
      sessionId: true,
      duration: true,
    },
  });

  // Get unique viewers (unique sessions)
  const uniqueSessions = new Set(pageViews.map(v => v.sessionId));

  // Get search queries
  const searches = await prisma.docSearchQuery.findMany({
    where: {
      repositoryId: { in: repositoryIds },
      createdAt: {
        gte: period.start,
        lt: period.end,
      },
    },
    select: {
      query: true,
      resultCount: true,
    },
  });

  // Get chat interactions (from ChatMessage)
  const chatCount = await prisma.chatMessage.count({
    where: {
      session: {
        repositoryId: { in: repositoryIds },
      },
      createdAt: {
        gte: period.start,
        lt: period.end,
      },
    },
  });

  // Calculate top viewed docs
  const docViewCounts = new Map<string, { documentId: string; path: string; count: number }>();
  for (const view of pageViews) {
    const key = view.documentId || view.documentPath;
    const existing = docViewCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      docViewCounts.set(key, {
        documentId: view.documentId || '',
        path: view.documentPath,
        count: 1,
      });
    }
  }

  const topViewedDocs = Array.from(docViewCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(v => ({
      documentId: v.documentId,
      path: v.path,
      views: v.count,
    }));

  // Calculate top search terms
  const searchCounts = new Map<string, { count: number; totalResults: number }>();
  for (const search of searches) {
    const existing = searchCounts.get(search.query);
    if (existing) {
      existing.count++;
      existing.totalResults += search.resultCount;
    } else {
      searchCounts.set(search.query, {
        count: 1,
        totalResults: search.resultCount,
      });
    }
  }

  const topSearchTerms = Array.from(searchCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([term, data]) => ({
      term,
      count: data.count,
      hasResult: data.totalResults / data.count > 0,
    }));

  // Calculate average time on page
  const validDurations = pageViews.filter(v => v.duration && v.duration > 0);
  const avgTimeOnPage = validDurations.length > 0
    ? validDurations.reduce((sum, v) => sum + (v.duration || 0), 0) / validDurations.length
    : 0;

  return {
    totalDocViews: pageViews.length,
    uniqueViewers: uniqueSessions.size,
    searchQueries: searches.length,
    chatInteractions: chatCount,
    topViewedDocs,
    topSearchTerms,
    avgTimeOnPage,
  };
}

// ============================================================================
// Productivity Metrics
// ============================================================================

export async function getProductivityMetrics(
  organizationId: string,
  period: { start: Date; end: Date }
): Promise<ProductivityMetrics> {
  log.info({ organizationId, period }, 'Getting productivity metrics');

  // Get all repositories for this organization
  const repositories = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true, createdAt: true },
  });
  const repositoryIds = repositories.map(r => r.id);

  if (repositoryIds.length === 0) {
    return {
      estimatedHoursSaved: 0,
      onboardingTimeSavedHours: 0,
      searchDeflectionRate: 0,
      docsGeneratedAutomatically: 0,
      docsManuallyCreated: 0,
      automationRate: 0,
      avgTimeToFirstDoc: 0,
    };
  }

  // Get document generation statistics
  const generatedDocs = await prisma.generationJob.count({
    where: {
      repositoryId: { in: repositoryIds },
      status: 'COMPLETED',
      createdAt: {
        gte: period.start,
        lt: period.end,
      },
    },
  });

  // Get manually created docs (approximation: docs without generation job)
  const totalDocs = await prisma.document.count({
    where: {
      repositoryId: { in: repositoryIds },
      createdAt: {
        gte: period.start,
        lt: period.end,
      },
    },
  });

  const manualDocs = Math.max(0, totalDocs - generatedDocs);
  const automationRate = totalDocs > 0 ? (generatedDocs / totalDocs) * 100 : 0;

  // Calculate search deflection rate
  const searches = await prisma.docSearchQuery.findMany({
    where: {
      repositoryId: { in: repositoryIds },
      createdAt: {
        gte: period.start,
        lt: period.end,
      },
    },
    select: { resultCount: true },
  });

  const successfulSearches = searches.filter(s => s.resultCount > 0).length;
  const searchDeflectionRate = searches.length > 0
    ? (successfulSearches / searches.length) * 100
    : 0;

  // Estimate hours saved from documentation
  // Formula: (doc views / 10) * 0.25 hours (assumes 1 in 10 views saves 15 minutes)
  const pageViewCount = await prisma.docPageView.count({
    where: {
      repositoryId: { in: repositoryIds },
      createdAt: {
        gte: period.start,
        lt: period.end,
      },
    },
  });

  const estimatedHoursSaved = (pageViewCount / 10) * 0.25;

  // Estimate onboarding time saved
  // Formula: (onboarding views * 2 hours) / 10 (assumes docs reduce onboarding time by 20%)
  const onboardingViews = await prisma.docPageView.count({
    where: {
      repositoryId: { in: repositoryIds },
      documentPath: {
        contains: 'onboarding',
      },
      createdAt: {
        gte: period.start,
        lt: period.end,
      },
    },
  });

  const onboardingTimeSavedHours = (onboardingViews * 2) / 10;

  // Calculate average time to first doc
  const timeToFirstDoc: number[] = [];
  for (const repo of repositories) {
    const firstDoc = await prisma.document.findFirst({
      where: { repositoryId: repo.id },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    if (firstDoc) {
      const hoursDiff = (firstDoc.createdAt.getTime() - repo.createdAt.getTime()) / (1000 * 60 * 60);
      timeToFirstDoc.push(hoursDiff);
    }
  }

  const avgTimeToFirstDoc = timeToFirstDoc.length > 0
    ? timeToFirstDoc.reduce((sum, t) => sum + t, 0) / timeToFirstDoc.length
    : 0;

  return {
    estimatedHoursSaved,
    onboardingTimeSavedHours,
    searchDeflectionRate,
    docsGeneratedAutomatically: generatedDocs,
    docsManuallyCreated: manualDocs,
    automationRate,
    avgTimeToFirstDoc,
  };
}

// ============================================================================
// ROI Calculation
// ============================================================================

export async function calculateROI(
  organizationId: string,
  period: { start: Date; end: Date },
  hourlyRate: number = 75
): Promise<ROICalculation> {
  log.info({ organizationId, period, hourlyRate }, 'Calculating ROI');

  // Get all repositories for this organization
  const repositories = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const repositoryIds = repositories.map(r => r.id);

  // Get LLM costs from usage summaries
  const llmUsage = await prisma.lLMUsageSummary.findMany({
    where: {
      organizationId,
      periodStart: { gte: period.start },
      periodEnd: { lte: period.end },
    },
    select: { totalCost: true },
  });

  const llmCosts = llmUsage.reduce((sum, usage) => sum + usage.totalCost, 0) / 100; // Convert from cents to dollars

  // Get productivity metrics
  const productivity = await getProductivityMetrics(organizationId, period);

  // Calculate investment
  // Platform costs: ~$10/month per repository (simplified)
  const days = Math.ceil((period.end.getTime() - period.start.getTime()) / (1000 * 60 * 60 * 24));
  const platformCosts = (repositoryIds.length * 10 * days) / 30;

  // Engineering hours: assume 2 hours setup per repo + 1 hour maintenance per month
  const engineeringHours = repositoryIds.length * 2 + (repositoryIds.length * 1 * days) / 30;
  const engineeringCost = engineeringHours * hourlyRate;

  const totalCost = llmCosts + platformCosts + engineeringCost;

  // Calculate return
  const hoursSaved = productivity.estimatedHoursSaved + productivity.onboardingTimeSavedHours;
  const dollarsSaved = hoursSaved * hourlyRate;

  // Calculate ROI
  const roiPercent = totalCost > 0 ? ((dollarsSaved - totalCost) / totalCost) * 100 : 0;

  // Calculate payback period (days until investment is recovered)
  const dailyReturn = dollarsSaved / Math.max(1, days);
  const paybackPeriodDays = dailyReturn > 0 ? totalCost / dailyReturn : 0;

  // Calculate cost per document
  const totalDocs = await prisma.document.count({
    where: {
      repositoryId: { in: repositoryIds },
      createdAt: {
        gte: period.start,
        lt: period.end,
      },
    },
  });

  const costPerDocument = totalDocs > 0 ? totalCost / totalDocs : 0;

  return {
    totalInvestment: {
      llmCosts,
      platformCosts,
      engineeringHours,
      totalCost,
    },
    totalReturn: {
      hoursSaved,
      hourlyRate,
      dollarsSaved,
    },
    roiPercent,
    paybackPeriodDays,
    costPerDocument,
  };
}

// ============================================================================
// ROI Trends
// ============================================================================

export async function getROITrends(
  organizationId: string,
  days: number
): Promise<ROITrend[]> {
  log.info({ organizationId, days }, 'Getting ROI trends');

  const trends: ROITrend[] = [];
  const now = new Date();

  // Get repositories for this org
  const repositories = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const repositoryIds = repositories.map(r => r.id);

  if (repositoryIds.length === 0) {
    return trends;
  }

  let cumulativeROI = 0;

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    // Get daily metrics
    const viewCount = await prisma.docPageView.count({
      where: {
        repositoryId: { in: repositoryIds },
        createdAt: {
          gte: date,
          lt: nextDate,
        },
      },
    });

    const searchCount = await prisma.docSearchQuery.count({
      where: {
        repositoryId: { in: repositoryIds },
        createdAt: {
          gte: date,
          lt: nextDate,
        },
      },
    });

    const docsGenerated = await prisma.generationJob.count({
      where: {
        repositoryId: { in: repositoryIds },
        status: 'COMPLETED',
        createdAt: {
          gte: date,
          lt: nextDate,
        },
      },
    });

    // Estimate daily hours saved
    const hoursSaved = (viewCount / 10) * 0.25;

    // Calculate daily ROI (simplified)
    const dailyReturn = hoursSaved * 75; // $75/hour default
    const dailyCost = (repositoryIds.length * 10) / 30; // Platform cost
    const dailyROI = dailyReturn - dailyCost;

    cumulativeROI += dailyROI;

    trends.push({
      date: date.toISOString().split('T')[0] ?? '',
      hoursSaved,
      docsGenerated,
      searchQueries: searchCount,
      cumulativeROI,
    });
  }

  return trends;
}

// ============================================================================
// Comprehensive ROI Metrics
// ============================================================================

export async function calculateROIMetrics(
  organizationId: string,
  period: { start: Date; end: Date }
): Promise<ROIMetrics> {
  log.info({ organizationId, period }, 'Calculating comprehensive ROI metrics');

  const days = Math.ceil((period.end.getTime() - period.start.getTime()) / (1000 * 60 * 60 * 24));

  const [usage, productivity, roi, trends] = await Promise.all([
    getUsageMetrics(organizationId, period),
    getProductivityMetrics(organizationId, period),
    calculateROI(organizationId, period),
    getROITrends(organizationId, Math.min(days, 90)), // Max 90 days for trends
  ]);

  return {
    organizationId,
    period: { start: period.start, end: period.end, days },
    usage,
    productivity,
    roi,
    trends,
  };
}

// ============================================================================
// Usage Event Tracking
// ============================================================================

export async function trackUsageEvent(event: DocUsageEvent): Promise<void> {
  log.debug({ event }, 'Tracking usage event');

  try {
    switch (event.type) {
      case 'view':
        if (event.documentId && event.repositoryId) {
          await prisma.docPageView.create({
            data: {
              repositoryId: event.repositoryId,
              documentId: event.documentId,
              documentPath: (event.metadata?.path as string) || '',
              userId: event.userId,
              sessionId: (event.metadata?.sessionId as string) || 'unknown',
              duration: (event.metadata?.duration as number) || 0,
              scrollDepth: (event.metadata?.scrollDepth as number) || 0,
              referrer: (event.metadata?.referrer as string) || null,
              userAgent: (event.metadata?.userAgent as string) || null,
              country: (event.metadata?.country as string) || null,
              createdAt: event.timestamp,
            },
          });
        }
        break;

      case 'search':
        if (event.repositoryId) {
          await prisma.docSearchQuery.create({
            data: {
              repositoryId: event.repositoryId,
              query: (event.metadata?.query as string) || '',
              resultCount: (event.metadata?.resultCount as number) || 0,
              userId: event.userId,
              sessionId: (event.metadata?.sessionId as string) || 'unknown',
              clickedDocId: (event.metadata?.clickedDocId as string) || null,
              createdAt: event.timestamp,
            },
          });
        }
        break;

      case 'feedback':
        if (event.documentId && event.repositoryId) {
          await prisma.docFeedback.create({
            data: {
              repositoryId: event.repositoryId,
              documentId: event.documentId,
              documentPath: (event.metadata?.path as string) || '',
              userId: event.userId,
              sessionId: (event.metadata?.sessionId as string) || 'unknown',
              helpful: (event.metadata?.helpful as boolean) || false,
              reason: (event.metadata?.reason as string) || null,
              comment: (event.metadata?.comment as string) || null,
              createdAt: event.timestamp,
            },
          });
        }
        break;

      // Chat and edit events are tracked through their respective services
      default:
        log.warn({ eventType: event.type }, 'Unknown event type');
    }
  } catch (error) {
    log.error({ error, event }, 'Failed to track usage event');
  }
}

// ============================================================================
// Search Gaps
// ============================================================================

export async function getTopSearchGaps(
  organizationId: string,
  limit: number = 10
): Promise<SearchGap[]> {
  log.info({ organizationId, limit }, 'Getting top search gaps');

  // Get repositories for this org
  const repositories = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const repositoryIds = repositories.map(r => r.id);

  if (repositoryIds.length === 0) {
    return [];
  }

  // Get searches with low results in the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const searches = await prisma.docSearchQuery.groupBy({
    by: ['query'],
    where: {
      repositoryId: { in: repositoryIds },
      createdAt: { gte: thirtyDaysAgo },
    },
    _count: { id: true },
    _avg: { resultCount: true },
  });

  // Filter for gaps (low results, high search count)
  const gaps = searches
    .filter(s => (s._avg.resultCount || 0) < 3 && s._count.id >= 3)
    .sort((a, b) => b._count.id - a._count.id)
    .slice(0, limit)
    .map(s => ({
      query: s.query,
      searchCount: s._count.id,
      avgResults: s._avg.resultCount || 0,
      suggestion: `Consider adding documentation for "${s.query}"`,
    }));

  return gaps;
}

// ============================================================================
// Satisfaction Score
// ============================================================================

export async function getSatisfactionScore(organizationId: string): Promise<SatisfactionScore> {
  log.info({ organizationId }, 'Getting satisfaction score');

  // Get repositories for this org
  const repositories = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const repositoryIds = repositories.map(r => r.id);

  if (repositoryIds.length === 0) {
    return {
      overall: 0,
      helpful: 0,
      notHelpful: 0,
      totalFeedback: 0,
      breakdown: {
        unclear: 0,
        outdated: 0,
        incomplete: 0,
        wrong: 0,
        other: 0,
      },
    };
  }

  // Get feedback from last 90 days
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const feedback = await prisma.docFeedback.findMany({
    where: {
      repositoryId: { in: repositoryIds },
      createdAt: { gte: ninetyDaysAgo },
    },
    select: {
      helpful: true,
      reason: true,
    },
  });

  const helpful = feedback.filter(f => f.helpful).length;
  const notHelpful = feedback.filter(f => !f.helpful).length;
  const total = feedback.length;

  const overall = total > 0 ? (helpful / total) * 100 : 0;

  // Count reasons
  const breakdown = {
    unclear: feedback.filter(f => f.reason === 'unclear').length,
    outdated: feedback.filter(f => f.reason === 'outdated').length,
    incomplete: feedback.filter(f => f.reason === 'incomplete').length,
    wrong: feedback.filter(f => f.reason === 'wrong').length,
    other: feedback.filter(f => f.reason === 'other').length,
  };

  return {
    overall,
    helpful,
    notHelpful,
    totalFeedback: total,
    breakdown,
  };
}

// ============================================================================
// Report Generation
// ============================================================================

export async function generateROIReport(
  organizationId: string,
  period: { start: Date; end: Date },
  format: 'json' | 'csv' | 'pdf' = 'json'
): Promise<string | Record<string, unknown>> {
  log.info({ organizationId, period, format }, 'Generating ROI report');

  const metrics = await calculateROIMetrics(organizationId, period);

  if (format === 'json') {
    return metrics as unknown as Record<string, unknown>;
  }

  if (format === 'csv') {
    // Generate CSV format
    const csv = [
      'Metric,Value',
      `Period Start,${metrics.period.start.toISOString()}`,
      `Period End,${metrics.period.end.toISOString()}`,
      `Days,${metrics.period.days}`,
      '',
      'Usage Metrics',
      `Total Doc Views,${metrics.usage.totalDocViews}`,
      `Unique Viewers,${metrics.usage.uniqueViewers}`,
      `Search Queries,${metrics.usage.searchQueries}`,
      `Chat Interactions,${metrics.usage.chatInteractions}`,
      `Avg Time on Page (seconds),${metrics.usage.avgTimeOnPage.toFixed(2)}`,
      '',
      'Productivity Metrics',
      `Estimated Hours Saved,${metrics.productivity.estimatedHoursSaved.toFixed(2)}`,
      `Onboarding Time Saved (hours),${metrics.productivity.onboardingTimeSavedHours.toFixed(2)}`,
      `Search Deflection Rate (%),${metrics.productivity.searchDeflectionRate.toFixed(2)}`,
      `Docs Generated Automatically,${metrics.productivity.docsGeneratedAutomatically}`,
      `Docs Created Manually,${metrics.productivity.docsManuallyCreated}`,
      `Automation Rate (%),${metrics.productivity.automationRate.toFixed(2)}`,
      '',
      'ROI Calculation',
      `LLM Costs ($),${metrics.roi.totalInvestment.llmCosts.toFixed(2)}`,
      `Platform Costs ($),${metrics.roi.totalInvestment.platformCosts.toFixed(2)}`,
      `Engineering Hours,${metrics.roi.totalInvestment.engineeringHours.toFixed(2)}`,
      `Total Cost ($),${metrics.roi.totalInvestment.totalCost.toFixed(2)}`,
      `Hours Saved,${metrics.roi.totalReturn.hoursSaved.toFixed(2)}`,
      `Dollars Saved ($),${metrics.roi.totalReturn.dollarsSaved.toFixed(2)}`,
      `ROI (%),${metrics.roi.roiPercent.toFixed(2)}`,
      `Payback Period (days),${metrics.roi.paybackPeriodDays.toFixed(2)}`,
      `Cost Per Document ($),${metrics.roi.costPerDocument.toFixed(2)}`,
    ].join('\n');

    return csv;
  }

  // PDF format would require a PDF library - return JSON for now
  log.warn('PDF format not yet implemented, returning JSON');
  return metrics as unknown as Record<string, unknown>;
}
