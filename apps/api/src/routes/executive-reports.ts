/**
 * Documentation ROI Dashboard with Executive Reports Routes
 *
 * API endpoints for generating executive-level documentation ROI dashboards,
 * KPI scorecards, team activity reports, and scheduled recurring reports.
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { createLogger, ValidationError, NotFoundError } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';

const log = createLogger('executive-reports-routes');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

// ============================================================================
// Executive Dashboard
// ============================================================================

/**
 * Get executive dashboard for an organization
 * GET /dashboard/:orgId
 */
app.get('/dashboard/:orgId', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.req.param('orgId') ?? '';
  const period = c.req.query('period') ?? '30d';
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  // Parse period or use custom dates
  let start: Date;
  let end: Date;

  if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new ValidationError('Invalid date format for startDate or endDate');
    }
    if (start >= end) {
      throw new ValidationError('startDate must be before endDate');
    }
  } else {
    end = new Date();
    start = new Date();
    const daysMatch = period.match(/^(\d+)d$/);
    if (!daysMatch) {
      throw new ValidationError('period must be in format Nd (e.g., 30d, 90d)');
    }
    const days = parseInt(daysMatch[1]!, 10);
    if (days < 1 || days > 365) {
      throw new ValidationError('period must be between 1d and 365d');
    }
    start.setDate(start.getDate() - days);
  }

  // Verify organization exists
  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
  });

  if (!organization) {
    throw new NotFoundError('Organization', orgId);
  }

  // Aggregate dashboard metrics
  const [repositoryCount, documentCount, recentGenerations] = await Promise.all([
    prisma.repository.count({ where: { organizationId: orgId } }),
    prisma.document.count({
      where: {
        repository: { organizationId: orgId },
      },
    }),
    db.executiveMetric.findFirst({
      where: {
        organizationId: orgId,
        periodStart: { gte: start },
        periodEnd: { lte: end },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const dashboard = {
    organizationId: orgId,
    organizationName: organization.name,
    period: { start, end },
    overview: {
      totalRepositories: repositoryCount,
      totalDocuments: documentCount,
      docsGeneratedThisPeriod: recentGenerations?.docsGenerated ?? 0,
      hoursSavedThisPeriod: recentGenerations?.hoursSaved ?? 0,
      costPerDocument: recentGenerations?.costPerDoc ?? 0,
      freshnessTrend: recentGenerations?.freshnessTrend ?? 'stable',
    },
  };

  log.info({ orgId, period }, 'Executive dashboard retrieved');

  return c.json({
    success: true,
    data: dashboard,
  });
});

// ============================================================================
// ROI Metrics
// ============================================================================

/**
 * Get key ROI metrics for an organization
 * GET /metrics/:orgId
 */
app.get('/metrics/:orgId', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.req.param('orgId') ?? '';

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
  });

  if (!organization) {
    throw new NotFoundError('Organization', orgId);
  }

  // Fetch most recent ROI metrics
  const latestMetrics = await db.executiveMetric.findFirst({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
  });

  const documentCount = await prisma.document.count({
    where: {
      repository: { organizationId: orgId },
    },
  });

  const metrics = {
    organizationId: orgId,
    hoursSaved: latestMetrics?.hoursSaved ?? 0,
    costPerDoc: latestMetrics?.costPerDoc ?? 0,
    freshnessTrend: latestMetrics?.freshnessTrend ?? 'stable',
    totalDocuments: documentCount,
    docsGenerated: latestMetrics?.docsGenerated ?? 0,
    aiEfficiencyScore: latestMetrics?.aiEfficiencyScore ?? 0,
    lastCalculated: latestMetrics?.createdAt ?? null,
  };

  return c.json({
    success: true,
    data: metrics,
  });
});

// ============================================================================
// Period Comparison
// ============================================================================

/**
 * Compare metrics across two periods
 * GET /comparison/:orgId
 */
