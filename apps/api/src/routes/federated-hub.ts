import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { NotFoundError, ValidationError, createLogger } from '@docsynth/utils';

const log = createLogger('federated-hub');

// Type assertion for new Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

// ============================================================================
// Hub CRUD
// ============================================================================

// Create a new documentation hub
app.post('/hubs', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId') as string;
  const body = await c.req.json<{
    name: string;
    description?: string;
    repositoryIds?: string[];
    settings?: Record<string, unknown>;
  }>();

  if (!body.name) {
    throw new ValidationError('name is required');
  }

  // Verify all provided repository IDs belong to the org
  if (body.repositoryIds && body.repositoryIds.length > 0) {
    const repositories = await prisma.repository.findMany({
      where: { id: { in: body.repositoryIds }, organizationId: orgId },
      select: { id: true },
    });

    const foundIds = new Set(repositories.map((r) => r.id));
    const invalidIds = body.repositoryIds.filter((id) => !foundIds.has(id));

    if (invalidIds.length > 0) {
      throw new ValidationError(`Invalid repository IDs: ${invalidIds.join(', ')}`);
    }
  }

  const hub = await db.federatedHub.create({
    data: {
      organizationId: orgId,
      name: body.name,
      description: body.description,
      repositoryIds: body.repositoryIds ?? [],
      settings: body.settings ?? {},
    },
  });

  log.info({ hubId: hub.id, orgId, name: body.name }, 'Federated hub created');

  return c.json({
    success: true,
    data: hub,
  }, 201);
});

// List all hubs for org
app.get('/hubs', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId') as string;
  const { limit, offset } = c.req.query();

  const [hubs, total] = await Promise.all([
    db.federatedHub.findMany({
      where: { organizationId: orgId },
      orderBy: { updatedAt: 'desc' },
      take: limit ? parseInt(limit, 10) : 20,
      skip: offset ? parseInt(offset, 10) : 0,
    }),
    db.federatedHub.count({ where: { organizationId: orgId } }),
  ]);

  return c.json({
    success: true,
    data: { hubs, total },
  });
});

// Get hub with aggregated documents
app.get('/hubs/:hubId', requireAuth, requireOrgAccess, async (c) => {
  const hubId = c.req.param('hubId') ?? '';
  const orgId = c.get('organizationId') as string;

  const hub = await db.federatedHub.findFirst({
    where: { id: hubId, organizationId: orgId },
  });

  if (!hub) {
    throw new NotFoundError('FederatedHub', hubId);
  }

  const repositoryIds = (hub.repositoryIds as string[]) || [];

  // Get repositories with document counts
  const repositories = repositoryIds.length > 0
    ? await prisma.repository.findMany({
        where: { id: { in: repositoryIds } },
        select: {
          id: true,
          name: true,
          fullName: true,
          defaultBranch: true,
          _count: { select: { documents: true } },
        },
      })
    : [];

  // Get aggregated documents across all hub repositories
  const documents = repositoryIds.length > 0
    ? await prisma.document.findMany({
        where: { repositoryId: { in: repositoryIds } },
        select: {
          id: true,
          repositoryId: true,
          path: true,
          type: true,
          title: true,
          version: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      })
    : [];

  return c.json({
    success: true,
    data: {
      ...hub,
      repositories,
      documents,
      stats: {
        totalRepositories: repositories.length,
        totalDocuments: documents.length,
      },
    },
  });
});

// Update hub settings
app.put('/hubs/:hubId', requireAuth, requireOrgAccess, async (c) => {
  const hubId = c.req.param('hubId') ?? '';
  const orgId = c.get('organizationId') as string;
  const body = await c.req.json<{
    name?: string;
    description?: string;
    settings?: Record<string, unknown>;
  }>();

  const hub = await db.federatedHub.findFirst({
    where: { id: hubId, organizationId: orgId },
  });

  if (!hub) {
    throw new NotFoundError('FederatedHub', hubId);
  }

  const updated = await db.federatedHub.update({
    where: { id: hubId },
    data: {
      ...(body.name && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.settings && { settings: body.settings }),
    },
  });

  log.info({ hubId, orgId }, 'Federated hub updated');

  return c.json({
    success: true,
    data: updated,
  });
});

// Delete a hub
app.delete('/hubs/:hubId', requireAuth, requireOrgAccess, async (c) => {
  const hubId = c.req.param('hubId') ?? '';
  const orgId = c.get('organizationId') as string;

  const hub = await db.federatedHub.findFirst({
    where: { id: hubId, organizationId: orgId },
  });

  if (!hub) {
    throw new NotFoundError('FederatedHub', hubId);
  }

  await db.federatedHub.delete({ where: { id: hubId } });

  log.info({ hubId, orgId }, 'Federated hub deleted');

  return c.json({
    success: true,
    data: { deleted: true },
  });
});

// ============================================================================
// Repository Management
// ============================================================================

// Add repository to hub
app.post('/hubs/:hubId/repositories', requireAuth, requireOrgAccess, async (c) => {
  const hubId = c.req.param('hubId') ?? '';
  const orgId = c.get('organizationId') as string;
  const body = await c.req.json<{ repositoryId: string }>();

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  const hub = await db.federatedHub.findFirst({
    where: { id: hubId, organizationId: orgId },
  });

  if (!hub) {
    throw new NotFoundError('FederatedHub', hubId);
  }

  // Verify the repository belongs to the org
  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  const repositoryIds = (hub.repositoryIds as string[]) || [];

  // Check if already added
  if (repositoryIds.includes(body.repositoryId)) {
    return c.json({
      success: true,
      data: {
        message: 'Repository already in hub',
        hubId,
        repositoryId: body.repositoryId,
      },
    });
  }

  repositoryIds.push(body.repositoryId);

  await db.federatedHub.update({
    where: { id: hubId },
    data: { repositoryIds },
  });

  log.info({ hubId, repositoryId: body.repositoryId }, 'Repository added to federated hub');

  return c.json({
    success: true,
    data: {
      message: 'Repository added to hub',
      hubId,
      repositoryId: body.repositoryId,
      totalRepositories: repositoryIds.length,
    },
  });
});

// Remove repository from hub
app.delete('/hubs/:hubId/repositories/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const hubId = c.req.param('hubId') ?? '';
  const repositoryId = c.req.param('repositoryId') ?? '';
  const orgId = c.get('organizationId') as string;

  const hub = await db.federatedHub.findFirst({
    where: { id: hubId, organizationId: orgId },
  });

  if (!hub) {
    throw new NotFoundError('FederatedHub', hubId);
  }

  const repositoryIds = (hub.repositoryIds as string[]) || [];
  const filteredIds = repositoryIds.filter((id: string) => id !== repositoryId);

  if (filteredIds.length === repositoryIds.length) {
    throw new NotFoundError('Repository in hub', repositoryId);
  }

  await db.federatedHub.update({
    where: { id: hubId },
    data: { repositoryIds: filteredIds },
  });

  log.info({ hubId, repositoryId }, 'Repository removed from federated hub');

  return c.json({
    success: true,
    data: {
      message: 'Repository removed from hub',
      hubId,
      repositoryId,
      totalRepositories: filteredIds.length,
    },
  });
});

