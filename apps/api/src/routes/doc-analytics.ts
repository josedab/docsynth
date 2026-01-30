import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { createLogger, generateId } from '@docsynth/utils';
import {
  DEFAULT_DASHBOARD_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_ANALYTICS_DAYS,
  DEFAULT_ANALYTICS_SUMMARY_LIMIT,
} from '../constants.js';

const log = createLogger('analytics-routes');

// Type assertion for models with expected field names
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export const analyticsRoutes = new Hono();

// Track page view
analyticsRoutes.post('/pageview', async (c) => {
  try {
    const body = await c.req.json();
    const { documentId, repositoryId, path, sessionId, userId, referrer, userAgent, duration } = body;

    if (!repositoryId) {
      return c.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'repositoryId is required' } },
        400
      );
    }

    await db.docPageView.create({
      data: {
        documentId,
        repositoryId,
        path,
        sessionId,
        userId,
        referrer,
        userAgent,
        duration,
      },
    });

    return c.json({ success: true, data: { tracked: true } }, 201);
  } catch (error) {
    log.error({ error }, 'Failed to track pageview');
    return c.json({ success: false, error: { code: 'TRACK_FAILED', message: 'Failed to track pageview' } }, 500);
  }
});

// Track search query
analyticsRoutes.post('/search', async (c) => {
  try {
    const body = await c.req.json();
    const { repositoryId, query, resultCount, clickedDocumentId, sessionId, userId } = body;

    if (!repositoryId || !query) {
      return c.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'repositoryId and query are required' } },
        400
      );
    }

    await db.docSearchQuery.create({
      data: {
        repositoryId,
        query,
        resultCount: resultCount ?? 0,
        clickedDocumentId,
        sessionId,
        userId,
      },
    });

    return c.json({ success: true, data: { tracked: true } }, 201);
  } catch (error) {
    log.error({ error }, 'Failed to track search');
    return c.json({ success: false, error: { code: 'TRACK_FAILED', message: 'Failed to track search' } }, 500);
  }
});

// Submit feedback
analyticsRoutes.post('/feedback', async (c) => {
  try {
    const body = await c.req.json();
    const { documentId, repositoryId, rating, helpful, comment, userId, sessionId } = body;

    if (!documentId || !repositoryId) {
      return c.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'documentId and repositoryId are required' } },
        400
      );
    }

    const feedback = await db.docFeedback.create({
      data: {
        id: generateId('fb'),
        documentId,
        repositoryId,
        rating,
        helpful,
        comment,
        userId,
        sessionId,
      },
    });

    log.info({ feedbackId: feedback.id, documentId, helpful }, 'Feedback submitted');

    return c.json({ success: true, data: { feedbackId: feedback.id } }, 201);
  } catch (error) {
    log.error({ error }, 'Failed to submit feedback');
    return c.json({ success: false, error: { code: 'SUBMIT_FAILED', message: 'Failed to submit feedback' } }, 500);
  }
});

