import { Hono } from 'hono';
import { prisma, type ExtendedPrismaClient, getExtendedPrisma } from '@docsynth/database';
import { RedisSessionStore } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimitByResource } from '../middleware/rate-limiter.js';
import { validateBody } from '../middleware/validate.js';
import { NotFoundError, ValidationError, generateId, createLogger, getAnthropicClient } from '@docsynth/utils';
import type { ChatMessage, ChatSource, ChatSession } from '@docsynth/types';
import {
  startChatStream,
  streamChatChunk,
  endChatStream,
  streamChatError,
  getChatSessionClients,
} from '../services/websocket.js';
import { semanticSearch, getVectorIndexStats } from '../services/embedding.js';
import {
  createChatSessionSchema,
  sendChatMessageSchema,
  type CreateChatSessionInput,
  type SendChatMessageInput,
} from '../schemas/request-schemas.js';
import { DEFAULT_PAGE_SIZE } from '../constants.js';

const app = new Hono();
const log = createLogger('chat-routes');

// Extended Prisma client with type-safe access to newer models
const db: ExtendedPrismaClient = getExtendedPrisma(prisma);

// Redis session store for chat sessions (TTL: 24 hours)
const chatSessionStore = new RedisSessionStore<ChatSession>({
  prefix: 'chat-session',
  defaultTtlSeconds: 24 * 60 * 60, // 24 hours
});

// Chat message rate limiter (per session)
const chatMessageRateLimit = rateLimitByResource(
  (c) => c.req.param('sessionId') || 'unknown',
  'chat'
);

// Start a new chat session
app.post('/sessions', requireAuth, requireOrgAccess, validateBody(createChatSessionSchema), async (c) => {
  const orgId = c.get('organizationId');
  const userId = c.get('userId');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (c as any).get('validatedBody') as CreateChatSessionInput;

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  const sessionId = generateId('chat');
  const session: ChatSession = {
    id: sessionId,
    repositoryId: body.repositoryId,
    userId,
    messages: [],
    createdAt: new Date(),
    lastMessageAt: new Date(),
  };

  await chatSessionStore.set(sessionId, session);
  log.info({ sessionId, repositoryId: body.repositoryId }, 'Created new chat session');

  return c.json({
    success: true,
    data: {
      sessionId,
      repositoryId: body.repositoryId,
    },
  }, 201);
});

// Send a message in a chat session
app.post('/sessions/:sessionId/messages', requireAuth, requireOrgAccess, chatMessageRateLimit, validateBody(sendChatMessageSchema), async (c) => {
  const sessionId = c.req.param('sessionId');
  const orgId = c.get('organizationId');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (c as any).get('validatedBody') as SendChatMessageInput;

  const session = await chatSessionStore.get(sessionId);
  if (!session) {
    throw new NotFoundError('Chat session', sessionId);
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: session.repositoryId, organizationId: orgId },
    include: {
      documents: {
        select: { id: true, path: true, type: true, title: true, content: true },
        take: DEFAULT_PAGE_SIZE,
      },
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', session.repositoryId);
  }

  // Add user message
  const userMessage: ChatMessage = {
    id: generateId('msg'),
    role: 'user',
    content: body.message,
    timestamp: new Date(),
  };
  session.messages.push(userMessage);

  // Build context from documents
  const relevantDocs = findRelevantDocuments(body.message, repository.documents);

  // Generate response using RAG
  const response = await generateRAGResponse(
    body.message,
    relevantDocs,
    session.messages.slice(-10), // Last 10 messages for context
    repository.name
  );

  // Add assistant message
  const assistantMessage: ChatMessage = {
    id: generateId('msg'),
    role: 'assistant',
    content: response.content,
    timestamp: new Date(),
    sources: response.sources,
  };
  session.messages.push(assistantMessage);
  session.lastMessageAt = new Date();

  // Update session in Redis
  await chatSessionStore.set(sessionId, session);
  log.info({ sessionId, messageId: assistantMessage.id }, 'Processed chat message');

  return c.json({
    success: true,
    data: {
      message: assistantMessage,
      sources: response.sources,
    },
  });
});

