import { prisma } from '@docsynth/database';

// ============================================================================
// Types
// ============================================================================

export interface GraphCluster {
  id: string;
  label: string;
  nodeIds: string[];
}

// ============================================================================
// Graph Operations Service
// ============================================================================

export async function getEntityNeighbors(repositoryId: string, entityId: string): Promise<string[]> {
  const relations = await prisma.knowledgeRelation.findMany({
    where: {
      repositoryId,
      OR: [
        { fromEntityId: entityId },
        { toEntityId: entityId },
      ],
    },
  });

  const neighbors = new Set<string>();
  for (const rel of relations) {
    neighbors.add(rel.fromEntityId === entityId ? rel.toEntityId : rel.fromEntityId);
  }
  return [...neighbors];
}

export function calculateCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dotProduct / denominator : 0;
}

export function detectCommunities(
  entities: { id: string; type: string; name: string }[],
  adjacency: Map<string, Set<string>>,
  minSize: number
): GraphCluster[] {
  const visited = new Set<string>();
  const clusters: GraphCluster[] = [];
  let clusterId = 0;

  // Group by type first, then by connectivity
  const byType = new Map<string, string[]>();
  for (const entity of entities) {
    const list = byType.get(entity.type) || [];
    list.push(entity.id);
    byType.set(entity.type, list);
  }

  for (const [type, entityIds] of byType) {
    // Find connected components within type
    for (const startId of entityIds) {
      if (visited.has(startId)) continue;

      const component: string[] = [];
      const queue = [startId];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        
        visited.add(current);
        component.push(current);

        const neighbors = adjacency.get(current) || new Set();
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor) && entityIds.includes(neighbor)) {
            queue.push(neighbor);
          }
        }
      }

      if (component.length >= minSize) {
        clusters.push({
          id: `cluster-${clusterId++}`,
          label: `${type} group (${component.length})`,
          nodeIds: component,
        });
      }
    }
  }

  return clusters;
}

// ============================================================================
// Color Utilities
// ============================================================================

const CLUSTER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6',
];

const ENTITY_TYPE_COLORS: Record<string, string> = {
  document: '#3b82f6',   // blue
  concept: '#8b5cf6',    // purple
  function: '#10b981',   // green
  class: '#f59e0b',      // amber
  interface: '#06b6d4',  // cyan
  type: '#ec4899',       // pink
  module: '#6366f1',     // indigo
  file: '#64748b',       // slate
  variable: '#84cc16',   // lime
  'api-endpoint': '#ef4444', // red
};

const DEFAULT_COLOR = '#9ca3af'; // gray

export function getClusterColor(clusterId: string): string {
  const index = parseInt(clusterId.replace('cluster-', ''), 10) || 0;
  return CLUSTER_COLORS[index % CLUSTER_COLORS.length] ?? DEFAULT_COLOR;
}

export function getEntityColor(type: string): string {
  return ENTITY_TYPE_COLORS[type] || DEFAULT_COLOR;
}
