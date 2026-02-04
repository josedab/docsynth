/**
 * Review Documentation Service
 *
 * Extracts knowledge and rationale from PR review threads.
 * Captures architectural decisions, design choices, and institutional
 * knowledge that would otherwise be lost in PR comment history.
 */

import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';
import { generateEmbeddings } from './embeddings.js';

const log = createLogger('review-documentation-service');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface ReviewComment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
  in_reply_to_id?: number;
  path?: string;
  line?: number;
  start_line?: number;
}

export interface ReviewThread {
  threadId: string;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  comments: ReviewComment[];
  status: 'open' | 'resolved' | 'dismissed';
}

export interface ExtractedRationale {
  decisionType: string;
  summary: string;
  problemDescription: string;
  solutionChosen: string;
  alternativesConsidered: string[];
  reasoningChain: string[];
  impactLevel: 'low' | 'medium' | 'high' | 'critical';
  affectedFiles: string[];
  affectedComponents: string[];
  confidence: number;
  isSignificant: boolean;
}

export interface ProcessThreadResult {
  threadId: string;
  rationaleId: string | null;
  isSignificant: boolean;
  summary: string | null;
}

export interface KnowledgeEntry {
  topic: string;
  category: string;
  content: string;
  sourceRationales: string[];
  keywords: string[];
}

// ============================================================================
// Review Documentation Service
// ============================================================================

class ReviewDocumentationService {
  private readonly MIN_THREAD_MESSAGES = 2;
  private readonly MIN_CONTENT_LENGTH = 100;
  private readonly SIGNIFICANCE_THRESHOLD = 0.6;

  /**
   * Process a single review thread and extract rationale if significant
   */
  async processReviewThread(
    repositoryId: string,
    prNumber: number,
    prTitle: string,
    thread: ReviewThread
  ): Promise<ProcessThreadResult> {
    log.info({ repositoryId, prNumber, threadId: thread.threadId }, 'Processing review thread');

    // Skip trivial threads
    if (thread.comments.length < this.MIN_THREAD_MESSAGES) {
      return {
        threadId: thread.threadId,
        rationaleId: null,
        isSignificant: false,
        summary: null,
      };
    }

    const totalContent = thread.comments.map((c) => c.body).join(' ');
    if (totalContent.length < this.MIN_CONTENT_LENGTH) {
      return {
        threadId: thread.threadId,
        rationaleId: null,
        isSignificant: false,
        summary: null,
      };
    }

    // Store the thread
    const storedThread = await db.pRReviewThread.upsert({
      where: {
        repositoryId_prNumber_threadId: {
          repositoryId,
          prNumber,
          threadId: thread.threadId,
        },
      },
      create: {
        repositoryId,
        prNumber,
        prTitle,
        threadId: thread.threadId,
        filePath: thread.filePath,
        lineStart: thread.lineStart,
        lineEnd: thread.lineEnd,
        status: thread.status,
      },
      update: {
        status: thread.status,
      },
    });

    // Store comments
    for (const comment of thread.comments) {
      const authorType = this.determineAuthorType(comment, thread.comments);
      const commentType = this.determineCommentType(comment.body);

      await db.pRReviewComment.upsert({
        where: { githubCommentId: comment.id },
        create: {
          threadId: storedThread.id,
          githubCommentId: comment.id,
          authorUsername: comment.user.login,
          authorType,
          body: comment.body,
          commentType,
          inReplyToId: comment.in_reply_to_id?.toString(),
        },
        update: {
          body: comment.body,
          commentType,
        },
      });
    }

    // Extract rationale using AI
    const rationale = await this.extractRationale(thread, prTitle);

    if (!rationale || !rationale.isSignificant) {
      return {
        threadId: thread.threadId,
        rationaleId: null,
        isSignificant: false,
        summary: rationale?.summary || null,
      };
    }

    // Store the rationale
    const storedRationale = await db.reviewRationale.create({
      data: {
        threadId: storedThread.id,
        repositoryId,
        prNumber,
        decisionType: rationale.decisionType,
        summary: rationale.summary,
        problemDescription: rationale.problemDescription,
        solutionChosen: rationale.solutionChosen,
        alternativesConsidered: rationale.alternativesConsidered,
        reasoningChain: rationale.reasoningChain,
        impactLevel: rationale.impactLevel,
        affectedFiles: rationale.affectedFiles,
        affectedComponents: rationale.affectedComponents,
        confidence: rationale.confidence,
        isSignificant: rationale.isSignificant,
      },
    });

    log.info(
      { repositoryId, prNumber, threadId: thread.threadId, rationaleId: storedRationale.id },
      'Extracted significant rationale from review thread'
    );

    return {
      threadId: thread.threadId,
      rationaleId: storedRationale.id,
      isSignificant: true,
      summary: rationale.summary,
    };
  }

