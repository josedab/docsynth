import { createLogger, createLLMClient, type LLMClient } from '@docsynth/utils';

const log = createLogger('chat-rag-service');

// Local type that matches what we return (compatible with ChatSource but more flexible)
interface SourceReference {
  documentId: string;
  documentPath: string;
  excerpt: string;
  relevanceScore: number;
  type?: 'document' | 'code';
}

interface RAGInput {
  query: string;
  repositoryId: string;
  context?: ChatContext;
  conversationHistory?: Array<{ role: string; content: string }>;
}

interface ChatContext {
  documentIds?: string[];
  filePaths?: string[];
  topics?: string[];
}

interface RAGResult {
  answer: string;
  sources: SourceReference[];
  confidence: number;
}

interface DocumentChunk {
  id: string;
  documentId: string;
  title: string;
  content: string;
  type: string;
  path: string;
}

interface CodeChunk {
  path: string;
  content: string;
  language: string;
}

class ChatRAGService {
  private llmClient: LLMClient;

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient ?? createLLMClient();
  }

  /**
   * Answer a question using RAG (Retrieval Augmented Generation)
   */
  async answer(input: RAGInput, documents: DocumentChunk[], codeFiles: CodeChunk[]): Promise<RAGResult> {
    const { query, context, conversationHistory } = input;

    log.info({ query: query.substring(0, 50), docCount: documents.length }, 'Processing RAG query');

    // Step 1: Understand the query intent
    const intent = this.classifyIntent(query);

    // Step 2: Retrieve relevant chunks
    const relevantDocs = this.retrieveRelevantDocs(query, documents, context);
    const relevantCode = intent.needsCode ? this.retrieveRelevantCode(query, codeFiles, context) : [];

    // Step 3: Build context for answer generation
    const ragContext = this.buildRAGContext(relevantDocs, relevantCode, conversationHistory);

    // Step 4: Generate answer
    const answer = await this.generateAnswer(query, ragContext, intent);

    // Step 5: Extract sources
    const sources = this.extractSources(relevantDocs, relevantCode);

    // Step 6: Calculate confidence
    const confidence = this.calculateConfidence(relevantDocs.length, relevantCode.length, intent);

    return { answer, sources, confidence };
  }

  /**
   * Classify the intent of the query
   */
  private classifyIntent(query: string): { type: string; needsCode: boolean; keywords: string[] } {
    const queryLower = query.toLowerCase();

    const intents = [
      {
        type: 'how_to',
        patterns: ['how do i', 'how to', 'how can i', 'what is the way to'],
        needsCode: true,
      },
      {
        type: 'what_is',
        patterns: ['what is', 'what are', 'explain', 'describe', 'definition'],
        needsCode: false,
      },
      {
        type: 'where_is',
        patterns: ['where is', 'where can i find', 'location of', 'which file'],
        needsCode: true,
      },
      {
        type: 'why',
        patterns: ['why does', 'why is', 'reason for', 'purpose of'],
        needsCode: false,
      },
      {
        type: 'troubleshoot',
        patterns: ['error', 'not working', 'issue', 'problem', 'fix', 'debug'],
        needsCode: true,
      },
      {
        type: 'example',
        patterns: ['example', 'sample', 'show me', 'demonstrate'],
        needsCode: true,
      },
    ];

    for (const intent of intents) {
      if (intent.patterns.some((p) => queryLower.includes(p))) {
        return {
          type: intent.type,
          needsCode: intent.needsCode,
          keywords: this.extractKeywords(query),
        };
      }
    }

    return {
      type: 'general',
      needsCode: true,
      keywords: this.extractKeywords(query),
    };
  }

  /**
   * Extract keywords from query
   */
  private extractKeywords(query: string): string[] {
    // Remove common words and extract meaningful terms
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at',
      'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after',
      'how', 'what', 'where', 'when', 'why', 'which', 'who', 'whom',
      'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
    ]);

    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Retrieve relevant document chunks
   */
  private retrieveRelevantDocs(
    query: string,
    documents: DocumentChunk[],
    context?: ChatContext
  ): Array<DocumentChunk & { relevance: number }> {
    const keywords = this.extractKeywords(query);
    const scored: Array<DocumentChunk & { relevance: number }> = [];

    for (const doc of documents) {
      let score = 0;
      const contentLower = doc.content.toLowerCase();
      const titleLower = doc.title.toLowerCase();

      // Keyword matching
      for (const keyword of keywords) {
        if (titleLower.includes(keyword)) score += 3;
        if (contentLower.includes(keyword)) {
          const count = (contentLower.match(new RegExp(keyword, 'g')) || []).length;
          score += Math.min(count, 5);
        }
      }

      // Context boost
      if (context?.documentIds?.includes(doc.documentId)) score += 5;
      if (context?.topics?.some((t) => contentLower.includes(t.toLowerCase()))) score += 3;

      // Document type relevance
      if (query.toLowerCase().includes('api') && doc.type === 'API_REFERENCE') score += 5;
      if (query.toLowerCase().includes('setup') && doc.type === 'GUIDE') score += 3;

      if (score > 0) {
        scored.push({ ...doc, relevance: score });
      }
    }

    // Sort by relevance and return top results
    return scored.sort((a, b) => b.relevance - a.relevance).slice(0, 5);
  }

  /**
   * Retrieve relevant code chunks
   */
  private retrieveRelevantCode(
    query: string,
    codeFiles: CodeChunk[],
    context?: ChatContext
  ): Array<CodeChunk & { relevance: number }> {
    const keywords = this.extractKeywords(query);
    const scored: Array<CodeChunk & { relevance: number }> = [];

    for (const file of codeFiles) {
      let score = 0;
      const contentLower = file.content.toLowerCase();
      const pathLower = file.path.toLowerCase();

      // Keyword matching
      for (const keyword of keywords) {
        if (pathLower.includes(keyword)) score += 3;
        if (contentLower.includes(keyword)) {
          const count = (contentLower.match(new RegExp(keyword, 'g')) || []).length;
          score += Math.min(count, 3);
        }
      }

      // Context boost
      if (context?.filePaths?.some((p) => file.path.includes(p))) score += 5;

      if (score > 0) {
        scored.push({ ...file, relevance: score });
      }
    }

    return scored.sort((a, b) => b.relevance - a.relevance).slice(0, 3);
  }

  /**
   * Build context for answer generation
   */
  private buildRAGContext(
    docs: Array<DocumentChunk & { relevance: number }>,
    code: Array<CodeChunk & { relevance: number }>,
    history?: Array<{ role: string; content: string }>
  ): string {
    let context = '';

    // Add relevant documentation
    if (docs.length > 0) {
      context += '## Relevant Documentation\n\n';
      for (const doc of docs) {
        context += `### ${doc.title} (${doc.path})\n`;
        // Truncate content to avoid token limits
        context += doc.content.substring(0, 1000) + '\n\n';
      }
    }

    // Add relevant code
    if (code.length > 0) {
      context += '## Relevant Code\n\n';
      for (const file of code) {
        context += `### ${file.path}\n`;
        context += '```' + file.language + '\n';
        context += file.content.substring(0, 500) + '\n';
        context += '```\n\n';
      }
    }

    // Add conversation history
    if (history && history.length > 0) {
      context += '## Previous Conversation\n\n';
      for (const msg of history.slice(-3)) {
        context += `${msg.role}: ${msg.content}\n`;
      }
    }

    return context;
  }

  /**
   * Generate answer based on context using LLM when available
   */
  private async generateAnswer(
    query: string,
    context: string,
    intent: { type: string; keywords: string[] }
  ): Promise<string> {
    if (!context.trim()) {
      return `I couldn't find specific information about "${query}" in the documentation. Could you try rephrasing your question or provide more context?`;
    }

    // Try LLM-based answer generation
    const prompt = this.buildAnswerPrompt(query, context, intent);
    const result = await this.llmClient.generate(prompt, { maxTokens: 1024 });

    if (result.provider !== 'fallback' && result.content) {
      return result.content;
    }

    // Fallback: generate a structured response based on available context
    return this.generateFallbackAnswer(query, context, intent);
  }

  private buildAnswerPrompt(
    query: string,
    context: string,
    intent: { type: string; keywords: string[] }
  ): string {
    return `You are a helpful documentation assistant. Answer the user's question based on the provided context.

Question: ${query}
Intent type: ${intent.type}
Keywords: ${intent.keywords.join(', ')}

Context from documentation:
${context}

Instructions:
- Answer directly and concisely
- Reference specific parts of the context when applicable
- If the context doesn't fully answer the question, acknowledge what's missing
- Use markdown formatting for code blocks and lists

Answer:`;
  }

  private generateFallbackAnswer(
    query: string,
    context: string,
    intent: { type: string; keywords: string[] }
  ): string {
    const points = this.extractKeyPoints(context);

    let answer = '';

    switch (intent.type) {
      case 'how_to':
        answer = `Here's how to ${query.replace(/^how (do i|to|can i)\s*/i, '')}:\n\n`;
        answer += points.map((p, i) => `${i + 1}. ${p}`).join('\n');
        break;

      case 'what_is':
        answer = `Based on the documentation:\n\n`;
        answer += points.join('\n\n');
        break;

      case 'where_is':
        answer = `You can find this in:\n\n`;
        answer += points.map((p) => `- ${p}`).join('\n');
        break;

      case 'troubleshoot':
        answer = `Here are some suggestions to resolve this:\n\n`;
        answer += points.map((p, i) => `${i + 1}. ${p}`).join('\n');
        break;

      case 'example':
        answer = `Here's an example:\n\n`;
        answer += points.join('\n\n');
        break;

      default:
        answer = points.join('\n\n');
    }

    return answer || `I found some relevant information but couldn't formulate a complete answer. Please check the referenced sources.`;
  }

  /**
   * Extract key points from context
   */
  private extractKeyPoints(context: string): string[] {
    const points: string[] = [];
    const lines = context.split('\n').filter((l) => l.trim().length > 0);

    for (const line of lines) {
      // Extract headings
      if (line.startsWith('#')) {
        points.push(line.replace(/^#+\s*/, ''));
      }
      // Extract list items
      else if (line.match(/^[-*]\s/) || line.match(/^\d+\.\s/)) {
        points.push(line.replace(/^[-*\d.]+\s*/, ''));
      }
      // Extract sentences with keywords
      else if (line.length > 30 && line.length < 200) {
        points.push(line.trim());
      }
    }

    // Deduplicate and limit
    return [...new Set(points)].slice(0, 5);
  }

  /**
   * Extract sources for citation
   */
  private extractSources(
    docs: Array<DocumentChunk & { relevance: number }>,
    code: Array<CodeChunk & { relevance: number }>
  ): SourceReference[] {
    const sources: SourceReference[] = [];

    for (const doc of docs) {
      sources.push({
        documentId: doc.documentId,
        documentPath: doc.path,
        excerpt: doc.content.substring(0, 150) + '...',
        relevanceScore: doc.relevance / 10,
        type: 'document',
      });
    }

    for (const file of code) {
      sources.push({
        documentId: file.path,
        documentPath: file.path,
        excerpt: file.content.substring(0, 100) + '...',
        relevanceScore: file.relevance / 10,
        type: 'code',
      });
    }

    return sources.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    docCount: number,
    codeCount: number,
    intent: { type: string; needsCode?: boolean }
  ): number {
    let confidence = 0.5;

    // Boost for having sources
    if (docCount > 0) confidence += 0.2;
    if (docCount > 2) confidence += 0.1;
    if (codeCount > 0 && intent.needsCode) confidence += 0.1;

    // Intent-specific adjustments
    if (intent.type === 'what_is' && docCount > 0) confidence += 0.1;
    if (intent.type === 'how_to' && codeCount > 0) confidence += 0.1;

    return Math.min(1.0, confidence);
  }
}

export const chatRAGService = new ChatRAGService();
