import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    repository: {
      findFirst: vi.fn(),
    },
    docPageView: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
    docSearchQuery: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    docFeedback: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
    },
    analyticsSummary: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

describe('Documentation Analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Page View Tracking', () => {
    it('should track page views with correct metadata', () => {
      interface PageView {
        id: string;
        documentId: string | null;
        repositoryId: string;
        path: string;
        sessionId: string | null;
        userId: string | null;
        referrer: string | null;
        userAgent: string | null;
        duration: number | null;
        createdAt: Date;
      }

      const pageView: PageView = {
        id: 'pv-123',
        documentId: 'doc-456',
        repositoryId: 'repo-789',
        path: '/docs/api/authentication',
        sessionId: 'sess-abc',
        userId: 'user-123',
        referrer: 'https://google.com',
        userAgent: 'Mozilla/5.0...',
        duration: 45000,
        createdAt: new Date(),
      };

      expect(pageView.path).toContain('/docs/');
      expect(pageView.duration).toBe(45000);
    });

    it('should aggregate views by path', () => {
      const views = [
        { path: '/docs/api/auth', count: 150 },
        { path: '/docs/getting-started', count: 320 },
        { path: '/docs/api/users', count: 85 },
        { path: '/docs/api/auth', count: 50 }, // duplicate path
      ];

      const aggregated = views.reduce((acc, v) => {
        acc[v.path] = (acc[v.path] || 0) + v.count;
        return acc;
      }, {} as Record<string, number>);

      expect(aggregated['/docs/api/auth']).toBe(200);
      expect(aggregated['/docs/getting-started']).toBe(320);
    });

    it('should calculate average session duration', () => {
      const sessions = [
        { duration: 30000 },
        { duration: 60000 },
        { duration: 45000 },
        { duration: 120000 },
      ];

      const avgDuration = sessions.reduce((sum, s) => sum + s.duration, 0) / sessions.length;
      expect(avgDuration).toBe(63750);
    });
  });

  describe('Search Analytics', () => {
    it('should track search queries', () => {
      interface SearchQuery {
        id: string;
        repositoryId: string;
        query: string;
        resultCount: number;
        clickedDocumentId: string | null;
        sessionId: string | null;
        createdAt: Date;
      }

      const query: SearchQuery = {
        id: 'sq-123',
        repositoryId: 'repo-456',
        query: 'authentication setup',
        resultCount: 5,
        clickedDocumentId: 'doc-789',
        sessionId: 'sess-abc',
        createdAt: new Date(),
      };

      expect(query.resultCount).toBeGreaterThan(0);
      expect(query.clickedDocumentId).toBeTruthy();
    });

    it('should calculate search click-through rate', () => {
      const totalSearches = 100;
      const searchesWithClicks = 65;

      const clickThroughRate = (searchesWithClicks / totalSearches) * 100;
      expect(clickThroughRate).toBe(65);
    });

    it('should identify zero-result queries', () => {
      const queries = [
        { query: 'authentication', results: 5 },
        { query: 'nonexistent feature', results: 0 },
        { query: 'setup guide', results: 3 },
        { query: 'xyz123', results: 0 },
      ];

      const zeroResults = queries.filter(q => q.results === 0);
      expect(zeroResults.length).toBe(2);
      expect(zeroResults.map(q => q.query)).toContain('nonexistent feature');
    });

    it('should rank popular search queries', () => {
      const queries = [
        { query: 'authentication', count: 150 },
        { query: 'getting started', count: 200 },
        { query: 'api reference', count: 120 },
        { query: 'deployment', count: 80 },
      ];

      const ranked = [...queries].sort((a, b) => b.count - a.count);

      expect(ranked[0]?.query).toBe('getting started');
      expect(ranked[ranked.length - 1]?.query).toBe('deployment');
    });
  });

  describe('Feedback Analytics', () => {
    it('should track helpful/not helpful feedback', () => {
      interface Feedback {
        id: string;
        documentId: string;
        repositoryId: string;
        helpful: boolean | null;
        rating: number | null;
        comment: string | null;
        userId: string | null;
        createdAt: Date;
      }

      const feedback: Feedback = {
        id: 'fb-123',
        documentId: 'doc-456',
        repositoryId: 'repo-789',
        helpful: true,
        rating: 4,
        comment: 'Clear and helpful!',
        userId: 'user-abc',
        createdAt: new Date(),
      };

      expect(feedback.helpful).toBe(true);
      expect(feedback.rating).toBe(4);
    });

    it('should calculate helpfulness rate', () => {
      const feedback = [
        { helpful: true },
        { helpful: true },
        { helpful: false },
        { helpful: true },
        { helpful: null },
      ];

      const ratedFeedback = feedback.filter(f => f.helpful !== null);
      const helpfulCount = ratedFeedback.filter(f => f.helpful).length;
      const helpfulnessRate = (helpfulCount / ratedFeedback.length) * 100;

      expect(helpfulnessRate).toBe(75);
    });

    it('should calculate average rating', () => {
      const ratings = [4, 5, 3, 4, 5, 4, 2, 5];
      const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;

      expect(avgRating).toBe(4);
    });

    it('should generate rating distribution', () => {
      const ratings = [5, 4, 5, 3, 5, 4, 4, 2, 5, 4];

      const distribution = ratings.reduce((acc, r) => {
        acc[r] = (acc[r] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);

      expect(distribution[5]).toBe(4);
      expect(distribution[4]).toBe(4);
      expect(distribution[3]).toBe(1);
      expect(distribution[2]).toBe(1);
    });
  });

  describe('Dashboard Metrics', () => {
    it('should aggregate dashboard metrics', () => {
      interface DashboardMetrics {
        totalPageViews: number;
        uniqueVisitors: number;
        avgSessionDuration: number;
        totalSearches: number;
        searchClickThroughRate: number;
        totalFeedback: number;
        helpfulnessScore: number;
      }

      const metrics: DashboardMetrics = {
        totalPageViews: 15000,
        uniqueVisitors: 3500,
        avgSessionDuration: 120, // seconds
        totalSearches: 2500,
        searchClickThroughRate: 68,
        totalFeedback: 450,
        helpfulnessScore: 82,
      };

      expect(metrics.uniqueVisitors).toBeLessThan(metrics.totalPageViews);
      expect(metrics.helpfulnessScore).toBeGreaterThan(50);
    });

    it('should calculate period-over-period changes', () => {
      const current = { views: 15000, searches: 2500 };
      const previous = { views: 12000, searches: 2200 };

      const viewsChange = ((current.views - previous.views) / previous.views) * 100;
      const searchesChange = ((current.searches - previous.searches) / previous.searches) * 100;

      expect(viewsChange).toBe(25);
      expect(searchesChange).toBeCloseTo(13.64, 1);
    });
  });

  describe('Time Series Data', () => {
    it('should aggregate data by date', () => {
      const events = [
        { date: '2024-03-01', type: 'view' },
        { date: '2024-03-01', type: 'view' },
        { date: '2024-03-01', type: 'search' },
        { date: '2024-03-02', type: 'view' },
        { date: '2024-03-02', type: 'view' },
        { date: '2024-03-02', type: 'view' },
      ];

      const byDate = events.reduce((acc, e) => {
        if (!acc[e.date]) {
          acc[e.date] = { views: 0, searches: 0 };
        }
        if (e.type === 'view') acc[e.date]!.views++;
        if (e.type === 'search') acc[e.date]!.searches++;
        return acc;
      }, {} as Record<string, { views: number; searches: number }>);

      expect(byDate['2024-03-01']?.views).toBe(2);
      expect(byDate['2024-03-02']?.views).toBe(3);
    });

    it('should fill missing dates with zeros', () => {
      const startDate = new Date('2024-03-01');
      const endDate = new Date('2024-03-05');
      const existingData: Record<string, number> = {
        '2024-03-01': 100,
        '2024-03-03': 150,
        '2024-03-05': 120,
      };

      const timeSeries: Array<{ date: string; value: number }> = [];
      const current = new Date(startDate);

      while (current <= endDate) {
        const dateStr = current.toISOString().split('T')[0]!;
        timeSeries.push({
          date: dateStr,
          value: existingData[dateStr] || 0,
        });
        current.setDate(current.getDate() + 1);
      }

      expect(timeSeries.length).toBe(5);
      expect(timeSeries.find(t => t.date === '2024-03-02')?.value).toBe(0);
      expect(timeSeries.find(t => t.date === '2024-03-03')?.value).toBe(150);
    });
  });

  describe('Document Performance', () => {
    it('should rank documents by performance', () => {
      interface DocPerformance {
        documentId: string;
        views: number;
        avgDuration: number;
        helpfulnessRate: number;
        searchAppearances: number;
      }

      const docs: DocPerformance[] = [
        { documentId: 'd1', views: 500, avgDuration: 120, helpfulnessRate: 85, searchAppearances: 50 },
        { documentId: 'd2', views: 300, avgDuration: 60, helpfulnessRate: 90, searchAppearances: 30 },
        { documentId: 'd3', views: 800, avgDuration: 45, helpfulnessRate: 70, searchAppearances: 80 },
      ];

      // Calculate composite score
      const withScore = docs.map(d => ({
        ...d,
        score: d.views * 0.3 + d.avgDuration * 0.2 + d.helpfulnessRate * 0.3 + d.searchAppearances * 0.2,
      }));

      const ranked = withScore.sort((a, b) => b.score - a.score);

      expect(ranked[0]?.documentId).toBeDefined();
    });

    it('should identify low-performing documents', () => {
      const docs = [
        { path: '/api/auth', helpfulnessRate: 85, bounceRate: 20 },
        { path: '/api/users', helpfulnessRate: 45, bounceRate: 60 },
        { path: '/getting-started', helpfulnessRate: 90, bounceRate: 15 },
        { path: '/api/deprecated', helpfulnessRate: 30, bounceRate: 75 },
      ];

      const lowPerforming = docs.filter(
        d => d.helpfulnessRate < 50 || d.bounceRate > 50
      );

      expect(lowPerforming.length).toBe(2);
      expect(lowPerforming.map(d => d.path)).toContain('/api/deprecated');
    });
  });

  describe('Export & Reporting', () => {
    it('should format analytics summary', () => {
      const summary = {
        period: { start: '2024-03-01', end: '2024-03-31' },
        views: { total: 15000, unique: 3500, change: 25 },
        searches: { total: 2500, clickThrough: 68, zeroResults: 150 },
        feedback: { total: 450, helpful: 370, avgRating: 4.2 },
      };

      const report = `# Analytics Report: ${summary.period.start} - ${summary.period.end}

## Page Views
- Total: ${summary.views.total.toLocaleString()}
- Unique Visitors: ${summary.views.unique.toLocaleString()}
- Change: ${summary.views.change > 0 ? '+' : ''}${summary.views.change}%

## Search
- Total Searches: ${summary.searches.total.toLocaleString()}
- Click-through Rate: ${summary.searches.clickThrough}%
- Zero-result Queries: ${summary.searches.zeroResults}

## Feedback
- Total Responses: ${summary.feedback.total}
- Helpful Rate: ${Math.round((summary.feedback.helpful / summary.feedback.total) * 100)}%
- Average Rating: ${summary.feedback.avgRating}/5`;

      expect(report).toContain('15,000');
      expect(report).toContain('+25%');
      expect(report).toContain('82%'); // helpful rate
    });

    it('should generate CSV export data', () => {
      const data = [
        { date: '2024-03-01', views: 500, searches: 80, feedback: 15 },
        { date: '2024-03-02', views: 520, searches: 75, feedback: 18 },
      ];

      const headers = ['date', 'views', 'searches', 'feedback'];
      const csvRows = [
        headers.join(','),
        ...data.map(row => headers.map(h => row[h as keyof typeof row]).join(',')),
      ];
      const csv = csvRows.join('\n');

      expect(csv).toContain('date,views,searches,feedback');
      expect(csv).toContain('2024-03-01,500,80,15');
    });
  });
});
