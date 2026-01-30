/**
 * Embedding Service - Backward Compatibility Re-exports
 * 
 * This service has been split into focused modules:
 * - chunking.ts - Document chunking logic
 * - embeddings.ts - Vector embedding generation and indexing
 * - vector-search.ts - Semantic search operations
 * 
 * This file re-exports all public functions for backward compatibility.
 */

// Chunking service
export {
  chunkDocument,
  estimateTokenCount,
  extractHighlights,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  type ChunkInput,
  type ChunkData,
} from './chunking.js';

// Embeddings service
export {
  generateEmbeddings,
  generateSingleEmbedding,
  indexDocument,
  indexRepository,
  getVectorIndexStats,
  deleteDocumentChunks,
  deleteRepositoryIndex,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
} from './embeddings.js';

// Vector search service
export {
  semanticSearch,
  cosineSimilarity,
} from './vector-search.js';
