/**
 * Multi-Repo Knowledge Graph V2 Service
 *
 * Cross-repository documentation that understands relationships between
 * microservices, shared libraries, and dependencies.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('multi-repo-graph-v2-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export type GraphNodeType =
  | 'repository'
  | 'service'
  | 'api_endpoint'
  | 'data_model'
  | 'shared_lib'
  | 'config';
export type GraphEdgeType =
  | 'depends_on'
  | 'calls'
  | 'extends'
  | 'produces'
  | 'consumes'
  | 'configures';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  repositoryId: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: GraphEdgeType;
  label?: string;
  metadata: Record<string, unknown>;
}

export interface KnowledgeGraphResult {
  organizationId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { totalNodes: number; totalEdges: number; repositories: number };
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Build a knowledge graph for an organization's repositories
 */
export async function buildKnowledgeGraph(
  organizationId: string,
  repositoryIds?: string[]
): Promise<KnowledgeGraphResult> {
  const whereClause =
    repositoryIds && repositoryIds.length > 0
      ? { organizationId, id: { in: repositoryIds } }
      : { organizationId };

  const repositories = await prisma.repository.findMany({
    where: whereClause,
    select: { id: true, fullName: true, name: true, config: true },
  });

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Create repository nodes
  for (const repo of repositories) {
    nodes.push({
      id: `repo-${repo.id}`,
      type: 'repository',
      label: repo.name,
      repositoryId: repo.id,
      metadata: { fullName: repo.fullName },
    });

    // Extract API endpoints from documents
    const documents = await prisma.document.findMany({
      where: { repositoryId: repo.id },
      select: { id: true, path: true, title: true, content: true, type: true },
    });

    for (const doc of documents) {
      if (!doc.content) continue;

      // Detect API endpoints
      const endpoints = extractApiEndpoints(doc.content);
      for (const ep of endpoints) {
        const nodeId = `api-${repo.id}-${ep.method}-${ep.path}`;
        nodes.push({
          id: nodeId,
          type: 'api_endpoint',
          label: `${ep.method} ${ep.path}`,
          repositoryId: repo.id,
          metadata: { method: ep.method, path: ep.path, documentId: doc.id },
        });
        edges.push({
          id: `edge-${nodeId}-${repo.id}`,
          sourceId: `repo-${repo.id}`,
          targetId: nodeId,
          type: 'produces',
          metadata: {},
        });
      }

      // Detect data models
      const models = extractDataModels(doc.content);
      for (const model of models) {
        const nodeId = `model-${repo.id}-${model}`;
        if (!nodes.find((n) => n.id === nodeId)) {
          nodes.push({
            id: nodeId,
            type: 'data_model',
            label: model,
            repositoryId: repo.id,
            metadata: { documentId: doc.id },
          });
        }
      }
    }
  }

  // Detect cross-repo dependencies
  for (const repo of repositories) {
    const config = repo.config as Record<string, unknown> | null;
    const deps = config?.dependencies as Record<string, string> | undefined;

    if (deps) {
      for (const depName of Object.keys(deps)) {
        const depRepo = repositories.find((r) => r.name === depName);
        if (depRepo) {
          edges.push({
            id: `dep-${repo.id}-${depRepo.id}`,
            sourceId: `repo-${repo.id}`,
            targetId: `repo-${depRepo.id}`,
            type: 'depends_on',
            label: `depends on ${depName}`,
            metadata: {},
          });
        }
      }
    }
  }

  // Store snapshot
  await db.knowledgeGraphSnapshot.create({
    data: {
      organizationId,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      repositories: repositories.length,
      metadata: { repositoryIds: repositories.map((r) => r.id) },
    },
  });

  // Persist nodes and edges
  await persistGraphData(organizationId, nodes, edges);

  return {
    organizationId,
    nodes,
    edges,
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      repositories: repositories.length,
    },
  };
}

/**
 * Get the current knowledge graph for an organization
 */
