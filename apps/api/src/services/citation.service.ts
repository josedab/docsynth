/**
 * Citation Service
 * 
 * Provides smart search with inline citations, source attribution,
 * and verifiable references to documentation.
 */

import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';
import { generateEmbeddings } from './embeddings.js';
import type { DocumentType } from '@docsynth/types';

const log = createLogger('citation-service');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface Citation {
  id: string;
  number: number;
  documentId: string;
  documentPath: string;
  documentTitle: string;
  sectionTitle: string | null;
  lineStart: number;
  lineEnd: number;
  excerpt: string;
  relevanceScore: number;
  url?: string;
}

export interface CitedAnswer {
  content: string;
  citations: Citation[];
  confidence: number;
  query: string;
  searchTimeMs: number;
  suggestedFollowUps: string[];
}

export interface CitationSearchOptions {
  topK?: number;
  minScore?: number;
  documentTypes?: DocumentType[];
  includeCodeBlocks?: boolean;
  maxExcerptLength?: number;
}

class CitationService {
  private readonly DEFAULT_TOP_K = 8;
  private readonly MIN_SCORE = 0.35;
  private readonly MAX_EXCERPT_LENGTH = 300;

  /**
   * Search with citations - returns answer with inline numbered citations
   */
  async searchWithCitations(
    repositoryId: string,
    query: string,
    options: CitationSearchOptions = {}
  ): Promise<CitedAnswer> {
    const startTime = Date.now();
    const topK = options.topK ?? this.DEFAULT_TOP_K;
    const minScore = options.minScore ?? this.MIN_SCORE;

    log.info({ repositoryId, query }, 'Starting citation search');

    try {
      // Generate query embedding
      const embeddingResult = await generateEmbeddings({ texts: [query] });
      const queryEmbedding = embeddingResult.embeddings[0] || [];

      // Search citation index first (if available)
      let citations = await this.searchCitationIndex(repositoryId, queryEmbedding, topK, minScore);

      // Fallback to document chunks if citation index is empty
      if (citations.length === 0) {
        citations = await this.searchDocumentChunks(repositoryId, queryEmbedding, topK, minScore);
      }

      // Number the citations
      citations = citations.map((c, idx) => ({ ...c, number: idx + 1 }));

      // Generate answer with inline citations
      const answer = await this.generateCitedAnswer(query, citations, repositoryId);

      return {
        content: answer.content,
        citations,
        confidence: answer.confidence,
        query,
        searchTimeMs: Date.now() - startTime,
        suggestedFollowUps: answer.followUps,
      };
    } catch (error) {
      log.error({ error, repositoryId, query }, 'Citation search failed');
      return {
        content: 'I encountered an error while searching. Please try again.',
        citations: [],
        confidence: 0,
        query,
        searchTimeMs: Date.now() - startTime,
        suggestedFollowUps: [],
      };
    }
  }

  /**
   * Search the citation index for relevant content
   */
  private async searchCitationIndex(
    repositoryId: string,
    queryEmbedding: number[],
    topK: number,
    minScore: number
  ): Promise<Citation[]> {
    try {
      const citationEntries = await db.citationIndex.findMany({
        where: { repositoryId },
        select: {
          id: true,
          documentId: true,
          content: true,
          sectionTitle: true,
          lineStart: true,
          lineEnd: true,
          heading: true,
          embedding: true,
        },
      });

      if (!citationEntries || citationEntries.length === 0) {
        return [];
      }

      // Score and rank
      const scored = citationEntries
        .map((entry: {
          id: string;
          documentId: string;
          content: string;
          sectionTitle: string | null;
          lineStart: number;
          lineEnd: number;
          heading: string | null;
          embedding: number[];
        }) => ({
          ...entry,
          score: this.cosineSimilarity(queryEmbedding, entry.embedding),
        }))
        .filter((entry: { score: number }) => entry.score >= minScore)
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
        .slice(0, topK);

      // Get document info for each citation
      const documentIds = [...new Set(scored.map((s: { documentId: string }) => s.documentId))] as string[];
      const documents = await prisma.document.findMany({
        where: { id: { in: documentIds } },
        select: { id: true, path: true, title: true },
      });

      const docMap = new Map(documents.map((d) => [d.id, d]));

      return scored.map((entry: {
        id: string;
        documentId: string;
        content: string;
        sectionTitle: string | null;
        lineStart: number;
        lineEnd: number;
        heading: string | null;
        score: number;
      }, idx: number) => {
        const doc = docMap.get(entry.documentId);
        return {
          id: entry.id,
          number: idx + 1,
          documentId: entry.documentId,
          documentPath: doc?.path || '',
          documentTitle: doc?.title || '',
          sectionTitle: entry.sectionTitle || entry.heading,
          lineStart: entry.lineStart,
          lineEnd: entry.lineEnd,
          excerpt: this.truncateExcerpt(entry.content),
          relevanceScore: entry.score,
        };
      });
    } catch (error) {
      log.warn({ error, repositoryId }, 'Citation index search failed, falling back to chunks');
      return [];
    }
  }

