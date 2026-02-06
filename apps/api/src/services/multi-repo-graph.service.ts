import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('multi-repo-graph');

// ============================================================================
// Types
// ============================================================================

export interface OrgDocGraph {
  organizationId: string;
  repositories: RepoNode[];
  edges: GraphEdge[];
  clusters: ServiceCluster[];
  stats: GraphStats;
}

export interface RepoNode {
  repositoryId: string;
  name: string;
  type: 'service' | 'library' | 'frontend' | 'infrastructure' | 'unknown';
  documentCount: number;
  healthScore: number;
  technologies: string[];
  exports: string[]; // public APIs
}

export interface GraphEdge {
  sourceRepoId: string;
  targetRepoId: string;
  type: 'depends_on' | 'imports_from' | 'publishes_to' | 'shares_data' | 'related_docs';
  weight: number; // strength of relationship
  details: string;
}

export interface ServiceCluster {
  id: string;
  name: string;
  repositoryIds: string[];
  description: string;
}

export interface GraphStats {
  totalRepositories: number;
  totalEdges: number;
  totalDocuments: number;
  averageHealthScore: number;
  mostConnected: string;
  leastDocumented: string;
}

export interface CrossRepoSearchResult {
  documentId: string;
  repositoryId: string;
  repositoryName: string;
  documentPath: string;
  title: string;
  snippet: string;
  relevanceScore: number;
}

// ============================================================================
// Graph Building
// ============================================================================

/**
 * Build organization-wide documentation graph
 */
export async function buildOrgGraph(organizationId: string): Promise<OrgDocGraph> {
  log.info({ organizationId }, 'Building org-wide documentation graph');

  // Get all repositories for the organization
  const repositories = await prisma.repository.findMany({
    where: { organizationId },
    include: {
      documents: {
        select: { id: true, type: true, content: true, path: true, metadata: true },
      },
    },
  });

  // Build repository nodes
  const repoNodes: RepoNode[] = await Promise.all(
    repositories.map(async (repo) => {
      const metadata = (repo.metadata as Record<string, unknown>) || {};
      const technologies = (metadata.technologies as string[]) || [];
      const exports = (metadata.exports as string[]) || [];

      // Calculate health score
      const healthScore = await calculateRepoHealthScore(repo.id);

      // Detect repository type
      const repoType = detectRepositoryType(repo, technologies);

      return {
        repositoryId: repo.id,
        name: repo.name,
        type: repoType,
        documentCount: repo.documents.length,
        healthScore,
        technologies,
        exports,
      };
    })
  );

  // Build edges between repositories
  const edges: GraphEdge[] = [];

  for (let i = 0; i < repositories.length; i++) {
    const sourceRepo = repositories[i];
    if (!sourceRepo) continue;

    for (let j = i + 1; j < repositories.length; j++) {
      const targetRepo = repositories[j];
      if (!targetRepo) continue;

      // Detect dependencies between repos
      const detectedEdges = await detectDependencies(
        sourceRepo.id,
        [targetRepo.id],
        sourceRepo.documents,
        targetRepo.documents
      );

      edges.push(...detectedEdges);
    }
  }

  // Cluster repositories by similarity
  const clusters = await getServiceClusters(organizationId, repoNodes, edges);

  // Calculate statistics
  const stats = calculateGraphStats(repoNodes, edges);

  // Build the graph
  const graph: OrgDocGraph = {
    organizationId,
    repositories: repoNodes,
    edges,
    clusters,
    stats,
  };

  // Note: Cache the graph in a dedicated cache service or Redis
  // For now, we'll return it directly. In production, consider:
  // - Storing in Redis with a TTL
  // - Storing in a dedicated table
  // - Using the cache service from cache.service.ts

  log.info(
    {
      organizationId,
      repoCount: repoNodes.length,
      edgeCount: edges.length,
      clusterCount: clusters.length,
    },
    'Org graph built successfully'
  );

  return graph;
}

/**
 * Get cached organization graph
 * Note: In production, this should fetch from cache service or Redis
 * For now, we rebuild on demand
 */
