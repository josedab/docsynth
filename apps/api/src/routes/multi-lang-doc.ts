/**
 * Multi-Language Documentation V2 Routes
 *
 * API endpoints for auto-translating documentation with glossary support.
 */

import { Hono } from 'hono';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  translateDocument,
  getDocumentTranslations,
  getStaleTranslations,
  markTranslationsStale,
  upsertGlossaryEntry,
  getGlossary,
  deleteGlossaryEntry,
  getTranslationCoverage,
  SUPPORTED_LANGUAGES,
} from '../services/multi-lang-doc.service.js';

const log = createLogger('multi-lang-doc-routes');

const app = new Hono();

/**
 * POST /translate - Translate a document
 */
app.post('/translate', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    documentId: string;
    repositoryId: string;
    targetLanguages: string[];
    glossaryId?: string;
    async?: boolean;
  }>();

  if (!body.documentId || !body.repositoryId || !body.targetLanguages?.length) {
    return c.json(
      { success: false, error: 'documentId, repositoryId, and targetLanguages are required' },
      400
    );
  }

  if (body.async) {
    const job = await addJob(QUEUE_NAMES.MULTI_LANG_DOC, {
      repositoryId: body.repositoryId,
      documentId: body.documentId,
      targetLanguages: body.targetLanguages,
      glossaryId: body.glossaryId,
    });
    return c.json({ success: true, data: { jobId: job.id, message: 'Translation queued' } });
  }

  try {
    const results = await translateDocument(
      body.documentId,
      body.repositoryId,
      body.targetLanguages,
      body.glossaryId
    );
    return c.json({ success: true, data: results });
  } catch (error) {
    log.error({ error }, 'Translation failed');
    return c.json({ success: false, error: 'Translation failed' }, 500);
  }
});

/**
 * GET /languages - Get supported languages
 */
app.get('/languages', async (c) => {
  return c.json({ success: true, data: SUPPORTED_LANGUAGES });
});

/**
 * GET /document/:documentId - Get translations for a document
 */
app.get('/document/:documentId', requireAuth, async (c) => {
  const translations = await getDocumentTranslations(c.req.param('documentId'));
  return c.json({ success: true, data: translations });
});

/**
 * GET /stale/:repositoryId - Get stale translations
 */
app.get('/stale/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const stale = await getStaleTranslations(c.req.param('repositoryId'));
  return c.json({ success: true, data: stale });
});

/**
 * POST /mark-stale/:documentId - Mark translations as needing update
 */
app.post('/mark-stale/:documentId', requireAuth, async (c) => {
  const count = await markTranslationsStale(c.req.param('documentId'));
  return c.json({ success: true, data: { markedStale: count } });
});

/**
 * GET /coverage/:repositoryId - Get translation coverage
 */
app.get('/coverage/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const coverage = await getTranslationCoverage(c.req.param('repositoryId'));
  return c.json({ success: true, data: coverage });
});

/**
 * POST /glossary - Add/update glossary entry
 */
app.post('/glossary', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    organizationId: string;
    term: string;
    translations: Record<string, string>;
  }>();

  if (!body.organizationId || !body.term) {
    return c.json({ success: false, error: 'organizationId and term are required' }, 400);
  }

  await upsertGlossaryEntry(body.organizationId, body.term, body.translations);
  return c.json({ success: true });
});

/**
 * GET /glossary/:organizationId - Get glossary
 */
app.get('/glossary/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  const entries = await getGlossary(c.req.param('organizationId'));
  return c.json({ success: true, data: entries });
});

/**
 * DELETE /glossary/:organizationId/:term - Delete glossary entry
 */
app.delete('/glossary/:organizationId/:term', requireAuth, requireOrgAccess, async (c) => {
  await deleteGlossaryEntry(c.req.param('organizationId'), c.req.param('term'));
  return c.json({ success: true });
});

export { app as multiLangDocRoutes };
