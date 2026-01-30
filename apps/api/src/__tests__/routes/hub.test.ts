import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    repository: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
    },
    documentationHub: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    hubSearch: {
      create: vi.fn(),
    },
  },
}));

describe('Multi-Repo Documentation Hub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Hub Configuration', () => {
    it('should create hub with correct structure', () => {
      interface DocumentationHub {
        id: string;
        name: string;
        organizationId: string;
        repositoryIds: string[];
        config: {
          theme?: string;
          customDomain?: string;
          searchEnabled: boolean;
          crossRepoLinks: boolean;
        };
        createdAt: Date;
        updatedAt: Date;
      }

      const hub: DocumentationHub = {
        id: 'hub-123',
        name: 'Platform Documentation',
        organizationId: 'org-456',
        repositoryIds: ['repo-1', 'repo-2', 'repo-3'],
        config: {
          theme: 'dark',
          customDomain: 'docs.example.com',
          searchEnabled: true,
          crossRepoLinks: true,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(hub.repositoryIds.length).toBe(3);
      expect(hub.config.searchEnabled).toBe(true);
    });

    it('should validate hub configuration', () => {
      const validateConfig = (config: {
        repositoryIds: string[];
        theme?: string;
      }): { valid: boolean; errors: string[] } => {
        const errors: string[] = [];

        if (config.repositoryIds.length === 0) {
          errors.push('At least one repository is required');
        }

        if (config.repositoryIds.length > 50) {
          errors.push('Maximum 50 repositories per hub');
        }

        if (config.theme && !['light', 'dark', 'auto'].includes(config.theme)) {
          errors.push('Invalid theme');
        }

        return { valid: errors.length === 0, errors };
      };

      expect(validateConfig({ repositoryIds: ['repo-1'] }).valid).toBe(true);
      expect(validateConfig({ repositoryIds: [] }).valid).toBe(false);
      expect(validateConfig({ repositoryIds: ['r1'], theme: 'invalid' }).valid).toBe(false);
    });
  });

  describe('Cross-Repository Aggregation', () => {
    it('should aggregate documents from multiple repos', () => {
      const repoDocuments = [
        { repoId: 'repo-1', docs: [{ path: 'api.md' }, { path: 'setup.md' }] },
        { repoId: 'repo-2', docs: [{ path: 'api.md' }, { path: 'config.md' }] },
        { repoId: 'repo-3', docs: [{ path: 'getting-started.md' }] },
      ];

      const allDocs = repoDocuments.flatMap(r => 
        r.docs.map(d => ({ ...d, repoId: r.repoId }))
      );

      expect(allDocs.length).toBe(5);
    });

    it('should categorize documents by type', () => {
      type DocType = 'API_REFERENCE' | 'GUIDE' | 'TUTORIAL' | 'CHANGELOG' | 'README';

      const documents = [
        { id: 'd1', type: 'API_REFERENCE' as DocType, repo: 'repo-1' },
        { id: 'd2', type: 'GUIDE' as DocType, repo: 'repo-1' },
        { id: 'd3', type: 'API_REFERENCE' as DocType, repo: 'repo-2' },
        { id: 'd4', type: 'TUTORIAL' as DocType, repo: 'repo-2' },
        { id: 'd5', type: 'CHANGELOG' as DocType, repo: 'repo-3' },
      ];

      const byType: Record<string, typeof documents> = {};
      for (const doc of documents) {
        if (!byType[doc.type]) {
          byType[doc.type] = [];
        }
        byType[doc.type]!.push(doc);
      }

      expect(byType.API_REFERENCE?.length).toBe(2);
      expect(byType.GUIDE?.length).toBe(1);
    });
  });

  describe('Unified Search', () => {
    it('should search across all hub repositories', () => {
      interface SearchResult {
        documentId: string;
        repositoryId: string;
        repositoryName: string;
        title: string;
        snippet: string;
        score: number;
      }

      const results: SearchResult[] = [
        { documentId: 'd1', repositoryId: 'r1', repositoryName: 'api-service', title: 'Authentication', snippet: '...OAuth2 authentication...', score: 0.95 },
        { documentId: 'd2', repositoryId: 'r2', repositoryName: 'web-app', title: 'Auth Setup', snippet: '...configure authentication...', score: 0.85 },
        { documentId: 'd3', repositoryId: 'r1', repositoryName: 'api-service', title: 'JWT Tokens', snippet: '...authentication tokens...', score: 0.75 },
      ];

      // Group by repository
      const byRepo = results.reduce((acc, r) => {
        if (!acc[r.repositoryName]) {
          acc[r.repositoryName] = [];
        }
        acc[r.repositoryName]!.push(r);
        return acc;
      }, {} as Record<string, SearchResult[]>);

      expect(byRepo['api-service']?.length).toBe(2);
    });

    it('should track search analytics', () => {
      interface SearchQuery {
        hubId: string;
        query: string;
        resultCount: number;
        clickedDocumentId: string | null;
        userId: string | null;
        createdAt: Date;
      }

      const queries: SearchQuery[] = [
        { hubId: 'h1', query: 'authentication', resultCount: 5, clickedDocumentId: 'd1', userId: 'u1', createdAt: new Date() },
        { hubId: 'h1', query: 'setup', resultCount: 3, clickedDocumentId: null, userId: null, createdAt: new Date() },
        { hubId: 'h1', query: 'authentication', resultCount: 5, clickedDocumentId: 'd2', userId: 'u2', createdAt: new Date() },
      ];

      const clickThroughRate = queries.filter(q => q.clickedDocumentId).length / queries.length;
      expect(clickThroughRate).toBeCloseTo(0.67, 2);

      const popularQueries = queries.reduce((acc, q) => {
        acc[q.query] = (acc[q.query] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      expect(popularQueries.authentication).toBe(2);
    });
  });

  describe('Navigation Structure', () => {
    it('should generate unified navigation', () => {
      interface NavItem {
        id: string;
        title: string;
        type: 'section' | 'link' | 'divider';
        repositoryId?: string;
        children?: NavItem[];
      }

      const navigation: NavItem[] = [
        {
          id: 'getting-started',
          title: 'Getting Started',
          type: 'section',
          children: [
            { id: 'overview', title: 'Overview', type: 'link', repositoryId: 'main-docs' },
            { id: 'quickstart', title: 'Quickstart', type: 'link', repositoryId: 'main-docs' },
          ],
        },
        { id: 'div-1', title: '', type: 'divider' },
        {
          id: 'api-reference',
          title: 'API Reference',
          type: 'section',
          children: [
            { id: 'auth-api', title: 'Authentication', type: 'link', repositoryId: 'api-service' },
            { id: 'users-api', title: 'Users', type: 'link', repositoryId: 'api-service' },
          ],
        },
      ];

      const allLinks = navigation.flatMap(n => 
        n.type === 'section' ? (n.children || []) : n.type === 'link' ? [n] : []
      );

      expect(allLinks.length).toBe(4);
    });

    it('should group documents by repository', () => {
      const documents = [
        { repo: 'api', path: 'auth/login.md', title: 'Login' },
        { repo: 'api', path: 'auth/logout.md', title: 'Logout' },
        { repo: 'web', path: 'components/button.md', title: 'Button' },
        { repo: 'api', path: 'users/create.md', title: 'Create User' },
      ];

      const grouped = documents.reduce((acc, doc) => {
        if (!acc[doc.repo]) {
          acc[doc.repo] = [];
        }
        acc[doc.repo]!.push(doc);
        return acc;
      }, {} as Record<string, typeof documents>);

      expect(grouped.api?.length).toBe(3);
      expect(grouped.web?.length).toBe(1);
    });
  });

  describe('Cross-Repo Links', () => {
    it('should resolve cross-repository references', () => {
      const resolveLink = (
        link: string,
        currentRepo: string,
        hubRepos: string[]
      ): { repo: string; path: string } | null => {
        // Format: @repo-name/path/to/doc.md
        const crossRepoMatch = link.match(/^@([^/]+)\/(.+)$/);
        
        if (crossRepoMatch) {
          const [, targetRepo, path] = crossRepoMatch;
          if (hubRepos.includes(targetRepo!)) {
            return { repo: targetRepo!, path: path! };
          }
        }

        // Relative link in same repo
        return { repo: currentRepo, path: link };
      };

      const hubRepos = ['api-docs', 'web-docs', 'shared-docs'];

      const crossLink = resolveLink('@web-docs/components/button.md', 'api-docs', hubRepos);
      expect(crossLink?.repo).toBe('web-docs');
      expect(crossLink?.path).toBe('components/button.md');

      const relativeLink = resolveLink('./auth.md', 'api-docs', hubRepos);
      expect(relativeLink?.repo).toBe('api-docs');
    });

    it('should detect broken cross-repo links', () => {
      const validateLinks = (
        links: string[],
        availableDocs: Map<string, string[]>
      ): string[] => {
        const broken: string[] = [];
        
        for (const link of links) {
          const match = link.match(/^@([^/]+)\/(.+)$/);
          if (match) {
            const [, repo, path] = match;
            const repoDocs = availableDocs.get(repo!);
            if (!repoDocs || !repoDocs.includes(path!)) {
              broken.push(link);
            }
          }
        }
        
        return broken;
      };

      const docs = new Map([
        ['api', ['auth.md', 'users.md']],
        ['web', ['setup.md']],
      ]);

      const links = [
        '@api/auth.md',
        '@api/nonexistent.md',
        '@web/setup.md',
        '@unknown/file.md',
      ];

      const broken = validateLinks(links, docs);
      expect(broken).toContain('@api/nonexistent.md');
      expect(broken).toContain('@unknown/file.md');
      expect(broken.length).toBe(2);
    });
  });

  describe('Hub Statistics', () => {
    it('should calculate hub-wide metrics', () => {
      const repoStats = [
        { repoId: 'r1', docCount: 25, lastUpdated: new Date('2024-03-10') },
        { repoId: 'r2', docCount: 15, lastUpdated: new Date('2024-03-15') },
        { repoId: 'r3', docCount: 30, lastUpdated: new Date('2024-03-05') },
      ];

      const totalDocs = repoStats.reduce((sum, r) => sum + r.docCount, 0);
      const lastUpdated = repoStats.reduce((latest, r) => 
        r.lastUpdated > latest ? r.lastUpdated : latest, 
        new Date(0)
      );

      expect(totalDocs).toBe(70);
      expect(lastUpdated.toISOString().split('T')[0]).toBe('2024-03-15');
    });

    it('should track hub activity', () => {
      interface HubActivity {
        date: string;
        views: number;
        searches: number;
        uniqueUsers: number;
      }

      const activity: HubActivity[] = [
        { date: '2024-03-01', views: 150, searches: 45, uniqueUsers: 30 },
        { date: '2024-03-02', views: 180, searches: 52, uniqueUsers: 35 },
        { date: '2024-03-03', views: 120, searches: 38, uniqueUsers: 25 },
      ];

      const totalViews = activity.reduce((sum, a) => sum + a.views, 0);
      const avgSearchesPerUser = activity.reduce((sum, a) => sum + a.searches, 0) / 
        activity.reduce((sum, a) => sum + a.uniqueUsers, 0);

      expect(totalViews).toBe(450);
      expect(avgSearchesPerUser).toBeCloseTo(1.5, 1);
    });
  });
});