// Get analytics dashboard for a repository
analyticsRoutes.get('/dashboard/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();
  const { days = '30' } = c.req.query();

  try {
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days, 10));

    // Parallel fetch all analytics data
    const [
      totalViews,
      uniqueSessions,
      totalSearches,
      totalFeedback,
      helpfulCount,
      notHelpfulCount,
      topPages,
      topSearches,
      recentFeedback,
    ] = await Promise.all([
      db.docPageView.count({
        where: { repositoryId, createdAt: { gte: since } },
      }),
      db.docPageView.groupBy({
        by: ['sessionId'],
        where: { repositoryId, createdAt: { gte: since }, sessionId: { not: null } },
      }),
      db.docSearchQuery.count({
        where: { repositoryId, createdAt: { gte: since } },
      }),
      db.docFeedback.count({
        where: { repositoryId, createdAt: { gte: since } },
      }),
      db.docFeedback.count({
        where: { repositoryId, createdAt: { gte: since }, helpful: true },
      }),
      db.docFeedback.count({
        where: { repositoryId, createdAt: { gte: since }, helpful: false },
      }),
      db.docPageView.groupBy({
        by: ['path'],
        where: { repositoryId, createdAt: { gte: since } },
        _count: { path: true },
        orderBy: { _count: { path: 'desc' } },
        take: DEFAULT_DASHBOARD_PAGE_SIZE,
      }),
      db.docSearchQuery.groupBy({
        by: ['query'],
        where: { repositoryId, createdAt: { gte: since } },
        _count: { query: true },
        orderBy: { _count: { query: 'desc' } },
        take: DEFAULT_DASHBOARD_PAGE_SIZE,
      }),
      db.docFeedback.findMany({
        where: { repositoryId, createdAt: { gte: since }, comment: { not: null } },
        select: {
          id: true,
          documentId: true,
          rating: true,
          helpful: true,
          comment: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: DEFAULT_DASHBOARD_PAGE_SIZE,
      }),
    ]);

    // Calculate engagement rate
    const avgDuration = await db.docPageView.aggregate({
      where: { repositoryId, createdAt: { gte: since }, duration: { not: null } },
      _avg: { duration: true },
    });

    // Calculate helpfulness score
    const helpfulnessScore = totalFeedback > 0
      ? Math.round((helpfulCount / totalFeedback) * 100)
      : null;

    return c.json({
      success: true,
      data: {
        repositoryId,
        period: { days: parseInt(days, 10), since: since.toISOString() },
        overview: {
          totalViews,
          uniqueSessions: uniqueSessions.length,
          totalSearches,
          totalFeedback,
          avgDuration: Math.round(avgDuration._avg?.duration ?? 0),
          helpfulnessScore,
        },
        feedback: {
          helpful: helpfulCount,
          notHelpful: notHelpfulCount,
          helpfulnessRate: helpfulnessScore,
        },
        /* eslint-disable @typescript-eslint/no-explicit-any */
        topPages: topPages.map((p: any) => ({
          path: p.path,
          views: p._count?.path ?? 0,
        })),
        topSearches: topSearches.map((s: any) => ({
          query: s.query,
          count: s._count?.query ?? 0,
        })),
        /* eslint-enable @typescript-eslint/no-explicit-any */
        recentFeedback,
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch analytics dashboard');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch analytics' } }, 500);
  }
});

// Get page-level analytics
analyticsRoutes.get('/pages/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();
  const { days = String(DEFAULT_ANALYTICS_DAYS), limit = String(DEFAULT_SEARCH_LIMIT) } = c.req.query();

  try {
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days, 10));

    // Get view counts by document
    const viewsByDocument = await db.docPageView.groupBy({
      by: ['documentId'],
      where: {
        repositoryId,
        createdAt: { gte: since },
        documentId: { not: null },
      },
      _count: { documentId: true },
      _avg: { duration: true },
      orderBy: { _count: { documentId: 'desc' } },
      take: parseInt(limit, 10),
    });

    // Get document details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const documentIds = viewsByDocument.map((v: any) => v.documentId).filter(Boolean) as string[];
    const documents = await prisma.document.findMany({
      where: { id: { in: documentIds } },
      select: { id: true, path: true, title: true, type: true },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const documentMap = new Map(documents.map((d: any) => [d.id, d]));

    // Get feedback for these documents
    const feedbackByDoc = await db.docFeedback.groupBy({
      by: ['documentId'],
      where: {
        repositoryId,
        documentId: { in: documentIds },
        createdAt: { gte: since },
      },
      _count: { documentId: true },
      _avg: { rating: true },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feedbackMap = new Map<string, any>(feedbackByDoc.map((f: any) => [f.documentId, f]));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pages = viewsByDocument.map((v: any) => {
      const doc = documentMap.get(v.documentId!);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feedback: any = feedbackMap.get(v.documentId!);

      return {
        documentId: v.documentId,
        path: doc?.path,
        title: doc?.title,
        type: doc?.type,
        views: v._count?.documentId ?? 0,
        avgDuration: Math.round(v._avg?.duration ?? 0),
        feedbackCount: feedback?._count?.documentId ?? 0,
        avgRating: feedback?._avg?.rating ?? null,
      };
    });

    return c.json({ success: true, data: { repositoryId, period: parseInt(days, 10), pages } });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch page analytics');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch page analytics' } }, 500);
  }
});

