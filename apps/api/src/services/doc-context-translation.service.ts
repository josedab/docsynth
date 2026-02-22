/**
 * AI Context-Aware Translation Service
 *
 * Translates technical documentation while preserving code blocks,
 * API terminology, and project-specific glossary terms. Supports
 * incremental delta translation for changed paragraphs only.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId } from '@docsynth/utils';

const log = createLogger('doc-context-translation-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface TranslationJob {
  id: string;
  repositoryId: string;
  documentId: string;
  sourceLanguage: string;
  targetLanguage: string;
  status: 'pending' | 'translating' | 'completed' | 'failed';
  originalContent: string;
  translatedContent?: string;
  glossaryTermsUsed: string[];
  confidence: number;
}

export interface GlossaryTerm {
  term: string;
  translations: Record<string, string>;
  context?: string;
  preserveOriginal: boolean;
}

export interface TechGlossary {
  id: string;
  repositoryId: string;
  entries: GlossaryTerm[];
}

export interface DeltaParagraph {
  index: number;
  original: string;
  translated: string;
  isCode: boolean;
}

export interface TranslationDelta {
  documentId: string;
  changedParagraphs: number;
  totalParagraphs: number;
  deltaParagraphs: DeltaParagraph[];
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Translate an entire document with context-aware translation.
 */
export async function translateDocument(
  repositoryId: string,
  documentId: string,
  targetLanguage: string,
  glossaryId?: string
): Promise<TranslationJob> {
  log.info({ repositoryId, documentId, targetLanguage }, 'Starting document translation');

  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  const glossary = glossaryId
    ? await getGlossary(repositoryId)
    : await db.techGlossary.findFirst({ where: { repositoryId } });

  const glossaryEntries: GlossaryTerm[] = glossary?.entries
    ? typeof glossary.entries === 'string'
      ? JSON.parse(glossary.entries)
      : glossary.entries
    : [];

  const sourceLanguage = detectLanguage(doc.content ?? '');
  const jobId = generateId();

  const job: TranslationJob = {
    id: jobId,
    repositoryId,
    documentId,
    sourceLanguage,
    targetLanguage,
    status: 'pending',
    originalContent: doc.content ?? '',
    glossaryTermsUsed: [],
    confidence: 0,
  };

  await db.translationJob.create({
    data: {
      id: jobId,
      repositoryId,
      documentId,
      sourceLanguage,
      targetLanguage,
      status: 'pending',
      originalContent: doc.content ?? '',
    },
  });

  try {
    job.status = 'translating';
    const context = extractTechnicalContext(job.originalContent);
    const { preserved, placeholders } = preserveCodeBlocks(job.originalContent);

    let translated = await performTranslation(preserved, sourceLanguage, targetLanguage, context);
    translated = applyGlossary(translated, glossaryEntries, targetLanguage);

    // Restore code blocks
    for (const [placeholder, code] of Object.entries(placeholders)) {
      translated = translated.replace(placeholder, code);
    }

    const termsUsed = glossaryEntries
      .filter(
        (e) =>
          translated.includes(e.term) ||
          Object.values(e.translations).some((t) => translated.includes(t))
      )
      .map((e) => e.term);

    job.translatedContent = translated;
    job.glossaryTermsUsed = termsUsed;
    job.confidence = computeConfidence(job.originalContent, translated, termsUsed.length);
    job.status = 'completed';

    await db.translationJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        translatedContent: translated,
        glossaryTermsUsed: JSON.stringify(termsUsed),
        confidence: job.confidence,
      },
    });

    log.info({ jobId, targetLanguage, confidence: job.confidence }, 'Translation completed');
  } catch (err) {
    job.status = 'failed';
    await db.translationJob.update({ where: { id: jobId }, data: { status: 'failed' } });
    log.error({ err, jobId }, 'Translation failed');
  }

  return job;
}

/**
 * Translate only changed paragraphs since last translation.
 */
