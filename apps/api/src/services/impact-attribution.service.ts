/**
 * Documentation Impact Attribution Service
 *
 * Correlates documentation updates with support ticket reduction, onboarding
 * improvements, and developer productivity gains. Generates ROI impact reports
 * with dollar estimates and trend analysis.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('impact-attribution-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface ImpactCorrelation {
  documentPath: string;
  metric: string;
  beforeValue: number;
  afterValue: number;
  changePercent: number;
  confidence: number;
  period: string;
}

export interface ImpactReport {
  organizationId: string;
  period: string;
  correlations: ImpactCorrelation[];
  topImpactDocs: Array<{ path: string; totalReduction: number }>;
  totalTicketReduction: number;
  estimatedHoursSaved: number;
  dollarImpact: number;
}

export interface PredictedImpact {
  documentPath: string;
  expectedTicketReduction: number;
  expectedOnboardingImprovement: number;
  confidence: number;
}

export interface TicketData {
  source: string;
  count: number;
  category: string;
  period: string;
}

// ============================================================================
// Constants
// ============================================================================

const PERIOD_DAYS: Record<string, number> = { weekly: 7, monthly: 30, quarterly: 90 };
const COST_PER_TICKET_HOUR = 45;
const AVG_MINUTES_PER_TICKET = 25;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Find correlations between documentation updates and support ticket reductions.
 */
export async function correlateDocImpact(
  organizationId: string,
  period: 'weekly' | 'monthly' | 'quarterly'
): Promise<ImpactCorrelation[]> {
  log.info({ organizationId, period }, 'Computing doc impact correlations');

  const days = PERIOD_DAYS[period];
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const priorPeriodStart = new Date(periodStart.getTime() - days * 24 * 60 * 60 * 1000);

  // Get repos for this org
  const repos = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const repoIds = repos.map((r) => r.id);

  // Get docs updated in this period
  const updatedDocs = await prisma.document.findMany({
    where: {
      repositoryId: { in: repoIds },
      updatedAt: { gte: periodStart, lte: periodEnd },
      path: { endsWith: '.md' },
    },
    select: { path: true, repositoryId: true, updatedAt: true },
  });

  // Get ticket data for both periods
  const currentTickets = await db.ticketData.findMany({
    where: {
      organizationId,
      recordedAt: { gte: periodStart, lte: periodEnd },
    },
  });

  const priorTickets = await db.ticketData.findMany({
    where: {
      organizationId,
      recordedAt: { gte: priorPeriodStart, lte: periodStart },
    },
  });

  const correlations: ImpactCorrelation[] = [];

  // Group tickets by category
  const currentByCategory = groupTicketsByCategory(currentTickets);
  const priorByCategory = groupTicketsByCategory(priorTickets);

  for (const doc of updatedDocs) {
    const category = classifyTicketCategory(doc.path);
    const beforeCount = priorByCategory.get(category) ?? 0;
    const afterCount = currentByCategory.get(category) ?? 0;

    if (beforeCount === 0) continue;

    const changePercent = ((afterCount - beforeCount) / beforeCount) * 100;
    const correlation = computeCorrelation(beforeCount, afterCount, updatedDocs.length);

    correlations.push({
      documentPath: doc.path,
      metric: `${category}_tickets`,
      beforeValue: beforeCount,
      afterValue: afterCount,
      changePercent: Math.round(changePercent * 100) / 100,
      confidence: correlation,
      period,
    });
  }

  // Sort by impact magnitude
  correlations.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

  log.info({ organizationId, correlations: correlations.length }, 'Correlations computed');
  return correlations;
}

/**
 * Generate a comprehensive impact report with ROI estimates.
 */
export async function generateImpactReport(
  organizationId: string,
  period: 'weekly' | 'monthly' | 'quarterly'
): Promise<ImpactReport> {
  log.info({ organizationId, period }, 'Generating impact report');

  const correlations = await correlateDocImpact(organizationId, period);

  // Calculate total ticket reduction (only count reductions, not increases)
  const reductions = correlations.filter((c) => c.changePercent < 0);
  const totalTicketReduction = reductions.reduce(
    (sum, c) => sum + Math.abs(c.beforeValue - c.afterValue),
    0
  );

  const estimatedHoursSaved = estimateHoursSaved(totalTicketReduction);
  const dollarImpact = Math.round(estimatedHoursSaved * COST_PER_TICKET_HOUR);

  // Identify top impact documents
  const docImpactMap = new Map<string, number>();
  for (const c of reductions) {
    const existing = docImpactMap.get(c.documentPath) ?? 0;
    docImpactMap.set(c.documentPath, existing + Math.abs(c.beforeValue - c.afterValue));
  }

  const topImpactDocs = [...docImpactMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, totalReduction]) => ({ path, totalReduction }));

  const report: ImpactReport = {
    organizationId,
    period,
    correlations,
    topImpactDocs,
    totalTicketReduction,
    estimatedHoursSaved,
    dollarImpact,
  };

  // Store report
  await db.impactReport.create({
    data: {
      organizationId,
      period,
      totalTicketReduction,
      estimatedHoursSaved,
      dollarImpact,
      topDocCount: topImpactDocs.length,
      correlationCount: correlations.length,
      generatedAt: new Date(),
    },
  });

  log.info(
    {
      organizationId,
      ticketReduction: totalTicketReduction,
      hoursSaved: estimatedHoursSaved,
      dollarImpact,
    },
    'Impact report generated'
  );
  return report;
}

/**
 * Predict the potential impact of documenting a specific area.
 */
