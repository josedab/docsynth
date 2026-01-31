import { Worker, Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import { QUEUE_NAMES, getRedisConnection, type BotMessageJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { docBotService } from '../services/doc-bot.js';

const log = createLogger('bot-message-worker');

// Type assertion for Prisma models not yet generated
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

async function processBotMessage(job: Job<BotMessageJobData>): Promise<void> {
  const { platform, channelId, threadId, userId, query, organizationId } = job.data;

  log.info({ platform, channelId, userId }, 'Processing bot message');

  try {
    await job.updateProgress(20);

    // Get organization's repositories and documents
    const repositories = await prisma.repository.findMany({
      where: { organizationId, enabled: true },
      select: { id: true },
    });

    const repoIds = repositories.map((r) => r.id);

    // Get documents from all repositories
    const documents = await prisma.document.findMany({
      where: { repositoryId: { in: repoIds } },
      select: {
        id: true,
        title: true,
        content: true,
        type: true,
        path: true,
      },
    });

    await job.updateProgress(50);

    // Process message
    const response = await docBotService.processMessage(
      {
        platform,
        channelId,
        threadId,
        userId,
        message: query,
        organizationId,
      },
      documents.map((d) => ({
        id: d.id,
        title: d.title,
        content: d.content || '',
        type: d.type,
        path: d.path,
      }))
    );

    await job.updateProgress(80);

    // Save conversation (using db for new models)
    await db.botConversation.create({
      data: {
        platform,
        channelId,
        threadId,
        userId,
        query,
        response: response.text,
        sources: response.sources,
      },
    });

    await job.updateProgress(100);

    log.info(
      {
        platform,
        channelId,
        responseLength: response.text.length,
        sourceCount: response.sources.length,
      },
      'Bot message processed'
    );

    // In production, we would send the response back to the platform here
    // For now, the response is just logged and stored
  } catch (error) {
    log.error({ error, platform, channelId }, 'Bot message processing failed');
    throw error;
  }
}

export function startBotMessageWorker(): Worker<BotMessageJobData> {
  const worker = new Worker<BotMessageJobData>(QUEUE_NAMES.BOT_MESSAGE, processBotMessage, {
    connection: getRedisConnection(),
    concurrency: 10,
  });

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Bot message job completed');
  });

  worker.on('failed', (job, error) => {
    log.error({ jobId: job?.id, error: error.message }, 'Bot message job failed');
  });

  log.info('Bot message worker started');
  return worker;
}
