import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { DocumentType } from '@docsynth/types';

const app = new Hono();

// Get organization analytics overview
app.get('/overview', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { startDate, endDate } = c.req.query();

  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();

  // Get repository IDs for the organization first
  const orgRepos = await prisma.repository.findMany({
    where: { organizationId: orgId },
    select: { id: true, enabled: true },
  });
  const repoIds = orgRepos.map((r) => r.id);

  const [repositories, jobs, documents] = await Promise.all([
    Promise.resolve(orgRepos),
    prisma.generationJob.findMany({
      where: {
        repositoryId: { in: repoIds },
        createdAt: { gte: start, lte: end },
      },
      select: { id: true, status: true, createdAt: true },
    }),
    prisma.document.findMany({
      where: {
        repositoryId: { in: repoIds },
        updatedAt: { gte: start, lte: end },
      },
      select: { id: true, type: true },
    }),
  ]);

  const totalRepos = repositories.length;
  const enabledRepos = repositories.filter((r) => r.enabled).length;
  const totalJobs = jobs.length;
  const successfulJobs = jobs.filter((j) => j.status === 'COMPLETED').length;
  const failedJobs = jobs.filter((j) => j.status === 'FAILED').length;

  return c.json({
    success: true,
    data: {
      period: { start, end },
      repositories: {
        total: totalRepos,
        enabled: enabledRepos,
        disabled: totalRepos - enabledRepos,
      },
      generation: {
        totalJobs,
        successful: successfulJobs,
        failed: failedJobs,
        successRate: totalJobs > 0 ? ((successfulJobs / totalJobs) * 100).toFixed(1) : 0,
      },
      documents: {
        total: documents.length,
        byType: documents.reduce(
          (acc, d) => {
            acc[d.type] = (acc[d.type] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        ),
      },
    },
  });
});

// Get documentation coverage metrics
app.get('/coverage', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { repositoryId } = c.req.query();

  const whereClause = repositoryId
    ? { id: repositoryId, organizationId: orgId }
    : { organizationId: orgId };

  const repositories = await prisma.repository.findMany({
    where: whereClause,
    include: {
      documents: {
        select: { type: true, path: true },
      },
      _count: {
        select: { documents: true },
      },
    },
  });

  const coverage = repositories.map((repo) => {
    const docTypes = new Set(repo.documents.map((d) => d.type));
    const expectedTypes: DocumentType[] = ['README', 'API_REFERENCE', 'CHANGELOG', 'ARCHITECTURE'];
    const coveredTypes = expectedTypes.filter((t) => docTypes.has(t));

    return {
      repositoryId: repo.id,
      repositoryName: repo.name,
      totalDocuments: repo._count.documents,
      coverage: {
        percentage: ((coveredTypes.length / expectedTypes.length) * 100).toFixed(1),
        covered: coveredTypes,
        missing: expectedTypes.filter((t) => !docTypes.has(t)),
      },
    };
  });

  return c.json({
    success: true,
    data: coverage,
  });
});

