import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';

const app = new Hono();

// Get organization health overview with trends
app.get('/overview', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { days } = c.req.query();

  const periodDays = days ? parseInt(days, 10) : 30;
  const startDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const [repositories, latestSnapshots, alerts, trends] = await Promise.all([
    // Get all repositories
    prisma.repository.findMany({
      where: { organizationId: orgId, enabled: true },
      select: { id: true, name: true },
    }),

    // Get latest snapshot per repository
    prisma.$queryRaw<Array<{
      repository_id: string;
      overall_score: number;
      document_count: number;
      healthy_count: number;
      needs_attention_count: number;
      critical_count: number;
      coverage_gaps: unknown;
    }>>`
      SELECT DISTINCT ON (repository_id) 
        repository_id,
        overall_score,
        document_count,
        healthy_count,
        needs_attention_count,
        critical_count,
        coverage_gaps
      FROM health_score_snapshots
      WHERE organization_id = ${orgId}
      ORDER BY repository_id, snapshot_date DESC
    `,

    // Get recent unacknowledged alerts
    prisma.healthAlert.findMany({
      where: {
        organizationId: orgId,
        acknowledged: false,
        createdAt: { gte: startDate },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),

    // Get daily trends
    prisma.healthScoreSnapshot.groupBy({
      by: ['snapshotDate'],
      where: {
        organizationId: orgId,
        snapshotDate: { gte: startDate },
      },
      _avg: {
        overallScore: true,
        freshnessScore: true,
        completenessScore: true,
      },
      _sum: {
        documentCount: true,
      },
      orderBy: { snapshotDate: 'asc' },
    }),
  ]);

  // Build repository map
  const repoMap = new Map(repositories.map((r) => [r.id, r.name]));

  // Calculate totals
  const totalDocuments = latestSnapshots.reduce((sum, s) => sum + (s.document_count || 0), 0);
  const totalHealthy = latestSnapshots.reduce((sum, s) => sum + (s.healthy_count || 0), 0);
  const totalNeedsAttention = latestSnapshots.reduce((sum, s) => sum + (s.needs_attention_count || 0), 0);
  const totalCritical = latestSnapshots.reduce((sum, s) => sum + (s.critical_count || 0), 0);
  const avgScore = latestSnapshots.length > 0
    ? Math.round(latestSnapshots.reduce((sum, s) => sum + (s.overall_score || 0), 0) / latestSnapshots.length)
    : 0;

  // Top performers and needs work
  const repoScores = latestSnapshots
    .map((s) => ({
      repositoryId: s.repository_id,
      repositoryName: repoMap.get(s.repository_id) || 'Unknown',
      score: s.overall_score || 0,
      issues: (s.coverage_gaps as string[]) || [],
    }))
    .sort((a, b) => b.score - a.score);

  const topPerformers = repoScores.slice(0, 5).map(({ repositoryId, repositoryName, score }) => ({
    repositoryId,
    repositoryName,
    score,
  }));

  const needsWork = repoScores
    .filter((r) => r.score < 70)
    .slice(0, 5);

  return c.json({
    success: true,
    data: {
      overallScore: avgScore,
      totalRepositories: repositories.length,
      totalDocuments,
      healthDistribution: {
        healthy: totalHealthy,
        needsAttention: totalNeedsAttention,
        critical: totalCritical,
      },
      topPerformers,
      needsWork,
      recentAlerts: alerts.map((a) => ({
        id: a.id,
        alertType: a.alertType,
        severity: a.severity,
        title: a.title,
        message: a.message,
        repositoryId: a.repositoryId,
        createdAt: a.createdAt,
      })),
      weeklyTrend: trends.map((t) => ({
        date: t.snapshotDate.toISOString().split('T')[0],
        overallScore: Math.round(t._avg.overallScore || 0),
        freshnessScore: Math.round(t._avg.freshnessScore || 0),
        completenessScore: Math.round(t._avg.completenessScore || 0),
        documentCount: t._sum.documentCount || 0,
      })),
    },
  });
});

// Get repository health trends
app.get('/trends/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { days } = c.req.query();

  const periodDays = days ? parseInt(days, 10) : 30;
  const startDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  // Verify access
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, name: true },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const snapshots = await prisma.healthScoreSnapshot.findMany({
    where: {
      repositoryId,
      snapshotDate: { gte: startDate },
    },
    orderBy: { snapshotDate: 'asc' },
    select: {
      snapshotDate: true,
      overallScore: true,
      freshnessScore: true,
      completenessScore: true,
      accuracyScore: true,
      documentCount: true,
      healthyCount: true,
      needsAttentionCount: true,
      criticalCount: true,
    },
  });

  // Calculate trend direction
  let trend: 'improving' | 'stable' | 'declining' = 'stable';
  if (snapshots.length >= 2) {
    const recentAvg = snapshots.slice(-7).reduce((s, x) => s + x.overallScore, 0) / Math.min(7, snapshots.length);
    const olderAvg = snapshots.slice(0, -7).reduce((s, x) => s + x.overallScore, 0) / Math.max(1, snapshots.length - 7);
    const diff = recentAvg - olderAvg;
    trend = diff > 5 ? 'improving' : diff < -5 ? 'declining' : 'stable';
  }

  return c.json({
    success: true,
    data: {
      repositoryId,
      repositoryName: repository.name,
      trend,
      snapshots: snapshots.map((s) => ({
        date: s.snapshotDate.toISOString().split('T')[0],
        overallScore: s.overallScore,
        freshnessScore: s.freshnessScore,
        completenessScore: s.completenessScore,
        accuracyScore: s.accuracyScore,
        documentCount: s.documentCount,
        healthDistribution: {
          healthy: s.healthyCount,
          needsAttention: s.needsAttentionCount,
          critical: s.criticalCount,
        },
      })),
    },
  });
});

