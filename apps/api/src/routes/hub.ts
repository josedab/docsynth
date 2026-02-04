import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('hub-routes');

// Type assertion for new Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export const hubRoutes = new Hono();

// List all hubs for an organization
hubRoutes.get('/organization/:organizationId', async (c) => {
  const { organizationId } = c.req.param();

  try {
    const hubs = await db.documentationHub.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
    });

    return c.json({ success: true, data: hubs });
  } catch (error) {
    log.error({ error, organizationId }, 'Failed to fetch hubs');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch hubs' } }, 500);
  }
});

// Get a specific hub by slug
hubRoutes.get('/slug/:slug', async (c) => {
  const { slug } = c.req.param();

  try {
    const hub = await db.documentationHub.findUnique({
      where: { slug },
    });

    if (!hub) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Hub not found' } }, 404);
    }

    // Get repository details
    const repositoryIds = hub.repositoryIds as string[];
    const repositories = await prisma.repository.findMany({
      where: { id: { in: repositoryIds } },
      select: {
        id: true,
        name: true,
        fullName: true,
        defaultBranch: true,
      },
    });

    return c.json({
      success: true,
      data: {
        ...hub,
        repositories,
      },
    });
  } catch (error) {
    log.error({ error, slug }, 'Failed to fetch hub');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch hub' } }, 500);
  }
});

// Create a new documentation hub
hubRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { organizationId, name, slug, description, repositoryIds, config, theme, isPublic } = body;

    if (!organizationId || !name || !slug) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'organizationId, name, and slug are required' },
      }, 400);
    }

    // Check slug uniqueness
    const existing = await db.documentationHub.findUnique({ where: { slug } });
    if (existing) {
      return c.json({
        success: false,
        error: { code: 'SLUG_EXISTS', message: 'A hub with this slug already exists' },
      }, 400);
    }

    const hub = await db.documentationHub.create({
      data: {
        organizationId,
        name,
        slug,
        description,
        repositoryIds: repositoryIds ?? [],
        config: config ?? {},
        theme: theme ?? {},
        isPublic: isPublic ?? false,
      },
    });

    log.info({ hubId: hub.id, slug }, 'Documentation hub created');

    return c.json({ success: true, data: hub }, 201);
  } catch (error) {
    log.error({ error }, 'Failed to create hub');
    return c.json({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create hub' } }, 500);
  }
});

// Update a hub
hubRoutes.put('/:hubId', async (c) => {
  const { hubId } = c.req.param();

  try {
    const body = await c.req.json();
    const { name, description, repositoryIds, config, theme, isPublic, customDomain } = body;

    const hub = await db.documentationHub.update({
      where: { id: hubId },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(repositoryIds && { repositoryIds }),
        ...(config && { config }),
        ...(theme && { theme }),
        ...(isPublic !== undefined && { isPublic }),
        ...(customDomain !== undefined && { customDomain }),
      },
    });

    return c.json({ success: true, data: hub });
  } catch (error) {
    log.error({ error, hubId }, 'Failed to update hub');
    return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update hub' } }, 500);
  }
});

// Delete a hub
hubRoutes.delete('/:hubId', async (c) => {
  const { hubId } = c.req.param();

  try {
    await db.documentationHub.delete({ where: { id: hubId } });
    log.info({ hubId }, 'Hub deleted');
    return c.json({ success: true, data: { deleted: true } });
  } catch (error) {
    log.error({ error, hubId }, 'Failed to delete hub');
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete hub' } }, 500);
  }
});