// Get freshness metrics
app.get('/freshness', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  // Get repository IDs for the organization first
  const orgRepos = await prisma.repository.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, lastActivityAt: true },
  });
  const repoIds = orgRepos.map((r) => r.id);
  const repoMap = new Map(orgRepos.map((r) => [r.id, r]));

  const documents = await prisma.document.findMany({
    where: { repositoryId: { in: repoIds } },
    orderBy: { updatedAt: 'desc' },
  });

  const now = new Date();
  const freshness = documents.map((doc) => {
    const repo = repoMap.get(doc.repositoryId);
    const docAge = now.getTime() - doc.updatedAt.getTime();
    const repoLastActivity = repo?.lastActivityAt
      ? now.getTime() - repo.lastActivityAt.getTime()
      : Infinity;

    // Doc is stale if it's older than 30 days and repo has recent activity
    const daysSinceUpdate = docAge / (24 * 60 * 60 * 1000);
    const daysSinceActivity = repoLastActivity / (24 * 60 * 60 * 1000);

    let status: 'fresh' | 'aging' | 'stale';
    if (daysSinceUpdate < 7) {
      status = 'fresh';
    } else if (daysSinceUpdate < 30 || daysSinceActivity > daysSinceUpdate) {
      status = 'aging';
    } else {
      status = 'stale';
    }

    return {
      documentId: doc.id,
      path: doc.path,
      type: doc.type,
      repository: repo?.name ?? 'Unknown',
      lastUpdated: doc.updatedAt,
      daysSinceUpdate: Math.floor(daysSinceUpdate),
      status,
    };
  });

  const summary = {
    fresh: freshness.filter((f) => f.status === 'fresh').length,
    aging: freshness.filter((f) => f.status === 'aging').length,
    stale: freshness.filter((f) => f.status === 'stale').length,
  };

  return c.json({
    success: true,
    data: {
      summary,
      documents: freshness,
    },
  });
});

// Get generation trends
app.get('/trends', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { period } = c.req.query();

  const days = period === 'year' ? 365 : period === 'quarter' ? 90 : 30;
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get repository IDs for the organization first
  const orgRepos = await prisma.repository.findMany({
    where: { organizationId: orgId },
    select: { id: true },
  });
  const repoIds = orgRepos.map((r) => r.id);

  const jobs = await prisma.generationJob.findMany({
    where: {
      repositoryId: { in: repoIds },
      createdAt: { gte: start },
    },
    select: {
      createdAt: true,
      status: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Group by day/week based on period
  const grouping = days > 60 ? 7 : 1; // Weekly for longer periods
  const trends: Record<string, { total: number; successful: number; failed: number }> = {};

  jobs.forEach((job) => {
    const date = new Date(job.createdAt);
    date.setHours(0, 0, 0, 0);
    if (grouping > 1) {
      date.setDate(date.getDate() - date.getDay()); // Start of week
    }
    const key = date.toISOString().split('T')[0] ?? '';

    if (!trends[key]) {
      trends[key] = { total: 0, successful: 0, failed: 0 };
    }

    trends[key]!.total++;
    if (job.status === 'COMPLETED') trends[key]!.successful++;
    if (job.status === 'FAILED') trends[key]!.failed++;
  });

  return c.json({
    success: true,
    data: {
      period: { days, grouping: grouping === 7 ? 'weekly' : 'daily' },
      trends: Object.entries(trends).map(([date, data]) => ({
        date,
        ...data,
      })),
    },
  });
});

// Get quality metrics
app.get('/quality', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  // Get repository IDs for the organization first
  const orgRepos = await prisma.repository.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
  });
  const repoIds = orgRepos.map((r) => r.id);
  const repoMap = new Map(orgRepos.map((r) => [r.id, r]));

  const documents = await prisma.document.findMany({
    where: { repositoryId: { in: repoIds } },
    select: {
      id: true,
      type: true,
      path: true,
      metadata: true,
      repositoryId: true,
    },
  });

  const quality = documents.map((doc) => {
    const repo = repoMap.get(doc.repositoryId);
    const metadata = (doc.metadata as Record<string, unknown>) || {};
    const qualityScore = typeof metadata.qualityScore === 'number' ? metadata.qualityScore : null;

    return {
      documentId: doc.id,
      path: doc.path,
      type: doc.type,
      repository: repo?.name ?? 'Unknown',
      qualityScore,
      lastAssessed: metadata.lastQualityCheck ?? null,
    };
  });

  const qualityWithScores = quality.filter((q): q is typeof q & { qualityScore: number } => q.qualityScore !== null);
  const avgScore =
    qualityWithScores.length > 0
      ? qualityWithScores.reduce((sum, q) => sum + q.qualityScore, 0) / qualityWithScores.length
      : 0;

  return c.json({
    success: true,
    data: {
      averageScore: qualityWithScores.length === 0 ? null : avgScore.toFixed(1),
      distribution: {
        excellent: qualityWithScores.filter((q) => q.qualityScore >= 90).length,
        good: qualityWithScores.filter((q) => q.qualityScore >= 70 && q.qualityScore < 90).length,
        needsWork: qualityWithScores.filter((q) => q.qualityScore < 70).length,
        notAssessed: quality.filter((q) => q.qualityScore === null).length,
      },
      documents: quality,
    },
  });
});

