import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import type { GraphVisualization, GraphNode, GraphEdge } from '@docsynth/types';
import {
  getEntityNeighbors,
  calculateCosineSimilarity,
  detectCommunities,
  getClusterColor,
  getEntityColor,
} from '../services/knowledge-graph.js';

const app = new Hono();

// Build/rebuild knowledge graph for a repository
app.post('/build', requireAuth, requireOrgAccess, rateLimit('knowledgeGraph'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ repositoryId: string; fullRebuild?: boolean }>();

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  const job = await addJob(QUEUE_NAMES.KNOWLEDGE_GRAPH, {
    repositoryId: body.repositoryId,
    fullRebuild: body.fullRebuild ?? false,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Knowledge graph build started',
    },
  });
});

// Get knowledge graph metadata and status
app.get('/:repositoryId/status', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const meta = await prisma.knowledgeGraphMeta.findUnique({
    where: { repositoryId },
  });

  return c.json({
    success: true,
    data: meta || {
      repositoryId,
      status: 'not-built',
      entityCount: 0,
      relationCount: 0,
    },
  });
});

// Get graph visualization data
app.get('/:repositoryId/visualize', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { entityTypes, maxNodes, includeOrphans } = c.req.query();

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Build entity filter
  const entityFilter: Record<string, unknown> = { repositoryId };
  if (entityTypes) {
    entityFilter.type = { in: entityTypes.split(',') };
  }

  const limit = maxNodes ? parseInt(maxNodes, 10) : 100;

  // Get entities with their relation counts for sizing
  const entities = await prisma.knowledgeEntity.findMany({
    where: entityFilter,
    take: limit,
    include: {
      _count: {
        select: {
          outgoingEdges: true,
          incomingEdges: true,
        },
      },
    },
  });

  const entityIds = entities.map((e) => e.id);

  // Get relations between these entities
  const relations = await prisma.knowledgeRelation.findMany({
    where: {
      repositoryId,
      fromEntityId: { in: entityIds },
      toEntityId: { in: entityIds },
    },
  });

  // Build visualization data
  const nodes: GraphNode[] = entities.map((entity) => ({
    id: entity.id,
    label: entity.name,
    type: entity.type as GraphNode['type'],
    size: Math.min(30, 10 + (entity._count.outgoingEdges + entity._count.incomingEdges) * 2),
    color: getEntityColor(entity.type),
    metadata: {
      description: entity.description,
      filePath: entity.filePath,
      lineStart: entity.lineStart,
    },
  }));

  const edges: GraphEdge[] = relations.map((rel) => ({
    id: rel.id,
    source: rel.fromEntityId,
    target: rel.toEntityId,
    label: rel.relationship as GraphEdge['label'],
    weight: rel.weight,
  }));

  // Filter orphan nodes if requested
  const finalNodes = includeOrphans === 'false'
    ? nodes.filter((n) => edges.some((e) => e.source === n.id || e.target === n.id))
    : nodes;

  const visualization: GraphVisualization = {
    nodes: finalNodes,
    edges,
  };

  return c.json({
    success: true,
    data: visualization,
  });
});

