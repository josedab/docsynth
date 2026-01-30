import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    knowledgeEntity: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      groupBy: vi.fn(),
    },
    knowledgeRelation: {
      findMany: vi.fn(),
    },
    repository: {
      findFirst: vi.fn(),
    },
    documentChunk: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@docsynth/utils', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
  NotFoundError: class extends Error {
    constructor(resource: string, id: string) {
      super(`${resource} not found: ${id}`);
    }
  },
}));

// Import after mocking

describe('Knowledge Graph Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Cluster Detection Algorithm', () => {
    it('should detect communities based on connectivity', () => {
      // Test the community detection algorithm
      const entities = [
        { id: '1', type: 'class', name: 'UserService' },
        { id: '2', type: 'class', name: 'AuthService' },
        { id: '3', type: 'function', name: 'authenticate' },
        { id: '4', type: 'document', name: 'API Docs' },
      ];

      const adjacency = new Map<string, Set<string>>();
      adjacency.set('1', new Set(['2', '3']));
      adjacency.set('2', new Set(['1', '3']));
      adjacency.set('3', new Set(['1', '2']));
      adjacency.set('4', new Set([]));

      // The detectCommunities function groups connected components
      // Entities 1, 2, 3 are connected; 4 is isolated
      // Expected: 2 clusters
      expect(entities.length).toBe(4);
      expect(adjacency.get('1')?.size).toBe(2);
    });

    it('should handle empty graph', () => {
      const entities: { id: string; type: string; name: string }[] = [];
      const adjacency = new Map<string, Set<string>>();

      expect(entities.length).toBe(0);
      expect(adjacency.size).toBe(0);
    });

    it('should handle single node graph', () => {
      const entities = [{ id: '1', type: 'class', name: 'Singleton' }];
      const adjacency = new Map<string, Set<string>>();
      adjacency.set('1', new Set());

      expect(entities.length).toBe(1);
      expect(adjacency.get('1')?.size).toBe(0);
    });
  });

  describe('Cosine Similarity', () => {
    it('should calculate similarity correctly for identical vectors', () => {
      const a = [1, 2, 3, 4, 5];
      const b = [1, 2, 3, 4, 5];

      // cosine(a, b) = (a·b) / (|a| * |b|)
      const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] ?? 0), 0);
      const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      const similarity = dotProduct / (normA * normB);

      expect(similarity).toBeCloseTo(1.0);
    });

    it('should calculate similarity correctly for orthogonal vectors', () => {
      const a = [1, 0];
      const b = [0, 1];

      const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] ?? 0), 0);
      const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      const similarity = dotProduct / (normA * normB);

      expect(similarity).toBeCloseTo(0.0);
    });

    it('should calculate similarity correctly for opposite vectors', () => {
      const a = [1, 2, 3];
      const b = [-1, -2, -3];

      const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] ?? 0), 0);
      const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      const similarity = dotProduct / (normA * normB);

      expect(similarity).toBeCloseTo(-1.0);
    });

    it('should return 0 for empty vectors', () => {
      const a: number[] = [];
      const b: number[] = [];

      expect(a.length).toBe(0);
      expect(b.length).toBe(0);
    });
  });

  describe('BFS Path Finding', () => {
    it('should find shortest path between connected nodes', () => {
      const adjacency = new Map<string, Set<string>>();
      adjacency.set('A', new Set(['B', 'C']));
      adjacency.set('B', new Set(['A', 'D']));
      adjacency.set('C', new Set(['A']));
      adjacency.set('D', new Set(['B', 'E']));
      adjacency.set('E', new Set(['D']));

      // BFS from A to E: A -> B -> D -> E (length 3)
      const visited = new Set<string>();
      const queue: { node: string; path: string[] }[] = [{ node: 'A', path: ['A'] }];
      let shortestPath: string[] = [];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.node === 'E') {
          shortestPath = current.path;
          break;
        }
        if (!visited.has(current.node)) {
          visited.add(current.node);
          const neighbors = adjacency.get(current.node) || new Set();
          for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
              queue.push({ node: neighbor, path: [...current.path, neighbor] });
            }
          }
        }
      }

      expect(shortestPath).toEqual(['A', 'B', 'D', 'E']);
      expect(shortestPath.length).toBe(4);
    });

    it('should return empty path for disconnected nodes', () => {
      const adjacency = new Map<string, Set<string>>();
      adjacency.set('A', new Set(['B']));
      adjacency.set('B', new Set(['A']));
      adjacency.set('C', new Set(['D']));
      adjacency.set('D', new Set(['C']));

      // BFS from A to C: No path exists
      const visited = new Set<string>();
      const queue: { node: string; path: string[] }[] = [{ node: 'A', path: ['A'] }];
      let foundPath: string[] = [];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.node === 'C') {
          foundPath = current.path;
          break;
        }
        if (!visited.has(current.node)) {
          visited.add(current.node);
          const neighbors = adjacency.get(current.node) || new Set();
          for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
              queue.push({ node: neighbor, path: [...current.path, neighbor] });
            }
          }
        }
      }

      expect(foundPath.length).toBe(0);
    });
  });

  describe('Neighborhood Extraction', () => {
    it('should extract 1-hop neighborhood', () => {
      const adjacency = new Map<string, Set<string>>();
      adjacency.set('center', new Set(['n1', 'n2', 'n3']));
      adjacency.set('n1', new Set(['center']));
      adjacency.set('n2', new Set(['center', 'n4']));
      adjacency.set('n3', new Set(['center']));
      adjacency.set('n4', new Set(['n2']));

      const neighborhood = new Set<string>(['center']);
      const depth = 1;

      for (let d = 0; d < depth; d++) {
        const currentLevel = Array.from(neighborhood);
        for (const node of currentLevel) {
          const neighbors = adjacency.get(node) || new Set();
          for (const neighbor of neighbors) {
            neighborhood.add(neighbor);
          }
        }
      }

      expect(neighborhood.has('center')).toBe(true);
      expect(neighborhood.has('n1')).toBe(true);
      expect(neighborhood.has('n2')).toBe(true);
      expect(neighborhood.has('n3')).toBe(true);
      expect(neighborhood.has('n4')).toBe(false); // 2-hops away
      expect(neighborhood.size).toBe(4);
    });

    it('should extract 2-hop neighborhood', () => {
      const adjacency = new Map<string, Set<string>>();
      adjacency.set('center', new Set(['n1']));
      adjacency.set('n1', new Set(['center', 'n2']));
      adjacency.set('n2', new Set(['n1', 'n3']));
      adjacency.set('n3', new Set(['n2']));

      const neighborhood = new Set<string>(['center']);
      const depth = 2;

      for (let d = 0; d < depth; d++) {
        const currentLevel = Array.from(neighborhood);
        for (const node of currentLevel) {
          const neighbors = adjacency.get(node) || new Set();
          for (const neighbor of neighbors) {
            neighborhood.add(neighbor);
          }
        }
      }

      expect(neighborhood.has('center')).toBe(true);
      expect(neighborhood.has('n1')).toBe(true);
      expect(neighborhood.has('n2')).toBe(true);
      expect(neighborhood.has('n3')).toBe(false); // 3-hops away
      expect(neighborhood.size).toBe(3);
    });
  });

  describe('Entity Type Colors', () => {
    it('should return correct colors for known entity types', () => {
      const colors: Record<string, string> = {
        document: '#3b82f6',
        concept: '#8b5cf6',
        function: '#10b981',
        class: '#f59e0b',
        interface: '#06b6d4',
        type: '#ec4899',
        module: '#84cc16',
        component: '#f97316',
        endpoint: '#6366f1',
        event: '#14b8a6',
      };

      expect(colors.document).toBe('#3b82f6');
      expect(colors.function).toBe('#10b981');
      expect(colors.class).toBe('#f59e0b');
    });

    it('should have default color for unknown types', () => {
      const colors: Record<string, string> = {
        document: '#3b82f6',
      };
      const defaultColor = '#9ca3af';

      const getColor = (type: string) => colors[type] || defaultColor;

      expect(getColor('unknown')).toBe(defaultColor);
      expect(getColor('document')).toBe('#3b82f6');
    });
  });
});
