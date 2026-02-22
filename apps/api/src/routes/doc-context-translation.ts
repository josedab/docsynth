/**
 * Doc Context Translation Routes
 *
 * API endpoints for context-aware documentation translation including
 * glossary management, delta synchronization, and translation validation.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  translateDocument,
  syncTranslationDelta,
  buildGlossary,
  getGlossary,
  updateGlossary,
  validateTranslation,
} from '../services/doc-context-translation.service.js';

const log = createLogger('doc-context-translation-routes');
const app = new Hono();

/**
 * POST /translate - Translate a document with context awareness
 */
app.post('/translate', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      filePath: string;
      targetLanguage: string;
      content?: string;
    }>();

    if (!body.repositoryId || !body.filePath || !body.targetLanguage) {
      return c.json(
        { success: false, error: 'repositoryId, filePath, and targetLanguage are required' },
        400
      );
    }

    const job = await addJob(QUEUE_NAMES.DOC_CONTEXT_TRANSLATION, {
      repositoryId: body.repositoryId,
      action: 'translate',
      filePath: body.filePath,
      targetLanguage: body.targetLanguage,
    });

    const result = await translateDocument(
      body.repositoryId,
      body.filePath,
      body.targetLanguage,
      body.content
    );

    log.info(
      { repositoryId: body.repositoryId, jobId: job.id, targetLanguage: body.targetLanguage },
      'Translation started'
    );
    return c.json({ success: true, data: { jobId: job.id, result } });
  } catch (error) {
    log.error({ error }, 'Failed to translate document');
    return c.json({ success: false, error: 'Failed to translate document' }, 500);
  }
});

/**
 * POST /sync-delta - Sync translation deltas after source changes
 */
app.post('/sync-delta', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      filePath: string;
      targetLanguages: string[];
    }>();

    if (!body.repositoryId || !body.filePath || !body.targetLanguages) {
      return c.json(
        { success: false, error: 'repositoryId, filePath, and targetLanguages are required' },
        400
      );
    }

    const result = await syncTranslationDelta(
      body.repositoryId,
      body.filePath,
      body.targetLanguages
    );
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to sync translation delta');
    return c.json({ success: false, error: 'Failed to sync translation delta' }, 500);
  }
});

/**
 * POST /glossary/build - Build a glossary for a repository
 */
app.post('/glossary/build', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      languages: string[];
    }>();

    if (!body.repositoryId || !body.languages) {
      return c.json({ success: false, error: 'repositoryId and languages are required' }, 400);
    }

    const glossary = await buildGlossary(body.repositoryId, body.languages);
    log.info({ repositoryId: body.repositoryId }, 'Glossary built');
    return c.json({ success: true, data: glossary });
  } catch (error) {
    log.error({ error }, 'Failed to build glossary');
    return c.json({ success: false, error: 'Failed to build glossary' }, 500);
  }
});

/**
 * GET /glossary/:repositoryId - Get the glossary for a repository
 */
app.get('/glossary/:repositoryId', requireAuth, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const language = c.req.query('language');
    const glossary = await getGlossary(repositoryId, language);
    return c.json({ success: true, data: glossary });
  } catch (error) {
    log.error({ error }, 'Failed to get glossary');
    return c.json({ success: false, error: 'Failed to get glossary' }, 500);
  }
});

/**
 * POST /glossary - Update glossary entries
 */
app.post('/glossary', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      entries: Array<{ term: string; translations: Record<string, string> }>;
    }>();

    if (!body.repositoryId || !body.entries) {
      return c.json({ success: false, error: 'repositoryId and entries are required' }, 400);
    }

    const updated = await updateGlossary(body.repositoryId, body.entries);
    return c.json({ success: true, data: updated });
  } catch (error) {
    log.error({ error }, 'Failed to update glossary');
    return c.json({ success: false, error: 'Failed to update glossary' }, 500);
  }
});

/**
 * POST /validate - Validate translation quality
 */
app.post('/validate', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      filePath: string;
      language: string;
    }>();

    if (!body.repositoryId || !body.filePath || !body.language) {
      return c.json(
        { success: false, error: 'repositoryId, filePath, and language are required' },
        400
      );
    }

    const validation = await validateTranslation(body.repositoryId, body.filePath, body.language);
    return c.json({ success: true, data: validation });
  } catch (error) {
    log.error({ error }, 'Failed to validate translation');
    return c.json({ success: false, error: 'Failed to validate translation' }, 500);
  }
});

export { app as docContextTranslationRoutes };