// Get usage by repository
app.get('/usage/repositories', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { limit } = c.req.query();

  const repositories = await prisma.repository.findMany({
    where: { organizationId: orgId },
    include: {
      _count: {
        select: {
          documents: true,
          prEvents: true,
          generationJobs: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: limit ? parseInt(limit, 10) : 10,
  });

  return c.json({
    success: true,
    data: repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      enabled: repo.enabled,
      documents: repo._count.documents,
      prEvents: repo._count.prEvents,
      generationJobs: repo._count.generationJobs,
    })),
  });
});

// Get document health scores
app.get('/health', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { repositoryId, status } = c.req.query();

  const orgRepos = await prisma.repository.findMany({
    where: repositoryId
      ? { id: repositoryId, organizationId: orgId }
      : { organizationId: orgId },
    select: { id: true, name: true, lastActivityAt: true },
  });
  const repoIds = orgRepos.map((r) => r.id);
  const repoMap = new Map(orgRepos.map((r) => [r.id, r]));

  const documents = await prisma.document.findMany({
    where: { repositoryId: { in: repoIds } },
  });

  // Get recent PR events to determine code change dates
  const prEvents = await prisma.pREvent.findMany({
    where: {
      repositoryId: { in: repoIds },
      mergedAt: { not: null },
    },
    orderBy: { mergedAt: 'desc' },
    take: 100,
  });

  const codeChangesByRepo = new Map<string, Date[]>();
  prEvents.forEach((pr) => {
    if (pr.mergedAt) {
      const existing = codeChangesByRepo.get(pr.repositoryId) || [];
      existing.push(pr.mergedAt);
      codeChangesByRepo.set(pr.repositoryId, existing);
    }
  });

  const now = new Date();
  const healthScores = documents.map((doc) => {
    const repo = repoMap.get(doc.repositoryId);
    const codeChangeDates = codeChangesByRepo.get(doc.repositoryId) || [];

    const docAge = now.getTime() - doc.updatedAt.getTime();
    const daysSinceUpdate = Math.floor(docAge / (24 * 60 * 60 * 1000));

    const lastCodeChange = codeChangeDates.length > 0
      ? Math.max(...codeChangeDates.map((d) => d.getTime()))
      : repo?.lastActivityAt?.getTime() ?? now.getTime();
    const daysSinceCodeChange = Math.floor((now.getTime() - lastCodeChange) / (24 * 60 * 60 * 1000));

    // Calculate freshness score
    let freshnessScore: number;
    if (daysSinceUpdate <= daysSinceCodeChange) {
      freshnessScore = 100;
    } else {
      const driftDays = daysSinceUpdate - daysSinceCodeChange;
      if (driftDays <= 7) freshnessScore = 90;
      else if (driftDays <= 14) freshnessScore = 75;
      else if (driftDays <= 30) freshnessScore = 60;
      else if (driftDays <= 60) freshnessScore = 40;
      else freshnessScore = 20;
    }

    // Simple completeness based on content length
    const wordCount = doc.content.split(/\s+/).filter((w) => w.length > 0).length;
    const completenessScore = Math.min(100, 50 + (wordCount >= 500 ? 30 : wordCount >= 200 ? 20 : 10) + (doc.content.includes('```') ? 20 : 0));

    // Overall score
    const overallScore = Math.round(freshnessScore * 0.5 + completenessScore * 0.5);
    const healthStatus = overallScore >= 70 ? 'healthy' : overallScore >= 40 ? 'needs-attention' : 'critical';

    return {
      documentId: doc.id,
      path: doc.path,
      type: doc.type,
      repository: repo?.name ?? 'Unknown',
      repositoryId: doc.repositoryId,
      scores: {
        freshness: freshnessScore,
        completeness: completenessScore,
        overall: overallScore,
      },
      factors: {
        daysSinceUpdate,
        daysSinceCodeChange,
        wordCount,
        hasCodeExamples: doc.content.includes('```'),
      },
      status: healthStatus,
      lastUpdated: doc.updatedAt,
    };
  });

  // Filter by status if requested
  const filteredScores = status
    ? healthScores.filter((h) => h.status === status)
    : healthScores;

  // Summary stats
  const summary = {
    total: healthScores.length,
    healthy: healthScores.filter((h) => h.status === 'healthy').length,
    needsAttention: healthScores.filter((h) => h.status === 'needs-attention').length,
    critical: healthScores.filter((h) => h.status === 'critical').length,
    averageScore: healthScores.length > 0
      ? Math.round(healthScores.reduce((sum, h) => sum + h.scores.overall, 0) / healthScores.length)
      : 0,
  };

  return c.json({
    success: true,
    data: {
      summary,
      documents: filteredScores.sort((a, b) => a.scores.overall - b.scores.overall),
    },
  });
});