export async function getOrgGraph(organizationId: string): Promise<OrgDocGraph | null> {
  // TODO: Implement proper caching with Redis or cache service
  // For now, return null to indicate graph needs to be built
  // This will trigger a rebuild when needed

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  if (!org) return null;

  // In production, fetch from cache here
  // For now, return null to indicate rebuild needed
  return null;
}

// ============================================================================
// Cross-Repo Search
// ============================================================================

/**
 * Search across all repositories in an organization
 */
export async function searchAcrossRepos(
  organizationId: string,
  query: string,
  limit: number = 20
): Promise<CrossRepoSearchResult[]> {
  log.info({ organizationId, query, limit }, 'Cross-repo search');

  // Get all repositories
  const repositories = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  });

  const repoIds = repositories.map((r) => r.id);
  const repoMap = new Map(repositories.map((r) => [r.id, r.name]));

  // Search documents across all repos
  const documents = await prisma.document.findMany({
    where: {
      repositoryId: { in: repoIds },
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { path: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      repositoryId: true,
      path: true,
      title: true,
      content: true,
    },
    take: limit,
  });

  // Calculate relevance scores and create results
  const results: CrossRepoSearchResult[] = documents.map((doc) => {
    const content = doc.content || '';
    const queryLower = query.toLowerCase();

    // Simple relevance scoring
    let relevanceScore = 0;
    if (doc.title.toLowerCase().includes(queryLower)) relevanceScore += 10;
    if (doc.path.toLowerCase().includes(queryLower)) relevanceScore += 5;

    const titleMatches = (doc.title.toLowerCase().match(new RegExp(queryLower, 'g')) || []).length;
    const contentMatches = (content.toLowerCase().match(new RegExp(queryLower, 'g')) || []).length;
    relevanceScore += titleMatches * 3 + Math.min(contentMatches, 20);

    // Extract snippet around query
    const snippetIndex = content.toLowerCase().indexOf(queryLower);
    const snippetStart = Math.max(0, snippetIndex - 100);
    const snippetEnd = Math.min(content.length, snippetIndex + 200);
    const snippet = content.slice(snippetStart, snippetEnd).trim();

    return {
      documentId: doc.id,
      repositoryId: doc.repositoryId,
      repositoryName: repoMap.get(doc.repositoryId) || 'Unknown',
      documentPath: doc.path,
      title: doc.title,
      snippet: snippet || content.slice(0, 200),
      relevanceScore,
    };
  });

  // Sort by relevance score
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return results;
}

// ============================================================================
// Dependency Detection
// ============================================================================

/**
 * Detect dependencies between repositories
 */