// Get chat session history
app.get('/sessions/:sessionId', requireAuth, async (c) => {
  const sessionId = c.req.param('sessionId');
  const session = await chatSessionStore.get(sessionId);

  if (!session) {
    throw new NotFoundError('Chat session', sessionId);
  }

  // Extend session TTL on access
  await chatSessionStore.extend(sessionId);

  return c.json({
    success: true,
    data: session,
  });
});

// Delete a chat session
app.delete('/sessions/:sessionId', requireAuth, async (c) => {
  const sessionId = c.req.param('sessionId');
  const session = await chatSessionStore.get(sessionId);

  if (!session) {
    throw new NotFoundError('Chat session', sessionId);
  }

  await chatSessionStore.delete(sessionId);
  log.info({ sessionId }, 'Deleted chat session');

  return c.json({
    success: true,
    message: 'Session deleted',
  });
});

// Submit feedback for a chat message
app.post('/sessions/:sessionId/messages/:messageId/feedback', requireAuth, async (c) => {
  const sessionId = c.req.param('sessionId');
  const messageId = c.req.param('messageId');
  const userId = c.get('userId');
  const body = await c.req.json<{
    rating: 'helpful' | 'not-helpful';
    feedbackText?: string;
    suggestedAnswer?: string;
  }>();

  if (!body.rating || !['helpful', 'not-helpful'].includes(body.rating)) {
    throw new ValidationError('rating must be "helpful" or "not-helpful"');
  }

  const session = await chatSessionStore.get(sessionId);
  if (!session) {
    throw new NotFoundError('Chat session', sessionId);
  }

  // Verify the message exists in the session
  const messageExists = session.messages.some((m) => m.id === messageId);
  if (!messageExists) {
    throw new NotFoundError('Message', messageId);
  }

  // Store feedback in database
  const feedback = await db.chatFeedback.create({
    data: {
      messageId,
      sessionId,
      userId,
      rating: body.rating,
      feedbackText: body.feedbackText,
      suggestedAnswer: body.suggestedAnswer,
    },
  });

  log.info({ sessionId, messageId, rating: body.rating }, 'Chat feedback submitted');

  return c.json({
    success: true,
    data: {
      feedbackId: feedback.id,
      rating: body.rating,
    },
  }, 201);
});

// Get chat analytics for a repository
app.get('/analytics/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Get vector index stats
  const indexStats = await getVectorIndexStats(repositoryId);

  // Get feedback statistics
  const [totalFeedback, helpfulCount] = await Promise.all([
    db.chatFeedback.count(),
    db.chatFeedback.count({ where: { rating: 'helpful' } }),
  ]);

  const helpfulRatio = totalFeedback > 0 ? helpfulCount / totalFeedback : 0;

  return c.json({
    success: true,
    data: {
      repositoryId,
      vectorIndex: indexStats,
      feedback: {
        total: totalFeedback,
        helpful: helpfulCount,
        notHelpful: totalFeedback - helpfulCount,
        helpfulRatio,
      },
    },
  });
});