// Get all documents across hub repositories
hubRoutes.get('/:hubId/documents', async (c) => {
  const { hubId } = c.req.param();
  const { type, search } = c.req.query();

  try {
    const hub = await db.documentationHub.findUnique({ where: { id: hubId } });
    if (!hub) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Hub not found' } }, 404);
    }

    const repositoryIds = hub.repositoryIds as string[];

    // Build where clause with type assertion for dynamic type filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const whereClause: any = {
      repositoryId: { in: repositoryIds },
    };
    
    if (type) {
      whereClause.type = type;
    }
    
    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
      ];
    }

    const documents = await prisma.document.findMany({
      where: whereClause,
      select: {
        id: true,
        repositoryId: true,
        path: true,
        type: true,
        title: true,
        version: true,
        updatedAt: true,
        repository: {
          select: {
            name: true,
            fullName: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    return c.json({ success: true, data: documents });
  } catch (error) {
    log.error({ error, hubId }, 'Failed to fetch hub documents');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch documents' } }, 500);
  }
});

// Search across all hub documents
hubRoutes.get('/:hubId/search', async (c) => {
  const { hubId } = c.req.param();
  const { q, limit = '20' } = c.req.query();

  if (!q) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'Search query is required' } }, 400);
  }

  try {
    const hub = await db.documentationHub.findUnique({ where: { id: hubId } });
    if (!hub) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Hub not found' } }, 404);
    }

    const repositoryIds = hub.repositoryIds as string[];

    // Full-text search across documents
    const results = await prisma.document.findMany({
      where: {
        repositoryId: { in: repositoryIds },
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { content: { contains: q, mode: 'insensitive' } },
          { path: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        repositoryId: true,
        path: true,
        type: true,
        title: true,
        content: true,
        repository: {
          select: { name: true, fullName: true },
        },
      },
      take: parseInt(limit, 10),
    });

    // Extract snippets with highlights
    const resultsWithSnippets = results.map((doc) => {
      const snippet = extractSnippet(doc.content, q);
      return {
        id: doc.id,
        repositoryId: doc.repositoryId,
        repositoryName: doc.repository.name,
        path: doc.path,
        type: doc.type,
        title: doc.title,
        snippet,
      };
    });

    // Log search query for analytics
    await db.hubSearch.create({
      data: {
        hubId,
        query: q,
        resultCount: results.length,
      },
    });

    return c.json({
      success: true,
      data: {
        query: q,
        total: resultsWithSnippets.length,
        results: resultsWithSnippets,
      },
    });
  } catch (error) {
    log.error({ error, hubId, query: q }, 'Hub search failed');
    return c.json({ success: false, error: { code: 'SEARCH_FAILED', message: 'Search failed' } }, 500);
  }
});

// Get hub architecture overview (aggregated from all repos)
hubRoutes.get('/:hubId/architecture', async (c) => {
  const { hubId } = c.req.param();

  try {
    const hub = await db.documentationHub.findUnique({ where: { id: hubId } });
    if (!hub) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Hub not found' } }, 404);
    }

    const repositoryIds = hub.repositoryIds as string[];

    // Get architecture diagrams from all repositories
    const diagrams = await prisma.architectureDiagram.findMany({
      where: { repositoryId: { in: repositoryIds } },
      select: {
        id: true,
        repositoryId: true,
        name: true,
        diagramType: true,
        source: true,
        description: true,
        repository: {
          select: { name: true },
        },
      },
    });

    // Get cross-repo relationships from knowledge graph
    const entities = await prisma.knowledgeEntity.findMany({
      where: { repositoryId: { in: repositoryIds } },
      select: {
        id: true,
        repositoryId: true,
        name: true,
        type: true,
        description: true,
      },
      take: 200,
    });

    // Get relations
    const relations = await prisma.knowledgeRelation.findMany({
      where: { repositoryId: { in: repositoryIds } },
      select: {
        fromEntityId: true,
        toEntityId: true,
        relationship: true,
        weight: true,
      },
      take: 500,
    });

    return c.json({
      success: true,
      data: {
        diagrams,
        knowledgeGraph: {
          entities,
          relations,
        },
      },
    });
  } catch (error) {
    log.error({ error, hubId }, 'Failed to fetch hub architecture');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch architecture' } }, 500);
  }
});

// Publish hub
hubRoutes.post('/:hubId/publish', async (c) => {
  const { hubId } = c.req.param();

  try {
    const hub = await db.documentationHub.update({
      where: { id: hubId },
      data: {
        isPublic: true,
        publishedAt: new Date(),
      },
    });

    log.info({ hubId }, 'Hub published');

    return c.json({
      success: true,
      data: {
        published: true,
        url: `/hub/${hub.slug}`,
      },
    });
  } catch (error) {
    log.error({ error, hubId }, 'Failed to publish hub');
    return c.json({ success: false, error: { code: 'PUBLISH_FAILED', message: 'Failed to publish hub' } }, 500);
  }
});

