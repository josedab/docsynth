import { Worker, Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import { QUEUE_NAMES, getRedisConnection, type ChatRAGJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { chatRAGService } from '../services/chat-rag.js';

const log = createLogger('chat-rag-worker');

// Type assertion for Prisma models that may not be in compiled types yet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

interface ChatSessionRecord {
  id: string;
  repositoryId: string;
  userId: string;
  title: string;
  context: Record<string, unknown>;
  messages: ChatMessageRecord[];
}

interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  sources: unknown[];
  createdAt: Date;
}

async function processChatRAG(job: Job<ChatRAGJobData>): Promise<void> {
  const { sessionId, repositoryId, message, userId } = job.data;

  log.info({ sessionId, repositoryId, messageLength: message.length }, 'Processing chat message');

  try {
    // Get or create session (using db to work around missing Prisma types)
    let session: ChatSessionRecord | null = await db.chatSession.findUnique({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });

    if (!session) {
      session = await db.chatSession.create({
        data: {
          id: sessionId,
          repositoryId,
          userId,
          title: message.substring(0, 50),
          context: {},
        },
        include: { messages: true },
      }) as ChatSessionRecord;
    }

    await job.updateProgress(20);

    // Save user message
    await db.chatMessage.create({
      data: {
        sessionId,
        role: 'user',
        content: message,
        sources: [],
      },
    });

    await job.updateProgress(30);

    // Get repository documents for RAG
    const documents = await prisma.document.findMany({
      where: { repositoryId },
      select: {
        id: true,
        path: true,
        title: true,
        type: true,
        content: true,
      },
    });

    const docChunks = documents
      .filter((d): d is typeof d & { content: string } => d.content !== null)
      .map((d) => ({
        id: d.id,
        documentId: d.id,
        title: d.title,
        content: d.content,
        type: d.type,
        path: d.path,
      }));

    await job.updateProgress(50);

    // Get code files (simplified - in production would fetch from GitHub)
    const codeFiles: Array<{ path: string; content: string; language: string }> = [];

    // Build conversation history
    const conversationHistory = session.messages
      .slice()
      .reverse()
      .map((m: ChatMessageRecord) => ({ role: m.role, content: m.content }));

    await job.updateProgress(60);

    // Get RAG answer
    const result = await chatRAGService.answer(
      {
        query: message,
        repositoryId,
        context: session.context as { documentIds?: string[]; filePaths?: string[]; topics?: string[] },
        conversationHistory,
      },
      docChunks,
      codeFiles
    );

    await job.updateProgress(90);

    // Save assistant response
    await db.chatMessage.create({
      data: {
        sessionId,
        role: 'assistant',
        content: result.answer,
        sources: result.sources,
      },
    });

    // Update session title if first message
    if (session.messages.length === 0) {
      await db.chatSession.update({
        where: { id: sessionId },
        data: { title: message.substring(0, 50) + (message.length > 50 ? '...' : '') },
      });
    }

    await job.updateProgress(100);

    log.info(
      {
        sessionId,
        answerLength: result.answer.length,
        sourceCount: result.sources.length,
        confidence: result.confidence,
      },
      'Chat response generated'
    );
  } catch (error) {
    log.error({ error, sessionId }, 'Chat RAG processing failed');
    throw error;
  }
}

export function startChatRAGWorker(): Worker<ChatRAGJobData> {
  const worker = new Worker<ChatRAGJobData>(QUEUE_NAMES.CHAT_RAG, processChatRAG, {
    connection: getRedisConnection(),
    concurrency: 5,
  });

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Chat RAG job completed');
  });

  worker.on('failed', (job, error) => {
    log.error({ jobId: job?.id, error: error.message }, 'Chat RAG job failed');
  });

  log.info('Chat RAG worker started');
  return worker;
}