// Get repository health summary
app.get('/health/repositories', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const repositories = await prisma.repository.findMany({
    where: { organizationId: orgId },
    include: {
      documents: {
        select: { id: true, type: true, path: true, content: true, updatedAt: true },
      },
    },
  });

  const expectedDocTypes: DocumentType[] = ['README', 'API_REFERENCE', 'CHANGELOG', 'ARCHITECTURE'];
  const now = new Date();

  const repoHealth = repositories.map((repo) => {
    const docTypes = new Set(repo.documents.map((d) => d.type));
    const coverageGaps = expectedDocTypes.filter((t) => !docTypes.has(t));

    // Calculate average health for this repo
    const docScores = repo.documents.map((doc) => {
      const docAge = now.getTime() - doc.updatedAt.getTime();
      const daysSinceUpdate = Math.floor(docAge / (24 * 60 * 60 * 1000));
      const freshnessScore = daysSinceUpdate <= 7 ? 100 : daysSinceUpdate <= 30 ? 70 : daysSinceUpdate <= 90 ? 40 : 20;
      return freshnessScore;
    });

    const avgScore = docScores.length > 0
      ? Math.round(docScores.reduce((sum, s) => sum + s, 0) / docScores.length)
      : 0;

    const healthDistribution = {
      healthy: docScores.filter((s) => s >= 70).length,
      needsAttention: docScores.filter((s) => s >= 40 && s < 70).length,
      critical: docScores.filter((s) => s < 40).length,
    };

    const topIssues: string[] = [];
    if (coverageGaps.length > 0) {
      topIssues.push(`Missing: ${coverageGaps.join(', ')}`);
    }
    if (healthDistribution.critical > 0) {
      topIssues.push(`${healthDistribution.critical} critical doc(s)`);
    }
    if (avgScore < 50) {
      topIssues.push('Documentation health is low');
    }

    return {
      repositoryId: repo.id,
      repositoryName: repo.name,
      enabled: repo.enabled,
      overallScore: avgScore,
      documentCount: repo.documents.length,
      healthDistribution,
      coverageGaps,
      coveragePercentage: Math.round(((expectedDocTypes.length - coverageGaps.length) / expectedDocTypes.length) * 100),
      topIssues,
    };
  });

  return c.json({
    success: true,
    data: repoHealth.sort((a, b) => a.overallScore - b.overallScore),
  });
});

