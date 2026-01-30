import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';

const app = new Hono();

// ============================================================================
// Translations
// ============================================================================

// List translations for document
app.get('/document/:documentId', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { repository: true },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  const translations = await prisma.translation.findMany({
    where: { documentId },
    orderBy: { targetLocale: 'asc' },
  });

  return c.json({
    success: true,
    data: translations,
  });
});

// Get single translation
app.get('/:translationId', requireAuth, requireOrgAccess, async (c) => {
  const translationId = c.req.param('translationId');
  const orgId = c.get('organizationId');

  const translation = await prisma.translation.findUnique({
    where: { id: translationId },
    include: { document: { include: { repository: true } } },
  });

  if (!translation || translation.document.repository.organizationId !== orgId) {
    throw new NotFoundError('Translation', translationId);
  }

  return c.json({
    success: true,
    data: translation,
  });
});

// Request translation
app.post('/translate', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    documentId: string;
    targetLocale: string;
    glossaryId?: string;
  }>();

  if (!body.documentId || !body.targetLocale) {
    throw new ValidationError('documentId and targetLocale are required');
  }

  // Verify document access
  const document = await prisma.document.findUnique({
    where: { id: body.documentId },
    include: { repository: true },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', body.documentId);
  }

  // Check for existing translation
  const existing = await prisma.translation.findFirst({
    where: { documentId: body.documentId, targetLocale: body.targetLocale },
  });

  if (existing) {
    throw new ValidationError(`Translation for locale ${body.targetLocale} already exists`);
  }

  // Queue translation job
  const job = await addJob(QUEUE_NAMES.TRANSLATION, {
    documentId: body.documentId,
    targetLocales: [body.targetLocale],
    useGlossary: !!body.glossaryId,
    preserveFormatting: true,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Translation started',
    },
  });
});

// Update translation
app.put('/:translationId', requireAuth, requireOrgAccess, async (c) => {
  const translationId = c.req.param('translationId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    content?: string;
    status?: string;
    metadata?: Record<string, unknown>;
  }>();

  const translation = await prisma.translation.findUnique({
    where: { id: translationId },
    include: { document: { include: { repository: true } } },
  });

  if (!translation || translation.document.repository.organizationId !== orgId) {
    throw new NotFoundError('Translation', translationId);
  }

  const updated = await prisma.translation.update({
    where: { id: translationId },
    data: {
      content: body.content,
      status: body.status,
    },
  });

  return c.json({
    success: true,
    data: updated,
  });
});

// Delete translation
app.delete('/:translationId', requireAuth, requireOrgAccess, async (c) => {
  const translationId = c.req.param('translationId');
  const orgId = c.get('organizationId');

  const translation = await prisma.translation.findUnique({
    where: { id: translationId },
    include: { document: { include: { repository: true } } },
  });

  if (!translation || translation.document.repository.organizationId !== orgId) {
    throw new NotFoundError('Translation', translationId);
  }

  await prisma.translation.delete({
    where: { id: translationId },
  });

  return c.json({ success: true });
});

// ============================================================================
// Glossaries
// ============================================================================

// List glossaries (terms)
app.get('/glossaries', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { locale } = c.req.query();

  const whereClause: Record<string, unknown> = { organizationId: orgId };
  if (locale) whereClause.locale = locale;

  const glossaries = await prisma.glossary.findMany({
    where: whereClause,
    orderBy: { term: 'asc' },
  });

  return c.json({
    success: true,
    data: glossaries,
  });
});

// Get glossary
app.get('/glossaries/:glossaryId', requireAuth, requireOrgAccess, async (c) => {
  const glossaryId = c.req.param('glossaryId');
  const orgId = c.get('organizationId');

  const glossary = await prisma.glossary.findFirst({
    where: { id: glossaryId, organizationId: orgId },
  });

  if (!glossary) {
    throw new NotFoundError('Glossary', glossaryId);
  }

  return c.json({
    success: true,
    data: glossary,
  });
});

// Create glossary term
app.post('/glossaries', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    locale: string;
    term: string;
    definition: string;
    translations?: Record<string, string>;
    context?: string;
    doNotTranslate?: boolean;
  }>();

  if (!body.locale || !body.term || !body.definition) {
    throw new ValidationError('locale, term, and definition are required');
  }

  const glossary = await prisma.glossary.create({
    data: {
      organizationId: orgId,
      locale: body.locale,
      term: body.term,
      definition: body.definition,
      translations: body.translations || {},
      context: body.context,
      doNotTranslate: body.doNotTranslate || false,
    },
  });

  return c.json({
    success: true,
    data: glossary,
  });
});

// Update glossary term
app.put('/glossaries/:glossaryId', requireAuth, requireOrgAccess, async (c) => {
  const glossaryId = c.req.param('glossaryId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    definition?: string;
    translations?: Record<string, string>;
    context?: string;
    doNotTranslate?: boolean;
  }>();

  const glossary = await prisma.glossary.findFirst({
    where: { id: glossaryId, organizationId: orgId },
  });

  if (!glossary) {
    throw new NotFoundError('Glossary', glossaryId);
  }

  const updated = await prisma.glossary.update({
    where: { id: glossaryId },
    data: {
      definition: body.definition,
      translations: body.translations as object | undefined,
      context: body.context,
      doNotTranslate: body.doNotTranslate,
    },
  });

  return c.json({
    success: true,
    data: updated,
  });
});

