/**
 * Translation Sync Routes
 *
 * Multi-language documentation synchronization endpoints.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  getTranslationStatus,
  buildSyncPlan,
  translateDocument,
  createOrUpdateGlossary,
  markStaleTranslations,
} from '../services/translation-sync.service.js';

const log = createLogger('translation-sync-routes');
const app = new Hono();

app.get('/status/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  try {
    const status = await getTranslationStatus(repositoryId);
    return c.json({ success: true, data: status });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get translation status');
    return c.json({ success: false, error: 'Failed to get status' }, 500);
  }
});

app.post('/sync-plan', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string; targetLanguage: string }>();

  if (!body.repositoryId || !body.targetLanguage) {
    return c.json({ success: false, error: 'repositoryId and targetLanguage are required' }, 400);
  }

  try {
    const plan = await buildSyncPlan(body.repositoryId, body.targetLanguage);
    return c.json({ success: true, data: plan });
  } catch (error) {
    log.error({ error }, 'Failed to build sync plan');
    return c.json({ success: false, error: 'Failed to build sync plan' }, 500);
  }
});

app.post('/translate', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    documentId: string;
    targetLanguage: string;
    deltaOnly?: boolean;
    glossaryId?: string;
  }>();

  if (!body.repositoryId || !body.documentId || !body.targetLanguage) {
    return c.json(
      { success: false, error: 'repositoryId, documentId, and targetLanguage are required' },
      400
    );
  }

  try {
    const result = await translateDocument(
      body.repositoryId,
      body.documentId,
      body.targetLanguage,
      body
    );
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to translate document');
    return c.json({ success: false, error: 'Failed to translate' }, 500);
  }
});

app.post('/sync/async', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string; targetLanguages: string[] }>();

  if (!body.repositoryId || !body.targetLanguages?.length) {
    return c.json({ success: false, error: 'repositoryId and targetLanguages are required' }, 400);
  }

  try {
    await addJob(QUEUE_NAMES.TRANSLATION_SYNC, {
      repositoryId: body.repositoryId,
      action: 'sync' as const,
      targetLanguages: body.targetLanguages,
    });
    return c.json({ success: true, data: { message: 'Translation sync queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to queue translation sync');
    return c.json({ success: false, error: 'Failed to queue sync' }, 500);
  }
});

app.post('/glossary', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    entries: Array<{
      term: string;
      translations: Record<string, string>;
      doNotTranslate?: boolean;
    }>;
  }>();

  if (!body.repositoryId || !body.entries) {
    return c.json({ success: false, error: 'repositoryId and entries are required' }, 400);
  }

  try {
    const glossary = await createOrUpdateGlossary(body.repositoryId, body.entries);
    return c.json({ success: true, data: glossary });
  } catch (error) {
    log.error({ error }, 'Failed to update glossary');
    return c.json({ success: false, error: 'Failed to update glossary' }, 500);
  }
});

app.post('/mark-stale', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string; documentId: string }>();

  if (!body.repositoryId || !body.documentId) {
    return c.json({ success: false, error: 'repositoryId and documentId are required' }, 400);
  }

  try {
    const count = await markStaleTranslations(body.repositoryId, body.documentId);
    return c.json({ success: true, data: { staleCount: count } });
  } catch (error) {
    log.error({ error }, 'Failed to mark stale translations');
    return c.json({ success: false, error: 'Failed to mark stale' }, 500);
  }
});

export { app as translationSyncRoutes };