// Search entities in knowledge graph
app.get('/:repositoryId/search', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const query = c.req.query('q');
  const entityTypes = c.req.query('types');
  const limit = c.req.query('limit');
  const orgId = c.get('organizationId');

  if (!query) {
    throw new ValidationError('Query parameter "q" is required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const whereClause: Record<string, unknown> = {
    repositoryId,
    OR: [
      { name: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
    ],
  };

  if (entityTypes) {
    whereClause.type = { in: entityTypes.split(',') };
  }

  const entities = await prisma.knowledgeEntity.findMany({
    where: whereClause,
    take: limit ? parseInt(limit, 10) : 20,
    include: {
      outgoingEdges: {
        take: 5,
        include: {
          toEntity: {
            select: { id: true, name: true, type: true },
          },
        },
      },
      incomingEdges: {
        take: 5,
        include: {
          fromEntity: {
            select: { id: true, name: true, type: true },
          },
        },
      },
    },
  });

  const results = entities.map((entity) => ({
    entity: {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      description: entity.description,
      filePath: entity.filePath,
      lineStart: entity.lineStart,
    },
    relatedEntities: [
      ...entity.outgoingEdges.map((e) => ({
        entity: e.toEntity,
        relationship: e.relationship,
        direction: 'outgoing' as const,
      })),
      ...entity.incomingEdges.map((e) => ({
        entity: e.fromEntity,
        relationship: e.relationship,
        direction: 'incoming' as const,
      })),
    ],
  }));

  return c.json({
    success: true,
    data: {
      query,
      results,
      total: results.length,
    },
  });
});

// Get entity details with all connections
app.get('/:repositoryId/entity/:entityId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const entityId = c.req.param('entityId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const entity = await prisma.knowledgeEntity.findFirst({
    where: { id: entityId, repositoryId },
    include: {
      outgoingEdges: {
        include: {
          toEntity: true,
        },
      },
      incomingEdges: {
        include: {
          fromEntity: true,
        },
      },
    },
  });

  if (!entity) {
    throw new NotFoundError('Entity', entityId);
  }

  // Get related documents
  const documentIds = entity.documentIds as string[];
  const documents = documentIds.length > 0
    ? await prisma.document.findMany({
        where: { id: { in: documentIds } },
        select: { id: true, path: true, title: true, type: true },
      })
    : [];

  return c.json({
    success: true,
    data: {
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.description,
        filePath: entity.filePath,
        lineStart: entity.lineStart,
        lineEnd: entity.lineEnd,
        metadata: entity.metadata,
      },
      connections: {
        outgoing: entity.outgoingEdges.map((e) => ({
          relationship: e.relationship,
          weight: e.weight,
          entity: {
            id: e.toEntity.id,
            name: e.toEntity.name,
            type: e.toEntity.type,
          },
        })),
        incoming: entity.incomingEdges.map((e) => ({
          relationship: e.relationship,
          weight: e.weight,
          entity: {
            id: e.fromEntity.id,
            name: e.fromEntity.name,
            type: e.fromEntity.type,
          },
        })),
      },
      documents,
    },
  });
});

// Traverse graph from a starting entity
app.get('/:repositoryId/traverse/:entityId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const entityId = c.req.param('entityId');
  const direction = c.req.query('direction') || 'both';
  const maxDepth = parseInt(c.req.query('depth') || '2', 10);
  const relationTypes = c.req.query('relations');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const startEntity = await prisma.knowledgeEntity.findFirst({
    where: { id: entityId, repositoryId },
  });

  if (!startEntity) {
    throw new NotFoundError('Entity', entityId);
  }

  // BFS traversal
  const visited = new Set<string>([entityId]);
  const nodes: GraphNode[] = [{
    id: startEntity.id,
    label: startEntity.name,
    type: startEntity.type as GraphNode['type'],
    size: 20,
    color: getEntityColor(startEntity.type),
  }];
  const edges: GraphEdge[] = [];
  let currentLevel = [entityId];

  for (let depth = 0; depth < maxDepth && currentLevel.length > 0; depth++) {
    const nextLevel: string[] = [];

    const relationFilter: Record<string, unknown> = { repositoryId };
    if (relationTypes) {
      relationFilter.relationship = { in: relationTypes.split(',') };
    }

    for (const nodeId of currentLevel) {
      const relations = await prisma.knowledgeRelation.findMany({
        where: {
          ...relationFilter,
          OR: [
            ...(direction !== 'incoming' ? [{ fromEntityId: nodeId }] : []),
            ...(direction !== 'outgoing' ? [{ toEntityId: nodeId }] : []),
          ],
        },
        include: {
          fromEntity: true,
          toEntity: true,
        },
      });

      for (const rel of relations) {
        const neighborId = rel.fromEntityId === nodeId ? rel.toEntityId : rel.fromEntityId;
        const neighbor = rel.fromEntityId === nodeId ? rel.toEntity : rel.fromEntity;

        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          nextLevel.push(neighborId);

          nodes.push({
            id: neighbor.id,
            label: neighbor.name,
            type: neighbor.type as GraphNode['type'],
            size: 15,
            color: getEntityColor(neighbor.type),
          });
        }

        // Add edge if not already added
        const edgeKey = `${rel.fromEntityId}-${rel.toEntityId}-${rel.relationship}`;
        if (!edges.some((e) => `${e.source}-${e.target}-${e.label}` === edgeKey)) {
          edges.push({
            id: rel.id,
            source: rel.fromEntityId,
            target: rel.toEntityId,
            label: rel.relationship as GraphEdge['label'],
            weight: rel.weight,
          });
        }
      }
    }

    currentLevel = nextLevel;
  }

  return c.json({
    success: true,
    data: {
      startEntity: entityId,
      depth: maxDepth,
      direction,
      nodes,
      edges,
    },
  });
});