export async function detectDependencies(
  repositoryId: string,
  otherRepoIds: string[],
  sourceDocs?: Array<{ id: string; content: string | null; metadata: unknown; path: string }>,
  targetDocs?: Array<{ id: string; content: string | null; metadata: unknown; path: string }>
): Promise<GraphEdge[]> {
  const edges: GraphEdge[] = [];

  // Fetch source docs if not provided
  if (!sourceDocs) {
    sourceDocs = await prisma.document.findMany({
      where: { repositoryId },
      select: { id: true, content: true, metadata: true, path: true },
    });
  }

  // Get target repositories
  const targetRepos = await prisma.repository.findMany({
    where: { id: { in: otherRepoIds } },
    include: {
      documents: targetDocs
        ? { where: { id: { in: targetDocs.map((d) => d.id) } } }
        : { select: { id: true, content: true, metadata: true, path: true } },
    },
  });

  for (const targetRepo of targetRepos) {
    const targetRepoMetadata = (targetRepo.metadata as Record<string, unknown>) || {};
    const targetExports = (targetRepoMetadata.exports as string[]) || [];

    let dependencyWeight = 0;
    let importWeight = 0;
    let relatedDocsWeight = 0;
    const details: string[] = [];

    // Check for package.json dependencies
    const packageJsonDoc = sourceDocs.find((d) => d.path.endsWith('package.json'));
    if (packageJsonDoc && packageJsonDoc.content) {
      try {
        const packageJson = JSON.parse(packageJsonDoc.content);
        const allDeps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };

        // Check if target repo package is in dependencies
        const targetPackageName = targetRepo.name.toLowerCase();
        for (const dep of Object.keys(allDeps)) {
          if (dep.toLowerCase().includes(targetPackageName)) {
            dependencyWeight += 5;
            details.push(`Dependency: ${dep}`);
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    // Check for import statements
    for (const doc of sourceDocs) {
      const content = doc.content || '';
      for (const exportedItem of targetExports) {
        if (content.includes(exportedItem)) {
          importWeight += 1;
        }
      }
    }

    // Check for cross-references in documentation
    for (const sourceDoc of sourceDocs) {
      const content = (sourceDoc.content || '').toLowerCase();
      for (const targetDoc of targetRepo.documents) {
        const targetPath = targetDoc.path.toLowerCase();
        if (content.includes(targetPath) || content.includes(targetRepo.name.toLowerCase())) {
          relatedDocsWeight += 1;
        }
      }
    }

    // Create edges based on detected relationships
    if (dependencyWeight > 0) {
      edges.push({
        sourceRepoId: repositoryId,
        targetRepoId: targetRepo.id,
        type: 'depends_on',
        weight: dependencyWeight,
        details: details.join(', '),
      });
    }

    if (importWeight > 0) {
      edges.push({
        sourceRepoId: repositoryId,
        targetRepoId: targetRepo.id,
        type: 'imports_from',
        weight: importWeight,
        details: `${importWeight} imports detected`,
      });
    }

    if (relatedDocsWeight > 0) {
      edges.push({
        sourceRepoId: repositoryId,
        targetRepoId: targetRepo.id,
        type: 'related_docs',
        weight: relatedDocsWeight,
        details: `${relatedDocsWeight} cross-references found`,
      });
    }
  }

  return edges;
}

/**
 * Get impact propagation for a document change across repos
 */
export async function getImpactPropagation(
  repositoryId: string,
  documentId: string
): Promise<Array<{ repositoryId: string; repositoryName: string; documentId: string; documentPath: string; impactScore: number }>> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { path: true, content: true, title: true },
  });

  if (!document) return [];

  const sourceRepo = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { organizationId: true, name: true },
  });

  if (!sourceRepo) return [];

  // Get graph to find connected repositories
  const graph = await getOrgGraph(sourceRepo.organizationId);
  if (!graph) return [];

  // Find repositories connected to this one
  const connectedRepoIds = graph.edges
    .filter((e) => e.sourceRepoId === repositoryId || e.targetRepoId === repositoryId)
    .map((e) => (e.sourceRepoId === repositoryId ? e.targetRepoId : e.sourceRepoId));

  // Search for references to this document in connected repos
  const impactedDocs = await prisma.document.findMany({
    where: {
      repositoryId: { in: connectedRepoIds },
      OR: [
        { content: { contains: document.path } },
        { content: { contains: document.title } },
      ],
    },
    include: {
      repository: {
        select: { name: true },
      },
    },
  });

  // Calculate impact scores
  const results = impactedDocs.map((doc) => {
    const content = doc.content || '';
    const pathMatches = (content.match(new RegExp(document.path, 'g')) || []).length;
    const titleMatches = (content.match(new RegExp(document.title, 'g')) || []).length;

    return {
      repositoryId: doc.repositoryId,
      repositoryName: doc.repository.name,
      documentId: doc.id,
      documentPath: doc.path,
      impactScore: pathMatches * 3 + titleMatches * 2,
    };
  });

  // Sort by impact score
  results.sort((a, b) => b.impactScore - a.impactScore);

  return results;
}

// ============================================================================
// Service Clustering
// ============================================================================

/**
 * Group repositories into service clusters
 */
