/**
 * Federated Search Service
 *
 * Aggregates documentation from multiple repositories into a unified,
 * searchable portal with cross-repo navigation and dependency maps.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('federated-search-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface FederatedIndex {
  organizationId: string;
  repositories: IndexedRepository[];
  totalDocuments: number;
  lastIndexedAt: Date;
}

export interface IndexedRepository {
  repositoryId: string;
  name: string;
  documentCount: number;
  lastIndexedAt: Date;
  tags: string[];
}

export interface FederatedSearchResult {
  query: string;
  totalResults: number;
  results: SearchHit[];
  facets: SearchFacets;
  executionTimeMs: number;
}

export interface SearchHit {
  documentPath: string;
  repositoryName: string;
  repositoryId: string;
  title: string;
  excerpt: string;
  score: number;
  highlights: string[];
  lastUpdated: Date;
}

export interface SearchFacets {
  repositories: Array<{ name: string; count: number }>;
  documentTypes: Array<{ type: string; count: number }>;
}

export interface NavigationTree {
  organizationId: string;
  nodes: NavigationNode[];
}

export interface NavigationNode {
  id: string;
  label: string;
  type: 'organization' | 'team' | 'repository' | 'document' | 'section';
  children: NavigationNode[];
  path?: string;
  repositoryId?: string;
}

export interface CrossRepoLink {
  sourceRepo: string;
  sourcePath: string;
  targetRepo: string;
  targetPath: string;
  linkType: 'reference' | 'dependency' | 'related';
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Build or update the federated search index
 */
export async function buildIndex(
  organizationId: string,
  repositoryIds?: string[]
): Promise<FederatedIndex> {
  const repos = await prisma.repository.findMany({
    where: {
      organizationId,
      ...(repositoryIds ? { id: { in: repositoryIds } } : {}),
    },
    select: { id: true, fullName: true, name: true },
  });

  const indexedRepos: IndexedRepository[] = [];

  for (const repo of repos) {
    const docs = await prisma.document.findMany({
      where: { repositoryId: repo.id },
      select: { id: true },
    });

    // Index all documents for this repo
    await db.federatedSearchEntry.deleteMany({
      where: { repositoryId: repo.id },
    });

    const allDocs = await prisma.document.findMany({
      where: { repositoryId: repo.id },
      select: { id: true, path: true, title: true, content: true, updatedAt: true },
    });

    for (const doc of allDocs) {
      await db.federatedSearchEntry.create({
        data: {
          organizationId,
          repositoryId: repo.id,
          repositoryName: repo.name,
          documentId: doc.id,
          documentPath: doc.path,
          title: doc.title ?? doc.path,
          content: doc.content ?? '',
          indexedAt: new Date(),
        },
      });
    }

    indexedRepos.push({
      repositoryId: repo.id,
      name: repo.name,
      documentCount: docs.length,
      lastIndexedAt: new Date(),
      tags: detectRepoTags(allDocs.map((d) => d.path)),
    });
  }

  const totalDocuments = indexedRepos.reduce((sum, r) => sum + r.documentCount, 0);

  const index: FederatedIndex = {
    organizationId,
    repositories: indexedRepos,
    totalDocuments,
    lastIndexedAt: new Date(),
  };

  await db.federatedIndex.upsert({
    where: { organizationId },
    create: {
      organizationId,
      repositoryCount: indexedRepos.length,
      totalDocuments,
      indexedAt: new Date(),
    },
    update: {
      repositoryCount: indexedRepos.length,
      totalDocuments,
      indexedAt: new Date(),
    },
  });

  log.info(
    { organizationId, repos: indexedRepos.length, documents: totalDocuments },
    'Federated index built'
  );

  return index;
}

/**
 * Search across all indexed repositories
 */