// Get hub navigation structure
hubRoutes.get('/:hubId/navigation', async (c) => {
  const { hubId } = c.req.param();

  try {
    const hub = await db.documentationHub.findUnique({ where: { id: hubId } });
    if (!hub) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Hub not found' } }, 404);
    }

    const repositoryIds = hub.repositoryIds as string[];

    // Build navigation structure
    const repositories = await prisma.repository.findMany({
      where: { id: { in: repositoryIds } },
      select: {
        id: true,
        name: true,
        fullName: true,
        documents: {
          select: {
            id: true,
            path: true,
            type: true,
            title: true,
          },
          orderBy: { path: 'asc' },
        },
      },
    });

    // Group documents by type and path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const navigation = repositories.map((repo: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byType: Record<string, any[]> = {};
      
      for (const doc of repo.documents) {
        if (!byType[doc.type]) {
          byType[doc.type] = [];
        }
        byType[doc.type]!.push(doc);
      }

      return {
        repositoryId: repo.id,
        repositoryName: repo.name,
        fullName: repo.fullName,
        sections: Object.entries(byType).map(([type, docs]) => ({
          type,
          title: formatDocType(type),
          items: docs.map((d) => ({
            id: d.id,
            path: d.path,
            title: d.title,
          })),
        })),
      };
    });

    return c.json({ success: true, data: navigation });
  } catch (error) {
    log.error({ error, hubId }, 'Failed to fetch hub navigation');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch navigation' } }, 500);
  }
});

function extractSnippet(content: string, query: string, maxLength: number = 200): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerContent.indexOf(lowerQuery);

  if (index === -1) {
    return content.slice(0, maxLength) + (content.length > maxLength ? '...' : '');
  }

  const start = Math.max(0, index - 50);
  const end = Math.min(content.length, index + query.length + 150);
  
  let snippet = content.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';

  return snippet;
}

function formatDocType(type: string): string {
  const typeMap: Record<string, string> = {
    README: 'README',
    API_REFERENCE: 'API Reference',
    CHANGELOG: 'Changelog',
    GUIDE: 'Guides',
    TUTORIAL: 'Tutorials',
    ARCHITECTURE: 'Architecture',
    ADR: 'Decision Records',
    INLINE_COMMENT: 'Inline Comments',
  };
  return typeMap[type] ?? type;
}

// ============================================================================
// Multi-Repo Aggregation Enhancements (Feature 7)
// ============================================================================

