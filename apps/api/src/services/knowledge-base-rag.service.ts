/**
 * Knowledge Base RAG 2.0 Service
 *
 * Unified knowledge base indexing code, docs, PRs, issues, and chat.
 * Powers contextual answers with cited sources and proactive surfacing.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('knowledge-base-rag-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface KBChunk {
  id: string;
  content: string;
  source: KBSource;
  metadata: Record<string, unknown>;
  embedding?: number[];
}

export interface KBSource {
  type: 'code' | 'doc' | 'pr' | 'issue' | 'slack' | 'adr';
  path: string;
  title: string;
  url?: string;
  author?: string;
  date: Date;
  repositoryId: string;
}

export interface KBQueryResult {
  query: string;
  answer: string;
  citations: Citation[];
  confidence: number;
  relatedQuestions: string[];
  executionTimeMs: number;
}

export interface Citation {
  sourceType: KBSource['type'];
  path: string;
  title: string;
  excerpt: string;
  relevanceScore: number;
  url?: string;
}

export interface KBIndexStatus {
  organizationId: string;
  repositories: Array<{
    repositoryId: string;
    name: string;
    chunksIndexed: number;
    lastIndexedAt: Date;
  }>;
  totalChunks: number;
  sourceBreakdown: Record<string, number>;
  lastFullIndexAt: Date | null;
}

export interface ProactiveSuggestion {
  type: 'related-doc' | 'answer-question' | 'suggested-reading';
  title: string;
  excerpt: string;
  sourcePath: string;
  confidence: number;
  trigger: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Index a repository into the knowledge base
 */
export async function indexRepository(
  repositoryId: string,
  sources: Array<'code' | 'docs' | 'prs' | 'issues' | 'slack' | 'adr'>,
  options?: { incremental?: boolean }
): Promise<{ chunksIndexed: number; sourcesProcessed: number }> {
  let chunksIndexed = 0;
  let sourcesProcessed = 0;

  if (!options?.incremental) {
    await db.kbChunk.deleteMany({ where: { repositoryId } });
  }

  for (const source of sources) {
    const chunks = await extractChunksFromSource(repositoryId, source);
    for (const chunk of chunks) {
      await db.kbChunk.create({
        data: {
          repositoryId,
          content: chunk.content,
          sourceType: chunk.source.type,
          sourcePath: chunk.source.path,
          sourceTitle: chunk.source.title,
          metadata: JSON.parse(JSON.stringify(chunk.metadata)),
          indexedAt: new Date(),
        },
      });
      chunksIndexed++;
    }
    sourcesProcessed++;
  }

  log.info({ repositoryId, chunksIndexed, sourcesProcessed }, 'Repository indexed');
  return { chunksIndexed, sourcesProcessed };
}

/**
 * Query the knowledge base with citation support
 */
