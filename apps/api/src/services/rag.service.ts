/**
 * Enhanced RAG (Retrieval-Augmented Generation) Service
 *
 * Provides intelligent documentation search and chat with:
 * - Semantic search with embeddings
 * - Context-aware chunking
 * - User personalization
 * - Follow-up suggestions
 * - Source attribution
 */

import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';
import type { ChatMessage, ChatSource, DocumentType } from '@docsynth/types';

const log = createLogger('rag-service');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// Configuration
const DEFAULT_TOP_K = 5;
const MIN_RELEVANCE_SCORE = 0.3;
const CONTEXT_WINDOW_TOKENS = 8000;
const MAX_HISTORY_MESSAGES = 10;

export interface RAGContext {
  repositoryId: string;
  userId?: string;
  sessionId?: string;
  userRole?: string;
  preferredTopics?: string[];
  recentDocuments?: string[];
}

export interface RAGSearchResult {
  chunks: ScoredChunk[];
  query: string;
  totalMatches: number;
  searchTimeMs: number;
  suggestedQueries: string[];
}

export interface ScoredChunk {
  id: string;
  documentId: string;
  documentPath: string;
  documentTitle: string;
  documentType: DocumentType;
  content: string;
  score: number;
  sectionHeading?: string;
  highlights?: string[];
}

export interface RAGResponse {
  content: string;
  sources: ChatSource[];
  confidence: number;
  followUpQuestions: string[];
  relatedTopics: string[];
  tokensUsed: number;
}

export interface ChatHistoryContext {
  messages: ChatMessage[];
  topics: string[];
  mentionedDocuments: string[];
}

/**
 * Generate embeddings for text using OpenAI
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.statusText}`);
  }

  const data = (await response.json()) as { data: { embedding: number[] }[] };
  return data.data[0]?.embedding ?? [];
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
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
 * Enhanced semantic search with personalization
 */
