/**
 * Document Chunking Service
 * Handles splitting documents into chunks for vector indexing.
 */

import type { DocumentChunk, DocumentType } from '@docsynth/types';

// ============================================================================
// Constants
// ============================================================================

export const CHUNK_SIZE = 1000; // characters
export const CHUNK_OVERLAP = 200; // characters

// ============================================================================
// Types
// ============================================================================

export interface ChunkInput {
  content: string;
  documentId: string;
  repositoryId: string;
  documentPath: string;
  documentType: DocumentType;
  documentTitle: string;
}

interface Section {
  heading?: string;
  content: string;
}

export type ChunkData = Omit<DocumentChunk, 'id' | 'embedding' | 'createdAt'>;

// ============================================================================
// Chunking Functions
// ============================================================================

/**
 * Chunk a document into smaller pieces suitable for embedding.
 * Uses markdown section headers as natural break points when possible.
 */
export function chunkDocument(input: ChunkInput): ChunkData[] {
  const { content, documentId, repositoryId, documentPath, documentType, documentTitle } = input;
  const chunks: ChunkData[] = [];

  // Split by sections first (markdown headers)
  const sections = splitBySections(content);

  let chunkIndex = 0;
  for (const section of sections) {
    const sectionChunks = splitBySize(section.content, CHUNK_SIZE, CHUNK_OVERLAP);

    for (const chunkContent of sectionChunks) {
      const tokenCount = estimateTokenCount(chunkContent);

      chunks.push({
        documentId,
        repositoryId,
        chunkIndex,
        content: chunkContent,
        metadata: {
          documentPath,
          documentType,
          documentTitle,
          sectionHeading: section.heading,
          tokenCount,
        },
      });
      chunkIndex++;
    }
  }

  return chunks;
}

/**
 * Split content by markdown section headers.
 */
function splitBySections(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];
  let currentSection: Section = { content: '' };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (currentSection.content.trim()) {
        sections.push(currentSection);
      }
      currentSection = {
        heading: headingMatch[2],
        content: line + '\n',
      };
    } else {
      currentSection.content += line + '\n';
    }
  }

  if (currentSection.content.trim()) {
    sections.push(currentSection);
  }

  return sections.length > 0 ? sections : [{ content }];
}

/**
 * Split text by size with overlap, breaking at natural boundaries when possible.
 */
function splitBySize(text: string, maxSize: number, overlap: number): string[] {
  if (text.length <= maxSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxSize;

    // Try to break at sentence or paragraph boundary
    if (end < text.length) {
      const lastParagraph = text.lastIndexOf('\n\n', end);
      const lastSentence = text.lastIndexOf('. ', end);
      const lastNewline = text.lastIndexOf('\n', end);

      if (lastParagraph > start + maxSize / 2) {
        end = lastParagraph + 2;
      } else if (lastSentence > start + maxSize / 2) {
        end = lastSentence + 2;
      } else if (lastNewline > start + maxSize / 2) {
        end = lastNewline + 1;
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Estimate token count for a text string.
 * Uses rough approximation of ~4 characters per token for English text.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract highlights from content that match query terms.
 */
export function extractHighlights(content: string, query: string): string[] {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  const highlights: string[] = [];

  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase();
    const matchCount = queryTerms.filter((term) => sentenceLower.includes(term)).length;

    if (matchCount > 0) {
      highlights.push(sentence.trim());
    }

    if (highlights.length >= 3) break;
  }

  return highlights;
}