// Send a message with streaming (for WebSocket clients)
app.post('/sessions/:sessionId/messages/stream', requireAuth, requireOrgAccess, chatMessageRateLimit, async (c) => {
  const sessionId = c.req.param('sessionId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ message: string }>();

  if (!body.message) {
    throw new ValidationError('message is required');
  }

  const session = await chatSessionStore.get(sessionId);
  if (!session) {
    throw new NotFoundError('Chat session', sessionId);
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: session.repositoryId, organizationId: orgId },
    include: {
      documents: {
        select: { id: true, path: true, type: true, title: true, content: true },
        take: DEFAULT_PAGE_SIZE,
      },
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', session.repositoryId);
  }

  // Add user message
  const userMessage: ChatMessage = {
    id: generateId('msg'),
    role: 'user',
    content: body.message,
    timestamp: new Date(),
  };
  session.messages.push(userMessage);

  // Generate message ID for the response
  const assistantMessageId = generateId('msg');
  
  // Check if WebSocket clients are connected
  const wsClients = getChatSessionClients(sessionId);
  
  if (wsClients > 0) {
    // Stream response via WebSocket
    log.info({ sessionId, wsClients }, 'Streaming chat response via WebSocket');
    
    // Start the stream
    startChatStream(sessionId, assistantMessageId);
    
    // Process in background and stream
    streamRAGResponse(
      sessionId,
      assistantMessageId,
      body.message,
      findRelevantDocuments(body.message, repository.documents),
      session,
      repository.name,
      chatSessionStore
    ).catch((error) => {
      log.error({ error, sessionId }, 'Streaming error');
      streamChatError(sessionId, assistantMessageId, 'Failed to generate response');
    });

    // Return immediately - response will be streamed via WebSocket
    return c.json({
      success: true,
      data: {
        messageId: assistantMessageId,
        streaming: true,
        wsClients,
      },
    }, 202);
  } else {
    // Fallback to synchronous response if no WebSocket clients
    const relevantDocs = findRelevantDocuments(body.message, repository.documents);
    const response = await generateRAGResponse(
      body.message,
      relevantDocs,
      session.messages.slice(-10),
      repository.name
    );

    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: response.content,
      timestamp: new Date(),
      sources: response.sources,
    };
    session.messages.push(assistantMessage);
    session.lastMessageAt = new Date();
    await chatSessionStore.set(sessionId, session);

    return c.json({
      success: true,
      data: {
        message: assistantMessage,
        sources: response.sources,
        streaming: false,
      },
    });
  }
});

// Semantic search endpoint for direct querying
app.post('/search', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    query: string;
    topK?: number;
    minScore?: number;
  }>();

  if (!body.repositoryId || !body.query) {
    throw new ValidationError('repositoryId and query are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Check if vector index exists
  const indexStats = await getVectorIndexStats(body.repositoryId);

  if (!indexStats || indexStats.totalChunks === 0) {
    return c.json({
      success: true,
      data: {
        results: [],
        message: 'No vector index found. Please index the repository first.',
        indexed: false,
      },
    });
  }

  // Perform semantic search
  const searchResult = await semanticSearch({
    query: body.query,
    repositoryId: body.repositoryId,
    topK: body.topK ?? 5,
    minScore: body.minScore ?? 0.3,
  });

  return c.json({
    success: true,
    data: {
      results: searchResult.chunks.map((c) => ({
        documentId: c.chunk.documentId,
        documentPath: c.chunk.metadata.documentPath,
        documentTitle: c.chunk.metadata.documentTitle,
        content: c.chunk.content,
        score: c.score,
        highlights: c.highlights,
      })),
      totalMatches: searchResult.totalMatches,
      searchTimeMs: searchResult.searchTimeMs,
      indexed: true,
    },
  });
});

// Helper: Find relevant documents based on query (fallback for keyword search)
function findRelevantDocuments(
  query: string,
  documents: { id: string; path: string; type: string; title: string; content: string }[]
): { doc: typeof documents[0]; relevance: number }[] {
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

  const scored = documents.map((doc) => {
    let relevance = 0;
    const contentLower = doc.content.toLowerCase();
    const titleLower = doc.title.toLowerCase();

    // Score based on term matches
    for (const term of queryTerms) {
      if (titleLower.includes(term)) relevance += 10;
      if (contentLower.includes(term)) relevance += 1;
    }

    // Boost README and API docs for general questions
    if (doc.type === 'README') relevance += 3;
    if (doc.type === 'API_REFERENCE') relevance += 2;

    return { doc, relevance };
  });

  return scored
    .filter((s) => s.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5);
}