export async function predictDocImpact(
  repositoryId: string,
  documentPath: string
): Promise<PredictedImpact> {
  log.info({ repositoryId, documentPath }, 'Predicting doc impact');

  // Analyze existing ticket patterns for related topics
  const repo = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { organizationId: true },
  });

  if (!repo) throw new Error(`Repository ${repositoryId} not found`);

  const category = classifyTicketCategory(documentPath);

  // Get historical tickets for this category
  const recentTickets = await db.ticketData.findMany({
    where: {
      organizationId: repo.organizationId,
      category,
      recordedAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    },
  });

  const totalTickets = recentTickets.reduce(
    (sum: number, t: { count: number }) => sum + t.count,
    0
  );

  // Estimate reduction based on historical patterns
  const avgReductionRate = 0.25; // 25% average reduction from documentation
  const expectedReduction = Math.round(totalTickets * avgReductionRate);

  // Onboarding improvement estimate based on doc type
  let onboardingImprovement = 0;
  if (documentPath.includes('getting-started') || documentPath.includes('quickstart')) {
    onboardingImprovement = 35;
  } else if (documentPath.includes('tutorial') || documentPath.includes('guide')) {
    onboardingImprovement = 20;
  } else if (documentPath.includes('api') || documentPath.includes('reference')) {
    onboardingImprovement = 10;
  }

  const confidence = totalTickets > 20 ? 0.8 : totalTickets > 5 ? 0.6 : 0.35;

  log.info(
    { repositoryId, documentPath, expectedReduction, confidence },
    'Impact prediction complete'
  );
  return {
    documentPath,
    expectedTicketReduction: expectedReduction,
    expectedOnboardingImprovement: onboardingImprovement,
    confidence,
  };
}

/**
 * Ingest support ticket data from external sources for correlation analysis.
 */
export async function ingestTicketData(
  organizationId: string,
  data: TicketData[]
): Promise<number> {
  log.info({ organizationId, records: data.length }, 'Ingesting ticket data');

  let ingested = 0;

  for (const ticket of data) {
    try {
      const category = ticket.category || classifyTicketCategory(ticket.source);

      await db.ticketData.create({
        data: {
          organizationId,
          source: ticket.source,
          count: ticket.count,
          category,
          period: ticket.period,
          recordedAt: new Date(),
        },
      });
      ingested++;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.warn({ source: ticket.source, err: message }, 'Failed to ingest ticket record');
    }
  }

  log.info({ organizationId, ingested, total: data.length }, 'Ticket data ingestion complete');
  return ingested;
}

/**
 * Get impact trend data over time for visualizations.
 */
export async function getImpactTrends(
  organizationId: string,
  days = 90
): Promise<Array<{ date: string; ticketCount: number; docUpdates: number }>> {
  log.info({ organizationId, days }, 'Fetching impact trends');

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get daily ticket counts
  const tickets = await db.ticketData.findMany({
    where: { organizationId, recordedAt: { gte: since } },
    select: { count: true, recordedAt: true },
  });

  // Get repos for doc update counts
  const repos = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const repoIds = repos.map((r) => r.id);

  const docUpdates = await prisma.document.findMany({
    where: {
      repositoryId: { in: repoIds },
      updatedAt: { gte: since },
      path: { endsWith: '.md' },
    },
    select: { updatedAt: true },
  });

  // Aggregate by day
  const dailyMap = new Map<string, { ticketCount: number; docUpdates: number }>();

  for (let d = 0; d < days; d++) {
    const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    dailyMap.set(key, { ticketCount: 0, docUpdates: 0 });
  }

  for (const t of tickets) {
    const key = new Date(t.recordedAt).toISOString().slice(0, 10);
    const entry = dailyMap.get(key);
    if (entry) entry.ticketCount += t.count;
  }

  for (const d of docUpdates) {
    const key = new Date(d.updatedAt).toISOString().slice(0, 10);
    const entry = dailyMap.get(key);
    if (entry) entry.docUpdates++;
  }

  const trends = [...dailyMap.entries()]
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  log.info({ organizationId, dataPoints: trends.length }, 'Impact trends fetched');
  return trends;
}

// ============================================================================
// Private Helpers
// ============================================================================

function computeCorrelation(beforeCount: number, afterCount: number, sampleSize: number): number {
  const changeMagnitude = Math.abs(beforeCount - afterCount) / Math.max(beforeCount, 1);
  const sampleConfidence = Math.min(sampleSize / 10, 1);
  return Math.round(Math.min(changeMagnitude * sampleConfidence, 1) * 100) / 100;
}

function estimateHoursSaved(ticketReduction: number): number {
  return Math.round(((ticketReduction * AVG_MINUTES_PER_TICKET) / 60) * 100) / 100;
}

function classifyTicketCategory(pathOrSource: string): string {
  const lower = pathOrSource.toLowerCase();

  if (lower.includes('auth') || lower.includes('login') || lower.includes('sso'))
    return 'authentication';
  if (lower.includes('api') || lower.includes('endpoint') || lower.includes('rest'))
    return 'api-usage';
  if (lower.includes('install') || lower.includes('setup') || lower.includes('getting-started'))
    return 'setup';
  if (lower.includes('migration') || lower.includes('upgrade') || lower.includes('breaking'))
    return 'migration';
  if (lower.includes('config') || lower.includes('settings') || lower.includes('env'))
    return 'configuration';
  if (lower.includes('error') || lower.includes('troubleshoot') || lower.includes('debug'))
    return 'troubleshooting';
  return 'general';
}

function groupTicketsByCategory(
  tickets: Array<{ category: string; count: number }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tickets) {
    map.set(t.category, (map.get(t.category) ?? 0) + t.count);
  }
  return map;
}