// Get analytics dashboard (comprehensive view)
app.get('/dashboard', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { days } = c.req.query();

  const periodDays = days ? parseInt(days, 10) : 30;
  const start = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  const end = new Date();

  const orgRepos = await prisma.repository.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, enabled: true },
  });
  const repoIds = orgRepos.map((r) => r.id);

  const [documents, jobs, recentDrifts] = await Promise.all([
    prisma.document.findMany({
      where: { repositoryId: { in: repoIds } },
      select: { id: true, path: true, type: true, updatedAt: true, repositoryId: true },
    }),
    prisma.generationJob.findMany({
      where: {
        repositoryId: { in: repoIds },
        createdAt: { gte: start, lte: end },
      },
      select: { id: true, status: true, createdAt: true },
    }),
    prisma.document.findMany({
      where: {
        repositoryId: { in: repoIds },
        updatedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      take: 10,
      orderBy: { updatedAt: 'asc' },
      select: { id: true, path: true, type: true, repositoryId: true, updatedAt: true },
    }),
  ]);

  const now = new Date();
  const docHealthScores = documents.map((doc) => {
    const daysSinceUpdate = Math.floor((now.getTime() - doc.updatedAt.getTime()) / (24 * 60 * 60 * 1000));
    return daysSinceUpdate <= 7 ? 100 : daysSinceUpdate <= 30 ? 70 : daysSinceUpdate <= 90 ? 40 : 20;
  });

  const avgHealthScore = docHealthScores.length > 0
    ? Math.round(docHealthScores.reduce((sum, s) => sum + s, 0) / docHealthScores.length)
    : 0;

  const successfulJobs = jobs.filter((j) => j.status === 'COMPLETED').length;

  // Generate daily trends
  const trends: { date: string; healthScore: number; documentCount: number; generations: number }[] = [];
  for (let i = periodDays - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0] ?? '';
    const dayJobs = jobs.filter((j) => {
      const jobDate = new Date(j.createdAt).toISOString().split('T')[0];
      return jobDate === dateStr;
    });
    trends.push({
      date: dateStr,
      healthScore: avgHealthScore, // Simplified - real impl would track historical
      documentCount: documents.length,
      generations: dayJobs.length,
    });
  }

  const repoMap = new Map(orgRepos.map((r) => [r.id, r]));

  return c.json({
    success: true,
    data: {
      period: { start, end },
      summary: {
        totalDocuments: documents.length,
        averageHealthScore: avgHealthScore,
        documentsNeedingAttention: docHealthScores.filter((s) => s < 70).length,
        generationsThisPeriod: jobs.length,
        successRate: jobs.length > 0 ? Math.round((successfulJobs / jobs.length) * 100) : 0,
      },
      recentDrifts: recentDrifts.map((doc) => ({
        documentId: doc.id,
        documentPath: doc.path,
        documentType: doc.type,
        repository: repoMap.get(doc.repositoryId)?.name ?? 'Unknown',
        daysSinceUpdate: Math.floor((now.getTime() - doc.updatedAt.getTime()) / (24 * 60 * 60 * 1000)),
        driftType: 'content-outdated',
      })),
      trends: trends.slice(-14), // Last 14 data points
    },
  });
});

// ============================================================================
// Team Contribution Analytics (Feature 6 Enhancement)
// ============================================================================