  /**
   * Extract rationale from a review thread using AI
   */
  private async extractRationale(
    thread: ReviewThread,
    prTitle: string
  ): Promise<ExtractedRationale | null> {
    const anthropic = getAnthropicClient();
    if (!anthropic) {
      log.warn('Anthropic client not available');
      return null;
    }

    // Build conversation transcript
    const transcript = thread.comments
      .map((c) => `**${c.user.login}**: ${c.body}`)
      .join('\n\n');

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: `You are an expert at extracting architectural decisions and design rationale from code review conversations.

Your task is to analyze a PR review thread and determine:
1. Whether it contains a SIGNIFICANT decision (architectural choice, design pattern, security consideration, performance optimization, or important convention)
2. If significant, extract the full rationale including the problem, solution, alternatives, and reasoning

A thread is SIGNIFICANT if it involves:
- Architectural choices (component design, data flow, API design)
- Design pattern decisions (why pattern X vs Y)
- Security considerations (authentication, authorization, data protection)
- Performance trade-offs (caching strategy, query optimization)
- Important conventions or standards being established
- Breaking change discussions
- Deprecation decisions

A thread is NOT significant if it only involves:
- Typo fixes
- Simple style/formatting changes
- Variable renaming
- Minor refactoring without rationale
- Questions that were answered without broader implications

Return your analysis as JSON.`,
        messages: [
          {
            role: 'user',
            content: `## PR Title
${prTitle}

## File Path
${thread.filePath || 'N/A'}

## Review Thread Conversation

${transcript}

---

Analyze this review thread. Return JSON with the following structure:
{
  "isSignificant": boolean,
  "confidence": number (0-1),
  "decisionType": "architectural" | "design_pattern" | "security" | "performance" | "style" | "refactoring" | "other",
  "summary": "One sentence summary of the decision",
  "problemDescription": "What problem or question was raised",
  "solutionChosen": "What solution/approach was decided on",
  "alternativesConsidered": ["Alternative 1", "Alternative 2"],
  "reasoningChain": ["Reason 1", "Reason 2"],
  "impactLevel": "low" | "medium" | "high" | "critical",
  "affectedComponents": ["Component names mentioned"],
  "affectedFiles": ["File paths mentioned"]
}

If the thread is NOT significant, return:
{
  "isSignificant": false,
  "confidence": number,
  "summary": "Brief description of what the thread was about"
}`,
          },
        ],
      });

      const content =
        response.content[0]?.type === 'text' ? response.content[0].text : null;

      if (!content) {
        return null;
      }

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        log.warn({ thread: thread.threadId }, 'Failed to extract JSON from response');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        isSignificant: boolean;
        confidence: number;
        decisionType?: string;
        summary: string;
        problemDescription?: string;
        solutionChosen?: string;
        alternativesConsidered?: string[];
        reasoningChain?: string[];
        impactLevel?: string;
        affectedComponents?: string[];
        affectedFiles?: string[];
      };

      // Apply significance threshold
      const isSignificant =
        parsed.isSignificant && parsed.confidence >= this.SIGNIFICANCE_THRESHOLD;

      return {
        decisionType: parsed.decisionType || 'other',
        summary: parsed.summary,
        problemDescription: parsed.problemDescription || '',
        solutionChosen: parsed.solutionChosen || '',
        alternativesConsidered: parsed.alternativesConsidered || [],
        reasoningChain: parsed.reasoningChain || [],
        impactLevel: (parsed.impactLevel as 'low' | 'medium' | 'high' | 'critical') || 'medium',
        affectedFiles: parsed.affectedFiles || (thread.filePath ? [thread.filePath] : []),
        affectedComponents: parsed.affectedComponents || [],
        confidence: parsed.confidence,
        isSignificant,
      };
    } catch (error) {
      log.error({ error, thread: thread.threadId }, 'Failed to extract rationale');
      return null;
    }
  }

  /**
   * Build knowledge base entries from accumulated rationales
   */
  async buildKnowledgeBase(repositoryId: string): Promise<{ entriesCreated: number }> {
    log.info({ repositoryId }, 'Building review knowledge base');

    // Get all significant rationales
    const rationales = await db.reviewRationale.findMany({
      where: {
        repositoryId,
        isSignificant: true,
        status: { not: 'dismissed' },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (rationales.length === 0) {
      return { entriesCreated: 0 };
    }

    // Group by decision type
    const byType = new Map<string, typeof rationales>();
    for (const r of rationales) {
      const existing = byType.get(r.decisionType) || [];
      existing.push(r);
      byType.set(r.decisionType, existing);
    }

    let entriesCreated = 0;

    // Create knowledge entries for each category
    for (const [category, categoryRationales] of byType) {
      const knowledgeEntries = await this.synthesizeKnowledge(
        categoryRationales,
        category
      );

      for (const entry of knowledgeEntries) {
        // Generate embedding for searchability
        const embeddingResult = await generateEmbeddings({
          texts: [entry.content],
        });

        await db.reviewKnowledgeBase.create({
          data: {
            repositoryId,
            topic: entry.topic,
            category: entry.category,
            content: entry.content,
            sourceRationales: entry.sourceRationales,
            keywords: entry.keywords,
            embedding: embeddingResult.embeddings[0] || [],
          },
        });

        entriesCreated++;
      }
    }

    log.info({ repositoryId, entriesCreated }, 'Knowledge base updated');
    return { entriesCreated };
  }

  /**
   * Synthesize knowledge entries from rationales
   */
  private async synthesizeKnowledge(
    rationales: Array<{
      id: string;
      summary: string;
      problemDescription: string;
      solutionChosen: string;
      reasoningChain: string[];
      affectedComponents: string[];
    }>,
    category: string
  ): Promise<KnowledgeEntry[]> {
    const anthropic = getAnthropicClient();
    if (!anthropic || rationales.length === 0) {
      return [];
    }

    // Build context from rationales
    const rationaleContext = rationales
      .slice(0, 10) // Limit to recent entries
      .map(
        (r, idx) =>
          `### Decision ${idx + 1}
**Summary**: ${r.summary}
**Problem**: ${r.problemDescription}
**Solution**: ${r.solutionChosen}
**Reasoning**: ${(r.reasoningChain as string[]).join('; ')}`
      )
      .join('\n\n');

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: `You are creating knowledge base entries from code review decisions.

## Category: ${category}

## Review Decisions

${rationaleContext}

---

Synthesize 1-3 knowledge base entries that capture the key patterns, decisions, and conventions from these reviews. Each entry should be:
- Self-contained and understandable without the original context
- Written as a guideline or reference for future developers
- Include practical examples where helpful

Return JSON array:
[
  {
    "topic": "Short topic name",
    "content": "Full knowledge entry content (1-3 paragraphs)",
    "keywords": ["keyword1", "keyword2"]
  }
]`,
          },
        ],
      });

      const content =
        response.content[0]?.type === 'text' ? response.content[0].text : null;

      if (!content) {
        return [];
      }

      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        topic: string;
        content: string;
        keywords: string[];
      }>;

      return parsed.map((p) => ({
        topic: p.topic,
        category,
        content: p.content,
        sourceRationales: rationales.map((r) => r.id),
        keywords: p.keywords,
      }));
    } catch (error) {
      log.error({ error, category }, 'Failed to synthesize knowledge');
      return [];
    }
  }

  /**
   * Query the knowledge base for context about a topic
   */
  async queryKnowledge(
    repositoryId: string,
    query: string,
    options: { topK?: number; category?: string } = {}
  ): Promise<Array<{ topic: string; content: string; relevance: number }>> {
    const topK = options.topK || 5;

    // Generate query embedding
    const embeddingResult = await generateEmbeddings({ texts: [query] });
    const queryEmbedding = embeddingResult.embeddings[0] || [];

    // Get knowledge entries
    const whereClause: { repositoryId: string; isActive: boolean; category?: string } = {
      repositoryId,
      isActive: true,
    };
    if (options.category) {
      whereClause.category = options.category;
    }

    const entries = await db.reviewKnowledgeBase.findMany({
      where: whereClause,
      select: {
        topic: true,
        content: true,
        embedding: true,
      },
    });

    // Score and rank by similarity
    const scored = entries
      .map((entry: { topic: string; content: string; embedding: number[] }) => ({
        topic: entry.topic,
        content: entry.content,
        relevance: this.cosineSimilarity(queryEmbedding, entry.embedding),
      }))
      .filter((e: { relevance: number }) => e.relevance > 0.3)
      .sort((a: { relevance: number }, b: { relevance: number }) => b.relevance - a.relevance)
      .slice(0, topK);

    return scored;
  }

  /**
   * Get rationales for a specific PR
   */
  async getPRRationales(
    repositoryId: string,
    prNumber: number
  ): Promise<
    Array<{
      id: string;
      decisionType: string;
      summary: string;
      solutionChosen: string;
      impactLevel: string;
      confidence: number;
    }>
  > {
    return db.reviewRationale.findMany({
      where: {
        repositoryId,
        prNumber,
        isSignificant: true,
      },
      select: {
        id: true,
        decisionType: true,
        summary: true,
        solutionChosen: true,
        impactLevel: true,
        confidence: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get significant rationales for a repository
   */
  async getSignificantRationales(
    repositoryId: string,
    options: { limit?: number; decisionType?: string } = {}
  ): Promise<
    Array<{
      id: string;
      prNumber: number;
      decisionType: string;
      summary: string;
      impactLevel: string;
      createdAt: Date;
    }>
  > {
    const whereClause: { repositoryId: string; isSignificant: boolean; decisionType?: string } = {
      repositoryId,
      isSignificant: true,
    };
    if (options.decisionType) {
      whereClause.decisionType = options.decisionType;
    }

    return db.reviewRationale.findMany({
      where: whereClause,
      select: {
        id: true,
        prNumber: true,
        decisionType: true,
        summary: true,
        impactLevel: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit || 50,
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private determineAuthorType(
    comment: ReviewComment,
    allComments: ReviewComment[]
  ): string {
    // The first commenter in a thread is typically the reviewer
    const firstComment = allComments[0];
    if (firstComment && comment.user.login === firstComment.user.login) {
      return 'reviewer';
    }
    // Others are likely the PR author or collaborators
    return 'author';
  }

  private determineCommentType(body: string): string {
    const lowerBody = body.toLowerCase();
    if (lowerBody.includes('lgtm') || lowerBody.includes('approved')) {
      return 'approval';
    }
    if (lowerBody.includes('suggestion') || body.includes('```suggestion')) {
      return 'suggestion';
    }
    if (
      lowerBody.includes('please change') ||
      lowerBody.includes('should be') ||
      lowerBody.includes('needs to')
    ) {
      return 'request_changes';
    }
    return 'comment';
  }

  private cosineSimilarity(a: number[], b: number[]): number {
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
}

export const reviewDocumentationService = new ReviewDocumentationService();