// Get search analytics
analyticsRoutes.get('/searches/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();
  const { days = '30' } = c.req.query();

  try {
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days, 10));

    // Top queries
    const topQueries = await db.docSearchQuery.groupBy({
      by: ['query'],
      where: { repositoryId, createdAt: { gte: since } },
      _count: { query: true },
      _avg: { resultCount: true },
      orderBy: { _count: { query: 'desc' } },
      take: DEFAULT_PAGE_SIZE,
    });

    // Zero result queries
    const zeroResultQueries = await db.docSearchQuery.findMany({
      where: {
        repositoryId,
        createdAt: { gte: since },
        resultCount: 0,
      },
      select: { query: true },
      distinct: ['query'],
      take: DEFAULT_PAGE_SIZE,
    });

    // Click-through rate
    const totalSearches = await db.docSearchQuery.count({
      where: { repositoryId, createdAt: { gte: since } },
    });

    const searchesWithClicks = await db.docSearchQuery.count({
      where: {
        repositoryId,
        createdAt: { gte: since },
        clickedDocumentId: { not: null },
      },
    });

    const clickThroughRate = totalSearches > 0
      ? Math.round((searchesWithClicks / totalSearches) * 100)
      : 0;

    return c.json({
      success: true,
      data: {
        repositoryId,
        period: parseInt(days, 10),
        totalSearches,
        clickThroughRate,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        topQueries: topQueries.map((q: any) => ({
          query: q.query,
          count: q._count?.query ?? 0,
          avgResults: Math.round(q._avg?.resultCount ?? 0),
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zeroResultQueries: zeroResultQueries.map((q: any) => q.query),
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch search analytics');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch search analytics' } }, 500);
  }
});

