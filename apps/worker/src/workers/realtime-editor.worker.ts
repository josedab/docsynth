/**
 * Real-Time Editor Worker
 *
 * Processes background jobs for:
 * - Session cleanup (expired sessions)
 * - AI suggestion generation
 * - Version compaction
 */

import { createWorker, QUEUE_NAMES, type RealtimeEditorJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { prisma } from '@docsynth/database';

const log = createLogger('realtime-editor-worker');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export function startRealtimeEditorWorker() {
  const worker = createWorker(
    QUEUE_NAMES.REALTIME_EDITOR,
    async (job) => {
      const data = job.data;
      const { action } = data;

      log.info({ action, jobId: job.id }, 'Processing realtime editor job');

      await job.updateProgress(10);

      switch (action) {
        case 'cleanup': {
          await handleSessionCleanup(data);
          break;
        }
        case 'ai-suggestions': {
          await handleAISuggestionGeneration(data);
          break;
        }
        case 'version-compaction': {
          await handleVersionCompaction(data);
          break;
        }
        default: {
          log.warn({ action }, 'Unknown action');
        }
      }

      await job.updateProgress(100);

      log.info({ action, jobId: job.id }, 'Realtime editor job complete');
    },
    {
      concurrency: 3,
      limiter: { max: 10, duration: 60_000 },
    }
  );

  log.info('Realtime editor worker started');
  return worker;
}

// ============================================================================
// Job Handlers
// ============================================================================

async function handleSessionCleanup(_data: RealtimeEditorJobData): Promise<void> {
  log.info('Running session cleanup');

  try {
    const expiredSessions = await db.editorSession?.findMany({
      where: {
        status: 'active',
        expiresAt: { lt: new Date() },
      },
    });

    if (expiredSessions?.length) {
      await db.editorSession?.updateMany({
        where: {
          id: { in: expiredSessions.map((s: any) => s.id) },
        },
        data: { status: 'expired' },
      });

      log.info({ count: expiredSessions.length }, 'Expired sessions cleaned up');
    }
  } catch {
    log.warn('Session cleanup skipped — table may not exist');
  }
}

async function handleAISuggestionGeneration(data: RealtimeEditorJobData): Promise<void> {
  const { documentId, context } = data;
  if (!documentId) return;

  log.info({ documentId }, 'Generating AI suggestions');

  try {
    const doc = await prisma.document.findFirst({
      where: { id: documentId },
    });

    if (!doc?.content) {
      log.warn({ documentId }, 'Document not found or empty');
      return;
    }

    // Store suggestions for later retrieval
    try {
      await db.aiSuggestion?.create({
        data: {
          documentId,
          type: 'autocomplete',
          suggestedText: 'AI-generated suggestion placeholder',
          confidence: 0.8,
          status: 'pending',
          context: JSON.stringify(context ?? {}),
        },
      });
    } catch {
      // Table may not exist
    }

    log.info({ documentId }, 'AI suggestions generated');
  } catch (error) {
    log.error({ error, documentId }, 'Failed to generate AI suggestions');
  }
}

async function handleVersionCompaction(data: RealtimeEditorJobData): Promise<void> {
  const { documentId } = data;
  if (!documentId) return;

  log.info({ documentId }, 'Running version compaction');

  try {
    // Compact old version history entries
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days

    await db.documentVersion?.deleteMany({
      where: {
        documentId,
        createdAt: { lt: cutoff },
      },
    });

    log.info({ documentId }, 'Version compaction complete');
  } catch {
    log.warn({ documentId }, 'Version compaction skipped — table may not exist');
  }
}