  /**
   * Fallback: search document chunks
   */
  private async searchDocumentChunks(
    repositoryId: string,
    queryEmbedding: number[],
    topK: number,
    minScore: number
  ): Promise<Citation[]> {
    const chunks = await db.documentChunk.findMany({
      where: { repositoryId },
      select: {
        id: true,
        documentId: true,
        content: true,
        embedding: true,
        metadata: true,
      },
    });

    if (!chunks || chunks.length === 0) {
      return [];
    }

    const scored = chunks
      .map((chunk: {
        id: string;
        documentId: string;
        content: string;
        embedding: number[];
        metadata: {
          documentPath?: string;
          documentTitle?: string;
          sectionHeading?: string;
          lineStart?: number;
          lineEnd?: number;
        };
      }) => ({
        ...chunk,
        score: this.cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
      .filter((chunk: { score: number }) => chunk.score >= minScore)
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, topK);

    return scored.map((chunk: {
      id: string;
      documentId: string;
      content: string;
      score: number;
      metadata: {
        documentPath?: string;
        documentTitle?: string;
        sectionHeading?: string;
        lineStart?: number;
        lineEnd?: number;
      };
    }, idx: number) => ({
      id: chunk.id,
      number: idx + 1,
      documentId: chunk.documentId,
      documentPath: chunk.metadata.documentPath || '',
      documentTitle: chunk.metadata.documentTitle || '',
      sectionTitle: chunk.metadata.sectionHeading || null,
      lineStart: chunk.metadata.lineStart || 0,
      lineEnd: chunk.metadata.lineEnd || 0,
      excerpt: this.truncateExcerpt(chunk.content),
      relevanceScore: chunk.score,
    }));
  }

  /**
   * Generate answer with inline citations
   */
  private async generateCitedAnswer(
    query: string,
    citations: Citation[],
    repositoryId: string
  ): Promise<{ content: string; confidence: number; followUps: string[] }> {
    const anthropic = getAnthropicClient();
    if (!anthropic) {
      return {
        content: 'AI service is not configured.',
        confidence: 0,
        followUps: [],
      };
    }

    // Build citation context with numbers
    const citationContext = citations
      .map((c) => `[${c.number}] ${c.documentTitle}${c.sectionTitle ? ` > ${c.sectionTitle}` : ''}\n${c.excerpt}`)
      .join('\n\n');

    // Get repository name
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { name: true },
    });

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: `You are a documentation expert for ${repository?.name || 'this project'}.

CRITICAL: You MUST include inline citations in your answers using the format [N] where N is the citation number.

Rules:
1. Reference specific citations when making claims: "The API uses JWT authentication [1]."
2. If information comes from multiple sources, cite all: "...as shown in [1][3]"
3. If you're not sure or the docs don't contain the answer, say so explicitly
4. Be accurate - only cite sources that actually support your statement
5. Keep answers concise but complete

At the end, suggest 2-3 follow-up questions.`,
        messages: [
          {
            role: 'user',
            content: `## Available Sources

${citationContext || 'No relevant sources found.'}

## Question

${query}

Provide an answer with inline citations [N]. If the sources don't contain relevant information, acknowledge that clearly.`,
          },
        ],
      });

      const content =
        response.content[0]?.type === 'text'
          ? response.content[0].text
          : 'Unable to generate response.';

      // Extract follow-up questions
      const followUps = this.extractFollowUps(content);
      
      // Calculate confidence based on:
      // 1. Average citation relevance
      // 2. Whether citations were actually used in the response
      const avgRelevance = citations.reduce((sum, c) => sum + c.relevanceScore, 0) / (citations.length || 1);
      const citationsUsed = (content.match(/\[\d+\]/g) || []).length;
      const citationUsageRatio = citations.length > 0 ? citationsUsed / citations.length : 0;
      
      const confidence = Math.min(100, Math.round((avgRelevance * 60) + (citationUsageRatio * 40)));

      // Clean up follow-up section from main content
      const mainContent = content.replace(/\n*(?:Follow-up questions?|Suggested questions?)[:\s]*\n[\s\S]*$/i, '').trim();

      return {
        content: mainContent,
        confidence,
        followUps,
      };
    } catch (error) {
      log.error({ error }, 'Failed to generate cited answer');
      return {
        content: 'Failed to generate answer. Please try again.',
        confidence: 0,
        followUps: [],
      };
    }
  }

  /**
   * Extract follow-up questions from response
   */
  private extractFollowUps(content: string): string[] {
    const followUps: string[] = [];
    
    // Look for follow-up section
    const followUpMatch = content.match(/(?:Follow-up questions?|Suggested questions?)[:\s]*\n([\s\S]*?)$/i);
    if (followUpMatch && followUpMatch[1]) {
      const lines = followUpMatch[1].split('\n');
      for (const line of lines) {
        const cleaned = line.replace(/^[-•\d.)\s]+/, '').trim();
        if (cleaned && cleaned.endsWith('?')) {
          followUps.push(cleaned);
        }
      }
    }

    return followUps.slice(0, 3);
  }

  /**
   * Build citation index for a repository
   */
  async buildCitationIndex(repositoryId: string, documentId?: string): Promise<{ indexed: number }> {
    log.info({ repositoryId, documentId }, 'Building citation index');

    const whereClause: { repositoryId: string; id?: string } = { repositoryId };
    if (documentId) {
      whereClause.id = documentId;
    }

    const documents = await prisma.document.findMany({
      where: whereClause,
      select: { id: true, path: true, title: true, content: true },
    });

    let indexed = 0;

    for (const doc of documents) {
      try {
        // Parse document into citable sections
        const sections = this.parseDocumentSections(doc.content);

        // Delete existing citations for this document
        await db.citationIndex.deleteMany({
          where: { documentId: doc.id },
        });

        // Create new citations
        for (const section of sections) {
          // Generate content hash
          const contentHash = this.hashContent(section.content);

          // Generate embedding
          const embeddingResult = await generateEmbeddings({ texts: [section.content] });
          const embedding = embeddingResult.embeddings[0] || [];

          await db.citationIndex.create({
            data: {
              repositoryId,
              documentId: doc.id,
              content: section.content,
              contentHash,
              sectionTitle: section.sectionTitle,
              lineStart: section.lineStart,
              lineEnd: section.lineEnd,
              heading: section.heading,
              headingLevel: section.headingLevel,
              codeBlocks: section.codeBlocks,
              keywords: section.keywords,
              embedding,
            },
          });

          indexed++;
        }
      } catch (error) {
        log.warn({ error, documentId: doc.id }, 'Failed to index document');
      }
    }

    log.info({ repositoryId, indexed }, 'Citation index built');
    return { indexed };
  }

  /**
   * Parse document into citable sections
   */
  private parseDocumentSections(content: string): Array<{
    content: string;
    sectionTitle: string | null;
    heading: string | null;
    headingLevel: number | null;
    lineStart: number;
    lineEnd: number;
    codeBlocks: string[];
    keywords: string[];
  }> {
    const sections: Array<{
      content: string;
      sectionTitle: string | null;
      heading: string | null;
      headingLevel: number | null;
      lineStart: number;
      lineEnd: number;
      codeBlocks: string[];
      keywords: string[];
    }> = [];

    const lines = content.split('\n');
    let currentSection: {
      content: string[];
      heading: string | null;
      headingLevel: number | null;
      lineStart: number;
      codeBlocks: string[];
    } = {
      content: [],
      heading: null,
      headingLevel: null,
      lineStart: 1,
      codeBlocks: [],
    };

    let inCodeBlock = false;
    let currentCodeBlock = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const lineNum = i + 1;

      // Handle code blocks
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          currentSection.codeBlocks.push(currentCodeBlock);
          currentCodeBlock = '';
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        currentSection.content.push(line);
        continue;
      }

      if (inCodeBlock) {
        currentCodeBlock += line + '\n';
        currentSection.content.push(line);
        continue;
      }

      // Check for heading
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        // Save previous section if it has content
        if (currentSection.content.length > 0) {
          const sectionContent = currentSection.content.join('\n').trim();
          if (sectionContent.length > 50) { // Only index substantial sections
            sections.push({
              content: sectionContent,
              sectionTitle: currentSection.heading,
              heading: currentSection.heading,
              headingLevel: currentSection.headingLevel,
              lineStart: currentSection.lineStart,
              lineEnd: lineNum - 1,
              codeBlocks: currentSection.codeBlocks,
              keywords: this.extractKeywords(sectionContent),
            });
          }
        }

        // Start new section
        currentSection = {
          content: [line],
          heading: headingMatch[2] ?? '',
          headingLevel: headingMatch[1]?.length ?? 1,
          lineStart: lineNum,
          codeBlocks: [],
        };
      } else {
        currentSection.content.push(line);
      }
    }

    // Add final section
    if (currentSection.content.length > 0) {
      const sectionContent = currentSection.content.join('\n').trim();
      if (sectionContent.length > 50) {
        sections.push({
          content: sectionContent,
          sectionTitle: currentSection.heading,
          heading: currentSection.heading,
          headingLevel: currentSection.headingLevel,
          lineStart: currentSection.lineStart,
          lineEnd: lines.length,
          codeBlocks: currentSection.codeBlocks,
          keywords: this.extractKeywords(sectionContent),
        });
      }
    }

    return sections;
  }

  /**
   * Extract keywords from content
   */
  private extractKeywords(content: string): string[] {
    // Simple keyword extraction - could be enhanced with NLP
    const words = content.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3);

    const wordFreq = new Map<string, number>();
    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }

    // Get top keywords by frequency
    return Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * Generate content hash
   */
  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * Truncate excerpt to max length
   */
  private truncateExcerpt(content: string): string {
    if (content.length <= this.MAX_EXCERPT_LENGTH) {
      return content;
    }
    return content.substring(0, this.MAX_EXCERPT_LENGTH - 3) + '...';
  }

  /**
   * Verify a citation is accurate (check if content still exists)
   */
  async verifyCitation(citationId: string): Promise<boolean> {
    const citation = await db.citationIndex.findUnique({
      where: { id: citationId },
      include: { document: { select: { content: true } } },
    });

    if (!citation || !citation.document) {
      return false;
    }

    // Check if the cited content still exists in the document
    return citation.document.content.includes(citation.content.substring(0, 100));
  }

  // ============================================
  // Public utility methods (for testing/external use)
  // ============================================

  /**
   * Public cosine similarity calculation
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += (a[i] ?? 0) * (b[i] ?? 0);
      normA += (a[i] ?? 0) ** 2;
      normB += (b[i] ?? 0) ** 2;
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Format a citation for display
   */
  formatCitation(citation: {
    documentPath: string;
    lineStart?: number;
    lineEnd?: number;
    relevanceScore: number;
  }): string {
    const { documentPath, lineStart, lineEnd, relevanceScore } = citation;
    let formatted = `[${documentPath}]`;
    if (lineStart !== undefined) {
      formatted += ` (L${lineStart}${lineEnd && lineEnd !== lineStart ? `-${lineEnd}` : ''})`;
    }
    formatted += ` - ${Math.round(relevanceScore * 100)}% match`;
    return formatted;
  }
}

export const citationService = new CitationService();
