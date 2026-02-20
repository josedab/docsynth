/**
 * Documentation Analytics & Insights Service
 *
 * Tracks reader behavior (views, searches, time-on-page), computes insights,
 * and generates actionable recommendations for doc improvement.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-analytics-insights-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface DocEvent {
  eventType: 'view' | 'search' | 'feedback' | 'time-on-page';
  documentPath: string;
  repositoryId: string;
  userId?: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export interface InsightsDashboard {
  organizationId: string;
  period: string;
  topDocs: Array<{ path: string; views: number; avgTimeSeconds: number }>;
  neverAccessed: Array<{ path: string; daysSinceCreated: number }>;
  failingSearches: Array<{ query: string; count: number }>;
  satisfactionTrend: Array<{ date: string; score: number }>;
  totalViews: number;
  uniqueReaders: number;
}

export interface Recommendation {
  type: 'update' | 'create' | 'archive' | 'improve';
  priority: 'high' | 'medium' | 'low';
  documentPath: string;
  reason: string;
  evidence: string;
}

// ============================================================================
// Core Functions
// ============================================================================

export async function trackEvent(event: DocEvent): Promise<void> {
  await db.docAnalyticsEvent.create({
    data: {
      eventType: event.eventType,
      documentPath: event.documentPath,
      repositoryId: event.repositoryId,
      userId: event.userId,
      metadata: JSON.parse(JSON.stringify(event.metadata)),
      createdAt: event.timestamp,
    },
  });
}

export async function trackEventBatch(events: DocEvent[]): Promise<number> {
  let tracked = 0;
  for (const event of events) {
    await trackEvent(event);
    tracked++;
  }
  log.info({ count: tracked }, 'Event batch tracked');
  return tracked;
}

export async function computeInsights(
  organizationId: string,
  period: 'daily' | 'weekly' | 'monthly' = 'weekly'
): Promise<InsightsDashboard> {
  const periodDays = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
  const startDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const repos = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const repoIds = repos.map((r) => r.id);

  const events = await db.docAnalyticsEvent.findMany({
    where: { repositoryId: { in: repoIds }, createdAt: { gte: startDate } },
    select: { eventType: true, documentPath: true, userId: true, metadata: true, createdAt: true },
  });

  // Top docs by views
  const viewCounts = new Map<string, { views: number; totalTime: number }>();
  const uniqueUsers = new Set<string>();

  for (const event of events) {
    if (event.eventType === 'view') {
      const entry = viewCounts.get(event.documentPath) ?? { views: 0, totalTime: 0 };
      entry.views++;
      viewCounts.set(event.documentPath, entry);
    }
    if (event.eventType === 'time-on-page') {
      const entry = viewCounts.get(event.documentPath) ?? { views: 0, totalTime: 0 };
      entry.totalTime += (event.metadata as any)?.seconds ?? 0;
      viewCounts.set(event.documentPath, entry);
    }
    if (event.userId) uniqueUsers.add(event.userId);
  }

  const topDocs = Array.from(viewCounts.entries())
    .map(([path, data]) => ({
      path,
      views: data.views,
      avgTimeSeconds: data.views > 0 ? Math.round(data.totalTime / data.views) : 0,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  // Never accessed docs
  const allDocs = await prisma.document.findMany({
    where: { repositoryId: { in: repoIds } },
    select: { path: true, createdAt: true },
  });
  const accessedPaths = new Set(viewCounts.keys());
  const neverAccessed = allDocs
    .filter((d) => !accessedPaths.has(d.path))
    .map((d) => ({
      path: d.path,
      daysSinceCreated: Math.floor(
        (Date.now() - new Date(d.createdAt).getTime()) / (24 * 60 * 60 * 1000)
      ),
    }))
    .sort((a, b) => b.daysSinceCreated - a.daysSinceCreated)
    .slice(0, 10);

  // Failing searches
  const searchEvents = events.filter(
    (e: any) => e.eventType === 'search' && (e.metadata as any)?.noResults
  );
  const searchCounts = new Map<string, number>();
  for (const e of searchEvents) {
    const query = (e.metadata as any)?.query ?? '';
    searchCounts.set(query, (searchCounts.get(query) ?? 0) + 1);
  }
  const failingSearches = Array.from(searchCounts.entries())
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Satisfaction trend (simplified)
  const satisfactionTrend = [{ date: new Date().toISOString().split('T')[0]!, score: 75 }];

  const totalViews = events.filter((e: any) => e.eventType === 'view').length;

  log.info(
    { organizationId, period, totalViews, uniqueReaders: uniqueUsers.size },
    'Insights computed'
  );

  return {
    organizationId,
    period: `${periodDays} days`,
    topDocs,
    neverAccessed,
    failingSearches,
    satisfactionTrend,
    totalViews,
    uniqueReaders: uniqueUsers.size,
  };
}

export async function generateRecommendations(organizationId: string): Promise<Recommendation[]> {
  const insights = await computeInsights(organizationId, 'monthly');
  const recommendations: Recommendation[] = [];

  for (const doc of insights.neverAccessed.slice(0, 5)) {
    if (doc.daysSinceCreated > 90) {
      recommendations.push({
        type: 'archive',
        priority: 'low',
        documentPath: doc.path,
        reason: 'Document has never been accessed',
        evidence: `Created ${doc.daysSinceCreated} days ago with zero views`,
      });
    }
  }

  for (const search of insights.failingSearches.slice(0, 3)) {
    recommendations.push({
      type: 'create',
      priority: 'high',
      documentPath: `docs/${search.query.replace(/\s+/g, '-')}.md`,
      reason: `Users are searching for "${search.query}" but finding no results`,
      evidence: `${search.count} failed search(es) in the last period`,
    });
  }

  log.info(
    { organizationId, recommendations: recommendations.length },
    'Recommendations generated'
  );
  return recommendations;
}
