/**
 * Multi-Language Documentation V2 Service
 *
 * Auto-translates documentation into 20+ languages using LLMs,
 * maintaining technical accuracy with glossary support.
 */

import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';

const log = createLogger('multi-lang-doc-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types & Constants
// ============================================================================

export interface TranslationResult {
  documentId: string;
  targetLanguage: string;
  content: string;
  quality: number;
  glossaryTermsUsed: number;
}

export interface GlossaryEntry {
  term: string;
  translations: Record<string, string>;
}

export const SUPPORTED_LANGUAGES = [
  { code: 'es', name: 'Spanish' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'de', name: 'German' },
  { code: 'fr', name: 'French' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ko', name: 'Korean' },
  { code: 'ru', name: 'Russian' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'uk', name: 'Ukrainian' },
];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Translate a document to target languages
 */
export async function translateDocument(
  documentId: string,
  repositoryId: string,
  targetLanguages: string[],
  glossaryId?: string
): Promise<TranslationResult[]> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { content: true, title: true },
  });

  if (!doc?.content) return [];

  // Load glossary terms if provided
  let glossary: GlossaryEntry[] = [];
  if (glossaryId) {
    const terms = await db.translationGlossary.findMany({
      where: { organizationId: glossaryId },
    });
    glossary = terms.map((t: { term: string; translations: Record<string, string> }) => ({
      term: t.term,
      translations: t.translations,
    }));
  }

  const results: TranslationResult[] = [];
  const anthropic = getAnthropicClient();

  for (const lang of targetLanguages) {
    const langInfo = SUPPORTED_LANGUAGES.find((l) => l.code === lang);
    if (!langInfo) continue;

    // Build glossary context
    const glossaryContext = glossary
      .filter((g) => g.translations[lang])
      .map((g) => `"${g.term}" → "${g.translations[lang]}"`)
      .join('\n');

    let translatedContent: string;
    let quality = 0.7;
    let glossaryTermsUsed = 0;

    if (anthropic) {
      try {
        const glossaryInstructions = glossaryContext
          ? `\n\nUse these translations for technical terms:\n${glossaryContext}`
          : '';

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: `You are a professional technical documentation translator. Translate to ${langInfo.name}. Preserve all code blocks, URLs, and technical identifiers exactly as-is. Maintain markdown formatting.${glossaryInstructions}`,
          messages: [
            {
              role: 'user',
              content: `Translate this documentation to ${langInfo.name}:\n\n${doc.content.substring(0, 8000)}`,
            },
          ],
        });

        const text = response.content[0];
        if (text && text.type === 'text') {
          translatedContent = (text as { type: 'text'; text: string }).text;
          quality = 0.85;
          glossaryTermsUsed = glossary.filter(
            (g) => g.translations[lang] && translatedContent.includes(g.translations[lang]!)
          ).length;
        } else {
          translatedContent = doc.content;
          quality = 0;
        }
      } catch (error) {
        log.error({ error, lang }, 'Translation failed');
        translatedContent = doc.content;
        quality = 0;
      }
    } else {
      // No LLM available - store original with low quality flag
      translatedContent = doc.content;
      quality = 0;
    }

    // Check if source has changed since last translation
    const sourceVersion = hashContent(doc.content);

    // Persist translation
    await db.translationV2.upsert({
      where: { documentId_targetLanguage: { documentId, targetLanguage: lang } },
      create: {
        documentId,
        repositoryId,
        targetLanguage: lang,
        content: translatedContent,
        quality,
        glossaryTerms: glossaryTermsUsed,
        sourceVersion,
        needsUpdate: false,
      },
      update: {
        content: translatedContent,
        quality,
        glossaryTerms: glossaryTermsUsed,
        sourceVersion,
        needsUpdate: false,
        translatedAt: new Date(),
      },
    });

    results.push({
      documentId,
      targetLanguage: lang,
      content: translatedContent,
      quality,
      glossaryTermsUsed,
    });
  }

  return results;
}

/**
 * Get all translations for a document
 */
export async function getDocumentTranslations(documentId: string) {
  return db.translationV2.findMany({
    where: { documentId },
    orderBy: { targetLanguage: 'asc' },
  });
}

/**
 * Get translations that need updating (source changed)
 */
export async function getStaleTranslations(repositoryId: string) {
  return db.translationV2.findMany({
    where: { repositoryId, needsUpdate: true },
    orderBy: { translatedAt: 'asc' },
  });
}

/**
 * Mark translations as needing update when source changes
 */
export async function markTranslationsStale(documentId: string): Promise<number> {
  const result = await db.translationV2.updateMany({
    where: { documentId },
    data: { needsUpdate: true },
  });
  return result.count;
}

/**
 * Manage glossary entries
 */
export async function upsertGlossaryEntry(
  organizationId: string,
  term: string,
  translations: Record<string, string>
): Promise<void> {
  await db.translationGlossary.upsert({
    where: { organizationId_term: { organizationId, term } },
    create: { organizationId, term, translations },
    update: { translations },
  });
}

export async function getGlossary(organizationId: string) {
  return db.translationGlossary.findMany({
    where: { organizationId },
    orderBy: { term: 'asc' },
  });
}

export async function deleteGlossaryEntry(organizationId: string, term: string): Promise<void> {
  await db.translationGlossary.deleteMany({
    where: { organizationId, term },
  });
}

/**
 * Get translation coverage stats for a repository
 */
export async function getTranslationCoverage(repositoryId: string) {
  const docCount = await prisma.document.count({ where: { repositoryId } });
  const translations = await db.translationV2.findMany({
    where: { repositoryId },
    select: { targetLanguage: true, needsUpdate: true },
  });

  const byLanguage: Record<string, { total: number; upToDate: number; stale: number }> = {};

  for (const t of translations) {
    const lang = t.targetLanguage as string;
    if (!byLanguage[lang]) {
      byLanguage[lang] = { total: 0, upToDate: 0, stale: 0 };
    }
    byLanguage[lang]!.total++;
    if (t.needsUpdate) {
      byLanguage[lang]!.stale++;
    } else {
      byLanguage[lang]!.upToDate++;
    }
  }

  return {
    totalDocuments: docCount,
    languages: byLanguage,
    supportedLanguages: SUPPORTED_LANGUAGES,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}