export async function syncTranslationDelta(
  repositoryId: string,
  documentId: string,
  targetLanguage: string
): Promise<TranslationDelta> {
  log.info({ repositoryId, documentId, targetLanguage }, 'Computing translation delta');

  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  const lastJob = await db.translationJob.findFirst({
    where: { repositoryId, documentId, targetLanguage, status: 'completed' },
    orderBy: { createdAt: 'desc' },
  });

  const currentParagraphs = splitIntoParagraphs(doc.content ?? '');
  const previousParagraphs = lastJob ? splitIntoParagraphs(lastJob.originalContent ?? '') : [];

  const deltaParagraphs: DeltaParagraph[] = [];

  for (let i = 0; i < currentParagraphs.length; i++) {
    const current = currentParagraphs[i];
    const previous = i < previousParagraphs.length ? previousParagraphs[i] : null;
    const isCode = current.trimStart().startsWith('```');

    if (current !== previous) {
      const translated = isCode
        ? current
        : await performTranslation(current, 'auto', targetLanguage, '');
      deltaParagraphs.push({ index: i, original: current, translated, isCode });
    }
  }

  log.info(
    { documentId, changed: deltaParagraphs.length, total: currentParagraphs.length },
    'Delta computed'
  );
  return {
    documentId,
    changedParagraphs: deltaParagraphs.length,
    totalParagraphs: currentParagraphs.length,
    deltaParagraphs,
  };
}

/**
 * Auto-build a technical glossary from repository content.
 */
export async function buildGlossary(repositoryId: string): Promise<TechGlossary> {
  log.info({ repositoryId }, 'Building technical glossary');

  const docs = await db.document.findMany({ where: { repositoryId }, select: { content: true } });
  const symbols = await db.codeSymbol.findMany({
    where: { repositoryId },
    select: { name: true, kind: true },
  });

  const termSet = new Map<string, GlossaryTerm>();

  // Extract terms from code symbols
  for (const sym of symbols) {
    if (sym.name && sym.name.length > 2 && !termSet.has(sym.name)) {
      termSet.set(sym.name, {
        term: sym.name,
        translations: {},
        context: `Code ${sym.kind}: ${sym.name}`,
        preserveOriginal: true,
      });
    }
  }

  // Extract technical terms from docs
  const techTermPattern = /`([A-Za-z_][A-Za-z0-9_]+)`/g;
  for (const doc of docs) {
    const content = doc.content ?? '';
    let match: RegExpExecArray | null;
    while ((match = techTermPattern.exec(content)) !== null) {
      const term = match[1];
      if (term.length > 2 && !termSet.has(term)) {
        termSet.set(term, { term, translations: {}, preserveOriginal: true });
      }
    }
  }

  const entries = Array.from(termSet.values()).slice(0, 500);
  const glossaryId = generateId();

  await db.techGlossary.upsert({
    where: { repositoryId },
    create: { id: glossaryId, repositoryId, entries: JSON.stringify(entries) },
    update: { entries: JSON.stringify(entries) },
  });

  log.info({ repositoryId, termCount: entries.length }, 'Glossary built');
  return { id: glossaryId, repositoryId, entries };
}

/**
 * Get existing glossary for a repository.
 */
export async function getGlossary(repositoryId: string): Promise<TechGlossary | null> {
  const row = await db.techGlossary.findFirst({ where: { repositoryId } });
  if (!row) return null;

  return {
    id: row.id,
    repositoryId,
    entries: typeof row.entries === 'string' ? JSON.parse(row.entries) : (row.entries ?? []),
  };
}

/**
 * Update glossary entries for a repository.
 */
export async function updateGlossary(
  repositoryId: string,
  entries: GlossaryTerm[]
): Promise<TechGlossary> {
  log.info({ repositoryId, entryCount: entries.length }, 'Updating glossary');

  const existing = await getGlossary(repositoryId);
  const merged = mergeGlossaryEntries(existing?.entries ?? [], entries);

  const id = existing?.id ?? generateId();
  await db.techGlossary.upsert({
    where: { repositoryId },
    create: { id, repositoryId, entries: JSON.stringify(merged) },
    update: { entries: JSON.stringify(merged) },
  });

  return { id, repositoryId, entries: merged };
}

/**
 * Validate a completed translation for quality issues.
 */
