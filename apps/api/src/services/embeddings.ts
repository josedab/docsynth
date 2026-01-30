/**
 * Embeddings Service
 * Handles vector embedding generation and document indexing.
 */

import OpenAI from 'openai';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import type {
  EmbeddingRequest,
  EmbeddingResult,
  VectorIndexStats,
  DocumentType,
} from '@docsynth/types';
import { chunkDocument, type ChunkData } from './chunking.js';

const log = createLogger('embeddings-service');

// ============================================================================
// Constants
// ============================================================================

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100;

// ============================================================================
// OpenAI Client
// ============================================================================

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generate embeddings for an array of text strings.
 */
export async function generateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResult> {
  const model = request.model ?? EMBEDDING_MODEL;

  try {
    const response = await openai.embeddings.create({
      model,
      input: request.texts,
    });

    const embeddings = response.data.map((d) => d.embedding);

    return {
      embeddings,
      model,
      tokensUsed: response.usage.total_tokens,
    };
  } catch (error) {
    log.error({ error }, 'Failed to generate embeddings');
    throw error;
  }
}

/**
 * Generate embedding for a single text string.
 */
export async function generateSingleEmbedding(text: string): Promise<number[]> {
  const result = await generateEmbeddings({ texts: [text] });
  return result.embeddings[0] ?? [];
}

// ============================================================================
// Document Indexing
// ============================================================================

/**
 * Index a single document for semantic search.
 * Creates vector embeddings for all chunks and stores them in the database.
 */
export async function indexDocument(
  documentId: string,
  repositoryId: string
): Promise<{ chunksCreated: number; tokensUsed: number }> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  // Delete existing chunks
  await prisma.documentChunk.deleteMany({
    where: { documentId },
  });

  // Create new chunks
  const chunks = chunkDocument({
    content: document.content,
    documentId,
    repositoryId,
    documentPath: document.path,
    documentType: document.type as DocumentType,
    documentTitle: document.title,
  });

  if (chunks.length === 0) {
    return { chunksCreated: 0, tokensUsed: 0 };
  }

  // Generate embeddings in batches
  let totalTokensUsed = 0;
  const chunksWithEmbeddings: (ChunkData & { embedding: number[] })[] = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.content);

    const result = await generateEmbeddings({ texts });
    totalTokensUsed += result.tokensUsed;

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      if (chunk) {
        chunksWithEmbeddings.push({
          ...chunk,
          embedding: result.embeddings[j] ?? [],
        });
      }
    }
  }

  // Store chunks in database
  await prisma.documentChunk.createMany({
    data: chunksWithEmbeddings.map((c) => ({
      documentId: c.documentId,
      repositoryId: c.repositoryId,
      chunkIndex: c.chunkIndex,
      content: c.content,
      embedding: c.embedding,
      metadata: c.metadata as object,
    })),
  });

  // Update vector index metadata
  await updateVectorIndexMeta(repositoryId);

  log.info({ documentId, chunksCreated: chunks.length, tokensUsed: totalTokensUsed }, 'Document indexed');

  return { chunksCreated: chunks.length, tokensUsed: totalTokensUsed };
}

/**
 * Index all documents in a repository.
 */
export async function indexRepository(repositoryId: string): Promise<{
  documentsIndexed: number;
  chunksCreated: number;
  tokensUsed: number;
}> {
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true },
  });

  let totalChunks = 0;
  let totalTokens = 0;

  for (const doc of documents) {
    const result = await indexDocument(doc.id, repositoryId);
    totalChunks += result.chunksCreated;
    totalTokens += result.tokensUsed;
  }

  await updateVectorIndexMeta(repositoryId);

  log.info(
    { repositoryId, documentsIndexed: documents.length, chunksCreated: totalChunks, tokensUsed: totalTokens },
    'Repository indexed'
  );

  return {
    documentsIndexed: documents.length,
    chunksCreated: totalChunks,
    tokensUsed: totalTokens,
  };
}

/**
 * Update vector index metadata for a repository.
 */
async function updateVectorIndexMeta(repositoryId: string): Promise<void> {
  const [chunkCount, docCount] = await Promise.all([
    prisma.documentChunk.count({ where: { repositoryId } }),
    prisma.document.count({ where: { repositoryId } }),
  ]);

  await prisma.vectorIndexMeta.upsert({
    where: { repositoryId },
    create: {
      repositoryId,
      totalChunks: chunkCount,
      totalDocuments: docCount,
      embeddingModel: EMBEDDING_MODEL,
      dimensionality: EMBEDDING_DIMENSIONS,
      lastIndexedAt: new Date(),
    },
    update: {
      totalChunks: chunkCount,
      totalDocuments: docCount,
      lastIndexedAt: new Date(),
    },
  });
}

// ============================================================================
// Index Management
// ============================================================================

/**
 * Get vector index statistics for a repository.
 */
export async function getVectorIndexStats(repositoryId: string): Promise<VectorIndexStats | null> {
  const meta = await prisma.vectorIndexMeta.findUnique({
    where: { repositoryId },
  });

  if (!meta) {
    return null;
  }

  return {
    repositoryId: meta.repositoryId,
    totalChunks: meta.totalChunks,
    totalDocuments: meta.totalDocuments,
    lastIndexedAt: meta.lastIndexedAt,
    embeddingModel: meta.embeddingModel,
    dimensionality: meta.dimensionality,
  };
}

/**
 * Delete all chunks for a document.
 */
export async function deleteDocumentChunks(documentId: string): Promise<number> {
  const result = await prisma.documentChunk.deleteMany({
    where: { documentId },
  });

  return result.count;
}

/**
 * Delete the entire vector index for a repository.
 */
export async function deleteRepositoryIndex(repositoryId: string): Promise<void> {
  await prisma.documentChunk.deleteMany({
    where: { repositoryId },
  });

  await prisma.vectorIndexMeta.delete({
    where: { repositoryId },
  }).catch(() => {
    // Ignore if not exists
  });
}
