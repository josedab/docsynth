/**
 * Documentation Chatbot for Support Service
 *
 * Embeddable chatbot trained on repository documentation. Answers user questions,
 * tracks unanswered topics, integrates with support systems.
 */

import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';

const log = createLogger('doc-chatbot-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface ChatbotMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  confidence?: number;
  sources?: string[];
  timestamp: string;
}

export interface ChatbotConfig {
  widgetTitle: string;
  welcomeMessage: string;
  primaryColor: string;
  position: 'bottom-right' | 'bottom-left';
  escalationEnabled: boolean;
  escalationEmail?: string;
  allowedDomains: string[];
  active: boolean;
}

export interface ChatbotAnalytics {
  totalConversations: number;
  avgSatisfaction: number;
  resolutionRate: number;
  topQuestions: Array<{ question: string; count: number; answered: boolean }>;
  unansweredTopics: string[];
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Process a user message and generate a response
 */
export async function processMessage(
  chatbotConfigId: string,
  conversationId: string,
  userMessage: string,
  visitorId: string
): Promise<ChatbotMessage> {
  // Get chatbot config and associated repository
  const config = await db.chatbotConfig.findUnique({
    where: { id: chatbotConfigId },
  });

  if (!config || !config.active) {
    return {
      role: 'assistant',
      content: 'This chatbot is currently unavailable.',
      confidence: 1,
      sources: [],
      timestamp: new Date().toISOString(),
    };
  }

  // Get conversation history
  const conversation = await db.chatbotConversation.findUnique({
    where: { id: conversationId },
  });

  const previousMessages = (conversation?.messages as ChatbotMessage[]) || [];

  // Search relevant documentation
  const relevantDocs = await searchDocumentation(config.repositoryId as string, userMessage);

  // Build context from relevant docs
  const docContext = relevantDocs
    .map((d) => `## ${d.title}\n${d.content?.substring(0, 1000) || ''}`)
    .join('\n\n');

  // Generate response
  const anthropic = getAnthropicClient();
  let response: ChatbotMessage;

  if (anthropic) {
    try {
      const conversationHistory = previousMessages
        .slice(-6) // Last 6 messages for context
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const aiResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: `You are a helpful documentation assistant for a software project. Answer questions using ONLY the documentation context provided. If you're unsure, say so. Be concise and helpful.\n\nDocumentation context:\n${docContext.substring(0, 4000)}`,
        messages: [...conversationHistory, { role: 'user', content: userMessage }],
      });

      const text = aiResponse.content[0];
      const responseText =
        text && text.type === 'text'
          ? (text as { type: 'text'; text: string }).text
          : "I'm sorry, I couldn't process your question.";

      // Estimate confidence based on doc relevance
      const confidence = relevantDocs.length > 0 ? 0.8 : 0.3;

      response = {
        role: 'assistant',
        content: responseText,
        confidence,
        sources: relevantDocs.map((d) => d.path),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      log.error({ error }, 'Failed to generate chatbot response');
      response = {
        role: 'assistant',
        content:
          "I'm having trouble processing your question right now. Please try again or contact support.",
        confidence: 0,
        sources: [],
        timestamp: new Date().toISOString(),
      };
    }
  } else {
    // Fallback: simple keyword matching
    const matchingDoc = relevantDocs[0];
    response = {
      role: 'assistant',
      content: matchingDoc
        ? `Based on our documentation:\n\n${matchingDoc.content?.substring(0, 500) || 'No content available'}\n\nFor more details, see: ${matchingDoc.path}`
        : "I couldn't find relevant documentation for your question. Would you like to contact support?",
      confidence: matchingDoc ? 0.5 : 0.1,
      sources: matchingDoc ? [matchingDoc.path] : [],
      timestamp: new Date().toISOString(),
    };
  }

  // Update conversation with new messages
  const newMessages = [
    ...previousMessages,
    { role: 'user' as const, content: userMessage, timestamp: new Date().toISOString() },
    response,
  ];

  if (conversation) {
    await db.chatbotConversation.update({
      where: { id: conversationId },
      data: { messages: newMessages },
    });
  } else {
    await db.chatbotConversation.create({
      data: {
        id: conversationId,
        chatbotConfigId,
        visitorId,
        messages: newMessages,
      },
    });
  }

  // Check for escalation
  if (config.escalationEnabled && response.confidence !== undefined && response.confidence < 0.3) {
    log.info({ conversationId, visitorId }, 'Low confidence - escalation suggested');
  }

  return response;
}

/**
 * Get or create chatbot configuration
 */
export async function getChatbotConfig(repositoryId: string): Promise<ChatbotConfig | null> {
  const config = await db.chatbotConfig.findUnique({
    where: { repositoryId },
  });

  if (!config) return null;

  return {
    widgetTitle: config.widgetTitle as string,
    welcomeMessage: config.welcomeMessage as string,
    primaryColor: config.primaryColor as string,
    position: config.position as 'bottom-right' | 'bottom-left',
    escalationEnabled: config.escalationEnabled as boolean,
    escalationEmail: config.escalationEmail as string | undefined,
    allowedDomains: (config.allowedDomains as string[]) || [],
    active: config.active as boolean,
  };
}