// Get graph statistics
app.get('/:repositoryId/stats', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const [meta, entityTypeStats, relationTypeStats] = await Promise.all([
    prisma.knowledgeGraphMeta.findUnique({ where: { repositoryId } }),
    prisma.knowledgeEntity.groupBy({
      by: ['type'],
      where: { repositoryId },
      _count: true,
    }),
    prisma.knowledgeRelation.groupBy({
      by: ['relationship'],
      where: { repositoryId },
      _count: true,
    }),
  ]);

  return c.json({
    success: true,
    data: {
      meta: meta || { status: 'not-built', entityCount: 0, relationCount: 0 },
      entityTypes: entityTypeStats.map((s) => ({ type: s.type, count: s._count })),
      relationTypes: relationTypeStats.map((s) => ({ type: s.relationship, count: s._count })),
    },
  });
});

// ============================================================================
// Interactive Knowledge Graph Explorer (Feature 2)
// ============================================================================

// Get clustered graph view with automatic community detection
app.get('/:repositoryId/clusters', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { minClusterSize } = c.req.query();

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Get all entities and relations
  const [entities, relations] = await Promise.all([
    prisma.knowledgeEntity.findMany({
      where: { repositoryId },
    }),
    prisma.knowledgeRelation.findMany({
      where: { repositoryId },
    }),
  ]);

  // Build adjacency list
  const adjacency = new Map<string, Set<string>>();
  for (const entity of entities) {
    adjacency.set(entity.id, new Set());
  }
  for (const rel of relations) {
    adjacency.get(rel.fromEntityId)?.add(rel.toEntityId);
    adjacency.get(rel.toEntityId)?.add(rel.fromEntityId);
  }

  // Simple community detection (connected components with type grouping)
  const clusters = detectCommunities(entities, adjacency, parseInt(minClusterSize || '3', 10));

  // Build visualization data
  const nodes: GraphNode[] = entities.map((entity) => {
    const cluster = clusters.find(c => c.nodeIds.includes(entity.id));
    return {
      id: entity.id,
      label: entity.name,
      type: entity.type as GraphNode['type'],
      size: 15,
      color: cluster ? getClusterColor(cluster.id) : getEntityColor(entity.type),
      metadata: {
        clusterId: cluster?.id,
        description: entity.description,
        filePath: entity.filePath,
      },
    };
  });

  const edges: GraphEdge[] = relations.map((rel) => ({
    id: rel.id,
    source: rel.fromEntityId,
    target: rel.toEntityId,
    label: rel.relationship as GraphEdge['label'],
    weight: rel.weight,
  }));

  return c.json({
    success: true,
    data: {
      nodes,
      edges,
      clusters,
    },
  });
});