export async function getServiceClusters(
  organizationId: string,
  repoNodes?: RepoNode[],
  edges?: GraphEdge[]
): Promise<ServiceCluster[]> {
  // If nodes/edges not provided, get from cached graph
  if (!repoNodes || !edges) {
    const graph = await getOrgGraph(organizationId);
    if (!graph) return [];
    repoNodes = graph.repositories;
    edges = graph.edges;
  }

  const clusters: ServiceCluster[] = [];
  const clustered = new Set<string>();

  // Group by repository type first
  const typeGroups = new Map<string, string[]>();
  for (const node of repoNodes) {
    const existing = typeGroups.get(node.type) || [];
    existing.push(node.repositoryId);
    typeGroups.set(node.type, existing);
  }

  // Create clusters for each type
  for (const [type, repoIds] of Array.from(typeGroups.entries())) {
    if (repoIds.length > 0) {
      clusters.push({
        id: `cluster-${type}`,
        name: `${type.charAt(0).toUpperCase() + type.slice(1)} Services`,
        repositoryIds: repoIds,
        description: `Group of ${type} repositories`,
      });
      repoIds.forEach((id) => clustered.add(id));
    }
  }

  // Find strongly connected components
  const adjacencyMap = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.weight >= 3) {
      // Only strong connections
      if (!adjacencyMap.has(edge.sourceRepoId)) {
        adjacencyMap.set(edge.sourceRepoId, new Set());
      }
      if (!adjacencyMap.has(edge.targetRepoId)) {
        adjacencyMap.set(edge.targetRepoId, new Set());
      }
      adjacencyMap.get(edge.sourceRepoId)?.add(edge.targetRepoId);
      adjacencyMap.get(edge.targetRepoId)?.add(edge.sourceRepoId);
    }
  }

  // Find connected components
  const visited = new Set<string>();
  let clusterIndex = 0;

  for (const repoId of repoNodes.map((n) => n.repositoryId)) {
    if (visited.has(repoId)) continue;

    const component: string[] = [];
    const queue = [repoId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;

      visited.add(current);
      component.push(current);

      const neighbors = adjacencyMap.get(current);
      if (neighbors) {
        for (const neighbor of Array.from(neighbors)) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }
    }

    if (component.length > 1) {
      clusters.push({
        id: `cluster-connected-${clusterIndex++}`,
        name: `Connected Services ${clusterIndex}`,
        repositoryIds: component,
        description: `Tightly coupled repositories with strong dependencies`,
      });
    }
  }

  return clusters;
}

/**
 * Get cross-repo drift alerts
 */
export async function getCrossRepoDriftAlerts(
  organizationId: string
): Promise<Array<{ repositoryId: string; repositoryName: string; relatedRepoId: string; relatedRepoName: string; reason: string; severity: 'low' | 'medium' | 'high' }>> {
  const graph = await getOrgGraph(organizationId);
  if (!graph) return [];

  const alerts: Array<{
    repositoryId: string;
    repositoryName: string;
    relatedRepoId: string;
    relatedRepoName: string;
    reason: string;
    severity: 'low' | 'medium' | 'high';
  }> = [];

  const repoMap = new Map(graph.repositories.map((r) => [r.repositoryId, r]));

  // Check for drift between connected repositories
  for (const edge of graph.edges) {
    const sourceRepo = repoMap.get(edge.sourceRepoId);
    const targetRepo = repoMap.get(edge.targetRepoId);

    if (!sourceRepo || !targetRepo) continue;

    // Alert if source has low health but high dependency
    if (sourceRepo.healthScore < 50 && edge.weight > 5) {
      alerts.push({
        repositoryId: edge.sourceRepoId,
        repositoryName: sourceRepo.name,
        relatedRepoId: edge.targetRepoId,
        relatedRepoName: targetRepo.name,
        reason: `Low documentation health (${sourceRepo.healthScore}%) but high dependency weight (${edge.weight})`,
        severity: 'high',
      });
    }

    // Alert if there's a dependency but target is poorly documented
    if (edge.type === 'depends_on' && targetRepo.healthScore < 40) {
      alerts.push({
        repositoryId: edge.sourceRepoId,
        repositoryName: sourceRepo.name,
        relatedRepoId: edge.targetRepoId,
        relatedRepoName: targetRepo.name,
        reason: `Depends on ${targetRepo.name} which has poor documentation (${targetRepo.healthScore}%)`,
        severity: 'medium',
      });
    }
  }

  return alerts;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate health score for a repository
 */
async function calculateRepoHealthScore(repositoryId: string): Promise<number> {
  const docs = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true, content: true },
  });

  if (docs.length === 0) return 0;

  let totalScore = 0;
  for (const doc of docs) {
    const content = doc.content || '';
    let docScore = 50; // Base score

    // Add points for content length
    if (content.length > 1000) docScore += 10;
    if (content.length > 5000) docScore += 10;

    // Add points for structure
    if (content.includes('##')) docScore += 10; // Has headings
    if (content.includes('```')) docScore += 10; // Has code blocks
    if (content.includes('[') && content.includes('](')) docScore += 10; // Has links

    totalScore += Math.min(docScore, 100);
  }

  return Math.round(totalScore / docs.length);
}