export async function search(
  organizationId: string,
  query: string,
  options?: { repositoryIds?: string[]; limit?: number; offset?: number }
): Promise<FederatedSearchResult> {
  const startTime = Date.now();
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  const whereClause: Record<string, unknown> = {
    organizationId,
    OR: [
      { title: { contains: query, mode: 'insensitive' } },
      { content: { contains: query, mode: 'insensitive' } },
    ],
  };

  if (options?.repositoryIds) {
    whereClause.repositoryId = { in: options.repositoryIds };
  }

  const [entries, totalCount] = await Promise.all([
    db.federatedSearchEntry.findMany({
      where: whereClause,
      select: {
        documentPath: true,
        repositoryName: true,
        repositoryId: true,
        title: true,
        content: true,
        indexedAt: true,
      },
      take: limit,
      skip: offset,
    }),
    db.federatedSearchEntry.count({ where: whereClause }),
  ]);

  const results: SearchHit[] = entries.map((entry: any) => ({
    documentPath: entry.documentPath,
    repositoryName: entry.repositoryName,
    repositoryId: entry.repositoryId,
    title: entry.title,
    excerpt: extractSearchExcerpt(entry.content ?? '', query, 200),
    score: calculateSearchScore(entry.title ?? '', entry.content ?? '', query),
    highlights: extractHighlights(entry.content ?? '', query),
    lastUpdated: entry.indexedAt,
  }));

  results.sort((a, b) => b.score - a.score);

  // Build facets
  const repoFacets = new Map<string, number>();
  const typeFacets = new Map<string, number>();
  for (const r of results) {
    repoFacets.set(r.repositoryName, (repoFacets.get(r.repositoryName) ?? 0) + 1);
    const type = r.documentPath.endsWith('.md') ? 'markdown' : 'code';
    typeFacets.set(type, (typeFacets.get(type) ?? 0) + 1);
  }

  log.info(
    { organizationId, query, resultCount: results.length, totalCount },
    'Federated search executed'
  );

  return {
    query,
    totalResults: totalCount,
    results,
    facets: {
      repositories: Array.from(repoFacets.entries()).map(([name, count]) => ({ name, count })),
      documentTypes: Array.from(typeFacets.entries()).map(([type, count]) => ({ type, count })),
    },
    executionTimeMs: Date.now() - startTime,
  };
}

/**
 * Build navigation tree for an organization
 */
export async function buildNavigationTree(organizationId: string): Promise<NavigationTree> {
  const repos = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  });

  const nodes: NavigationNode[] = [];

  for (const repo of repos) {
    const docs = await prisma.document.findMany({
      where: { repositoryId: repo.id },
      select: { path: true, title: true },
      orderBy: { path: 'asc' },
    });

    const docNodes: NavigationNode[] = docs.map((doc) => ({
      id: `${repo.id}-${doc.path}`,
      label: doc.title ?? doc.path.split('/').pop() ?? doc.path,
      type: 'document' as const,
      children: [],
      path: doc.path,
      repositoryId: repo.id,
    }));

    nodes.push({
      id: repo.id,
      label: repo.name,
      type: 'repository',
      children: docNodes,
      repositoryId: repo.id,
    });
  }

  return { organizationId, nodes };
}

/**
 * Detect cross-repo links
 */
export async function detectCrossRepoLinks(organizationId: string): Promise<CrossRepoLink[]> {
  const links: CrossRepoLink[] = [];

  const repos = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  });

  const repoMap = new Map(repos.map((r) => [r.id, r.name]));

  for (const repo of repos) {
    const docs = await prisma.document.findMany({
      where: { repositoryId: repo.id, content: { not: null } },
      select: { path: true, content: true },
      take: 50,
    });

    for (const doc of docs) {
      if (!doc.content) continue;
      for (const [otherRepoId, otherName] of repoMap) {
        if (otherRepoId === repo.id) continue;
        if (doc.content.includes(otherName)) {
          links.push({
            sourceRepo: repo.name,
            sourcePath: doc.path,
            targetRepo: otherName,
            targetPath: '',
            linkType: 'reference',
          });
        }
      }
    }
  }

  log.info({ organizationId, linkCount: links.length }, 'Cross-repo links detected');
  return links;
}

// ============================================================================
// Helper Functions
// ============================================================================

function extractSearchExcerpt(content: string, query: string, maxLength: number): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerContent.indexOf(lowerQuery);

  if (index === -1) return content.substring(0, maxLength) + '...';

  const start = Math.max(0, index - 80);
  const end = Math.min(content.length, index + query.length + 80);
  const excerpt = content.substring(start, end);

  return (start > 0 ? '...' : '') + excerpt + (end < content.length ? '...' : '');
}

function calculateSearchScore(title: string, content: string, query: string): number {
  const lowerQuery = query.toLowerCase();
  let score = 0;

  if (title.toLowerCase().includes(lowerQuery)) score += 5;
  if (title.toLowerCase() === lowerQuery) score += 10;

  const contentMatches = (content.toLowerCase().match(new RegExp(lowerQuery, 'g')) ?? []).length;
  score += Math.min(5, contentMatches);

  return Math.min(10, score);
}

function extractHighlights(content: string, query: string): string[] {
  const lines = content.split('\n');
  return lines
    .filter((line) => line.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 3)
    .map((line) => line.trim().substring(0, 150));
}

function detectRepoTags(paths: string[]): string[] {
  const tags: string[] = [];
  if (paths.some((p) => p.includes('api'))) tags.push('api');
  if (paths.some((p) => p.endsWith('.md'))) tags.push('docs');
  if (paths.some((p) => p.includes('test'))) tags.push('tested');
  return tags;
}
