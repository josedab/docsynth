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