/**
 * Create or update chatbot configuration
 */
export async function upsertChatbotConfig(
  repositoryId: string,
  config: Partial<ChatbotConfig>
): Promise<ChatbotConfig> {
  const updated = await db.chatbotConfig.upsert({
    where: { repositoryId },
    create: { repositoryId, ...config },
    update: config,
  });

  return {
    widgetTitle: updated.widgetTitle as string,
    welcomeMessage: updated.welcomeMessage as string,
    primaryColor: updated.primaryColor as string,
    position: updated.position as 'bottom-right' | 'bottom-left',
    escalationEnabled: updated.escalationEnabled as boolean,
    escalationEmail: updated.escalationEmail as string | undefined,
    allowedDomains: (updated.allowedDomains as string[]) || [],
    active: updated.active as boolean,
  };
}

/**
 * Get chatbot analytics
 */
export async function getChatbotAnalytics(
  chatbotConfigId: string,
  days: number = 30
): Promise<ChatbotAnalytics> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const conversations = await db.chatbotConversation.findMany({
    where: { chatbotConfigId, startedAt: { gte: since } },
  });

  const satisfactions = conversations
    .filter((c: { satisfaction: number | null }) => c.satisfaction !== null)
    .map((c: { satisfaction: number }) => c.satisfaction);

  const avgSatisfaction =
    satisfactions.length > 0
      ? satisfactions.reduce((a: number, b: number) => a + b, 0) / satisfactions.length
      : 0;

  // Extract questions and find unanswered ones
  const questionCounts: Record<string, { count: number; answered: boolean }> = {};

  for (const conv of conversations) {
    const messages = (conv.messages as ChatbotMessage[]) || [];
    for (const msg of messages) {
      if (msg.role === 'user') {
        const key = msg.content.substring(0, 100);
        if (!questionCounts[key]) {
          questionCounts[key] = { count: 0, answered: false };
        }
        questionCounts[key]!.count++;
      }
      if (msg.role === 'assistant' && msg.confidence && msg.confidence > 0.5) {
        const prevUserMsg = messages[messages.indexOf(msg) - 1];
        if (prevUserMsg) {
          const key = prevUserMsg.content.substring(0, 100);
          if (questionCounts[key]) {
            questionCounts[key]!.answered = true;
          }
        }
      }
    }
  }

  const topQuestions = Object.entries(questionCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([question, data]) => ({ question, ...data }));

  const unansweredTopics = topQuestions.filter((q) => !q.answered).map((q) => q.question);

  const escalated = conversations.filter((c: { escalated: boolean }) => c.escalated).length;
  const resolutionRate =
    conversations.length > 0
      ? ((conversations.length - escalated) / conversations.length) * 100
      : 100;

  return {
    totalConversations: conversations.length,
    avgSatisfaction,
    resolutionRate,
    topQuestions,
    unansweredTopics,
  };
}

/**
 * Rate a conversation
 */
export async function rateConversation(
  conversationId: string,
  satisfaction: number
): Promise<void> {
  await db.chatbotConversation.update({
    where: { id: conversationId },
    data: { satisfaction: Math.min(5, Math.max(1, satisfaction)) },
  });
}

/**
 * Escalate a conversation
 */
export async function escalateConversation(conversationId: string): Promise<void> {
  await db.chatbotConversation.update({
    where: { id: conversationId },
    data: { escalated: true, endedAt: new Date() },
  });
}

/**
 * Generate embeddable widget script
 */
export async function getWidgetScript(repositoryId: string): Promise<string> {
  const config = await getChatbotConfig(repositoryId);
  if (!config) return '';

  return `<!-- DocSynth Chatbot Widget -->
<script>
  (function() {
    var d = document, s = d.createElement('script');
    s.src = '/api/chatbot/widget.js';
    s.setAttribute('data-repo', '${repositoryId}');
    s.setAttribute('data-color', '${config.primaryColor}');
    s.setAttribute('data-position', '${config.position}');
    s.setAttribute('data-title', '${config.widgetTitle}');
    d.body.appendChild(s);
  })();
</script>`;
}

// ============================================================================
// Utility Functions
// ============================================================================

async function searchDocumentation(
  repositoryId: string,
  query: string
): Promise<Array<{ title: string; path: string; content: string | null }>> {
  // Simple keyword search - in production would use vector search
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { title: true, path: true, content: true },
  });

  // Score documents by keyword match
  const scored = documents.map((doc) => {
    const content = (doc.content || '').toLowerCase();
    const title = doc.title.toLowerCase();
    let score = 0;

    for (const kw of keywords) {
      if (title.includes(kw)) score += 3;
      if (content.includes(kw)) score += 1;
    }

    return { ...doc, score };
  });

  return scored
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