app.get('/comparison/:orgId', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.req.param('orgId') ?? '';
  const currentPeriod = c.req.query('currentPeriod');
  const previousPeriod = c.req.query('previousPeriod');

  if (!currentPeriod || !previousPeriod) {
    throw new ValidationError('currentPeriod and previousPeriod are required (format: Nd, e.g., 30d)');
  }

  const currentMatch = currentPeriod.match(/^(\d+)d$/);
  const previousMatch = previousPeriod.match(/^(\d+)d$/);

  if (!currentMatch || !previousMatch) {
    throw new ValidationError('Period must be in format Nd (e.g., 30d, 90d)');
  }

  const currentDays = parseInt(currentMatch[1]!, 10);
  const previousDays = parseInt(previousMatch[1]!, 10);

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
  });

  if (!organization) {
    throw new NotFoundError('Organization', orgId);
  }

  const now = new Date();
  const currentStart = new Date();
  currentStart.setDate(now.getDate() - currentDays);

  const previousStart = new Date(currentStart);
  previousStart.setDate(previousStart.getDate() - previousDays);
  const previousEnd = new Date(currentStart);

  // Fetch metrics for both periods
  const [currentMetrics, previousMetrics] = await Promise.all([
    db.executiveMetric.findFirst({
      where: {
        organizationId: orgId,
        periodStart: { gte: currentStart },
        periodEnd: { lte: now },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.executiveMetric.findFirst({
      where: {
        organizationId: orgId,
        periodStart: { gte: previousStart },
        periodEnd: { lte: previousEnd },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const currentHoursSaved = currentMetrics?.hoursSaved ?? 0;
  const previousHoursSaved = previousMetrics?.hoursSaved ?? 0;
  const currentDocsGenerated = currentMetrics?.docsGenerated ?? 0;
  const previousDocsGenerated = previousMetrics?.docsGenerated ?? 0;

  const comparison = {
    organizationId: orgId,
    currentPeriod: {
      label: currentPeriod,
      start: currentStart,
      end: now,
      hoursSaved: currentHoursSaved,
      docsGenerated: currentDocsGenerated,
      costPerDoc: currentMetrics?.costPerDoc ?? 0,
    },
    previousPeriod: {
      label: previousPeriod,
      start: previousStart,
      end: previousEnd,
      hoursSaved: previousHoursSaved,
      docsGenerated: previousDocsGenerated,
      costPerDoc: previousMetrics?.costPerDoc ?? 0,
    },
    changes: {
      hoursSavedDelta: currentHoursSaved - previousHoursSaved,
      hoursSavedPercent: previousHoursSaved > 0
        ? ((currentHoursSaved - previousHoursSaved) / previousHoursSaved) * 100
        : 0,
      docsGeneratedDelta: currentDocsGenerated - previousDocsGenerated,
      docsGeneratedPercent: previousDocsGenerated > 0
        ? ((currentDocsGenerated - previousDocsGenerated) / previousDocsGenerated) * 100
        : 0,
    },
  };

  return c.json({
    success: true,
    data: comparison,
  });
});

// ============================================================================
// Report Generation
// ============================================================================

/**
 * Generate an executive report
 * POST /reports/:orgId/generate
 */
app.post('/reports/:orgId/generate', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.req.param('orgId') ?? '';
  const body = await c.req.json<{
    format: 'json' | 'csv' | 'pdf';
    period: string;
    includeCharts: boolean;
  }>();

  if (!body.format || !['json', 'csv', 'pdf'].includes(body.format)) {
    throw new ValidationError('format must be one of: json, csv, pdf');
  }

  if (!body.period) {
    throw new ValidationError('period is required (format: Nd, e.g., 30d)');
  }

  const periodMatch = body.period.match(/^(\d+)d$/);
  if (!periodMatch) {
    throw new ValidationError('period must be in format Nd (e.g., 30d, 90d)');
  }

  const days = parseInt(periodMatch[1]!, 10);
  if (days < 1 || days > 365) {
    throw new ValidationError('period must be between 1d and 365d');
  }

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
  });

  if (!organization) {
    throw new NotFoundError('Organization', orgId);
  }

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  // Create the report record
  const report = await db.executiveReport.create({
    data: {
      organizationId: orgId,
      format: body.format,
      period: body.period,
      includeCharts: body.includeCharts ?? false,
      periodStart: start,
      periodEnd: end,
      status: 'generating',
      generatedBy: c.get('userId') as string,
    },
  });

  // Update status to completed (in production, this would be async)
  const completedReport = await db.executiveReport.update({
    where: { id: report.id },
    data: {
      status: 'completed',
      completedAt: new Date(),
    },
  });

  log.info({ reportId: report.id, orgId, format: body.format, period: body.period }, 'Executive report generated');

  return c.json({
    success: true,
    data: completedReport,
  }, 201);
});

/**
 * List generated reports for an organization
 * GET /reports/:orgId
 */
app.get('/reports/:orgId', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.req.param('orgId') ?? '';
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
  });

  if (!organization) {
    throw new NotFoundError('Organization', orgId);
  }

  const [reports, total] = await Promise.all([
    db.executiveReport.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      select: {
        id: true,
        format: true,
        period: true,
        status: true,
        includeCharts: true,
        periodStart: true,
        periodEnd: true,
        generatedBy: true,
        createdAt: true,
        completedAt: true,
      },
    }),
    db.executiveReport.count({ where: { organizationId: orgId } }),
  ]);

  return c.json({
    success: true,
    data: {
      reports,
      total,
      limit,
      offset,
    },
  });
});

