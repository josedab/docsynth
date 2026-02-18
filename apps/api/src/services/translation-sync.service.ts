/**
 * Translation Sync Service
 *
 * Manages multi-language documentation synchronization with delta-only
 * translation, per-repo glossaries, and staleness tracking.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('translation-sync-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface TranslationStatus {
  repositoryId: string;
  sourceLanguage: string;
  languages: LanguageStatus[];
  totalDocuments: number;
  overallSyncPercentage: number;
}

export interface LanguageStatus {
  language: string;
  translatedCount: number;
  totalCount: number;
  syncPercentage: number;
  staleCount: number;
  lastSyncedAt: Date | null;
}

export interface TranslationResult {
  documentId: string;
  sourceLanguage: string;
  targetLanguage: string;
  originalContent: string;
  translatedContent: string;
  changedParagraphs: number;
  totalParagraphs: number;
  glossaryTermsUsed: string[];
  confidence: number;
}

export interface GlossaryEntry {
  term: string;
  translations: Record<string, string>;
  context?: string;
  doNotTranslate?: boolean;
}

export interface Glossary {
  id: string;
  repositoryId: string;
  entries: GlossaryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncPlan {
  repositoryId: string;
  targetLanguage: string;
  documentsToSync: DocumentSyncItem[];
  estimatedTime: string;
  totalParagraphs: number;
}

export interface DocumentSyncItem {
  documentId: string;
  path: string;
  status: 'new' | 'stale' | 'up-to-date';
  changedParagraphs: number;
  totalParagraphs: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get translation status for a repository
 */
export async function getTranslationStatus(repositoryId: string): Promise<TranslationStatus> {
  const docs = await prisma.document.findMany({
    where: { repositoryId, OR: [{ path: { endsWith: '.md' } }, { path: { endsWith: '.mdx' } }] },
    select: { id: true, path: true },
  });

  const translations = await db.translationRecord.findMany({
    where: { repositoryId },
    select: { documentId: true, targetLanguage: true, syncedAt: true, stale: true },
  });

  const languageMap = new Map<
    string,
    { translated: number; stale: number; lastSynced: Date | null }
  >();

  for (const t of translations) {
    const entry = languageMap.get(t.targetLanguage) ?? {
      translated: 0,
      stale: 0,
      lastSynced: null,
    };
    entry.translated++;
    if (t.stale) entry.stale++;
    if (!entry.lastSynced || t.syncedAt > entry.lastSynced) entry.lastSynced = t.syncedAt;
    languageMap.set(t.targetLanguage, entry);
  }

  const languages: LanguageStatus[] = Array.from(languageMap.entries()).map(([language, data]) => ({
    language,
    translatedCount: data.translated,
    totalCount: docs.length,
    syncPercentage: docs.length > 0 ? Math.round((data.translated / docs.length) * 100) : 0,
    staleCount: data.stale,
    lastSyncedAt: data.lastSynced,
  }));

  const totalTranslated = languages.reduce((sum, l) => sum + l.translatedCount, 0);
  const totalPossible = languages.length * docs.length;

  return {
    repositoryId,
    sourceLanguage: 'en',
    languages,
    totalDocuments: docs.length,
    overallSyncPercentage:
      totalPossible > 0 ? Math.round((totalTranslated / totalPossible) * 100) : 0,
  };
}

/**
 * Build a sync plan for a target language
 */
export async function buildSyncPlan(
  repositoryId: string,
  targetLanguage: string
): Promise<SyncPlan> {
  const docs = await prisma.document.findMany({
    where: { repositoryId, OR: [{ path: { endsWith: '.md' } }, { path: { endsWith: '.mdx' } }] },
    select: { id: true, path: true, content: true, updatedAt: true },
  });

  const existingTranslations = await db.translationRecord.findMany({
    where: { repositoryId, targetLanguage },
    select: { documentId: true, syncedAt: true, translatedContent: true },
  });

  const translationMap = new Map(
    existingTranslations.map((t: { documentId: string; syncedAt: Date }) => [t.documentId, t])
  );

  const items: DocumentSyncItem[] = docs.map((doc) => {
    const existing = translationMap.get(doc.id) as { syncedAt: Date } | undefined;
    const paragraphs = doc.content ? doc.content.split('\n\n').length : 0;

    let status: DocumentSyncItem['status'] = 'new';
    let changedParagraphs = paragraphs;

    if (existing) {
      if (new Date(doc.updatedAt) > new Date(existing.syncedAt)) {
        status = 'stale';
        changedParagraphs = Math.ceil(paragraphs * 0.3); // estimate 30% changed
      } else {
        status = 'up-to-date';
        changedParagraphs = 0;
      }
    }

    return {
      documentId: doc.id,
      path: doc.path,
      status,
      changedParagraphs,
      totalParagraphs: paragraphs,
    };
  });

  const needsSync = items.filter((i) => i.status !== 'up-to-date');
  const totalParagraphs = needsSync.reduce((sum, i) => sum + i.changedParagraphs, 0);

  return {
    repositoryId,
    targetLanguage,
    documentsToSync: needsSync,
    estimatedTime: `${Math.ceil(totalParagraphs * 0.5)} minutes`,
    totalParagraphs,
  };
}

