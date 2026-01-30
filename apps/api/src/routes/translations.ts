import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError, getAnthropicClient } from '@docsynth/utils';
import type { SupportedLanguage, TranslatedDocument } from '@docsynth/types';

const app = new Hono();

const SUPPORTED_LANGUAGES: Record<SupportedLanguage, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  zh: 'Chinese (Simplified)',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
};

// Get supported languages
app.get('/languages', requireAuth, async (c) => {
  return c.json({
    success: true,
    data: Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => ({
      code,
      name,
    })),
  });
});

// Translate a document
app.post('/translate', requireAuth, requireOrgAccess, rateLimit('translation'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    documentId: string;
    targetLanguages: SupportedLanguage[];
    preserveCodeBlocks?: boolean;
  }>();

  if (!body.documentId || !body.targetLanguages?.length) {
    throw new ValidationError('documentId and targetLanguages are required');
  }

  // Validate languages
  for (const lang of body.targetLanguages) {
    if (!SUPPORTED_LANGUAGES[lang]) {
      throw new ValidationError(`Unsupported language: ${lang}`);
    }
  }

  // Get the document
  const document = await prisma.document.findFirst({
    where: { id: body.documentId },
    include: { repository: true },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', body.documentId);
  }

  const translations: TranslatedDocument[] = [];
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  for (const targetLang of body.targetLanguages) {
    const targetLanguageName = SUPPORTED_LANGUAGES[targetLang];

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [
          {
            role: 'user',
            content: `Translate the following technical documentation from English to ${targetLanguageName}.

Rules:
1. Preserve all markdown formatting exactly
2. Keep code blocks unchanged (do not translate code)
3. Keep technical terms that are commonly used in English (API, URL, etc.)
4. Maintain the same structure and headings
5. Translate naturally, not word-for-word

Document to translate:

${document.content}

Provide only the translated document, no explanations.`,
          },
        ],
      });

      const translatedContent = response.content[0]?.type === 'text' 
        ? response.content[0].text 
        : document.content;

      translations.push({
        originalDocumentId: document.id,
        language: targetLang,
        content: translatedContent,
        translatedAt: new Date(),
        wordCount: translatedContent.split(/\s+/).length,
      });
    } catch {
      translations.push({
        originalDocumentId: document.id,
        language: targetLang,
        content: `[Translation failed for ${targetLanguageName}]`,
        translatedAt: new Date(),
        wordCount: 0,
      });
    }
  }

  return c.json({
    success: true,
    data: {
      originalDocument: {
        id: document.id,
        path: document.path,
        title: document.title,
      },
      translations,
    },
  });
});

// Get existing translations for a document
app.get('/document/:documentId', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');

  const document = await prisma.document.findFirst({
    where: { id: documentId },
    include: { repository: true },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  // Check metadata for stored translations
  const metadata = document.metadata as Record<string, unknown> ?? {};
  const translations = (metadata.translations as TranslatedDocument[]) ?? [];

  return c.json({
    success: true,
    data: {
      documentId,
      availableLanguages: translations.map(t => t.language),
      translations,
    },
  });
});

export { app as translationRoutes };