// Get alerts
app.get('/alerts', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { repositoryId, acknowledged, severity, limit } = c.req.query();

  const whereClause: Record<string, unknown> = { organizationId: orgId };

  if (repositoryId) {
    whereClause.repositoryId = repositoryId;
  }
  if (acknowledged !== undefined) {
    whereClause.acknowledged = acknowledged === 'true';
  }
  if (severity) {
    whereClause.severity = severity;
  }

  const alerts = await prisma.healthAlert.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: limit ? parseInt(limit, 10) : 50,
  });

  const counts = await prisma.healthAlert.groupBy({
    by: ['severity'],
    where: { organizationId: orgId, acknowledged: false },
    _count: true,
  });

  return c.json({
    success: true,
    data: {
      alerts,
      unacknowledgedCounts: {
        info: counts.find((c) => c.severity === 'info')?._count || 0,
        warning: counts.find((c) => c.severity === 'warning')?._count || 0,
        critical: counts.find((c) => c.severity === 'critical')?._count || 0,
      },
    },
  });
});

// Acknowledge alert
app.post('/alerts/:alertId/acknowledge', requireAuth, requireOrgAccess, async (c) => {
  const alertId = c.req.param('alertId');
  const orgId = c.get('organizationId');
  const userId = c.get('userId');

  const alert = await prisma.healthAlert.findFirst({
    where: { id: alertId, organizationId: orgId },
  });

  if (!alert) {
    throw new NotFoundError('Alert', alertId);
  }

  await prisma.healthAlert.update({
    where: { id: alertId },
    data: {
      acknowledged: true,
      acknowledgedBy: userId,
      acknowledgedAt: new Date(),
    },
  });

  return c.json({ success: true, message: 'Alert acknowledged' });
});