export async function semanticSearchEnhanced(
  query: string,
  context: RAGContext,
  options: {
    topK?: number;
    minScore?: number;
    documentTypes?: DocumentType[];
    boostRecent?: boolean;
  } = {}
): Promise<RAGSearchResult> {
  const startTime = Date.now();
  const topK = options.topK ?? DEFAULT_TOP_K;
  const minScore = options.minScore ?? MIN_RELEVANCE_SCORE;

  try {
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);

    // Fetch all chunks for the repository
    const whereClause: Record<string, unknown> = { repositoryId: context.repositoryId };
    if (options.documentTypes?.length) {
      // Filter by document types if specified
    }

    const chunks = await db.documentChunk.findMany({
      where: whereClause,
      select: {
        id: true,
        documentId: true,
        content: true,
        embedding: true,
        metadata: true,
      },
    });

    // Score chunks by similarity
    interface ChunkWithScore {
      id: string;
      documentId: string;
      content: string;
      metadata: {
        documentPath?: string;
        documentTitle?: string;
        documentType?: DocumentType;
        sectionHeading?: string;
      };
      score: number;
    }

    const scoredChunks: ChunkWithScore[] = chunks
      .map((chunk: { id: string; documentId: string; content: string; embedding: number[]; metadata: Record<string, unknown> }) => ({
        ...chunk,
        metadata: chunk.metadata as ChunkWithScore['metadata'],
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
      .filter((chunk: ChunkWithScore) => chunk.score >= minScore)
      .sort((a: ChunkWithScore, b: ChunkWithScore) => b.score - a.score);

    // Apply personalization boosts
    if (context.recentDocuments?.length && options.boostRecent) {
      for (const chunk of scoredChunks) {
        if (context.recentDocuments.includes(chunk.documentId)) {
          chunk.score *= 1.1; // 10% boost for recently viewed docs
        }
      }
      scoredChunks.sort((a: ChunkWithScore, b: ChunkWithScore) => b.score - a.score);
    }

    // Take top K results
    const topChunks = scoredChunks.slice(0, topK);

    // Generate highlights
    const results: ScoredChunk[] = topChunks.map((chunk: ChunkWithScore) => ({
      id: chunk.id,
      documentId: chunk.documentId,
      documentPath: chunk.metadata.documentPath || '',
      documentTitle: chunk.metadata.documentTitle || '',
      documentType: (chunk.metadata.documentType as DocumentType) || 'GUIDE',
      content: chunk.content,
      score: chunk.score,
      sectionHeading: chunk.metadata.sectionHeading,
      highlights: extractHighlights(chunk.content, query),
    }));

    // Generate suggested queries based on content
    const suggestedQueries = generateSuggestedQueries(query, results);

    return {
      chunks: results,
      query,
      totalMatches: scoredChunks.length,
      searchTimeMs: Date.now() - startTime,
      suggestedQueries,
    };
  } catch (error) {
    log.error({ error, query }, 'Semantic search failed');
    return {
      chunks: [],
      query,
      totalMatches: 0,
      searchTimeMs: Date.now() - startTime,
      suggestedQueries: [],
    };
  }
}

/**
 * Extract relevant highlights from content
 */
function extractHighlights(content: string, query: string): string[] {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  const highlights: string[] = [];

  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase();
    const matchCount = queryTerms.filter((term) => sentenceLower.includes(term)).length;

    if (matchCount > 0) {
      highlights.push(sentence.trim());
      if (highlights.length >= 3) break;
    }
  }

  return highlights;
}

/**
 * Generate suggested follow-up queries
 */
function generateSuggestedQueries(originalQuery: string, results: ScoredChunk[]): string[] {
  const suggestions: string[] = [];

  // Extract topics from results
  const topics = new Set<string>();
  for (const result of results) {
    if (result.sectionHeading) {
      topics.add(result.sectionHeading);
    }
  }

  // Generate query variations
  const topicArray = Array.from(topics).slice(0, 3);
  for (const topic of topicArray) {
    suggestions.push(`How does ${topic} work?`);
  }

  if (originalQuery.toLowerCase().includes('how')) {
    suggestions.push(originalQuery.replace(/how/i, 'Why'));
  }

  if (!originalQuery.toLowerCase().includes('example')) {
    suggestions.push(`Show me an example of ${originalQuery}`);
  }

  return suggestions.slice(0, 5);
}

/**
 * Generate RAG response with sources and follow-ups
 */
export async function generateRAGResponseEnhanced(
  query: string,
  context: RAGContext,
  history: ChatHistoryContext,
  options: {
    streaming?: boolean;
    maxTokens?: number;
  } = {}
): Promise<RAGResponse> {
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    return {
      content: 'AI service is not configured. Please contact support.',
      sources: [],
      confidence: 0,
      followUpQuestions: [],
      relatedTopics: [],
      tokensUsed: 0,
    };
  }

  // Get repository info
  const repository = await prisma.repository.findUnique({
    where: { id: context.repositoryId },
    select: { name: true, fullName: true },
  });

  // Search for relevant content
  const searchResults = await semanticSearchEnhanced(query, context, {
    topK: 5,
    boostRecent: true,
  });

  // Build context from search results
  const docContext = searchResults.chunks
    .map((chunk) => {
      return `### ${chunk.documentTitle}${chunk.sectionHeading ? ` > ${chunk.sectionHeading}` : ''}\n${chunk.content}`;
    })
    .join('\n\n---\n\n');

  // Build conversation history
  const historyContext = history.messages
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  // Personalization context
  const personalizationNote = context.userRole
    ? `The user is a ${context.userRole}. Adjust technical depth accordingly.`
    : '';

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: options.maxTokens || 2000,
      system: `You are an expert documentation assistant for the ${repository?.name || 'repository'}.

Your role:
- Answer questions accurately based on the provided documentation
- Cite specific documents when referencing information
- If information isn't in the docs, clearly state that
- Suggest related topics the user might want to explore
- Keep responses helpful and appropriately detailed

${personalizationNote}

At the end of your response, include:
1. A list of 2-3 follow-up questions the user might want to ask
2. Related topics to explore

Format follow-ups as:
**Follow-up questions:**
- Question 1?
- Question 2?

**Related topics:**
- Topic 1
- Topic 2`,
      messages: [
        {
          role: 'user',
          content: `## Documentation Context

${docContext || 'No relevant documentation found for this query.'}

## Conversation History

${historyContext || 'This is the start of the conversation.'}

## Current Question

${query}

Please provide a comprehensive answer based on the documentation.`,
        },
      ],
    });

    const content =
      response.content[0]?.type === 'text' ? response.content[0].text : 'Unable to generate response.';

    // Parse follow-up questions and topics from response
    const { mainContent, followUpQuestions, relatedTopics } = parseResponseSections(content);

    // Build sources from search results
    const sources: ChatSource[] = searchResults.chunks.map((chunk) => ({
      documentId: chunk.documentId,
      documentPath: chunk.documentPath,
      excerpt: chunk.content.slice(0, 200) + '...',
      relevanceScore: chunk.score,
    }));

    // Calculate confidence based on search scores
    const avgScore = searchResults.chunks.reduce((sum, c) => sum + c.score, 0) / (searchResults.chunks.length || 1);
    const confidence = Math.min(avgScore * 100, 100);

    return {
      content: mainContent,
      sources,
      confidence,
      followUpQuestions,
      relatedTopics,
      tokensUsed: response.usage?.output_tokens || 0,
    };
  } catch (error) {
    log.error({ error }, 'RAG response generation failed');
    return {
      content: 'I encountered an error while processing your question. Please try again.',
      sources: [],
      confidence: 0,
      followUpQuestions: [],
      relatedTopics: [],
      tokensUsed: 0,
    };
  }
}

