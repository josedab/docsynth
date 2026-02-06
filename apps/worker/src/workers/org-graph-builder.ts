/**
 * Organization Graph Builder Worker
 *
 * Builds a unified knowledge graph across all organization repositories,
 * showing service dependencies, shared APIs, and cross-repo documentation relationships.
 */

import { createWorker, QUEUE_NAMES, type OrgGraphBuilderJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import type { RepoNode, GraphEdge, ServiceCluster, GraphStats } from '../../../api/src/services/multi-repo-graph.service.js';

const log = createLogger('org-graph-builder-worker');

// Note: We can't import the service directly due to worker/api separation,
// so we'll implement the core logic here

interface OrgDocGraph {
  organizationId: string;
  repositories: RepoNode[];
  edges: GraphEdge[];
  clusters: ServiceCluster[];
  stats: GraphStats;
}

export function startOrgGraphBuilderWorker() {
  const worker = createWorker(
    QUEUE_NAMES.ORG_GRAPH_BUILDER,
    async (job) => {
      const data = job.data as OrgGraphBuilderJobData;
      const { organizationId } = data;

      log.info({ jobId: job.id, organizationId }, 'Starting org graph build');

      await job.updateProgress(5);

      try {
        // Verify organization exists
        const org = await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { id: true, name: true },
        });

        if (!org) {
          throw new Error(`Organization ${organizationId} not found`);
        }

        await job.updateProgress(10);

        // Step 1: Fetch all repositories for the organization
        log.info({ organizationId }, 'Fetching repositories');
        const repositories = await prisma.repository.findMany({
          where: { organizationId },
          include: {
            documents: {
              select: {
                id: true,
                type: true,
                content: true,
                path: true,
                metadata: true,
                title: true,
              },
            },
          },
        });

        log.info({ organizationId, repoCount: repositories.length }, 'Fetched repositories');
        await job.updateProgress(20);

        // Step 2: Build repository nodes
        log.info({ organizationId }, 'Building repository nodes');
        const repoNodes: RepoNode[] = [];

        for (let i = 0; i < repositories.length; i++) {
          const repo = repositories[i];
          if (!repo) continue;

          const metadata = (repo.metadata as Record<string, unknown>) || {};
          const technologies = (metadata.technologies as string[]) || [];
          const exports = (metadata.exports as string[]) || [];

          // Calculate health score
          const healthScore = calculateRepoHealthScore(repo.documents);

          // Detect repository type
          const repoType = detectRepositoryType(repo.name, technologies);

          // Extract public APIs/exports from package.json
          const packageJsonDoc = repo.documents.find((d) => d.path.endsWith('package.json'));
          const detectedExports = packageJsonDoc
            ? extractExportsFromPackageJson(packageJsonDoc.content || '')
            : [];

          repoNodes.push({
            repositoryId: repo.id,
            name: repo.name,
            type: repoType,
            documentCount: repo.documents.length,
            healthScore,
            technologies,
            exports: exports.length > 0 ? exports : detectedExports,
          });

          await job.updateProgress(20 + Math.floor((i / repositories.length) * 30));
        }

        log.info({ organizationId, nodeCount: repoNodes.length }, 'Built repository nodes');

        // Step 3: Detect dependencies and build edges
        log.info({ organizationId }, 'Detecting dependencies');
        const edges: GraphEdge[] = [];

        for (let i = 0; i < repositories.length; i++) {
          const sourceRepo = repositories[i];
          if (!sourceRepo) continue;

          for (let j = i + 1; j < repositories.length; j++) {
            const targetRepo = repositories[j];
            if (!targetRepo) continue;

            // Analyze dependencies between repos
            const detectedEdges = detectRepositoryDependencies(
              sourceRepo,
              targetRepo,
              repoNodes
            );

            edges.push(...detectedEdges);
          }

          await job.updateProgress(50 + Math.floor((i / repositories.length) * 20));
        }

        log.info({ organizationId, edgeCount: edges.length }, 'Detected dependencies');

        // Step 4: Cluster repositories by similarity/dependency
        log.info({ organizationId }, 'Clustering repositories');
        const clusters = clusterRepositories(repoNodes, edges);

        log.info({ organizationId, clusterCount: clusters.length }, 'Clustered repositories');
        await job.updateProgress(75);

        // Step 5: Calculate statistics
        log.info({ organizationId }, 'Calculating statistics');
        const stats = calculateGraphStats(repoNodes, edges);

        await job.updateProgress(85);

        // Step 6: Build final graph
        const graph: OrgDocGraph = {
          organizationId,
          repositories: repoNodes,
          edges,
          clusters,
          stats,
        };

        // Step 7: Cache the graph
        // TODO: Store in Redis or cache service for production use
        // For now, we'll just log that the graph was built successfully
        log.info({ organizationId }, 'Graph built (caching not implemented yet)');

        await job.updateProgress(100);

        log.info(
          {
            organizationId,
            repoCount: repoNodes.length,
            edgeCount: edges.length,
            clusterCount: clusters.length,
          },
          'Org graph build completed'
        );

        // Return void as required by JobProcessor
        return;
      } catch (error) {
        log.error({ error, organizationId }, 'Org graph build failed');
        throw error;
      }
    },
    { concurrency: 1 }
  );

  log.info('Org graph builder worker started');
  return worker;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate health score for a repository based on its documents
 */