// Get leaderboard
app.get('/leaderboard', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { period } = c.req.query();

  const selectedPeriod = period || 'weekly';

  // Get current period start
  const now = new Date();
  let periodStart: Date;
  if (selectedPeriod === 'weekly') {
    periodStart = new Date(now);
    periodStart.setDate(periodStart.getDate() - periodStart.getDay());
    periodStart.setHours(0, 0, 0, 0);
  } else if (selectedPeriod === 'monthly') {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    periodStart = new Date(0); // All time
  }

  const entries = await prisma.teamLeaderboard.findMany({
    where: {
      organizationId: orgId,
      period: selectedPeriod,
      periodStart: { gte: periodStart },
    },
    orderBy: { score: 'desc' },
  });

  // Assign ranks
  const rankedEntries = entries.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    badges: entry.badges as Array<{ id: string; name: string; icon: string }>,
  }));

  return c.json({
    success: true,
    data: {
      period: selectedPeriod,
      periodStart,
      entries: rankedEntries,
    },
  });
});

// Trigger health scan
app.post('/scan', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ repositoryId?: string }>().catch(() => ({ repositoryId: undefined }));

  // Verify repository if specified
  if (body.repositoryId) {
    const repo = await prisma.repository.findFirst({
      where: { id: body.repositoryId, organizationId: orgId },
    });
    if (!repo) {
      throw new NotFoundError('Repository', body.repositoryId);
    }
  }

  const job = await addJob(QUEUE_NAMES.HEALTH_SCAN, {
    organizationId: orgId,
    repositoryId: body.repositoryId,
    scheduled: false,
    createAlerts: true,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Health scan started',
    },
  });
});