/**
 * Get a specific report
 * GET /reports/:orgId/:reportId
 */
app.get('/reports/:orgId/:reportId', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.req.param('orgId') ?? '';
  const reportId = c.req.param('reportId') ?? '';

  const report = await db.executiveReport.findFirst({
    where: { id: reportId, organizationId: orgId },
  });

  if (!report) {
    throw new NotFoundError('Report', reportId);
  }

  return c.json({
    success: true,
    data: report,
  });
});

// ============================================================================
// Scheduled Reports
// ============================================================================

/**
 * Schedule recurring reports
 * POST /reports/:orgId/schedule
 */
app.post('/reports/:orgId/schedule', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.req.param('orgId') ?? '';
  const body = await c.req.json<{
    frequency: 'weekly' | 'monthly';
    recipients: string[];
    format?: 'json' | 'csv' | 'pdf';
    includeCharts?: boolean;
  }>();

  if (!body.frequency || !['weekly', 'monthly'].includes(body.frequency)) {
    throw new ValidationError('frequency must be one of: weekly, monthly');
  }

  if (!body.recipients || !Array.isArray(body.recipients) || body.recipients.length === 0) {
    throw new ValidationError('recipients must be a non-empty array of email addresses');
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const email of body.recipients) {
    if (!emailRegex.test(email)) {
      throw new ValidationError(`Invalid email address: ${email}`);
    }
  }

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
  });

  if (!organization) {
    throw new NotFoundError('Organization', orgId);
  }

  // Calculate next run date
  const nextRunAt = new Date();
  if (body.frequency === 'weekly') {
    nextRunAt.setDate(nextRunAt.getDate() + 7);
  } else {
    nextRunAt.setMonth(nextRunAt.getMonth() + 1);
  }

  const schedule = await db.reportSchedule.create({
    data: {
      organizationId: orgId,
      frequency: body.frequency,
      recipients: body.recipients,
      format: body.format ?? 'pdf',
      includeCharts: body.includeCharts ?? true,
      createdBy: c.get('userId') as string,
      active: true,
      nextRunAt,
    },
  });

  log.info(
    { scheduleId: schedule.id, orgId, frequency: body.frequency, recipientCount: body.recipients.length },
    'Report schedule created'
  );

  return c.json({
    success: true,
    data: schedule,
  }, 201);
});

/**
 * Delete a scheduled report
 * DELETE /reports/:orgId/schedule/:scheduleId
 */