// Get team contribution metrics
app.get('/contributions', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { days } = c.req.query();

  const periodDays = days ? parseInt(days, 10) : 30;
  const start = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const orgRepos = await prisma.repository.findMany({
    where: { organizationId: orgId },
    select: { id: true },
  });
  const repoIds = orgRepos.map((r) => r.id);

  // Get generation jobs grouped by status
  const jobs = await prisma.generationJob.findMany({
    where: {
      repositoryId: { in: repoIds },
      createdAt: { gte: start },
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      repositoryId: true,
    },
  });

  // Get PR events to identify contributors
  const prEvents = await prisma.pREvent.findMany({
    where: {
      repositoryId: { in: repoIds },
      createdAt: { gte: start },
    },
    select: {
      id: true,
      prNumber: true,
      title: true,
      createdAt: true,
      repositoryId: true,
    },
  });

  // Aggregate by status
  const byStatus = jobs.reduce((acc, job) => {
    const status = job.status || 'unknown';
    if (!acc[status]) acc[status] = 0;
    acc[status]++;
    return acc;
  }, {} as Record<string, number>);

  // Weekly contribution trend
  const weeklyContributions: Record<string, { generations: number; prs: number }> = {};

  for (let i = 0; i < periodDays; i += 7) {
    const weekStart = new Date(Date.now() - (periodDays - i) * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekKey = weekStart.toISOString().split('T')[0] ?? '';

    const weekJobs = jobs.filter(j => j.createdAt >= weekStart && j.createdAt < weekEnd);
    const weekPRs = prEvents.filter(p => p.createdAt >= weekStart && p.createdAt < weekEnd);

    weeklyContributions[weekKey] = {
      generations: weekJobs.length,
      prs: weekPRs.length,
    };
  }

  return c.json({
    success: true,
    data: {
      period: { days: periodDays, start: start.toISOString() },
      summary: {
        totalGenerations: jobs.length,
        totalPREvents: prEvents.length,
        successfulGenerations: jobs.filter(j => j.status === 'COMPLETED').length,
      },
      byStatus,
      weeklyTrend: Object.entries(weeklyContributions).map(([week, data]) => ({
        week,
        ...data,
      })),
    },
  });
});