// Delete glossary
app.delete('/glossaries/:glossaryId', requireAuth, requireOrgAccess, async (c) => {
  const glossaryId = c.req.param('glossaryId');
  const orgId = c.get('organizationId');

  const glossary = await prisma.glossary.findFirst({
    where: { id: glossaryId, organizationId: orgId },
  });

  if (!glossary) {
    throw new NotFoundError('Glossary', glossaryId);
  }

  await prisma.glossary.delete({
    where: { id: glossaryId },
  });

  return c.json({ success: true });
});

// Supported locales
app.get('/locales', requireAuth, async (c) => {
  const locales = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'zh', name: 'Chinese (Simplified)' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'ru', name: 'Russian' },
    { code: 'ar', name: 'Arabic' },
    { code: 'it', name: 'Italian' },
    { code: 'nl', name: 'Dutch' },
  ];

  return c.json({
    success: true,
    data: locales,
  });
});

// ============================================================================
// Batch Translation Operations (Feature 3)
// ============================================================================

// Batch translate multiple documents
app.post('/batch', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    documentIds: string[];
    targetLocales: string[];
    useGlossary?: boolean;
    preserveFormatting?: boolean;
  }>();

  if (!body.documentIds?.length || !body.targetLocales?.length) {
    throw new ValidationError('documentIds and targetLocales arrays are required');
  }

  if (body.documentIds.length > 50) {
    throw new ValidationError('Maximum 50 documents per batch');
  }

  // Verify document access
  const documents = await prisma.document.findMany({
    where: { id: { in: body.documentIds } },
    include: { repository: { select: { organizationId: true } } },
  });

  const accessibleDocIds = documents
    .filter(d => d.repository.organizationId === orgId)
    .map(d => d.id);

  if (accessibleDocIds.length === 0) {
    throw new NotFoundError('Documents', body.documentIds.join(', '));
  }

  // Queue translation jobs for each document
  const jobs = [];
  for (const documentId of accessibleDocIds) {
    const job = await addJob(QUEUE_NAMES.TRANSLATION, {
      documentId,
      targetLocales: body.targetLocales,
      useGlossary: body.useGlossary ?? true,
      preserveFormatting: body.preserveFormatting ?? true,
    });
    jobs.push({ documentId, jobId: job.id });
  }

  return c.json({
    success: true,
    data: {
      batchId: `batch-${Date.now()}`,
      totalDocuments: accessibleDocIds.length,
      targetLocales: body.targetLocales,
      jobs,
      message: 'Batch translation started',
    },
  }, 202);
});

// Translate all documents in a repository
app.post('/repository/:repositoryId', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    targetLocales: string[];
    documentTypes?: string[];
    useGlossary?: boolean;
  }>();

  if (!body.targetLocales?.length) {
    throw new ValidationError('targetLocales array is required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Get all documents in repository
  const whereClause: Record<string, unknown> = { repositoryId };
  if (body.documentTypes?.length) {
    whereClause.type = { in: body.documentTypes };
  }

  const documents = await prisma.document.findMany({
    where: whereClause,
    select: { id: true },
  });

  // Queue translation jobs
  const jobs = [];
  for (const doc of documents) {
    const job = await addJob(QUEUE_NAMES.TRANSLATION, {
      documentId: doc.id,
      targetLocales: body.targetLocales,
      useGlossary: body.useGlossary ?? true,
      preserveFormatting: true,
    });
    jobs.push({ documentId: doc.id, jobId: job.id });
  }

  return c.json({
    success: true,
    data: {
      repositoryId,
      totalDocuments: documents.length,
      targetLocales: body.targetLocales,
      jobs,
    },
  }, 202);
});

// ============================================================================
// Glossary Sync & Management (Feature 3)
// ============================================================================

// Bulk import glossary terms
app.post('/glossaries/import', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    locale: string;
    terms: Array<{
      term: string;
      definition: string;
      translations?: Record<string, string>;
      context?: string;
      doNotTranslate?: boolean;
    }>;
  }>();

  if (!body.locale || !body.terms?.length) {
    throw new ValidationError('locale and terms array are required');
  }

  const results = {
    created: 0,
    updated: 0,
    errors: [] as string[],
  };

  for (const item of body.terms) {
    try {
      await prisma.glossary.upsert({
        where: {
          organizationId_locale_term: {
            organizationId: orgId,
            locale: body.locale,
            term: item.term,
          },
        },
        update: {
          definition: item.definition,
          translations: item.translations || {},
          context: item.context,
          doNotTranslate: item.doNotTranslate || false,
        },
        create: {
          organizationId: orgId,
          locale: body.locale,
          term: item.term,
          definition: item.definition,
          translations: item.translations || {},
          context: item.context,
          doNotTranslate: item.doNotTranslate || false,
        },
      });
      results.created++;
    } catch {
      results.errors.push(`Failed to import term "${item.term}"`);
    }
  }

  return c.json({
    success: true,
    data: results,
  }, 201);
});