// Helper: Generate response using RAG
async function generateRAGResponse(
  query: string,
  relevantDocs: { doc: { id: string; path: string; content: string; title: string }; relevance: number }[],
  conversationHistory: ChatMessage[],
  repoName: string
): Promise<{ content: string; sources: ChatSource[] }> {
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    return {
      content: 'I apologize, but the AI service is not configured. Please contact support.',
      sources: [],
    };
  }

  // Build context from relevant documents
  const docContext = relevantDocs
    .map((r) => {
      const excerpt = r.doc.content.slice(0, 2000);
      return `### ${r.doc.title} (${r.doc.path})\n${excerpt}`;
    })
    .join('\n\n---\n\n');

  // Build conversation context
  const conversationContext = conversationHistory
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: `You are a helpful documentation assistant for the ${repoName} repository. 
Answer questions based on the provided documentation context. 
If the answer isn't in the documentation, say so clearly.
Keep responses concise and helpful.
Reference specific documents when citing information.`,
      messages: [
        {
          role: 'user',
          content: `## Documentation Context

${docContext || 'No relevant documentation found.'}

## Conversation History

${conversationContext || 'This is the start of the conversation.'}

## Current Question

${query}

Please provide a helpful answer based on the documentation context above.`,
        },
      ],
    });

    const content = response.content[0]?.type === 'text' 
      ? response.content[0].text 
      : 'I apologize, but I could not generate a response.';

    const sources: ChatSource[] = relevantDocs.map((r) => ({
      documentId: r.doc.id,
      documentPath: r.doc.path,
      excerpt: r.doc.content.slice(0, 200) + '...',
      relevanceScore: r.relevance,
    }));

    return { content, sources };
  } catch {
    return {
      content: 'I apologize, but I encountered an error while processing your question. Please try again.',
      sources: [],
    };
  }
}

// Helper: Stream RAG response via WebSocket
async function streamRAGResponse(
  sessionId: string,
  messageId: string,
  query: string,
  relevantDocs: { doc: { id: string; path: string; content: string; title: string }; relevance: number }[],
  session: ChatSession,
  repoName: string,
  sessionStore: RedisSessionStore<ChatSession>
): Promise<void> {
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    streamChatError(sessionId, messageId, 'AI service is not configured');
    return;
  }

  // Build context from relevant documents
  const docContext = relevantDocs
    .map((r) => {
      const excerpt = r.doc.content.slice(0, 2000);
      return `### ${r.doc.title} (${r.doc.path})\n${excerpt}`;
    })
    .join('\n\n---\n\n');

  // Build conversation context
  const conversationContext = session.messages
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  try {
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: `You are a helpful documentation assistant for the ${repoName} repository. 
Answer questions based on the provided documentation context. 
If the answer isn't in the documentation, say so clearly.
Keep responses concise and helpful.
Reference specific documents when citing information.`,
      messages: [
        {
          role: 'user',
          content: `## Documentation Context

${docContext || 'No relevant documentation found.'}

## Conversation History

${conversationContext || 'This is the start of the conversation.'}

## Current Question

${query}

Please provide a helpful answer based on the documentation context above.`,
        },
      ],
    });

    let fullContent = '';

    // Stream each chunk
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const chunk = event.delta.text;
        fullContent += chunk;
        streamChatChunk(sessionId, messageId, chunk);
      }
    }

    // Build sources
    const sources: ChatSource[] = relevantDocs.map((r) => ({
      documentId: r.doc.id,
      documentPath: r.doc.path,
      excerpt: r.doc.content.slice(0, 200) + '...',
      relevanceScore: r.relevance,
    }));

    // Create the full message
    const assistantMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: fullContent,
      timestamp: new Date(),
      sources,
    };

    // Update session
    session.messages.push(assistantMessage);
    session.lastMessageAt = new Date();
    await sessionStore.set(sessionId, session);

    // End the stream
    endChatStream(sessionId, messageId, assistantMessage, sources);
    
    log.info({ sessionId, messageId, contentLength: fullContent.length }, 'Chat stream completed');
  } catch (error) {
    log.error({ error, sessionId, messageId }, 'Streaming RAG error');
    streamChatError(sessionId, messageId, 'Failed to generate response');
    throw error;
  }
}

export { app as chatRoutes };