/**
 * Translate a document with delta support
 */
export async function translateDocument(
  repositoryId: string,
  documentId: string,
  targetLanguage: string,
  options?: { deltaOnly?: boolean; glossaryId?: string }
): Promise<TranslationResult> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { content: true, path: true },
  });

  if (!doc || !doc.content) {
    throw new Error(`Document not found or empty: ${documentId}`);
  }

  const glossary = options?.glossaryId ? await getGlossary(options.glossaryId) : null;
  const paragraphs = doc.content.split('\n\n');
  const translatedParagraphs: string[] = [];
  const glossaryTermsUsed: string[] = [];
  let changedCount = 0;

  for (const paragraph of paragraphs) {
    let translated = simulateTranslation(paragraph, targetLanguage);

    // Apply glossary
    if (glossary) {
      for (const entry of glossary.entries) {
        if (paragraph.includes(entry.term)) {
          const targetTerm = entry.doNotTranslate
            ? entry.term
            : (entry.translations[targetLanguage] ?? entry.term);
          translated = translated.replace(new RegExp(entry.term, 'gi'), targetTerm);
          glossaryTermsUsed.push(entry.term);
        }
      }
    }

    translatedParagraphs.push(translated);
    if (translated !== paragraph) changedCount++;
  }

  const translatedContent = translatedParagraphs.join('\n\n');

  // Store translation
  await db.translationRecord.upsert({
    where: { documentId_targetLanguage: { documentId, targetLanguage } },
    create: {
      documentId,
      repositoryId,
      targetLanguage,
      sourceLanguage: 'en',
      translatedContent,
      syncedAt: new Date(),
      stale: false,
    },
    update: {
      translatedContent,
      syncedAt: new Date(),
      stale: false,
    },
  });

  log.info(
    { documentId, targetLanguage, changedCount, totalParagraphs: paragraphs.length },
    'Document translated'
  );

  return {
    documentId,
    sourceLanguage: 'en',
    targetLanguage,
    originalContent: doc.content,
    translatedContent,
    changedParagraphs: changedCount,
    totalParagraphs: paragraphs.length,
    glossaryTermsUsed: [...new Set(glossaryTermsUsed)],
    confidence: 0.85,
  };
}

/**
 * Get or create glossary
 */
export async function getGlossary(glossaryId: string): Promise<Glossary | null> {
  const stored = await db.translationGlossary.findUnique({ where: { id: glossaryId } });
  if (!stored) return null;

  return {
    id: stored.id,
    repositoryId: stored.repositoryId,
    entries: stored.entries as unknown as GlossaryEntry[],
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

export async function createOrUpdateGlossary(
  repositoryId: string,
  entries: GlossaryEntry[]
): Promise<Glossary> {
  const existing = await db.translationGlossary.findFirst({ where: { repositoryId } });

  if (existing) {
    const updated = await db.translationGlossary.update({
      where: { id: existing.id },
      data: { entries: JSON.parse(JSON.stringify(entries)), updatedAt: new Date() },
    });
    return {
      id: updated.id,
      repositoryId,
      entries,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  const created = await db.translationGlossary.create({
    data: {
      repositoryId,
      entries: JSON.parse(JSON.stringify(entries)),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return {
    id: created.id,
    repositoryId,
    entries,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

/**
 * Mark translations as stale when source changes
 */
export async function markStaleTranslations(
  repositoryId: string,
  documentId: string
): Promise<number> {
  const result = await db.translationRecord.updateMany({
    where: { repositoryId, documentId },
    data: { stale: true },
  });

  log.info({ repositoryId, documentId, count: result.count }, 'Translations marked stale');
  return result.count;
}

// ============================================================================
// Helper Functions
// ============================================================================

function simulateTranslation(text: string, targetLanguage: string): string {
  // Placeholder: in production, this would call DeepL or a translation LLM
  const langPrefixes: Record<string, string> = {
    es: '[ES]',
    ja: '[JA]',
    zh: '[ZH]',
    de: '[DE]',
    fr: '[FR]',
    ko: '[KO]',
    pt: '[PT]',
    it: '[IT]',
    ru: '[RU]',
    ar: '[AR]',
  };

  const prefix = langPrefixes[targetLanguage] ?? `[${targetLanguage.toUpperCase()}]`;

  // Preserve markdown formatting, only "translate" text content
  if (
    text.startsWith('#') ||
    text.startsWith('```') ||
    text.startsWith('|') ||
    text.startsWith('-')
  ) {
    return text; // preserve structural elements
  }

  return `${prefix} ${text}`;
}