/**
 * Detect repository type based on metadata and technologies
 */
function detectRepositoryType(
  repo: { name: string; metadata: unknown },
  technologies: string[]
): RepoNode['type'] {
  const name = repo.name.toLowerCase();
  const techSet = new Set(technologies.map((t) => t.toLowerCase()));

  // Check for frontend patterns
  if (
    techSet.has('react') ||
    techSet.has('vue') ||
    techSet.has('angular') ||
    name.includes('frontend') ||
    name.includes('ui') ||
    name.includes('web')
  ) {
    return 'frontend';
  }

  // Check for library patterns
  if (
    name.includes('lib') ||
    name.includes('utils') ||
    name.includes('shared') ||
    name.includes('common')
  ) {
    return 'library';
  }

  // Check for infrastructure patterns
  if (
    name.includes('infra') ||
    name.includes('terraform') ||
    name.includes('k8s') ||
    name.includes('deploy') ||
    techSet.has('terraform') ||
    techSet.has('kubernetes')
  ) {
    return 'infrastructure';
  }

  // Check for service patterns
  if (
    name.includes('service') ||
    name.includes('api') ||
    name.includes('server') ||
    techSet.has('node') ||
    techSet.has('express') ||
    techSet.has('fastify')
  ) {
    return 'service';
  }

  return 'unknown';
}

/**
 * Calculate graph statistics
 */
function calculateGraphStats(repoNodes: RepoNode[], edges: GraphEdge[]): GraphStats {
  const totalRepos = repoNodes.length;
  const totalEdges = edges.length;
  const totalDocuments = repoNodes.reduce((sum, node) => sum + node.documentCount, 0);
  const avgHealth =
    totalRepos > 0
      ? Math.round(repoNodes.reduce((sum, node) => sum + node.healthScore, 0) / totalRepos)
      : 0;

  // Find most connected repository
  const connectionCounts = new Map<string, number>();
  for (const edge of edges) {
    connectionCounts.set(edge.sourceRepoId, (connectionCounts.get(edge.sourceRepoId) || 0) + 1);
    connectionCounts.set(edge.targetRepoId, (connectionCounts.get(edge.targetRepoId) || 0) + 1);
  }

  let mostConnected = '';
  let maxConnections = 0;
  for (const [repoId, count] of Array.from(connectionCounts.entries())) {
    if (count > maxConnections) {
      maxConnections = count;
      mostConnected = repoNodes.find((n) => n.repositoryId === repoId)?.name || '';
    }
  }

  // Find least documented repository
  const leastDoc = repoNodes.reduce((min, node) =>
    node.documentCount < min.documentCount ? node : min
  );

  return {
    totalRepositories: totalRepos,
    totalEdges,
    totalDocuments,
    averageHealthScore: avgHealth,
    mostConnected: mostConnected || 'N/A',
    leastDocumented: leastDoc?.name || 'N/A',
  };
}
