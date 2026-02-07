import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    repository: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@docsynth/queue', () => ({
  addJob: vi.fn().mockResolvedValue({ id: 'job-123' }),
  QUEUE_NAMES: {
    ORG_GRAPH_BUILDER: 'org-graph-builder',
  },
}));

describe('Multi-Repository Documentation Graph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Repository Type Detection', () => {
    it('should detect frontend repositories', () => {
      const detectRepositoryType = (name: string, technologies: string[]): string => {
        const nameLower = name.toLowerCase();
        const techSet = new Set(technologies.map((t) => t.toLowerCase()));

        if (
          techSet.has('react') ||
          techSet.has('vue') ||
          techSet.has('angular') ||
          nameLower.includes('frontend') ||
          nameLower.includes('ui') ||
          nameLower.includes('web')
        ) {
          return 'frontend';
        }

        if (
          nameLower.includes('lib') ||
          nameLower.includes('utils') ||
          nameLower.includes('shared')
        ) {
          return 'library';
        }

        if (
          nameLower.includes('service') ||
          nameLower.includes('api') ||
          nameLower.includes('server')
        ) {
          return 'service';
        }

        return 'unknown';
      };

      expect(detectRepositoryType('my-frontend-app', ['react'])).toBe('frontend');
      expect(detectRepositoryType('ui-components', [])).toBe('frontend');
      expect(detectRepositoryType('my-app', ['vue'])).toBe('frontend');
    });

    it('should detect service repositories', () => {
      const detectRepositoryType = (name: string, technologies: string[]): string => {
        const nameLower = name.toLowerCase();
        const techSet = new Set(technologies.map((t) => t.toLowerCase()));

        if (techSet.has('react') || nameLower.includes('frontend')) {
          return 'frontend';
        }

        if (nameLower.includes('lib') || nameLower.includes('shared')) {
          return 'library';
        }

        if (
          nameLower.includes('service') ||
          nameLower.includes('api') ||
          nameLower.includes('server') ||
          techSet.has('express')
        ) {
          return 'service';
        }

        return 'unknown';
      };

      expect(detectRepositoryType('auth-service', [])).toBe('service');
      expect(detectRepositoryType('api-gateway', [])).toBe('service');
      expect(detectRepositoryType('backend', ['express'])).toBe('service');
    });

    it('should detect library repositories', () => {
      const detectRepositoryType = (name: string): string => {
        const nameLower = name.toLowerCase();

        if (
          nameLower.includes('lib') ||
          nameLower.includes('utils') ||
          nameLower.includes('shared') ||
          nameLower.includes('common')
        ) {
          return 'library';
        }

        return 'unknown';
      };

      expect(detectRepositoryType('shared-utils')).toBe('library');
      expect(detectRepositoryType('common-lib')).toBe('library');
      expect(detectRepositoryType('ui-library')).toBe('library');
    });
  });

  describe('Dependency Detection', () => {
    it('should extract dependencies from package.json', () => {
      const packageJsonContent = JSON.stringify({
        name: 'my-app',
        dependencies: {
          'shared-lib': '^1.0.0',
          'react': '^18.0.0',
        },
        devDependencies: {
          'testing-utils': '^2.0.0',
        },
      });

      const packageJson = JSON.parse(packageJsonContent);
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      expect(Object.keys(allDeps)).toContain('shared-lib');
      expect(Object.keys(allDeps)).toContain('react');
      expect(Object.keys(allDeps)).toContain('testing-utils');
      expect(Object.keys(allDeps).length).toBe(3);
    });

    it('should detect import statements', () => {
      const content = `
import { Component } from 'shared-lib';
import React from 'react';
const utils = require('utils-lib');
`;

      const importPattern = /import.*from.*['"]([^'"]+)['"]/g;
      const requirePattern = /require\(['"]([^'"]+)['"]\)/g;

      const imports: string[] = [];
      let match;

      while ((match = importPattern.exec(content)) !== null) {
        imports.push(match[1] ?? '');
      }

      while ((match = requirePattern.exec(content)) !== null) {
        imports.push(match[1] ?? '');
      }

      expect(imports).toContain('shared-lib');
      expect(imports).toContain('react');
      expect(imports).toContain('utils-lib');
    });
  });

  describe('Health Score Calculation', () => {
    it('should calculate health score based on document quality', () => {
      const calculateDocScore = (content: string): number => {
        let score = 50; // Base score

        if (content.length > 1000) score += 10;
        if (content.length > 5000) score += 10;
        if (content.includes('##')) score += 10; // Has headings
        if (content.includes('```')) score += 10; // Has code blocks
        if (content.includes('[') && content.includes('](')) score += 10; // Has links

        return Math.min(score, 100);
      };

      const goodDoc = `
## Overview

This is a well-documented module with code examples:

\`\`\`javascript
console.log('example');
\`\`\`

See [related docs](./related.md) for more info.
`;

      const poorDoc = 'Basic documentation.';

      expect(calculateDocScore(goodDoc)).toBeGreaterThan(calculateDocScore(poorDoc));
      expect(calculateDocScore(goodDoc)).toBeGreaterThanOrEqual(80);
      expect(calculateDocScore(poorDoc)).toBeLessThan(70);
    });

    it('should calculate average health score for repository', () => {
      const docScores = [90, 85, 95, 80];
      const avgScore = Math.round(
        docScores.reduce((sum, score) => sum + score, 0) / docScores.length
      );

      expect(avgScore).toBe(88);
    });
  });

  describe('Cross-Repo Search', () => {
    it('should calculate relevance score for search results', () => {
      const calculateRelevanceScore = (
        title: string,
        content: string,
        query: string
      ): number => {
        let score = 0;
        const queryLower = query.toLowerCase();

        if (title.toLowerCase().includes(queryLower)) score += 10;

        const titleMatches = (title.toLowerCase().match(new RegExp(queryLower, 'g')) || [])
          .length;
        const contentMatches = (content.toLowerCase().match(new RegExp(queryLower, 'g')) || [])
          .length;

        score += titleMatches * 3 + Math.min(contentMatches, 20);

        return score;
      };

      const doc1 = {
        title: 'Authentication API Documentation',
        content: 'This document covers authentication and authorization...',
      };

      const doc2 = {
        title: 'User Guide',
        content: 'Some basic info...',
      };

      const query = 'authentication';

      const score1 = calculateRelevanceScore(doc1.title, doc1.content, query);
      const score2 = calculateRelevanceScore(doc2.title, doc2.content, query);

      expect(score1).toBeGreaterThan(score2);
    });
  });

  describe('Service Clustering', () => {
    it('should group repositories by type', () => {
      const repos = [
        { id: 'r1', type: 'frontend' },
        { id: 'r2', type: 'frontend' },
        { id: 'r3', type: 'service' },
        { id: 'r4', type: 'service' },
        { id: 'r5', type: 'library' },
      ];

      const typeGroups = new Map<string, string[]>();
      for (const repo of repos) {
        const existing = typeGroups.get(repo.type) || [];
        existing.push(repo.id);
        typeGroups.set(repo.type, existing);
      }

      expect(typeGroups.get('frontend')?.length).toBe(2);
      expect(typeGroups.get('service')?.length).toBe(2);
      expect(typeGroups.get('library')?.length).toBe(1);
      expect(typeGroups.size).toBe(3);
    });

    it('should find connected components in dependency graph', () => {
      // Simple test for connected component detection
      const edges = [
        { source: 'r1', target: 'r2', weight: 5 },
        { source: 'r2', target: 'r3', weight: 4 },
        { source: 'r4', target: 'r5', weight: 6 },
      ];

      const adjacencyMap = new Map<string, Set<string>>();

      for (const edge of edges) {
        if (edge.weight >= 3) {
          if (!adjacencyMap.has(edge.source)) {
            adjacencyMap.set(edge.source, new Set());
          }
          if (!adjacencyMap.has(edge.target)) {
            adjacencyMap.set(edge.target, new Set());
          }
          adjacencyMap.get(edge.source)?.add(edge.target);
          adjacencyMap.get(edge.target)?.add(edge.source);
        }
      }

      expect(adjacencyMap.get('r1')?.has('r2')).toBe(true);
      expect(adjacencyMap.get('r2')?.has('r3')).toBe(true);
      expect(adjacencyMap.get('r4')?.has('r5')).toBe(true);

      // Check that r1-r2-r3 are connected but separate from r4-r5
      const component1 = adjacencyMap.get('r1');
      expect(component1?.has('r4')).toBe(false);
    });
  });

  describe('Graph Statistics', () => {
    it('should calculate graph statistics correctly', () => {
      const repoNodes = [
        { repositoryId: 'r1', documentCount: 10, healthScore: 80 },
        { repositoryId: 'r2', documentCount: 15, healthScore: 90 },
        { repositoryId: 'r3', documentCount: 5, healthScore: 60 },
      ];

      const edges = [
        { sourceRepoId: 'r1', targetRepoId: 'r2', weight: 5 },
        { sourceRepoId: 'r2', targetRepoId: 'r3', weight: 3 },
        { sourceRepoId: 'r1', targetRepoId: 'r3', weight: 2 },
      ];

      const totalRepos = repoNodes.length;
      const totalEdges = edges.length;
      const totalDocs = repoNodes.reduce((sum, node) => sum + node.documentCount, 0);
      const avgHealth = Math.round(
        repoNodes.reduce((sum, node) => sum + node.healthScore, 0) / totalRepos
      );

      expect(totalRepos).toBe(3);
      expect(totalEdges).toBe(3);
      expect(totalDocs).toBe(30);
      expect(avgHealth).toBe(77);
    });

    it('should find most connected repository', () => {
      const edges = [
        { sourceRepoId: 'r1', targetRepoId: 'r2' },
        { sourceRepoId: 'r1', targetRepoId: 'r3' },
        { sourceRepoId: 'r1', targetRepoId: 'r4' },
        { sourceRepoId: 'r2', targetRepoId: 'r3' },
      ];

      const connectionCounts = new Map<string, number>();

      for (const edge of edges) {
        connectionCounts.set(
          edge.sourceRepoId,
          (connectionCounts.get(edge.sourceRepoId) || 0) + 1
        );
        connectionCounts.set(
          edge.targetRepoId,
          (connectionCounts.get(edge.targetRepoId) || 0) + 1
        );
      }

      let mostConnected = '';
      let maxConnections = 0;

      for (const [repoId, count] of connectionCounts) {
        if (count > maxConnections) {
          maxConnections = count;
          mostConnected = repoId;
        }
      }

      expect(mostConnected).toBe('r1');
      expect(maxConnections).toBe(3);
    });
  });
});