// ============================================================================
// Search
// ============================================================================

// Search across all hub repositories
app.get('/hubs/:hubId/search', requireAuth, requireOrgAccess, async (c) => {
  const hubId = c.req.param('hubId') ?? '';
  const orgId = c.get('organizationId') as string;
  const { q, limit } = c.req.query();

  if (!q) {
    throw new ValidationError('Search query parameter "q" is required');
  }

  const hub = await db.federatedHub.findFirst({
    where: { id: hubId, organizationId: orgId },
  });

  if (!hub) {
    throw new NotFoundError('FederatedHub', hubId);
  }

  const repositoryIds = (hub.repositoryIds as string[]) || [];

  if (repositoryIds.length === 0) {
    return c.json({
      success: true,
      data: {
        query: q,
        total: 0,
        results: [],
      },
    });
  }

  // Full-text search across documents in hub repositories
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
    take: limit ? parseInt(limit, 10) : 20,
  });

  // Extract snippets around the matched query
  const resultsWithSnippets = results.map((doc) => {
    const snippet = extractSnippet(doc.content, q);
    return {
      id: doc.id,
      repositoryId: doc.repositoryId,
      repositoryName: doc.repository.name,
      repositoryFullName: doc.repository.fullName,
      path: doc.path,
      type: doc.type,
      title: doc.title,
      snippet,
    };
  });

  return c.json({
    success: true,
    data: {
      query: q,
      total: resultsWithSnippets.length,
      results: resultsWithSnippets,
    },
  });
});

// ============================================================================
// Navigation
// ============================================================================

// Get navigation tree for hub (cross-repo sidebar)
app.get('/hubs/:hubId/navigation', requireAuth, requireOrgAccess, async (c) => {
  const hubId = c.req.param('hubId') ?? '';
  const orgId = c.get('organizationId') as string;

  const hub = await db.federatedHub.findFirst({
    where: { id: hubId, organizationId: orgId },
  });

  if (!hub) {
    throw new NotFoundError('FederatedHub', hubId);
  }

  const repositoryIds = (hub.repositoryIds as string[]) || [];

  if (repositoryIds.length === 0) {
    return c.json({
      success: true,
      data: [],
    });
  }

  // Build navigation structure from repositories and their documents
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

  // Group documents by type and build tree structure
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

  return c.json({
    success: true,
    data: navigation,
  });
});

// ============================================================================
// Helpers
// ============================================================================

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

export { app as federatedHubRoutes };