// Export glossary terms
app.get('/glossaries/export', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { locale, format } = c.req.query();

  const whereClause: Record<string, unknown> = { organizationId: orgId };
  if (locale) whereClause.locale = locale;

  const terms = await prisma.glossary.findMany({
    where: whereClause,
    orderBy: { term: 'asc' },
  });

  if (format === 'csv') {
    // Generate CSV
    const header = 'term,definition,locale,translations,context,doNotTranslate';
    const rows = terms.map(t => 
      `"${t.term}","${t.definition}","${t.locale}","${JSON.stringify(t.translations)}","${t.context || ''}",${t.doNotTranslate}`
    );
    
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename=glossary.csv');
    return c.text([header, ...rows].join('\n'));
  }

  return c.json({
    success: true,
    data: {
      terms: terms.map(t => ({
        term: t.term,
        definition: t.definition,
        locale: t.locale,
        translations: t.translations,
        context: t.context,
        doNotTranslate: t.doNotTranslate,
      })),
      total: terms.length,
    },
  });
});

// Sync glossary across translations (update existing translations with new terms)
app.post('/glossaries/sync', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    locale: string;
    targetLocales: string[];
    dryRun?: boolean;
  }>();

  if (!body.locale || !body.targetLocales?.length) {
    throw new ValidationError('locale and targetLocales are required');
  }

  // Get glossary terms
  const glossaryTerms = await prisma.glossary.findMany({
    where: {
      organizationId: orgId,
      locale: body.locale,
    },
  });

  if (glossaryTerms.length === 0) {
    return c.json({
      success: true,
      data: {
        message: 'No glossary terms found for sync',
        affected: 0,
      },
    });
  }

  // Find translations that might need updating
  const translations = await prisma.translation.findMany({
    where: {
      document: {
        repository: { organizationId: orgId },
      },
      sourceLocale: body.locale,
      targetLocale: { in: body.targetLocales },
    },
    include: {
      document: { select: { id: true, path: true } },
    },
  });

  const results = {
    translationsChecked: translations.length,
    termsFound: 0,
    translationsAffected: 0,
    updates: [] as Array<{
      documentId: string;
      documentPath: string;
      targetLocale: string;
      termsReplaced: string[];
    }>,
  };

  for (const translation of translations) {
    if (!translation.content) continue;

    let content = translation.content;
    const termsReplaced: string[] = [];

    for (const glossaryTerm of glossaryTerms) {
      const translations = glossaryTerm.translations as Record<string, string>;
      const targetTranslation = translations[translation.targetLocale];
      
      if (!targetTranslation) continue;

      // Check if term exists in content and could be replaced
      // This is a simplified check - in production, use proper tokenization
      const termRegex = new RegExp(`\\b${escapeRegex(glossaryTerm.term)}\\b`, 'gi');
      
      if (termRegex.test(content)) {
        if (!body.dryRun) {
          content = content.replace(termRegex, targetTranslation);
        }
        termsReplaced.push(glossaryTerm.term);
        results.termsFound++;
      }
    }

    if (termsReplaced.length > 0) {
      results.translationsAffected++;
      results.updates.push({
        documentId: translation.document.id,
        documentPath: translation.document.path,
        targetLocale: translation.targetLocale,
        termsReplaced,
      });

      if (!body.dryRun) {
        await prisma.translation.update({
          where: { id: translation.id },
          data: {
            content,
            glossaryUsed: termsReplaced,
          },
        });
      }
    }
  }

  return c.json({
    success: true,
    data: {
      ...results,
      dryRun: body.dryRun ?? false,
    },
  });
});

// Get translation coverage stats for a repository
app.get('/repository/:repositoryId/coverage', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Get all documents
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true, type: true },
  });

  // Get all translations
  const translations = await prisma.translation.findMany({
    where: {
      documentId: { in: documents.map(d => d.id) },
    },
    select: {
      documentId: true,
      targetLocale: true,
      status: true,
    },
  });

  // Calculate coverage per locale
  const locales = [...new Set(translations.map(t => t.targetLocale))];
  const coverage: Record<string, {
    totalDocs: number;
    translatedDocs: number;
    publishedDocs: number;
    coveragePercent: number;
  }> = {};

  for (const locale of locales) {
    const localeTranslations = translations.filter(t => t.targetLocale === locale);
    const translated = new Set(localeTranslations.map(t => t.documentId)).size;
    const published = localeTranslations.filter(t => t.status === 'published').length;

    coverage[locale] = {
      totalDocs: documents.length,
      translatedDocs: translated,
      publishedDocs: published,
      coveragePercent: documents.length > 0 ? Math.round((translated / documents.length) * 100) : 0,
    };
  }

  return c.json({
    success: true,
    data: {
      repositoryId,
      totalDocuments: documents.length,
      locales: locales.length,
      coverage,
    },
  });
});

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const translationRoutes = app;