app.delete('/reports/:orgId/schedule/:scheduleId', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.req.param('orgId') ?? '';
  const scheduleId = c.req.param('scheduleId') ?? '';

  const schedule = await db.reportSchedule.findFirst({
    where: { id: scheduleId, organizationId: orgId },
  });

  if (!schedule) {
    throw new NotFoundError('Schedule', scheduleId);
  }

  await db.reportSchedule.update({
    where: { id: scheduleId },
    data: { active: false },
  });

  log.info({ scheduleId, orgId }, 'Report schedule deleted');

  return c.json({
    success: true,
    data: {
      message: 'Schedule successfully deleted',
    },
  });
});

// ============================================================================
// KPI Scorecard
// ============================================================================

/**
 * Get KPI scorecard for an organization
 * GET /kpis/:orgId
 */
app.get('/kpis/:orgId', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.req.param('orgId') ?? '';

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
  });

  if (!organization) {
    throw new NotFoundError('Organization', orgId);
  }

  // Fetch latest KPI data
  const latestMetrics = await db.executiveMetric.findFirst({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
  });

  const documentCount = await prisma.document.count({
    where: {
      repository: { organizationId: orgId },
    },
  });

  const repositoryCount = await prisma.repository.count({
    where: { organizationId: orgId },
  });

  const kpis = {
    organizationId: orgId,
    documentationFreshness: {
      score: latestMetrics?.freshnessScore ?? 0,
      trend: latestMetrics?.freshnessTrend ?? 'stable',
      staleDocCount: latestMetrics?.staleDocCount ?? 0,
      totalDocs: documentCount,
    },
    coverage: {
      score: latestMetrics?.coverageScore ?? 0,
      coveredRepositories: latestMetrics?.coveredRepos ?? 0,
      totalRepositories: repositoryCount,
    },
    teamAdoption: {
      score: latestMetrics?.adoptionScore ?? 0,
      activeUsers: latestMetrics?.activeUsers ?? 0,
      totalUsers: latestMetrics?.totalUsers ?? 0,
    },
    aiEfficiency: {
      score: latestMetrics?.aiEfficiencyScore ?? 0,
      docsGenerated: latestMetrics?.docsGenerated ?? 0,
      avgGenerationTime: latestMetrics?.avgGenerationTime ?? 0,
      successRate: latestMetrics?.successRate ?? 0,
    },
    lastUpdated: latestMetrics?.createdAt ?? null,
  };

  return c.json({
    success: true,
    data: kpis,
  });
});

// ============================================================================
// Team Activity
// ============================================================================

/**
 * Get team member activity (contributions, reviews, generations per user)
 * GET /team-activity/:orgId
 */
app.get('/team-activity/:orgId', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.req.param('orgId') ?? '';
  const days = parseInt(c.req.query('days') ?? '30', 10);
  const limit = parseInt(c.req.query('limit') ?? '20', 10);

  if (days < 1 || days > 365) {
    throw new ValidationError('days must be between 1 and 365');
  }

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
  });

  if (!organization) {
    throw new NotFoundError('Organization', orgId);
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Fetch team activity data
  const teamActivity = await db.teamActivityRecord.findMany({
    where: {
      organizationId: orgId,
      recordedAt: { gte: startDate },
    },
    include: {
      user: {
        select: { id: true, githubUsername: true, avatarUrl: true },
      },
    },
    orderBy: { totalContributions: 'desc' },
    take: limit,
  });

  const members = teamActivity.map((activity: Record<string, unknown>) => ({
    user: activity.user,
    contributions: activity.totalContributions ?? 0,
    reviews: activity.totalReviews ?? 0,
    generations: activity.totalGenerations ?? 0,
    lastActive: activity.lastActiveAt ?? activity.recordedAt,
  }));

  return c.json({
    success: true,
    data: {
      organizationId: orgId,
      period: {
        start: startDate,
        end: new Date(),
        days,
      },
      members,
      totalMembers: members.length,
    },
  });
});

export { app as executiveReportsRoutes };
