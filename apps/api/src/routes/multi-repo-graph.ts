import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import {
  buildOrgGraph,
  getOrgGraph,
  searchAcrossRepos,
  detectDependencies,
  getImpactPropagation,
  getServiceClusters,
  getCrossRepoDriftAlerts,
  type OrgDocGraph,
  type CrossRepoSearchResult,
} from '../services/multi-repo-graph.service.js';

const app = new Hono();

// ============================================================================
// Graph Retrieval & Building
// ============================================================================

/**
 * GET /graph - Get org-wide documentation graph
 */
app.get('/graph', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const graph = await getOrgGraph(orgId);

  if (!graph) {
    return c.json({
      success: false,
      error: 'Graph not built yet. Please trigger a build first.',
      data: null,
    });
  }

  return c.json({
    success: true,
    data: graph,
  });
});

/**
 * POST /build - Trigger graph rebuild
 */
app.post('/build', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ async?: boolean }>().catch(() => ({ async: false }));

  // Verify organization exists
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });

  if (!org) {
    throw new NotFoundError('Organization', orgId);
  }

  if (body.async === true) {
    // Queue background job for graph building
    const job = await addJob(QUEUE_NAMES.ORG_GRAPH_BUILDER, {
      organizationId: orgId,
    });

    return c.json({
      success: true,
      data: {
        jobId: job.id,
        message: 'Graph build queued',
      },
    });
  } else {
    // Build synchronously
    const graph = await buildOrgGraph(orgId);

    return c.json({
      success: true,
      data: {
        message: 'Graph built successfully',
        stats: graph.stats,
      },
    });
  }
});

// ============================================================================
// Cross-Repo Search
// ============================================================================

/**
 * GET /search - Cross-repo document search
 */
app.get('/search', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { q, limit } = c.req.query();

  if (!q) {
    throw new ValidationError('Query parameter "q" is required');
  }

  const searchLimit = limit ? parseInt(limit, 10) : 20;

  const results = await searchAcrossRepos(orgId, q, searchLimit);

  return c.json({
    success: true,
    data: {
      query: q,
      totalResults: results.length,
      results,
    },
  });
});

// ============================================================================
// Repository Dependencies
// ============================================================================

/**
 * GET /dependencies/:repositoryId - Get dependencies for a repo
 */
app.get('/dependencies/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  // Verify repository access
  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, name: true, organizationId: true },
  });

  if (!repo) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Get all other repos in the org
  const otherRepos = await prisma.repository.findMany({
    where: {
      organizationId: orgId,
      id: { not: repositoryId },
    },
    select: { id: true, name: true },
  });

  const otherRepoIds = otherRepos.map((r) => r.id);

  // Detect dependencies
  const edges = await detectDependencies(repositoryId, otherRepoIds);

  // Group by type
  const dependencies = {
    dependsOn: edges.filter((e) => e.type === 'depends_on'),
    imports: edges.filter((e) => e.type === 'imports_from'),
    publishes: edges.filter((e) => e.type === 'publishes_to'),
    sharedData: edges.filter((e) => e.type === 'shares_data'),
    relatedDocs: edges.filter((e) => e.type === 'related_docs'),
  };

  // Get repo names for display
  const repoMap = new Map([
    [repo.id, repo.name],
    ...otherRepos.map((r) => [r.id, r.name] as [string, string]),
  ]);

  const enrichedDependencies = {
    dependsOn: dependencies.dependsOn.map((e) => ({
      ...e,
      targetName: repoMap.get(e.targetRepoId) || 'Unknown',
    })),
    imports: dependencies.imports.map((e) => ({
      ...e,
      targetName: repoMap.get(e.targetRepoId) || 'Unknown',
    })),
    publishes: dependencies.publishes.map((e) => ({
      ...e,
      targetName: repoMap.get(e.targetRepoId) || 'Unknown',
    })),
    sharedData: dependencies.sharedData.map((e) => ({
      ...e,
      targetName: repoMap.get(e.targetRepoId) || 'Unknown',
    })),
    relatedDocs: dependencies.relatedDocs.map((e) => ({
      ...e,
      targetName: repoMap.get(e.targetRepoId) || 'Unknown',
    })),
  };

  return c.json({
    success: true,
    data: {
      repositoryId,
      repositoryName: repo.name,
      dependencies: enrichedDependencies,
      summary: {
        total: edges.length,
        dependsOn: dependencies.dependsOn.length,
        imports: dependencies.imports.length,
        publishes: dependencies.publishes.length,
        sharedData: dependencies.sharedData.length,
        relatedDocs: dependencies.relatedDocs.length,
      },
    },
  });
});

// ============================================================================
// Impact Analysis
// ============================================================================

/**
 * GET /impact/:repositoryId/:documentId - Get cross-repo impact for a doc change
 */