export async function getKnowledgeGraph(organizationId: string): Promise<KnowledgeGraphResult> {
  const nodesData = await db.knowledgeGraphNode.findMany({
    where: { organizationId },
  });

  const edgesData = await db.knowledgeGraphEdge.findMany({
    where: { organizationId },
  });

  const nodes: GraphNode[] = nodesData.map((n: Record<string, unknown>) => ({
    id: n.id as string,
    type: n.nodeType as GraphNodeType,
    label: n.label as string,
    repositoryId: n.repositoryId as string,
    metadata: (n.metadata as Record<string, unknown>) || {},
  }));

  const edges: GraphEdge[] = edgesData.map((e: Record<string, unknown>) => ({
    id: e.id as string,
    sourceId: e.sourceNodeId as string,
    targetId: e.targetNodeId as string,
    type: e.edgeType as GraphEdgeType,
    label: e.label as string | undefined,
    metadata: (e.metadata as Record<string, unknown>) || {},
  }));

  const repoIds = new Set(nodes.map((n) => n.repositoryId));

  return {
    organizationId,
    nodes,
    edges,
    stats: { totalNodes: nodes.length, totalEdges: edges.length, repositories: repoIds.size },
  };
}

/**
 * Get graph snapshots history
 */
export async function getGraphSnapshots(organizationId: string, limit: number = 20) {
  return db.knowledgeGraphSnapshot.findMany({
    where: { organizationId },
    orderBy: { generatedAt: 'desc' },
    take: limit,
  });
}

/**
 * Search nodes in the graph
 */
export async function searchGraphNodes(
  organizationId: string,
  query: string,
  nodeType?: GraphNodeType
) {
  const where: Record<string, unknown> = {
    organizationId,
    label: { contains: query, mode: 'insensitive' },
  };
  if (nodeType) where.nodeType = nodeType;

  return db.knowledgeGraphNode.findMany({ where, take: 50 });
}

// ============================================================================
// Utility Functions
// ============================================================================

function extractApiEndpoints(content: string): Array<{ method: string; path: string }> {
  const endpoints: Array<{ method: string; path: string }> = [];
  const regex = /(GET|POST|PUT|PATCH|DELETE)\s+(\/[a-zA-Z0-9/_{}:-]+)/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match[1] && match[2]) {
      endpoints.push({ method: match[1], path: match[2] });
    }
  }
  return endpoints;
}

function extractDataModels(content: string): string[] {
  const models: string[] = [];
  // Look for interface/type/model definitions in code blocks
  const modelRegex = /(?:interface|type|model|class)\s+([A-Z][a-zA-Z0-9]+)/g;
  let match;

  while ((match = modelRegex.exec(content)) !== null) {
    if (match[1]) models.push(match[1]);
  }
  return [...new Set(models)];
}

async function persistGraphData(
  organizationId: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
): Promise<void> {
  // Clear existing data for this org
  await db.knowledgeGraphEdge.deleteMany({ where: { organizationId } });
  await db.knowledgeGraphNode.deleteMany({ where: { organizationId } });

  // Insert nodes
  for (const node of nodes) {
    try {
      await db.knowledgeGraphNode.create({
        data: {
          id: node.id,
          organizationId,
          repositoryId: node.repositoryId,
          nodeType: node.type,
          label: node.label,
          metadata: node.metadata,
        },
      });
    } catch (error) {
      log.error({ error, nodeId: node.id }, 'Failed to persist graph node');
    }
  }

  // Insert edges
  for (const edge of edges) {
    try {
      await db.knowledgeGraphEdge.create({
        data: {
          id: edge.id,
          organizationId,
          sourceNodeId: edge.sourceId,
          targetNodeId: edge.targetId,
          edgeType: edge.type,
          label: edge.label,
          metadata: edge.metadata,
        },
      });
    } catch (error) {
      log.error({ error, edgeId: edge.id }, 'Failed to persist graph edge');
    }
  }
}
