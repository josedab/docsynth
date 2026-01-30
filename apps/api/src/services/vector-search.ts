/**
 * Vector Search Service
 * Handles semantic search operations using vector embeddings.
 */

import { prisma, Prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import type {
  ChunkMetadata,
  SemanticSearchQuery,
  SemanticSearchResult,
  ScoredChunk,
} from '@docsynth/types';
import { generateSingleEmbedding } from './embeddings.js';
import { extractHighlights } from './chunking.js';

const log = createLogger('vector-search-service');

// ============================================================================
// Search Functions
// ============================================================================

/**
 * Perform semantic search across document chunks.
 */
export async function semanticSearch(query: SemanticSearchQuery): Promise<SemanticSearchResult> {
  const startTime = Date.now();

  log.debug({ query: query.query, repositoryId: query.repositoryId }, 'Starting semantic search');

  // Generate query embedding
  const queryEmbedding = await generateSingleEmbedding(query.query);

  // Build filter conditions
  const whereConditions: Prisma.DocumentChunkWhereInput = {
    repositoryId: query.repositoryId,
  };

  if (query.documentTypes && query.documentTypes.length > 0) {
    whereConditions.document = {
      type: { in: query.documentTypes },
    };
  }

  // Fetch chunks for the repository
  const chunks = await prisma.documentChunk.findMany({
    where: whereConditions,
    include: {
      document: {
        select: { id: true, path: true, type: true, title: true },
      },
    },
  });

  // Calculate cosine similarity for each chunk
  const scoredChunks: ScoredChunk[] = chunks.map((chunk) => {
    const score = cosineSimilarity(queryEmbedding, chunk.embedding);
    return {
      chunk: {
        id: chunk.id,
        documentId: chunk.documentId,
        repositoryId: chunk.repositoryId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        embedding: chunk.embedding,
        metadata: chunk.metadata as unknown as ChunkMetadata,
        createdAt: chunk.createdAt,
      },
      score,
      highlights: extractHighlights(chunk.content, query.query),
    };
  });

  // Filter by minimum score
  const minScore = query.minScore ?? 0.3;
  const filteredChunks = scoredChunks.filter((c) => c.score >= minScore);

  // Sort by score and take top K
  const topK = query.topK ?? 5;
  const topChunks = filteredChunks.sort((a, b) => b.score - a.score).slice(0, topK);

  const searchTimeMs = Date.now() - startTime;

  log.debug({ totalMatches: filteredChunks.length, searchTimeMs }, 'Search completed');

  return {
    chunks: topChunks,
    query: query.query,
    totalMatches: filteredChunks.length,
    searchTimeMs,
  };
}

/**
 * Calculate cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }

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
  return denominator === 0 ? 0 : dotProduct / denominator;
}