export async function validateTranslation(
  translationId: string
): Promise<{ valid: boolean; issues: string[] }> {
  const job = await db.translationJob.findUnique({ where: { id: translationId } });
  if (!job) return { valid: false, issues: ['Translation job not found'] };

  const issues: string[] = [];
  const original = job.originalContent ?? '';
  const translated = job.translatedContent ?? '';

  if (!translated) {
    issues.push('Translation content is empty');
    return { valid: false, issues };
  }

  // Check code blocks preserved
  const originalCodeBlocks = (original.match(/```[\s\S]*?```/g) ?? []).length;
  const translatedCodeBlocks = (translated.match(/```[\s\S]*?```/g) ?? []).length;
  if (originalCodeBlocks !== translatedCodeBlocks) {
    issues.push(
      `Code block mismatch: original has ${originalCodeBlocks}, translated has ${translatedCodeBlocks}`
    );
  }

  // Check URLs preserved
  const urlPattern = /https?:\/\/[^\s)]+/g;
  const originalUrls = new Set(original.match(urlPattern) ?? []);
  const translatedUrls = new Set(translated.match(urlPattern) ?? []);
  for (const url of originalUrls) {
    if (!translatedUrls.has(url)) issues.push(`Missing URL in translation: ${url}`);
  }

  // Check length ratio
  const ratio = translated.length / (original.length || 1);
  if (ratio < 0.5) issues.push('Translation is significantly shorter than original');
  if (ratio > 3.0) issues.push('Translation is significantly longer than original');

  // Check markdown structure
  const originalHeadings = (original.match(/^#{1,6}\s/gm) ?? []).length;
  const translatedHeadings = (translated.match(/^#{1,6}\s/gm) ?? []).length;
  if (originalHeadings !== translatedHeadings) {
    issues.push(
      `Heading count mismatch: original has ${originalHeadings}, translated has ${translatedHeadings}`
    );
  }

  return { valid: issues.length === 0, issues };
}

// ============================================================================
// Helpers
// ============================================================================

function extractTechnicalContext(content: string): string {
  const headings = content.match(/^#{1,6}\s.+$/gm) ?? [];
  const codeTypes = new Set<string>();
  const langPattern = /```(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = langPattern.exec(content)) !== null) codeTypes.add(m[1]);

  return [
    `Headings: ${headings.slice(0, 5).join(', ')}`,
    `Code languages: ${Array.from(codeTypes).join(', ')}`,
  ].join('\n');
}

function preserveCodeBlocks(content: string): {
  preserved: string;
  placeholders: Record<string, string>;
} {
  const placeholders: Record<string, string> = {};
  let index = 0;
  const preserved = content.replace(/```[\s\S]*?```/g, (match) => {
    const key = `__CODE_BLOCK_${index++}__`;
    placeholders[key] = match;
    return key;
  });
  return { preserved, placeholders };
}

function applyGlossary(text: string, glossary: GlossaryTerm[], targetLang: string): string {
  let result = text;
  for (const entry of glossary) {
    if (entry.preserveOriginal) continue;
    const translation = entry.translations[targetLang];
    if (translation) {
      const pattern = new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, 'gi');
      result = result.replace(pattern, translation);
    }
  }
  return result;
}

function detectLanguage(content: string): string {
  const langPatterns: [string, RegExp][] = [
    ['en', /\b(the|and|is|are|this|that|with|from)\b/gi],
    ['es', /\b(el|la|los|las|del|con|para|esta)\b/gi],
    ['fr', /\b(le|la|les|des|dans|pour|avec|cette)\b/gi],
    ['de', /\b(der|die|das|und|ist|mit|von|für)\b/gi],
    ['ja', /[\u3040-\u309f\u30a0-\u30ff]/g],
    ['zh', /[\u4e00-\u9fff]/g],
  ];

  let bestLang = 'en';
  let bestScore = 0;

  for (const [lang, pattern] of langPatterns) {
    const matches = content.match(pattern);
    const score = matches?.length ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }

  return bestLang;
}

function splitIntoParagraphs(content: string): string[] {
  return content.split(/\n\n+/).filter((p) => p.trim().length > 0);
}

async function performTranslation(
  text: string,
  _source: string,
  _target: string,
  _context: string
): Promise<string> {
  // Placeholder: in production, this calls an LLM or translation API
  log.debug({ sourceLen: text.length }, 'Performing translation');
  return text;
}

function computeConfidence(original: string, translated: string, glossaryHits: number): number {
  let confidence = 0.7;
  if (glossaryHits > 0) confidence += Math.min(glossaryHits * 0.02, 0.1);

  const origCodeBlocks = (original.match(/```/g) ?? []).length;
  const transCodeBlocks = (translated.match(/```/g) ?? []).length;
  if (origCodeBlocks === transCodeBlocks) confidence += 0.1;

  const ratio = translated.length / (original.length || 1);
  if (ratio >= 0.7 && ratio <= 2.0) confidence += 0.1;

  return Math.min(confidence, 1.0);
}

function mergeGlossaryEntries(existing: GlossaryTerm[], incoming: GlossaryTerm[]): GlossaryTerm[] {
  const map = new Map<string, GlossaryTerm>();
  for (const e of existing) map.set(e.term, e);
  for (const e of incoming) {
    const prev = map.get(e.term);
    if (prev) {
      map.set(e.term, {
        ...prev,
        translations: { ...prev.translations, ...e.translations },
        context: e.context ?? prev.context,
      });
    } else {
      map.set(e.term, e);
    }
  }
  return Array.from(map.values());
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