// Find shortest path between two entities
app.get('/:repositoryId/path/:fromId/:toId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const fromId = c.req.param('fromId');
  const toId = c.req.param('toId');
  const orgId = c.get('organizationId');
  const maxDepth = parseInt(c.req.query('maxDepth') || '6', 10);

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // BFS to find shortest path
  const visited = new Set<string>([fromId]);
  const queue: { id: string; path: string[] }[] = [{ id: fromId, path: [fromId] }];
  let foundPath: string[] | null = null;

  while (queue.length > 0 && !foundPath) {
    const current = queue.shift()!;
    
    if (current.path.length > maxDepth) continue;

    const relations = await prisma.knowledgeRelation.findMany({
      where: {
        repositoryId,
        OR: [
          { fromEntityId: current.id },
          { toEntityId: current.id },
        ],
      },
    });

    for (const rel of relations) {
      const neighborId = rel.fromEntityId === current.id ? rel.toEntityId : rel.fromEntityId;
      
      if (neighborId === toId) {
        foundPath = [...current.path, toId];
        break;
      }

      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push({ id: neighborId, path: [...current.path, neighborId] });
      }
    }
  }

  if (!foundPath) {
    return c.json({
      success: true,
      data: {
        found: false,
        message: 'No path found between entities within depth limit',
      },
    });
  }

  // Fetch entities in path
  const pathEntities = await prisma.knowledgeEntity.findMany({
    where: { id: { in: foundPath } },
  });

  // Fetch relations between consecutive path nodes
  const pathRelations = [];
  for (let i = 0; i < foundPath.length - 1; i++) {
    const rel = await prisma.knowledgeRelation.findFirst({
      where: {
        repositoryId,
        OR: [
          { fromEntityId: foundPath[i], toEntityId: foundPath[i + 1] },
          { fromEntityId: foundPath[i + 1], toEntityId: foundPath[i] },
        ],
      },
    });
    if (rel) pathRelations.push(rel);
  }

  // Order entities by path
  const orderedEntities = foundPath.map(id => 
    pathEntities.find(e => e.id === id)
  ).filter(Boolean);

  return c.json({
    success: true,
    data: {
      found: true,
      pathLength: foundPath.length,
      entities: orderedEntities.map(e => ({
        id: e!.id,
        name: e!.name,
        type: e!.type,
        description: e!.description,
      })),
      relations: pathRelations.map(r => ({
        from: r.fromEntityId,
        to: r.toEntityId,
        relationship: r.relationship,
      })),
    },
  });
});

// Get entity neighborhood for focus view
app.get('/:repositoryId/entity/:entityId/neighborhood', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const entityId = c.req.param('entityId');
  const orgId = c.get('organizationId');
  const depth = parseInt(c.req.query('depth') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const centralEntity = await prisma.knowledgeEntity.findFirst({
    where: { id: entityId, repositoryId },
  });

  if (!centralEntity) {
    throw new NotFoundError('Entity', entityId);
  }

  // Collect neighborhood entities
  const visited = new Set<string>([entityId]);
  const nodes: GraphNode[] = [{
    id: centralEntity.id,
    label: centralEntity.name,
    type: centralEntity.type as GraphNode['type'],
    size: 30, // Larger for central node
    color: getEntityColor(centralEntity.type),
    metadata: {
      isCentral: true,
      description: centralEntity.description,
    },
  }];
  const edges: GraphEdge[] = [];

  let currentLevel = [entityId];

  for (let d = 0; d < depth && nodes.length < limit; d++) {
    const nextLevel: string[] = [];

    for (const nodeId of currentLevel) {
      const relations = await prisma.knowledgeRelation.findMany({
        where: {
          repositoryId,
          OR: [
            { fromEntityId: nodeId },
            { toEntityId: nodeId },
          ],
        },
        include: {
          fromEntity: true,
          toEntity: true,
        },
        take: Math.floor((limit - nodes.length) / currentLevel.length),
      });

      for (const rel of relations) {
        const neighborId = rel.fromEntityId === nodeId ? rel.toEntityId : rel.fromEntityId;
        const neighbor = rel.fromEntityId === nodeId ? rel.toEntity : rel.fromEntity;

        // Add edge
        const edgeExists = edges.some(
          e => (e.source === rel.fromEntityId && e.target === rel.toEntityId) ||
               (e.source === rel.toEntityId && e.target === rel.fromEntityId)
        );
        if (!edgeExists) {
          edges.push({
            id: rel.id,
            source: rel.fromEntityId,
            target: rel.toEntityId,
            label: rel.relationship as GraphEdge['label'],
            weight: rel.weight,
          });
        }

        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          nextLevel.push(neighborId);

          nodes.push({
            id: neighbor.id,
            label: neighbor.name,
            type: neighbor.type as GraphNode['type'],
            size: 20 - (d * 3), // Smaller nodes further from center
            color: getEntityColor(neighbor.type),
            metadata: {
              distance: d + 1,
              description: neighbor.description,
            },
          });

          if (nodes.length >= limit) break;
        }
      }
      if (nodes.length >= limit) break;
    }

    currentLevel = nextLevel;
  }

  return c.json({
    success: true,
    data: {
      central: {
        id: centralEntity.id,
        name: centralEntity.name,
        type: centralEntity.type,
      },
      nodes,
      edges,
      stats: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        maxDepthReached: depth,
      },
    },
  });
});