// Get feedback analytics
analyticsRoutes.get('/feedback/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();
  const { days = '30' } = c.req.query();

  try {
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days, 10));

    // Overall feedback stats
    const [total, helpful, notHelpful] = await Promise.all([
      db.docFeedback.count({ where: { repositoryId, createdAt: { gte: since } } }),
      db.docFeedback.count({ where: { repositoryId, createdAt: { gte: since }, helpful: true } }),
      db.docFeedback.count({ where: { repositoryId, createdAt: { gte: since }, helpful: false } }),
    ]);

    // Rating distribution
    const ratingDistribution = await db.docFeedback.groupBy({
      by: ['rating'],
      where: {
        repositoryId,
        createdAt: { gte: since },
        rating: { not: null },
      },
      _count: { rating: true },
    });

    // Worst rated documents
    const worstRated = await db.docFeedback.groupBy({
      by: ['documentId'],
      where: {
        repositoryId,
        createdAt: { gte: since },
        helpful: false,
      },
      _count: { documentId: true },
      orderBy: { _count: { documentId: 'desc' } },
      take: DEFAULT_DASHBOARD_PAGE_SIZE,
    });

    // Get document details for worst rated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const worstDocIds = worstRated.map((w: any) => w.documentId);
    const worstDocs = await prisma.document.findMany({
      where: { id: { in: worstDocIds } },
      select: { id: true, path: true, title: true },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docMap = new Map(worstDocs.map((d: any) => [d.id, d]));

    // Recent comments
    const recentComments = await db.docFeedback.findMany({
      where: {
        repositoryId,
        createdAt: { gte: since },
        comment: { not: null },
      },
      select: {
        id: true,
        documentId: true,
        rating: true,
        helpful: true,
        comment: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: DEFAULT_PAGE_SIZE,
    });

    return c.json({
      success: true,
      data: {
        repositoryId,
        period: parseInt(days, 10),
        overview: {
          total,
          helpful,
          notHelpful,
          helpfulnessRate: total > 0 ? Math.round((helpful / total) * 100) : null,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ratingDistribution: ratingDistribution.map((r: any) => ({
          rating: r.rating,
          count: r._count?.rating ?? 0,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        worstRated: worstRated.map((w: any) => ({
          documentId: w.documentId,
          path: docMap.get(w.documentId)?.path,
          title: docMap.get(w.documentId)?.title,
          notHelpfulCount: w._count?.documentId ?? 0,
        })),
        recentComments,
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch feedback analytics');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch feedback analytics' } }, 500);
  }
});

// Get time series data for charting
analyticsRoutes.get('/timeseries/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();
  const { days = '30', metric = 'views' } = c.req.query();

  try {
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days, 10));

    // Generate date buckets
    const dateBuckets: Record<string, number> = {};
    const currentDate = new Date(since);
    while (currentDate <= new Date()) {
      const dateKey = currentDate.toISOString().split('T')[0];
      if (dateKey) dateBuckets[dateKey] = 0;
      currentDate.setDate(currentDate.getDate() + 1);
    }

    let data: Array<{ createdAt: Date }>;

    if (metric === 'views') {
      data = await db.docPageView.findMany({
        where: { repositoryId, createdAt: { gte: since } },
        select: { createdAt: true },
      });
    } else if (metric === 'searches') {
      data = await db.docSearchQuery.findMany({
        where: { repositoryId, createdAt: { gte: since } },
        select: { createdAt: true },
      });
    } else if (metric === 'feedback') {
      data = await db.docFeedback.findMany({
        where: { repositoryId, createdAt: { gte: since } },
        select: { createdAt: true },
      });
    } else {
      return c.json(
        { success: false, error: { code: 'INVALID_METRIC', message: 'metric must be views, searches, or feedback' } },
        400
      );
    }

    // Aggregate by date
    for (const item of data) {
      const date = item.createdAt.toISOString().split('T')[0];
      if (date && dateBuckets[date] !== undefined) {
        dateBuckets[date]++;
      }
    }

    const timeseries = Object.entries(dateBuckets).map(([date, count]) => ({
      date,
      count,
    }));

    return c.json({
      success: true,
      data: {
        repositoryId,
        metric,
        period: parseInt(days, 10),
        timeseries,
      },
    });
  } catch (error) {
    log.error({ error, repositoryId, metric }, 'Failed to fetch timeseries data');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch timeseries' } }, 500);
  }
});

// Generate analytics summary/report
analyticsRoutes.post('/summary/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();

  try {
    const body = await c.req.json();
    const { period = 'weekly' } = body;

    const days = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Gather all metrics
    const [views, searches, feedbackCount, helpfulCount] = await Promise.all([
      db.docPageView.count({ where: { repositoryId, createdAt: { gte: since } } }),
      db.docSearchQuery.count({ where: { repositoryId, createdAt: { gte: since } } }),
      db.docFeedback.count({ where: { repositoryId, createdAt: { gte: since } } }),
      db.docFeedback.count({ where: { repositoryId, createdAt: { gte: since }, helpful: true } }),
    ]);

    const uniqueSessions = await db.docPageView.groupBy({
      by: ['sessionId'],
      where: { repositoryId, createdAt: { gte: since }, sessionId: { not: null } },
    });

    // Store summary
    const summary = await db.analyticsSummary.create({
      data: {
        id: generateId('asum'),
        repositoryId,
        period,
        periodStart: since,
        periodEnd: new Date(),
        metrics: {
          views,
          searches,
          feedback: feedbackCount,
          helpfulCount,
          uniqueSessions: uniqueSessions.length,
          helpfulnessRate: feedbackCount > 0 ? Math.round((helpfulCount / feedbackCount) * 100) : null,
        },
      },
    });

    log.info({ summaryId: summary.id, repositoryId, period }, 'Analytics summary generated');

    return c.json({ success: true, data: summary }, 201);
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to generate analytics summary');
    return c.json({ success: false, error: { code: 'GENERATE_FAILED', message: 'Failed to generate summary' } }, 500);
  }
});

// Get historical summaries
analyticsRoutes.get('/summaries/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();
  const { period, limit = String(DEFAULT_ANALYTICS_SUMMARY_LIMIT) } = c.req.query();

  try {
    const summaries = await db.analyticsSummary.findMany({
      where: {
        repositoryId,
        ...(period && { period }),
      },
      orderBy: { periodEnd: 'desc' },
      take: parseInt(limit, 10),
    });

    return c.json({ success: true, data: summaries });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch summaries');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch summaries' } }, 500);
  }
});