app.get('/impact/:repositoryId/:documentId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');

  // Verify access
  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, name: true },
  });

  if (!repo) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const document = await prisma.document.findFirst({
    where: { id: documentId, repositoryId },
    select: { id: true, path: true, title: true },
  });

  if (!document) {
    throw new NotFoundError('Document', documentId);
  }

  // Get impact propagation
  const impactedDocs = await getImpactPropagation(repositoryId, documentId);

  // Group by repository
  const byRepository = new Map<string, typeof impactedDocs>();
  for (const impact of impactedDocs) {
    const existing = byRepository.get(impact.repositoryId) || [];
    existing.push(impact);
    byRepository.set(impact.repositoryId, existing);
  }

  const groupedImpact = Array.from(byRepository.entries()).map(([repoId, docs]) => ({
    repositoryId: repoId,
    repositoryName: docs[0]?.repositoryName || 'Unknown',
    affectedDocuments: docs,
    totalImpactScore: docs.reduce((sum, d) => sum + d.impactScore, 0),
  }));

  // Sort by total impact score
  groupedImpact.sort((a, b) => b.totalImpactScore - a.totalImpactScore);

  return c.json({
    success: true,
    data: {
      sourceDocument: {
        repositoryId,
        repositoryName: repo.name,
        documentId,
        documentPath: document.path,
        title: document.title,
      },
      impact: {
        totalAffectedDocuments: impactedDocs.length,
        affectedRepositories: groupedImpact.length,
        byRepository: groupedImpact,
      },
    },
  });
});

// ============================================================================
// Service Clusters
// ============================================================================

/**
 * GET /clusters - Get service clusters
 */
app.get('/clusters', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const clusters = await getServiceClusters(orgId);

  // Get repository names for each cluster
  const allRepoIds = new Set<string>();
  clusters.forEach((cluster) => {
    cluster.repositoryIds.forEach((id) => allRepoIds.add(id));
  });

  const repos = await prisma.repository.findMany({
    where: { id: { in: Array.from(allRepoIds) } },
    select: { id: true, name: true },
  });

  const repoMap = new Map(repos.map((r) => [r.id, r.name]));

  const enrichedClusters = clusters.map((cluster) => ({
    ...cluster,
    repositories: cluster.repositoryIds.map((id) => ({
      id,
      name: repoMap.get(id) || 'Unknown',
    })),
    size: cluster.repositoryIds.length,
  }));

  return c.json({
    success: true,
    data: {
      totalClusters: enrichedClusters.length,
      clusters: enrichedClusters,
    },
  });
});

// ============================================================================
// Drift Alerts
// ============================================================================

/**
 * GET /drift-alerts - Get cross-repo drift alerts
 */
app.get('/drift-alerts', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const alerts = await getCrossRepoDriftAlerts(orgId);

  // Group by severity
  const bySeverity = {
    high: alerts.filter((a) => a.severity === 'high'),
    medium: alerts.filter((a) => a.severity === 'medium'),
    low: alerts.filter((a) => a.severity === 'low'),
  };

  return c.json({
    success: true,
    data: {
      totalAlerts: alerts.length,
      bySeverity: {
        high: bySeverity.high.length,
        medium: bySeverity.medium.length,
        low: bySeverity.low.length,
      },
      alerts: {
        high: bySeverity.high,
        medium: bySeverity.medium,
        low: bySeverity.low,
      },
    },
  });
});

// ============================================================================
// Statistics
// ============================================================================

/**
 * GET /stats - Get graph statistics
 */
app.get('/stats', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const graph = await getOrgGraph(orgId);

  if (!graph) {
    return c.json({
      success: false,
      error: 'Graph not built yet. Please trigger a build first.',
    });
  }

  // Additional computed stats
  const edgesByType = {
    dependsOn: graph.edges.filter((e) => e.type === 'depends_on').length,
    importsFrom: graph.edges.filter((e) => e.type === 'imports_from').length,
    publishesTo: graph.edges.filter((e) => e.type === 'publishes_to').length,
    sharesData: graph.edges.filter((e) => e.type === 'shares_data').length,
    relatedDocs: graph.edges.filter((e) => e.type === 'related_docs').length,
  };

  const reposByType = {
    service: graph.repositories.filter((r) => r.type === 'service').length,
    library: graph.repositories.filter((r) => r.type === 'library').length,
    frontend: graph.repositories.filter((r) => r.type === 'frontend').length,
    infrastructure: graph.repositories.filter((r) => r.type === 'infrastructure').length,
    unknown: graph.repositories.filter((r) => r.type === 'unknown').length,
  };

  const healthDistribution = {
    excellent: graph.repositories.filter((r) => r.healthScore >= 80).length,
    good: graph.repositories.filter((r) => r.healthScore >= 60 && r.healthScore < 80).length,
    fair: graph.repositories.filter((r) => r.healthScore >= 40 && r.healthScore < 60).length,
    poor: graph.repositories.filter((r) => r.healthScore < 40).length,
  };

  return c.json({
    success: true,
    data: {
      ...graph.stats,
      edgesByType,
      repositoriesByType: reposByType,
      healthDistribution,
      clusters: {
        total: graph.clusters.length,
        avgSize:
          graph.clusters.length > 0
            ? Math.round(
                graph.clusters.reduce((sum, c) => sum + c.repositoryIds.length, 0) /
                  graph.clusters.length
              )
            : 0,
      },
    },
  });
});

export { app as multiRepoGraphRoutes };
