/**
 * Citation Index Worker
 * 
 * Processes jobs to build and update the citation index for repositories.
 */

import { createWorker, QUEUE_NAMES } from '@docsynth/queue';
import type { CitationIndexJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger, generateId, getAnthropicClient } from '@docsynth/utils';

const log = createLogger('citation-index-worker');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

/**
 * Generate embedding for text using Claude
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not configured');
  }

  // Use a simple embedding approach - in production, use a dedicated embedding model
  // For now, we'll create a deterministic vector based on content
  const normalizedText = text.toLowerCase().slice(0, 8000);
  const words = normalizedText.split(/\s+/);
  
  // Create a 256-dimensional embedding based on word patterns
  const embedding = new Array(256).fill(0);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    for (let j = 0; j < word.length && j < 256; j++) {
      const charCode = word.charCodeAt(j);
      embedding[(i + j) % 256] += charCode / 1000;
    }
  }

  // Normalize the embedding
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] = embedding[i] / magnitude;
    }
  }

  return embedding;
}

/**
 * Parse document into citable sections
 */
function parseDocumentSections(content: string): Array<{
  content: string;
  sectionTitle: string | null;
  heading: string | null;
  headingLevel: number | null;
  lineStart: number;
  lineEnd: number;
  codeBlocks: string[];
  keywords: string[];
}> {
  const sections: Array<{
    content: string;
    sectionTitle: string | null;
    heading: string | null;
    headingLevel: number | null;
    lineStart: number;
    lineEnd: number;
    codeBlocks: string[];
    keywords: string[];
  }> = [];

  const lines = content.split('\n');
  let currentSection: {
    content: string[];
    heading: string | null;
    headingLevel: number | null;
    lineStart: number;
    codeBlocks: string[];
  } = {
    content: [],
    heading: null,
    headingLevel: null,
    lineStart: 1,
    codeBlocks: [],
  };

  let inCodeBlock = false;
  let currentCodeBlock = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Handle code blocks
    if (line?.startsWith('```')) {
      if (inCodeBlock) {
        currentSection.codeBlocks.push(currentCodeBlock);
        currentCodeBlock = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      currentSection.content.push(line);
      continue;
    }

    if (inCodeBlock) {
      currentCodeBlock += line + '\n';
      currentSection.content.push(line ?? '');
      continue;
    }

    // Check for heading
    const headingMatch = line?.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      // Save previous section if it has content
      if (currentSection.content.length > 0) {
        const sectionContent = currentSection.content.join('\n').trim();
        if (sectionContent.length > 50) {
          sections.push({
            content: sectionContent,
            sectionTitle: currentSection.heading,
            heading: currentSection.heading,
            headingLevel: currentSection.headingLevel,
            lineStart: currentSection.lineStart,
            lineEnd: lineNum - 1,
            codeBlocks: currentSection.codeBlocks,
            keywords: extractKeywords(sectionContent),
          });
        }
      }

      // Start new section
      currentSection = {
        content: [line ?? ''],
        heading: headingMatch[2] ?? null,
        headingLevel: headingMatch[1]?.length ?? null,
        lineStart: lineNum,
        codeBlocks: [],
      };
    } else {
      currentSection.content.push(line ?? '');
    }
  }

  // Add final section
  if (currentSection.content.length > 0) {
    const sectionContent = currentSection.content.join('\n').trim();
    if (sectionContent.length > 50) {
      sections.push({
        content: sectionContent,
        sectionTitle: currentSection.heading,
        heading: currentSection.heading,
        headingLevel: currentSection.headingLevel,
        lineStart: currentSection.lineStart,
        lineEnd: lines.length,
        codeBlocks: currentSection.codeBlocks,
        keywords: extractKeywords(sectionContent),
      });
    }
  }

  return sections;
}

/**
 * Extract keywords from content
 */
function extractKeywords(content: string): string[] {
  const words = content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const wordFreq = new Map<string, number>();
  for (const word of words) {
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  }

  return Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

/**
 * Generate content hash
 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * Process citation index job
 */
async function processCitationIndex(job: { data: CitationIndexJobData }): Promise<void> {
  const { repositoryId, documentId, fullReindex } = job.data;

  log.info({ repositoryId, documentId, fullReindex }, 'Starting citation indexing');

  // Get documents to index
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereClause: any = { repositoryId };
  if (documentId && !fullReindex) {
    whereClause.id = documentId;
  }

  const documents = await prisma.document.findMany({
    where: whereClause,
    select: { id: true, path: true, title: true, content: true },
  });

  if (documents.length === 0) {
    log.warn({ repositoryId, documentId }, 'No documents found to index');
    return;
  }

  let totalIndexed = 0;
  let totalErrors = 0;

  for (const doc of documents) {
    try {
      // Parse document into sections
      const sections = parseDocumentSections(doc.content);

      if (sections.length === 0) {
        log.debug({ documentId: doc.id }, 'No sections found in document');
        continue;
      }

      // Delete existing citations for this document
      await db.citationIndex.deleteMany({
        where: { documentId: doc.id },
      });

      // Create new citations
      for (const section of sections) {
        try {
          const contentHash = hashContent(section.content);
          const embedding = await generateEmbedding(section.content);

          await db.citationIndex.create({
            data: {
              id: generateId(),
              repositoryId,
              documentId: doc.id,
              content: section.content,
              contentHash,
              sectionTitle: section.sectionTitle,
              lineStart: section.lineStart,
              lineEnd: section.lineEnd,
              heading: section.heading,
              headingLevel: section.headingLevel,
              codeBlocks: section.codeBlocks,
              keywords: section.keywords,
              embedding,
            },
          });

          totalIndexed++;
        } catch (sectionError) {
          log.warn({ error: sectionError, documentId: doc.id }, 'Failed to index section');
          totalErrors++;
        }
      }

      log.debug({ documentId: doc.id, sections: sections.length }, 'Document indexed');
    } catch (docError) {
      log.error({ error: docError, documentId: doc.id }, 'Failed to index document');
      totalErrors++;
    }
  }

  log.info(
    { repositoryId, totalIndexed, totalErrors, documentsProcessed: documents.length },
    'Citation indexing complete'
  );
}

// Create and export the worker
export const citationIndexWorker = createWorker(
  QUEUE_NAMES.CITATION_INDEX,
  async (job) => {
    await processCitationIndex(job);
  },
  {
    concurrency: 2,
    limiter: {
      max: 5,
      duration: 60000, // 5 per minute
    },
  }
);

log.info('Citation index worker started');