export async function queryKnowledgeBase(
  organizationId: string,
  query: string,
  options?: {
    repositoryId?: string;
    requireCitations?: boolean;
    confidenceMinimum?: number;
    maxChunks?: number;
  }
): Promise<KBQueryResult> {
  const startTime = Date.now();
  const maxChunks = options?.maxChunks ?? 10;

  const whereClause: Record<string, unknown> = {};
  if (options?.repositoryId) whereClause.repositoryId = options.repositoryId;

  // Search by content matching
  const chunks = await db.kbChunk.findMany({
    where: {
      ...whereClause,
      OR: [
        { content: { contains: query, mode: 'insensitive' } },
        { sourceTitle: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: {
      content: true,
      sourceType: true,
      sourcePath: true,
      sourceTitle: true,
      metadata: true,
    },
    take: maxChunks,
  });

  const citations: Citation[] = chunks.map((chunk: any, idx: number) => ({
    sourceType: chunk.sourceType,
    path: chunk.sourcePath,
    title: chunk.sourceTitle,
    excerpt: chunk.content.substring(0, 200),
    relevanceScore: Math.max(0.5, 1 - idx * 0.1),
  }));

  const answer =
    chunks.length > 0
      ? `Based on ${chunks.length} source(s), here's what I found:\n\n${chunks
          .slice(0, 3)
          .map((c: any) => `- **${c.sourceTitle}**: ${c.content.substring(0, 150)}...`)
          .join('\n')}`
      : `I couldn't find information about "${query}" in the knowledge base.`;

  const confidence = chunks.length > 0 ? Math.min(0.95, 0.5 + chunks.length * 0.05) : 0.1;
  const relatedQuestions = generateRelatedQuestions(query, chunks);

  log.info(
    { organizationId, query: query.substring(0, 50), results: chunks.length, confidence },
    'KB query executed'
  );

  return {
    query,
    answer,
    citations,
    confidence,
    relatedQuestions,
    executionTimeMs: Date.now() - startTime,
  };
}

/**
 * Get index status
 */
export async function getIndexStatus(organizationId: string): Promise<KBIndexStatus> {
  const repos = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  });

  const repoStatuses = [];
  let totalChunks = 0;
  const sourceBreakdown: Record<string, number> = {};

  for (const repo of repos) {
    const chunks = await db.kbChunk.findMany({
      where: { repositoryId: repo.id },
      select: { sourceType: true, indexedAt: true },
    });

    const chunksIndexed = chunks.length;
    totalChunks += chunksIndexed;

    for (const chunk of chunks) {
      sourceBreakdown[chunk.sourceType] = (sourceBreakdown[chunk.sourceType] ?? 0) + 1;
    }

    const lastIndexed =
      chunks.length > 0
        ? chunks.reduce(
            (latest: Date, c: { indexedAt: Date }) => (c.indexedAt > latest ? c.indexedAt : latest),
            new Date(0)
          )
        : null;

    repoStatuses.push({
      repositoryId: repo.id,
      name: repo.name,
      chunksIndexed,
      lastIndexedAt: lastIndexed ?? new Date(),
    });
  }

  return {
    organizationId,
    repositories: repoStatuses,
    totalChunks,
    sourceBreakdown,
    lastFullIndexAt: null,
  };
}

/**
 * Generate proactive suggestions for a context
 */
export async function getProactiveSuggestions(
  repositoryId: string,
  context: { filePath?: string; prTitle?: string; searchQuery?: string }
): Promise<ProactiveSuggestion[]> {
  const suggestions: ProactiveSuggestion[] = [];
  const searchTerms = [context.filePath, context.prTitle, context.searchQuery].filter(Boolean);

  for (const term of searchTerms) {
    const chunks = await db.kbChunk.findMany({
      where: { repositoryId, content: { contains: term ?? '', mode: 'insensitive' } },
      select: { sourceTitle: true, sourcePath: true, content: true, sourceType: true },
      take: 3,
    });

    for (const chunk of chunks) {
      suggestions.push({
        type: chunk.sourceType === 'doc' ? 'related-doc' : 'suggested-reading',
        title: chunk.sourceTitle,
        excerpt: chunk.content.substring(0, 150),
        sourcePath: chunk.sourcePath,
        confidence: 0.7,
        trigger: term ?? '',
      });
    }
  }

  return suggestions.slice(0, 5);
}

// ============================================================================
// Helper Functions
// ============================================================================

async function extractChunksFromSource(
  repositoryId: string,
  source: 'code' | 'docs' | 'prs' | 'issues' | 'slack' | 'adr'
): Promise<KBChunk[]> {
  const chunks: KBChunk[] = [];

  switch (source) {
    case 'docs':
    case 'code': {
      const docs = await prisma.document.findMany({
        where: {
          repositoryId,
          ...(source === 'docs'
            ? { OR: [{ path: { endsWith: '.md' } }, { path: { endsWith: '.mdx' } }] }
            : { NOT: [{ path: { endsWith: '.md' } }, { path: { endsWith: '.mdx' } }] }),
        },
        select: { id: true, path: true, title: true, content: true, updatedAt: true },
        take: 200,
      });

      for (const doc of docs) {
        if (!doc.content) continue;
        const docChunks = chunkContent(doc.content, 500);
        for (let i = 0; i < docChunks.length; i++) {
          chunks.push({
            id: `${doc.id}-${i}`,
            content: docChunks[i]!,
            source: {
              type: source,
              path: doc.path,
              title: doc.title ?? doc.path,
              date: doc.updatedAt,
              repositoryId,
            },
            metadata: { chunkIndex: i, totalChunks: docChunks.length },
          });
        }
      }
      break;
    }
    case 'prs':
    case 'issues':
    case 'slack':
    case 'adr':
      // Placeholder for external source indexing
      break;
  }

  return chunks;
}

function chunkContent(content: string, maxChunkSize: number): string[] {
  const paragraphs = content.split('\n\n');
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if ((current + para).length > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += para + '\n\n';
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

function generateRelatedQuestions(query: string, chunks: any[]): string[] {
  const questions: string[] = [];
  if (chunks.length > 0) {
    questions.push(`How does ${query} relate to the architecture?`);
    questions.push(`What are the best practices for ${query}?`);
    questions.push(`Are there examples of ${query}?`);
  }
  return questions.slice(0, 3);
}