// Get document health details
app.get('/documents/:documentId', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');

  const document = await prisma.document.findFirst({
    where: { id: documentId },
    include: {
      repository: {
        select: { id: true, name: true, organizationId: true, lastActivityAt: true },
      },
    },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  // Get code change dates (for future freshness calculation)
  const prEvents = await prisma.pREvent.findMany({
    where: { repositoryId: document.repositoryId, mergedAt: { not: null } },
    orderBy: { mergedAt: 'desc' },
    take: 20,
    select: { mergedAt: true },
  });

  // Get existing doc types (for completeness scoring)

  // Calculate basic health metrics
  const now = new Date();
  const docAge = Math.floor((now.getTime() - document.updatedAt.getTime()) / (1000 * 60 * 60 * 24));
  
  // Factor in recent code changes
  const recentCodeChange = prEvents.length > 0 && prEvents[0]?.mergedAt 
    ? prEvents[0].mergedAt > document.updatedAt 
    : false;
  
  // Simple freshness calculation
  const freshnessScore = Math.max(0, 100 - (docAge * 2) - (recentCodeChange ? 10 : 0)); // Lose 2 points per day
  
  // Simple completeness check based on content length
  const contentLength = (document.content || '').length;
  const completenessScore = Math.min(100, Math.floor(contentLength / 50));
  
  // Overall score (weighted average)
  const overallScore = Math.floor(freshnessScore * 0.5 + completenessScore * 0.5);
  
  // Determine status
  let status: 'healthy' | 'needs-attention' | 'critical';
  if (overallScore >= 70) status = 'healthy';
  else if (overallScore >= 40) status = 'needs-attention';
  else status = 'critical';

  const healthScore = {
    status,
    scores: {
      freshness: freshnessScore,
      completeness: completenessScore,
      overall: overallScore,
    },
    recommendations: overallScore < 70 ? ['Consider updating this documentation'] : [],
  };

  // Get related alerts
  const alerts = await prisma.healthAlert.findMany({
    where: { documentId, acknowledged: false },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  return c.json({
    success: true,
    data: {
      document: {
        id: document.id,
        path: document.path,
        type: document.type,
        title: document.title,
        version: document.version,
        updatedAt: document.updatedAt,
      },
      repository: {
        id: document.repository.id,
        name: document.repository.name,
      },
      health: healthScore,
      alerts,
    },
  });
});

// ============================================================================
// Gamification Features (Feature 9)
// ============================================================================

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  criteria: string;
}

const AVAILABLE_BADGES: Badge[] = [
  { id: 'first-doc', name: 'First Doc', description: 'Created first documentation', icon: '📝', criteria: 'docsCreated >= 1' },
  { id: 'doc-master', name: 'Doc Master', description: 'Created 10+ docs in a week', icon: '🏆', criteria: 'docsCreated >= 10' },
  { id: 'perfect-score', name: 'Perfect Score', description: 'Achieved 100% health score', icon: '💯', criteria: 'score >= 100' },
  { id: 'streak-7', name: 'Week Warrior', description: '7-day documentation streak', icon: '🔥', criteria: 'streak >= 7' },
  { id: 'streak-30', name: 'Month Champion', description: '30-day documentation streak', icon: '👑', criteria: 'streak >= 30' },
  { id: 'fixer', name: 'Bug Squasher', description: 'Fixed 5+ documentation issues', icon: '🐛', criteria: 'docsImproved >= 5' },
  { id: 'translator', name: 'Polyglot', description: 'Translated docs to 3+ languages', icon: '🌍', criteria: 'translations >= 3' },
  { id: 'reviewer', name: 'Quality Keeper', description: 'Reviewed 10+ doc PRs', icon: '🔍', criteria: 'reviews >= 10' },
];

// Get user achievements
app.get('/achievements/:userId', requireAuth, requireOrgAccess, async (c) => {
  const userId = c.req.param('userId');
  const orgId = c.get('organizationId');

  // Get user's leaderboard entries across all periods
  const entries = await prisma.teamLeaderboard.findMany({
    where: { organizationId: orgId },
    orderBy: { periodStart: 'desc' },
    take: 100,
  });

  // Calculate total stats
  const totalDocsCreated = entries.reduce((sum, e) => sum + (e.docsCreated || 0), 0);
  const totalDocsImproved = entries.reduce((sum, e) => sum + (e.docsImproved || 0), 0);
  const currentStreak = entries[0]?.streak || 0;
  const bestScore = Math.max(...entries.map(e => e.score || 0), 0);

  // Determine earned badges
  const earnedBadges: Array<Badge & { earnedAt: Date }> = [];
  const stats = { docsCreated: totalDocsCreated, docsImproved: totalDocsImproved, streak: currentStreak, score: bestScore };

  for (const badge of AVAILABLE_BADGES) {
    if (evaluateBadgeCriteria(badge.criteria, stats)) {
      earnedBadges.push({ ...badge, earnedAt: new Date() });
    }
  }

  // Calculate level based on total contributions
  const totalContributions = totalDocsCreated + totalDocsImproved;
  const level = Math.floor(totalContributions / 10) + 1;
  const xpForNextLevel = level * 10;
  const currentXp = totalContributions % 10;

  return c.json({
    success: true,
    data: {
      userId,
      level,
      currentXp,
      xpForNextLevel,
      stats: {
        totalDocsCreated,
        totalDocsImproved,
        currentStreak,
        bestScore,
      },
      badges: earnedBadges,
      availableBadges: AVAILABLE_BADGES.filter(b => !earnedBadges.some(e => e.id === b.id)),
    },
  });
});

function evaluateBadgeCriteria(criteria: string, stats: Record<string, number>): boolean {
  // Simple criteria evaluation
  const match = criteria.match(/(\w+)\s*(>=|>|==|<=|<)\s*(\d+)/);
  if (!match) return false;

  const [, stat, op, valueStr] = match;
  if (!stat || !valueStr) return false;
  const value = parseInt(valueStr, 10);
  const statValue = stats[stat] || 0;

  switch (op) {
    case '>=': return statValue >= value;
    case '>': return statValue > value;
    case '==': return statValue === value;
    case '<=': return statValue <= value;
    case '<': return statValue < value;
    default: return false;
  }
}

// Get team rankings with achievements
app.get('/team-stats', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { period } = c.req.query();

  const selectedPeriod = period || 'monthly';

  // Get latest period for each repository
  const now = new Date();
  let periodStart: Date;
  if (selectedPeriod === 'weekly') {
    periodStart = new Date(now);
    periodStart.setDate(periodStart.getDate() - periodStart.getDay());
    periodStart.setHours(0, 0, 0, 0);
  } else {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const entries = await prisma.teamLeaderboard.findMany({
    where: {
      organizationId: orgId,
      period: selectedPeriod,
      periodStart: { gte: periodStart },
    },
    orderBy: { score: 'desc' },
  });

  // Calculate team totals
  const teamStats = {
    totalScore: entries.reduce((sum, e) => sum + (e.score || 0), 0),
    totalDocsCreated: entries.reduce((sum, e) => sum + (e.docsCreated || 0), 0),
    totalDocsImproved: entries.reduce((sum, e) => sum + (e.docsImproved || 0), 0),
    activeRepos: entries.length,
    averageScore: entries.length > 0 
      ? Math.round(entries.reduce((sum, e) => sum + (e.score || 0), 0) / entries.length)
      : 0,
  };

  // Get previous period for comparison
  const prevPeriodStart = selectedPeriod === 'weekly'
    ? new Date(periodStart.getTime() - 7 * 24 * 60 * 60 * 1000)
    : new Date(periodStart.getFullYear(), periodStart.getMonth() - 1, 1);

  const prevEntries = await prisma.teamLeaderboard.findMany({
    where: {
      organizationId: orgId,
      period: selectedPeriod,
      periodStart: { gte: prevPeriodStart, lt: periodStart },
    },
  });

  const prevTotal = prevEntries.reduce((sum, e) => sum + (e.score || 0), 0);
  const scoreChange = teamStats.totalScore - prevTotal;

  return c.json({
    success: true,
    data: {
      period: selectedPeriod,
      periodStart,
      teamStats: {
        ...teamStats,
        scoreChange,
        trend: scoreChange > 0 ? 'up' : scoreChange < 0 ? 'down' : 'stable',
      },
      topRepositories: entries.slice(0, 10).map((e, idx) => ({
        rank: idx + 1,
        repositoryId: e.repositoryId,
        repositoryName: e.repositoryName,
        score: e.score,
        scoreChange: e.scoreChange,
        docsCreated: e.docsCreated,
        docsImproved: e.docsImproved,
        streak: e.streak,
        badges: e.badges,
      })),
    },
  });
});

// Award badge manually (admin function)
app.post('/badges/award', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    userId: string;
    badgeId: string;
  }>();

  if (!body.userId || !body.badgeId) {
    throw new ValidationError('userId and badgeId are required');
  }

  const badge = AVAILABLE_BADGES.find(b => b.id === body.badgeId);
  if (!badge) {
    throw new NotFoundError('Badge', body.badgeId);
  }

  // In a full implementation, this would store the badge award
  // For now, return success
  return c.json({
    success: true,
    data: {
      userId: body.userId,
      badge: { ...badge, earnedAt: new Date() },
      message: `Badge "${badge.name}" awarded successfully`,
    },
  }, 201);
});

// Get challenges (weekly/monthly goals)
app.get('/challenges', requireAuth, requireOrgAccess, async (c) => {
  // Define current challenges
  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));

  const challenges = [
    {
      id: 'weekly-docs',
      title: 'Documentation Sprint',
      description: 'Create 5 new documents this week',
      type: 'weekly',
      goal: 5,
      reward: '🎯 Sprint Champion badge',
      endsAt: weekEnd,
    },
    {
      id: 'health-boost',
      title: 'Health Boost',
      description: 'Improve organization health score by 10 points',
      type: 'weekly',
      goal: 10,
      reward: '💪 Health Hero badge',
      endsAt: weekEnd,
    },
    {
      id: 'translation-drive',
      title: 'Global Reach',
      description: 'Translate 3 documents to a new language',
      type: 'monthly',
      goal: 3,
      reward: '🌐 Global Champion badge',
      endsAt: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    },
  ];

  return c.json({
    success: true,
    data: {
      challenges,
      message: 'Complete challenges to earn special badges!',
    },
  });
});

export { app as healthDashboardRoutes };