function calculateRepoHealthScore(
  documents: Array<{ content: string | null }>
): number {
  if (documents.length === 0) return 0;

  let totalScore = 0;

  for (const doc of documents) {
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

  return Math.round(totalScore / documents.length);
}

/**
 * Detect repository type based on name and technologies
 */
function detectRepositoryType(
  repoName: string,
  technologies: string[]
): RepoNode['type'] {
  const name = repoName.toLowerCase();
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
 * Extract exports from package.json
 */
function extractExportsFromPackageJson(content: string): string[] {
  try {
    const packageJson = JSON.parse(content);
    const exports: string[] = [];

    // Get package name
    if (packageJson.name) {
      exports.push(packageJson.name);
    }

    // Get exports field if available
    if (packageJson.exports && typeof packageJson.exports === 'object') {
      for (const key of Object.keys(packageJson.exports)) {
        if (key !== '.') {
          exports.push(key);
        }
      }
    }

    // Get main entry point
    if (packageJson.main) {
      exports.push(packageJson.main);
    }

    return exports;
  } catch {
    return [];
  }
}

/**
 * Detect dependencies between two repositories
 */
function detectRepositoryDependencies(
  sourceRepo: {
    id: string;
    name: string;
    documents: Array<{ content: string | null; path: string }>;
  },
  targetRepo: {
    id: string;
    name: string;
    documents: Array<{ content: string | null; path: string }>;
    metadata: unknown;
  },
  repoNodes: RepoNode[]
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const targetNode = repoNodes.find((n) => n.repositoryId === targetRepo.id);
  const targetExports = targetNode?.exports || [];

  let dependencyWeight = 0;
  let importWeight = 0;
  let relatedDocsWeight = 0;
  const details: string[] = [];

  // Check for package.json dependencies
  const packageJsonDoc = sourceRepo.documents.find((d) => d.path.endsWith('package.json'));
  if (packageJsonDoc && packageJsonDoc.content) {
    try {
      const packageJson = JSON.parse(packageJsonDoc.content);
      const allDeps = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
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
  for (const doc of sourceRepo.documents) {
    const content = doc.content || '';

    // Check for imports of target repo exports
    for (const exportedItem of targetExports) {
      const importPattern = new RegExp(`import.*from.*['"].*${exportedItem}.*['"]`, 'g');
      const requirePattern = new RegExp(`require\\(['"].*${exportedItem}.*['"]\\)`, 'g');

      const importMatches = content.match(importPattern) || [];
      const requireMatches = content.match(requirePattern) || [];

      if (importMatches.length > 0 || requireMatches.length > 0) {
        importWeight += importMatches.length + requireMatches.length;
      }
    }
  }

  // Check for cross-references in documentation
  for (const sourceDoc of sourceRepo.documents) {
    const content = (sourceDoc.content || '').toLowerCase();

    // Check for mentions of target repo
    const targetNameMatches = content.match(new RegExp(targetRepo.name.toLowerCase(), 'g')) || [];
    relatedDocsWeight += targetNameMatches.length;

    // Check for links to target repo docs
    for (const targetDoc of targetRepo.documents) {
      const targetPath = targetDoc.path.toLowerCase();
      if (content.includes(targetPath)) {
        relatedDocsWeight += 2; // Weight links more than mentions
      }
    }
  }

  // Create edges based on detected relationships
  if (dependencyWeight > 0) {
    edges.push({
      sourceRepoId: sourceRepo.id,
      targetRepoId: targetRepo.id,
      type: 'depends_on',
      weight: dependencyWeight,
      details: details.join(', '),
    });
  }

  if (importWeight > 0) {
    edges.push({
      sourceRepoId: sourceRepo.id,
      targetRepoId: targetRepo.id,
      type: 'imports_from',
      weight: Math.min(importWeight, 10), // Cap weight at 10
      details: `${importWeight} import statements detected`,
    });
  }

  if (relatedDocsWeight > 2) {
    // Only create edge if significant relationship
    edges.push({
      sourceRepoId: sourceRepo.id,
      targetRepoId: targetRepo.id,
      type: 'related_docs',
      weight: Math.min(relatedDocsWeight, 10),
      details: `${relatedDocsWeight} cross-references found`,
    });
  }

  return edges;
}

/**
 * Cluster repositories by similarity and dependencies
 */
function clusterRepositories(repoNodes: RepoNode[], edges: GraphEdge[]): ServiceCluster[] {
  const clusters: ServiceCluster[] = [];
  const clustered = new Set<string>();

  // Cluster 1: Group by repository type
  const typeGroups = new Map<string, string[]>();
  for (const node of repoNodes) {
    const existing = typeGroups.get(node.type) || [];
    existing.push(node.repositoryId);
    typeGroups.set(node.type, existing);
  }

  // Create clusters for each type (only if more than 1 repo)
  for (const [type, repoIds] of Array.from(typeGroups.entries())) {
    if (repoIds.length > 1) {
      clusters.push({
        id: `cluster-type-${type}`,
        name: `${type.charAt(0).toUpperCase() + type.slice(1)} Repositories`,
        repositoryIds: repoIds,
        description: `Group of ${type} repositories`,
      });
      repoIds.forEach((id) => clustered.add(id));
    }
  }

  // Cluster 2: Find strongly connected components (high dependency)
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

  // Find connected components using DFS
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

    // Only create cluster for multi-repo components
    if (component.length > 1) {
      clusters.push({
        id: `cluster-connected-${clusterIndex}`,
        name: `Connected Service Group ${clusterIndex + 1}`,
        repositoryIds: component,
        description: `Tightly coupled repositories with strong dependencies`,
      });
      clusterIndex++;
    }
  }

  // Cluster 3: Technology-based clustering
  const techGroups = new Map<string, string[]>();
  for (const node of repoNodes) {
    for (const tech of node.technologies) {
      const existing = techGroups.get(tech) || [];
      existing.push(node.repositoryId);
      techGroups.set(tech, existing);
    }
  }

  // Create tech clusters for common technologies (only if 3+ repos)
  for (const [tech, repoIds] of Array.from(techGroups.entries())) {
    if (repoIds.length >= 3) {
      clusters.push({
        id: `cluster-tech-${tech.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        name: `${tech} Stack`,
        repositoryIds: repoIds,
        description: `Repositories using ${tech}`,
      });
    }
  }

  return clusters;
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
  let leastDoc = repoNodes[0];
  for (const node of repoNodes) {
    if (!leastDoc || node.documentCount < leastDoc.documentCount) {
      leastDoc = node;
    }
  }

  return {
    totalRepositories: totalRepos,
    totalEdges,
    totalDocuments,
    averageHealthScore: avgHealth,
    mostConnected: mostConnected || 'N/A',
    leastDocumented: leastDoc?.name || 'N/A',
  };
}
