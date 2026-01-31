import { Worker, Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import { QUEUE_NAMES, getRedisConnection, type TranslationJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { translationService } from '../services/translation.js';

const log = createLogger('translation-worker');

async function processTranslation(job: Job<TranslationJobData>): Promise<void> {
  const { documentId, targetLocales, useGlossary, preserveFormatting } = job.data;

  log.info({ documentId, targetLocales }, 'Starting translation job');

  // Get source document
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { repository: { include: { organization: true } } },
  });

  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const sourceContent = document.content;
  if (!sourceContent) {
    throw new Error('Document has no content to translate');
  }

  // Detect source locale
  const sourceLocale = translationService.detectLocale(sourceContent);

  // Load glossary if requested
  let glossary: Map<string, string> | undefined;
  if (useGlossary && document.repository.organizationId) {
    const glossaryTerms = await prisma.glossary.findMany({
      where: {
        organizationId: document.repository.organizationId,
        locale: sourceLocale,
      },
    });

    if (glossaryTerms.length > 0) {
      glossary = new Map();
      for (const term of glossaryTerms) {
        const translations = term.translations as Record<string, string>;
        for (const targetLocale of targetLocales) {
          if (translations[targetLocale]) {
            glossary.set(term.term, translations[targetLocale]);
          }
        }
      }
    }
  }

  const totalLocales = targetLocales.length;
  let completedLocales = 0;

  // Translate to each target locale
  for (const targetLocale of targetLocales) {
    if (targetLocale === sourceLocale) {
      log.info({ targetLocale }, 'Skipping translation - same as source');
      continue;
    }

    try {
      // Check for existing translation
      const existing = await prisma.translation.findUnique({
        where: {
          documentId_targetLocale: {
            documentId,
            targetLocale,
          },
        },
      });

      // Update status to translating
      if (existing) {
        await prisma.translation.update({
          where: { id: existing.id },
          data: { status: 'translating' },
        });
      } else {
        await prisma.translation.create({
          data: {
            documentId,
            sourceLocale,
            targetLocale,
            status: 'translating',
            translator: 'ai',
          },
        });
      }

      // Perform translation
      const result = await translationService.translate({
        content: sourceContent,
        sourceLocale,
        targetLocale,
        glossary,
        preserveFormatting: preserveFormatting ?? true,
      });

      // Save translation
      await prisma.translation.upsert({
        where: {
          documentId_targetLocale: {
            documentId,
            targetLocale,
          },
        },
        update: {
          content: result.content,
          status: 'review',
          confidence: result.confidence,
          glossaryUsed: result.glossaryTermsUsed,
        },
        create: {
          documentId,
          sourceLocale,
          targetLocale,
          content: result.content,
          status: 'review',
          translator: 'ai',
          confidence: result.confidence,
          glossaryUsed: result.glossaryTermsUsed,
        },
      });

      completedLocales++;
      await job.updateProgress(Math.round((completedLocales / totalLocales) * 100));

      log.info(
        {
          documentId,
          targetLocale,
          wordCount: result.wordCount,
          confidence: result.confidence,
        },
        'Translation completed'
      );
    } catch (error) {
      log.error({ error, documentId, targetLocale }, 'Translation failed');

      // Mark as failed but continue with other locales
      await prisma.translation.upsert({
        where: {
          documentId_targetLocale: {
            documentId,
            targetLocale,
          },
        },
        update: { status: 'pending' },
        create: {
          documentId,
          sourceLocale,
          targetLocale,
          status: 'pending',
        },
      });
    }
  }
}

export function startTranslationWorker(): Worker<TranslationJobData> {
  const worker = new Worker<TranslationJobData>(QUEUE_NAMES.TRANSLATION, processTranslation, {
    connection: getRedisConnection(),
    concurrency: 2,
  });

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Translation job completed');
  });

  worker.on('failed', (job, error) => {
    log.error({ jobId: job?.id, error: error.message }, 'Translation job failed');
  });

  log.info('Translation worker started');
  return worker;
}