// Get related documents for an entity
app.get('/:repositoryId/entity/:entityId/documents', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const entityId = c.req.param('entityId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const entity = await prisma.knowledgeEntity.findFirst({
    where: { id: entityId, repositoryId },
  });

  if (!entity) {
    throw new NotFoundError('Entity', entityId);
  }

  const documentIds = entity.documentIds as string[];
  
  const documents = documentIds.length > 0
    ? await prisma.document.findMany({
        where: { id: { in: documentIds } },
        select: {
          id: true,
          path: true,
          title: true,
          type: true,
          updatedAt: true,
        },
      })
    : [];

  // Also find documents that mention this entity
  const mentioningDocs = await prisma.document.findMany({
    where: {
      repositoryId,
      content: { contains: entity.name },
      id: { notIn: documentIds },
    },
    select: {
      id: true,
      path: true,
      title: true,
      type: true,
      updatedAt: true,
    },
    take: 10,
  });

  return c.json({
    success: true,
    data: {
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
      },
      linkedDocuments: documents,
      mentioningDocuments: mentioningDocs,
    },
  });
});

// Get graph similarity between two entities
app.get('/:repositoryId/similarity/:entityA/:entityB', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const entityAId = c.req.param('entityA');
  const entityBId = c.req.param('entityB');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const [entityA, entityB] = await Promise.all([
    prisma.knowledgeEntity.findFirst({ where: { id: entityAId, repositoryId } }),
    prisma.knowledgeEntity.findFirst({ where: { id: entityBId, repositoryId } }),
  ]);

  if (!entityA || !entityB) {
    throw new NotFoundError('Entity', !entityA ? entityAId : entityBId);
  }

  // Calculate Jaccard similarity based on shared neighbors
  const [neighborsA, neighborsB] = await Promise.all([
    getEntityNeighbors(repositoryId, entityAId),
    getEntityNeighbors(repositoryId, entityBId),
  ]);

  const setA = new Set(neighborsA);
  const setB = new Set(neighborsB);
  const intersection = [...setA].filter(x => setB.has(x));
  const union = new Set([...setA, ...setB]);

  const jaccardSimilarity = union.size > 0 ? intersection.length / union.size : 0;

  // Calculate cosine similarity if embeddings exist
  let cosineSimilarity: number | null = null;
  if (entityA.embedding?.length && entityB.embedding?.length) {
    const embA = entityA.embedding as number[];
    const embB = entityB.embedding as number[];
    cosineSimilarity = calculateCosineSimilarity(embA, embB);
  }

  return c.json({
    success: true,
    data: {
      entityA: { id: entityA.id, name: entityA.name, type: entityA.type },
      entityB: { id: entityB.id, name: entityB.name, type: entityB.type },
      structuralSimilarity: jaccardSimilarity,
      semanticSimilarity: cosineSimilarity,
      sharedNeighbors: intersection.length,
      totalNeighborsA: neighborsA.length,
      totalNeighborsB: neighborsB.length,
    },
  });
});

export { app as knowledgeGraphRoutes };