// Get aggregated metrics across hub repositories
hubRoutes.get('/:hubId/metrics', async (c) => {
  const { hubId } = c.req.param();
  const { days = '30' } = c.req.query();

  try {
    const hub = await db.documentationHub.findUnique({ where: { id: hubId } });
    if (!hub) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Hub not found' } }, 404);
    }

    const repositoryIds = hub.repositoryIds as string[];
    const periodDays = parseInt(days, 10);
    const start = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    // Get documents across all repositories
    const documents = await prisma.document.findMany({
      where: { repositoryId: { in: repositoryIds } },
      select: {
        id: true,
        repositoryId: true,
        type: true,
        content: true,
        updatedAt: true,
      },
    });

    // Calculate metrics
    const now = new Date();
    let totalFresh = 0;
    let totalAging = 0;
    let totalStale = 0;
    let totalWords = 0;
    let totalWithExamples = 0;

    const repoMetrics = new Map<string, { docs: number; words: number; fresh: number }>();

    for (const doc of documents) {
      const daysSinceUpdate = Math.floor((now.getTime() - doc.updatedAt.getTime()) / (24 * 60 * 60 * 1000));
      const wordCount = doc.content.split(/\s+/).filter(w => w.length > 0).length;

      if (daysSinceUpdate <= 7) totalFresh++;
      else if (daysSinceUpdate <= 30) totalAging++;
      else totalStale++;

      totalWords += wordCount;
      if (doc.content.includes('```')) totalWithExamples++;

      // Per-repo metrics
      if (!repoMetrics.has(doc.repositoryId)) {
        repoMetrics.set(doc.repositoryId, { docs: 0, words: 0, fresh: 0 });
      }
      const rm = repoMetrics.get(doc.repositoryId)!;
      rm.docs++;
      rm.words += wordCount;
      if (daysSinceUpdate <= 7) rm.fresh++;
    }

    // Get repositories for names
    const repos = await prisma.repository.findMany({
      where: { id: { in: repositoryIds } },
      select: { id: true, name: true },
    });
    const repoMap = new Map(repos.map(r => [r.id, r.name]));

    // Document type distribution
    const typeDistribution = documents.reduce((acc, doc) => {
      acc[doc.type] = (acc[doc.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return c.json({
      success: true,
      data: {
        hubId,
        period: { days: periodDays, start: start.toISOString() },
        summary: {
          totalDocuments: documents.length,
          totalRepositories: repositoryIds.length,
          totalWords,
          avgWordsPerDoc: documents.length > 0 ? Math.round(totalWords / documents.length) : 0,
          documentsWithExamples: totalWithExamples,
        },
        freshness: {
          fresh: totalFresh,
          aging: totalAging,
          stale: totalStale,
          score: documents.length > 0 ? Math.round((totalFresh / documents.length) * 100) : 0,
        },
        typeDistribution,
        byRepository: Array.from(repoMetrics.entries()).map(([repoId, metrics]) => ({
          repositoryId: repoId,
          repositoryName: repoMap.get(repoId) || 'Unknown',
          documents: metrics.docs,
          avgWords: metrics.docs > 0 ? Math.round(metrics.words / metrics.docs) : 0,
          freshnessScore: metrics.docs > 0 ? Math.round((metrics.fresh / metrics.docs) * 100) : 0,
        })),
      },
    });
  } catch (error) {
    log.error({ error, hubId }, 'Failed to fetch hub metrics');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch metrics' } }, 500);
  }
});

// Get style consistency analysis across hub repositories
hubRoutes.get('/:hubId/style-consistency', async (c) => {
  const { hubId } = c.req.param();

  try {
    const hub = await db.documentationHub.findUnique({ where: { id: hubId } });
    if (!hub) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Hub not found' } }, 404);
    }

    const repositoryIds = hub.repositoryIds as string[];

    // Get documents for analysis
    const documents = await prisma.document.findMany({
      where: { repositoryId: { in: repositoryIds } },
      select: {
        id: true,
        repositoryId: true,
        path: true,
        type: true,
        content: true,
        repository: { select: { name: true } },
      },
    });

    // Analyze style patterns
    const stylePatterns = {
      headingStyles: new Map<string, number>(),
      codeBlockLanguages: new Map<string, number>(),
      linkStyles: new Map<string, number>(),
      listStyles: new Map<string, number>(),
    };

    const inconsistencies: Array<{
      type: string;
      description: string;
      repositories: string[];
      severity: 'low' | 'medium' | 'high';
    }> = [];

    for (const doc of documents) {
      // Analyze heading styles
      const atxHeadings = (doc.content.match(/^#{1,6}\s+.+$/gm) || []).length;
      const setextHeadings = (doc.content.match(/^.+\n[=-]+$/gm) || []).length;
      if (atxHeadings > 0) stylePatterns.headingStyles.set('atx', (stylePatterns.headingStyles.get('atx') || 0) + 1);
      if (setextHeadings > 0) stylePatterns.headingStyles.set('setext', (stylePatterns.headingStyles.get('setext') || 0) + 1);

      // Analyze code block languages
      const codeBlocks = doc.content.match(/```(\w+)?/g) || [];
      for (const block of codeBlocks) {
        const lang = block.replace('```', '') || 'none';
        stylePatterns.codeBlockLanguages.set(lang, (stylePatterns.codeBlockLanguages.get(lang) || 0) + 1);
      }

      // Analyze link styles
      const inlineLinks = (doc.content.match(/\[.+\]\(.+\)/g) || []).length;
      const refLinks = (doc.content.match(/\[.+\]\[.+\]/g) || []).length;
      if (inlineLinks > 0) stylePatterns.linkStyles.set('inline', (stylePatterns.linkStyles.get('inline') || 0) + 1);
      if (refLinks > 0) stylePatterns.linkStyles.set('reference', (stylePatterns.linkStyles.get('reference') || 0) + 1);

      // Analyze list styles
      const dashLists = (doc.content.match(/^-\s+/gm) || []).length;
      const asteriskLists = (doc.content.match(/^\*\s+/gm) || []).length;
      const numberedLists = (doc.content.match(/^\d+\.\s+/gm) || []).length;
      if (dashLists > 0) stylePatterns.listStyles.set('dash', (stylePatterns.listStyles.get('dash') || 0) + 1);
      if (asteriskLists > 0) stylePatterns.listStyles.set('asterisk', (stylePatterns.listStyles.get('asterisk') || 0) + 1);
      if (numberedLists > 0) stylePatterns.listStyles.set('numbered', (stylePatterns.listStyles.get('numbered') || 0) + 1);
    }

    // Detect inconsistencies
    if (stylePatterns.headingStyles.size > 1) {
      inconsistencies.push({
        type: 'heading-style',
        description: 'Mixed heading styles detected (ATX and Setext)',
        repositories: repositoryIds,
        severity: 'low',
      });
    }

    if (stylePatterns.listStyles.has('dash') && stylePatterns.listStyles.has('asterisk')) {
      inconsistencies.push({
        type: 'list-style',
        description: 'Mixed list marker styles (dash and asterisk)',
        repositories: repositoryIds,
        severity: 'low',
      });
    }

    // Check for missing code block languages
    const noLangBlocks = stylePatterns.codeBlockLanguages.get('none') || 0;
    const totalBlocks = Array.from(stylePatterns.codeBlockLanguages.values()).reduce((a, b) => a + b, 0);
    if (noLangBlocks > totalBlocks * 0.2) {
      inconsistencies.push({
        type: 'code-language',
        description: `${Math.round((noLangBlocks / totalBlocks) * 100)}% of code blocks lack language specification`,
        repositories: repositoryIds,
        severity: 'medium',
      });
    }

    // Calculate consistency score
    const totalPatternTypes = 4;
    const inconsistentPatterns = inconsistencies.length;
    const consistencyScore = Math.max(0, Math.round(((totalPatternTypes - inconsistentPatterns) / totalPatternTypes) * 100));

    return c.json({
      success: true,
      data: {
        hubId,
        consistencyScore,
        patterns: {
          headingStyles: Object.fromEntries(stylePatterns.headingStyles),
          codeBlockLanguages: Object.fromEntries(stylePatterns.codeBlockLanguages),
          linkStyles: Object.fromEntries(stylePatterns.linkStyles),
          listStyles: Object.fromEntries(stylePatterns.listStyles),
        },
        inconsistencies,
        recommendations: [
          ...(inconsistencies.filter(i => i.type === 'heading-style').length > 0 ? ['Standardize on ATX-style headings (# Heading)'] : []),
          ...(inconsistencies.filter(i => i.type === 'list-style').length > 0 ? ['Use consistent list markers (recommend -)'] : []),
          ...(inconsistencies.filter(i => i.type === 'code-language').length > 0 ? ['Always specify language for code blocks'] : []),
        ],
      },
    });
  } catch (error) {
    log.error({ error, hubId }, 'Failed to analyze style consistency');
    return c.json({ success: false, error: { code: 'ANALYSIS_FAILED', message: 'Failed to analyze style consistency' } }, 500);
  }
});

// Get common patterns across hub repositories
hubRoutes.get('/:hubId/patterns', async (c) => {
  const { hubId } = c.req.param();

  try {
    const hub = await db.documentationHub.findUnique({ where: { id: hubId } });
    if (!hub) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Hub not found' } }, 404);
    }

    const repositoryIds = hub.repositoryIds as string[];

    // Get documents
    const documents = await prisma.document.findMany({
      where: { repositoryId: { in: repositoryIds } },
      select: {
        id: true,
        repositoryId: true,
        type: true,
        title: true,
        content: true,
        repository: { select: { name: true } },
      },
    });

    // Analyze common section patterns
    const sectionPatterns = new Map<string, { count: number; repos: Set<string> }>();
    const headingPattern = /^(#{1,3})\s+(.+)$/gm;

    for (const doc of documents) {
      let match;
      while ((match = headingPattern.exec(doc.content)) !== null) {
        const headingText = match[2];
        if (!headingText) continue;
        const heading = headingText.toLowerCase().trim();
        // Normalize common headings
        const normalized = normalizeHeading(heading);
        if (normalized) {
          if (!sectionPatterns.has(normalized)) {
            sectionPatterns.set(normalized, { count: 0, repos: new Set() });
          }
          const pattern = sectionPatterns.get(normalized)!;
          pattern.count++;
          pattern.repos.add(doc.repositoryId);
        }
      }
    }

    // Filter to patterns appearing in multiple repos
    const commonPatterns = Array.from(sectionPatterns.entries())
      .filter(([_, data]) => data.repos.size > 1)
      .map(([pattern, data]) => ({
        section: pattern,
        occurrences: data.count,
        repositories: data.repos.size,
        isStandard: isStandardSection(pattern),
      }))
      .sort((a, b) => b.repositories - a.repositories);

    // Identify missing standard sections per repo
    const standardSections = ['installation', 'usage', 'api', 'contributing', 'license'];
    const repoMissingSections = new Map<string, string[]>();

    for (const repoId of repositoryIds) {
      const repoDocs = documents.filter(d => d.repositoryId === repoId);
      const repoSections = new Set<string>();

      for (const doc of repoDocs) {
        let match;
        headingPattern.lastIndex = 0;
        while ((match = headingPattern.exec(doc.content)) !== null) {
          const headingText = match[2];
          if (!headingText) continue;
          const normalized = normalizeHeading(headingText.toLowerCase());
          if (normalized) repoSections.add(normalized);
        }
      }

      const missing = standardSections.filter(s => !repoSections.has(s));
      if (missing.length > 0) {
        repoMissingSections.set(repoId, missing);
      }
    }

    // Get repository names
    const repos = await prisma.repository.findMany({
      where: { id: { in: repositoryIds } },
      select: { id: true, name: true },
    });
    const repoMap = new Map(repos.map(r => [r.id, r.name]));

    return c.json({
      success: true,
      data: {
        hubId,
        commonPatterns: commonPatterns.slice(0, 20),
        standardSections,
        coverage: {
          byRepository: Array.from(repoMissingSections.entries()).map(([repoId, missing]) => ({
            repositoryId: repoId,
            repositoryName: repoMap.get(repoId) || 'Unknown',
            missingSections: missing,
            coveragePercent: Math.round(((standardSections.length - missing.length) / standardSections.length) * 100),
          })),
        },
        suggestions: [
          ...Array.from(repoMissingSections.entries())
            .filter(([_, missing]) => missing.length > 0)
            .map(([repoId, missing]) => ({
              repository: repoMap.get(repoId) || repoId,
              action: `Add missing sections: ${missing.join(', ')}`,
            })),
        ],
      },
    });
  } catch (error) {
    log.error({ error, hubId }, 'Failed to analyze patterns');
    return c.json({ success: false, error: { code: 'ANALYSIS_FAILED', message: 'Failed to analyze patterns' } }, 500);
  }
});

function normalizeHeading(heading: string): string | null {
  const mappings: Record<string, string> = {
    'getting started': 'installation',
    'quick start': 'installation',
    'setup': 'installation',
    'install': 'installation',
    'installation': 'installation',
    'usage': 'usage',
    'how to use': 'usage',
    'examples': 'usage',
    'api': 'api',
    'api reference': 'api',
    'reference': 'api',
    'contributing': 'contributing',
    'contribution': 'contributing',
    'contribute': 'contributing',
    'license': 'license',
    'changelog': 'changelog',
    'changes': 'changelog',
    'release notes': 'changelog',
    'configuration': 'configuration',
    'config': 'configuration',
    'options': 'configuration',
    'testing': 'testing',
    'tests': 'testing',
    'deployment': 'deployment',
    'deploy': 'deployment',
  };

  return mappings[heading] || null;
}

function isStandardSection(section: string): boolean {
  const standard = ['installation', 'usage', 'api', 'contributing', 'license', 'changelog', 'configuration', 'testing', 'deployment'];
  return standard.includes(section);
}