/**
 * Parse response to extract follow-up questions and related topics
 */
function parseResponseSections(content: string): {
  mainContent: string;
  followUpQuestions: string[];
  relatedTopics: string[];
} {
  const followUpQuestions: string[] = [];
  const relatedTopics: string[] = [];

  // Find and extract follow-up questions section
  const followUpMatch = content.match(/\*\*Follow-up questions:\*\*\s*([\s\S]*?)(?=\*\*Related topics:\*\*|$)/i);
  if (followUpMatch && followUpMatch[1]) {
    const questions = followUpMatch[1].match(/^[-•]\s*(.+)/gm);
    if (questions) {
      followUpQuestions.push(...questions.map((q) => q.replace(/^[-•]\s*/, '').trim()));
    }
  }

  // Find and extract related topics section
  const topicsMatch = content.match(/\*\*Related topics:\*\*\s*([\s\S]*?)$/i);
  if (topicsMatch && topicsMatch[1]) {
    const topics = topicsMatch[1].match(/^[-•]\s*(.+)/gm);
    if (topics) {
      relatedTopics.push(...topics.map((t) => t.replace(/^[-•]\s*/, '').trim()));
    }
  }

  // Remove the sections from main content
  let mainContent = content
    .replace(/\*\*Follow-up questions:\*\*[\s\S]*?(?=\*\*Related topics:\*\*|$)/i, '')
    .replace(/\*\*Related topics:\*\*[\s\S]*$/i, '')
    .trim();

  return { mainContent, followUpQuestions, relatedTopics };
}

/**
 * Get personalized context for a user
 */
export async function getUserContext(userId: string, repositoryId: string): Promise<Partial<RAGContext>> {
  try {
    // Get user's recent chat sessions and viewed documents
    const recentSessions = await db.chatSession.findMany({
      where: { userId, repositoryId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { context: true },
    });

    // Extract topics from recent sessions
    const topics: string[] = [];
    const recentDocuments: string[] = [];

    for (const session of recentSessions as { context: { topics?: string[]; documentIds?: string[] } }[]) {
      if (session.context?.topics) {
        topics.push(...session.context.topics);
      }
      if (session.context?.documentIds) {
        recentDocuments.push(...session.context.documentIds);
      }
    }

    return {
      preferredTopics: [...new Set(topics)].slice(0, 10),
      recentDocuments: [...new Set(recentDocuments)].slice(0, 20),
    };
  } catch {
    return {};
  }
}

/**
 * Save feedback for a chat response
 */
export async function saveRAGFeedback(
  sessionId: string,
  messageId: string,
  userId: string,
  rating: 'helpful' | 'not-helpful',
  details?: { feedbackText?: string; suggestedAnswer?: string }
): Promise<void> {
  await db.chatFeedback.create({
    data: {
      sessionId,
      messageId,
      userId,
      rating,
      feedbackText: details?.feedbackText,
      suggestedAnswer: details?.suggestedAnswer,
    },
  });

  log.info({ sessionId, messageId, rating }, 'RAG feedback saved');
}

/**
 * Get unanswered queries for documentation improvement
 */
export async function getUnansweredQueries(
  repositoryId: string,
  limit = 20
): Promise<{ query: string; count: number; lastAsked: Date }[]> {
  // Get queries that received low-confidence or "not found" responses
  const feedbacks = await db.chatFeedback.findMany({
    where: { rating: 'not-helpful' },
    orderBy: { createdAt: 'desc' },
    take: limit * 2,
  });

  // Aggregate similar queries
  const queryMap = new Map<string, { count: number; lastAsked: Date }>();

  for (const feedback of feedbacks as { feedbackText?: string; createdAt: Date }[]) {
    if (feedback.feedbackText) {
      const normalized = feedback.feedbackText.toLowerCase().trim();
      const existing = queryMap.get(normalized);
      if (existing) {
        existing.count++;
        if (feedback.createdAt > existing.lastAsked) {
          existing.lastAsked = feedback.createdAt;
        }
      } else {
        queryMap.set(normalized, { count: 1, lastAsked: feedback.createdAt });
      }
    }
  }

  return Array.from(queryMap.entries())
    .map(([query, stats]) => ({ query, ...stats }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