// Get trending topics in documentation
app.get('/trending', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { days, limit } = c.req.query();

  const periodDays = days ? parseInt(days, 10) : 7;
  const topLimit = limit ? parseInt(limit, 10) : 10;
  const start = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const orgRepos = await prisma.repository.findMany({
    where: { organizationId: orgId },
    select: { id: true },
  });
  const repoIds = orgRepos.map((r) => r.id);

  // Get recent documents updated in the period
  const recentDocs = await prisma.document.findMany({
    where: {
      repositoryId: { in: repoIds },
      updatedAt: { gte: start },
    },
    select: {
      id: true,
      path: true,
      title: true,
      type: true,
      content: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  // Extract topics from titles and content (simple keyword extraction)
  const topicCounts: Record<string, { count: number; docs: string[] }> = {};

  for (const doc of recentDocs) {
    // Extract potential topics from title
    const titleWords = (doc.title || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3);

    // Extract section headings from content
    const headings = doc.content.match(/^#{1,3}\s+(.+)$/gm) || [];
    const headingWords = headings
      .map(h => h.replace(/^#+\s+/, '').toLowerCase())
      .flatMap(h => h.split(/\s+/).filter(w => w.length > 3));

    const allTopics = [...titleWords, ...headingWords];

    for (const topic of allTopics) {
      // Skip common words
      const stopWords = ['this', 'that', 'with', 'from', 'have', 'been', 'will', 'your', 'what', 'when', 'where', 'which'];
      if (stopWords.includes(topic)) continue;

      if (!topicCounts[topic]) {
        topicCounts[topic] = { count: 0, docs: [] };
      }
      topicCounts[topic].count++;
      if (!topicCounts[topic].docs.includes(doc.id)) {
        topicCounts[topic].docs.push(doc.id);
      }
    }
  }

  // Sort by count and get top topics
  const trending = Object.entries(topicCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topLimit)
    .map(([topic, data]) => ({
      topic,
      mentionCount: data.count,
      documentCount: data.docs.length,
    }));

  // Get document types distribution
  const typeDistribution = recentDocs.reduce((acc, doc) => {
    acc[doc.type] = (acc[doc.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return c.json({
    success: true,
    data: {
      period: { days: periodDays, start: start.toISOString() },
      trending,
      recentActivity: {
        documentsUpdated: recentDocs.length,
        typeDistribution,
      },
      recentDocuments: recentDocs.slice(0, 10).map(d => ({
        id: d.id,
        path: d.path,
        title: d.title,
        type: d.type,
        updatedAt: d.updatedAt,
      })),
    },
  });
});

// Get engagement summary across all repositories
app.get('/engagement', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { days } = c.req.query();

  const periodDays = days ? parseInt(days, 10) : 30;
  const start = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const orgRepos = await prisma.repository.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
  });
  const repoIds = orgRepos.map((r) => r.id);
  const repoMap = new Map(orgRepos.map(r => [r.id, r.name]));

  // Get document counts and recent updates
  const documents = await prisma.document.findMany({
    where: { repositoryId: { in: repoIds } },
    select: {
      id: true,
      repositoryId: true,
      type: true,
      updatedAt: true,
      content: true,
    },
  });

  // Calculate engagement metrics per repository
  const repoMetrics = new Map<string, {
    docs: number;
    freshDocs: number;
    staleDocs: number;
    totalWords: number;
    hasCodeExamples: number;
  }>();

  const now = new Date();
  for (const doc of documents) {
    const repoId = doc.repositoryId;
    if (!repoMetrics.has(repoId)) {
      repoMetrics.set(repoId, {
        docs: 0,
        freshDocs: 0,
        staleDocs: 0,
        totalWords: 0,
        hasCodeExamples: 0,
      });
    }

    const metrics = repoMetrics.get(repoId)!;
    metrics.docs++;

    const daysSinceUpdate = Math.floor((now.getTime() - doc.updatedAt.getTime()) / (24 * 60 * 60 * 1000));
    if (daysSinceUpdate <= 7) metrics.freshDocs++;
    else if (daysSinceUpdate > 30) metrics.staleDocs++;

    const wordCount = doc.content.split(/\s+/).filter(w => w.length > 0).length;
    metrics.totalWords += wordCount;

    if (doc.content.includes('```')) metrics.hasCodeExamples++;
  }

  // Aggregate across all repos
  let totalDocs = 0;
  let totalFresh = 0;
  let totalStale = 0;
  let totalWords = 0;
  let totalWithExamples = 0;

  for (const metrics of repoMetrics.values()) {
    totalDocs += metrics.docs;
    totalFresh += metrics.freshDocs;
    totalStale += metrics.staleDocs;
    totalWords += metrics.totalWords;
    totalWithExamples += metrics.hasCodeExamples;
  }

  // Calculate engagement scores
  const freshnessScore = totalDocs > 0 ? Math.round((totalFresh / totalDocs) * 100) : 0;
  const exampleCoverage = totalDocs > 0 ? Math.round((totalWithExamples / totalDocs) * 100) : 0;
  const avgWordsPerDoc = totalDocs > 0 ? Math.round(totalWords / totalDocs) : 0;

  // Overall engagement score (weighted average)
  const overallScore = Math.round(
    freshnessScore * 0.4 +
    Math.min(100, exampleCoverage * 1.5) * 0.3 +
    Math.min(100, (avgWordsPerDoc / 10)) * 0.3
  );

  return c.json({
    success: true,
    data: {
      period: { days: periodDays, start: start.toISOString() },
      overall: {
        totalDocuments: totalDocs,
        totalRepositories: orgRepos.length,
        engagementScore: overallScore,
        freshnessScore,
        exampleCoverage,
        avgWordsPerDocument: avgWordsPerDoc,
      },
      distribution: {
        fresh: totalFresh,
        aging: totalDocs - totalFresh - totalStale,
        stale: totalStale,
      },
      byRepository: Array.from(repoMetrics.entries()).map(([repoId, metrics]) => ({
        repositoryId: repoId,
        repositoryName: repoMap.get(repoId) || 'Unknown',
        documents: metrics.docs,
        freshDocuments: metrics.freshDocs,
        staleDocuments: metrics.staleDocs,
        avgWordsPerDoc: metrics.docs > 0 ? Math.round(metrics.totalWords / metrics.docs) : 0,
        exampleCoverage: metrics.docs > 0 ? Math.round((metrics.hasCodeExamples / metrics.docs) * 100) : 0,
      })).sort((a, b) => b.documents - a.documents),
    },
  });
});

export { app as analyticsRoutes };
