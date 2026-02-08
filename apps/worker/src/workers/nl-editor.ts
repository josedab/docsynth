/**
 * Natural Language Editor Worker
 *
 * Handles batch natural language edits across multiple documents.
 * Processes each document with the given instruction and stores results as previews.
 */

import { createWorker, QUEUE_NAMES } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';

const log = createLogger('nl-editor-worker');

interface NLEditorJobData {
  type: 'batch' | 'single';
  repositoryId: string;
  instruction: string;
  targetDocuments?: string[];
  scope?: 'all' | 'api-docs' | 'guides' | 'readme';
  documentId?: string; // For single edits
  sectionHeading?: string;
  context?: {
    relatedCode?: string;
    style?: string;
  };
}

interface EditResult {
  documentId: string;
  documentPath: string;
  editId?: string;
  status: 'success' | 'failed';
  confidence?: number;
  error?: string;
}

/**
 * Extract a specific section from markdown content
 */
function extractSection(content: string, heading: string): { content: string; startLine: number; endLine: number } | null {
  const lines = content.split('\n');
  let sectionStart = -1;
  let sectionEnd = lines.length;
  let headingLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = line.match(/^(#{1,6})\s+(.+)$/);

    if (match) {
      const currentHeading = match[2]?.trim() ?? '';
      const currentLevel = match[1]?.length ?? 0;

      if (currentHeading.toLowerCase() === heading.toLowerCase()) {
        sectionStart = i;
        headingLevel = currentLevel;
      } else if (sectionStart >= 0 && currentLevel <= headingLevel) {
        sectionEnd = i;
        break;
      }
    }
  }

  if (sectionStart < 0) {
    return null;
  }

  const sectionLines = lines.slice(sectionStart, sectionEnd);
  return {
    content: sectionLines.join('\n'),
    startLine: sectionStart,
    endLine: sectionEnd,
  };
}

/**
 * Identify which sections were modified in the edit
 */
function identifyModifiedSections(original: string, edited: string): string[] {
  const sections: string[] = [];
  const lines = edited.split('\n');

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const heading = match[2]?.trim() ?? '';

      // Check if this section's content changed
      const originalSection = extractSection(original, heading);
      const editedSection = extractSection(edited, heading);

      if (originalSection && editedSection && originalSection.content !== editedSection.content) {
        sections.push(heading);
      }
    }
  }

  return sections;
}

/**
 * Generate a readable diff between original and edited content
 */
function generateDiff(original: string, edited: string): string {
  const originalLines = original.split('\n');
  const editedLines = edited.split('\n');
  const diffLines: string[] = [];

  const maxLines = Math.max(originalLines.length, editedLines.length);
  let contextWindow = 3;
  let lastChangeIndex = -100;

  for (let i = 0; i < maxLines; i++) {
    const origLine = originalLines[i] ?? '';
    const newLine = editedLines[i] ?? '';

    if (origLine !== newLine) {
      // Show context before change
      if (i - lastChangeIndex > contextWindow * 2) {
        if (diffLines.length > 0) {
          diffLines.push('...');
        }
        for (let j = Math.max(0, i - contextWindow); j < i; j++) {
          diffLines.push(`  ${originalLines[j] ?? ''}`);
        }
      }

      // Show the change
      if (origLine && !newLine) {
        diffLines.push(`- ${origLine}`);
      } else if (!origLine && newLine) {
        diffLines.push(`+ ${newLine}`);
      } else {
        if (origLine) diffLines.push(`- ${origLine}`);
        if (newLine) diffLines.push(`+ ${newLine}`);
      }

      lastChangeIndex = i;
    } else if (i - lastChangeIndex <= contextWindow && lastChangeIndex >= 0) {
      // Show context after change
      diffLines.push(`  ${origLine}`);
    }
  }

  return diffLines.slice(0, 100).join('\n');
}

/**
 * Process a single document edit
 */
async function processDocumentEdit(
  documentId: string,
  instruction: string,
  sectionHeading?: string,
  context?: { relatedCode?: string; style?: string }
): Promise<EditResult> {
  try {
    // Fetch the document
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, content: true, path: true, title: true },
    });

    if (!document) {
      return {
        documentId,
        documentPath: 'unknown',
        status: 'failed',
        error: 'Document not found',
      };
    }

    let contentToEdit = document.content || '';
    let sectionInfo: { content: string; startLine: number; endLine: number } | null = null;

    // If scoped to a section, extract just that section
    if (sectionHeading) {
      sectionInfo = extractSection(contentToEdit, sectionHeading);
      if (!sectionInfo) {
        return {
          documentId,
          documentPath: document.path,
          status: 'failed',
          error: `Section "${sectionHeading}" not found`,
        };
      }
      contentToEdit = sectionInfo.content;
    }

    // Build the LLM prompt
    const anthropic = getAnthropicClient();
    if (!anthropic) {
      return {
        documentId,
        documentPath: document.path,
        status: 'failed',
        error: 'Anthropic client not available',
      };
    }

    const systemPrompt = `You are a documentation expert. Apply the requested edit to the documentation content.
Maintain the existing style, structure, and formatting unless specifically instructed to change them.
Return ONLY the edited content, no explanations or markdown code blocks.`;

    const userPrompt = `Apply this edit instruction to the documentation:

Instruction: "${instruction}"

${sectionHeading ? `Section: ${sectionHeading}\n` : ''}

Current content:
\`\`\`markdown
${contentToEdit}
\`\`\`

${context?.relatedCode ? `\nRelated code for context:\n\`\`\`\n${context.relatedCode}\n\`\`\`\n` : ''}
${context?.style ? `\nStyle guide: ${context.style}\n` : ''}

Return the edited content:`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: userPrompt,
      }],
    });

    const textContent = response.content[0];
    if (!textContent || textContent.type !== 'text') {
      return {
        documentId,
        documentPath: document.path,
        status: 'failed',
        error: 'Unexpected response type from LLM',
      };
    }

    let editedContent = (textContent as { type: 'text'; text: string }).text.trim();

    // Clean up common markdown wrapper artifacts
    editedContent = editedContent.replace(/^```(?:markdown)?\n/, '').replace(/\n```$/, '');

    // If we edited just a section, replace it in the full document
    let fullEditedContent = editedContent;
    if (sectionInfo) {
      const lines = (document.content || '').split('\n');
      lines.splice(sectionInfo.startLine, sectionInfo.endLine - sectionInfo.startLine, editedContent);
      fullEditedContent = lines.join('\n');
    }

    // Calculate confidence based on edit magnitude
    const originalLength = contentToEdit.length;
    const editedLength = editedContent.length;
    const changeRatio = Math.abs(editedLength - originalLength) / Math.max(originalLength, 1);

    let confidence = 0.85;
    if (changeRatio < 0.05) confidence = 0.6;
    if (changeRatio > 2.0) confidence = 0.5;

    // Identify modified sections
    const sectionsModified = identifyModifiedSections(document.content || '', fullEditedContent);

    // Generate diff
    const diff = generateDiff(document.content || '', fullEditedContent);

    // Store the edit record
    const editRecord = await prisma.nLEdit.create({
      data: {
        documentId,
        instruction,
        originalContent: document.content || '',
        editedContent: fullEditedContent,
        diff,
        sectionsModified,
        confidence,
        status: 'preview',
        metadata: {
          sectionHeading,
          context,
          processedByWorker: true,
        },
      },
    });

    log.info({ documentId, editId: editRecord.id, instruction }, 'Processed NL edit in worker');

    return {
      documentId,
      documentPath: document.path,
      editId: editRecord.id,
      status: 'success',
      confidence,
    };
  } catch (error) {
    log.error({ error, documentId }, 'Failed to process document edit');
    return {
      documentId,
      documentPath: 'unknown',
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export function startNLEditorWorker() {
  const worker = createWorker(
    QUEUE_NAMES.NL_EDITOR,
    async (job) => {
      const data = job.data as NLEditorJobData;
      const { type, repositoryId, instruction, targetDocuments, scope, documentId, sectionHeading, context } = data;

      log.info({ jobId: job.id, type, repositoryId }, 'Starting NL editor job');

      await job.updateProgress(5);

      try {
        if (type === 'single' && documentId) {
          // Process single document edit
          const result = await processDocumentEdit(documentId, instruction, sectionHeading, context);

          await job.updateProgress(100);

          return;
        } else if (type === 'batch') {
          // Process batch edit
          // Build document query
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const whereClause: any = { repositoryId };

          if (targetDocuments && targetDocuments.length > 0) {
            whereClause.id = { in: targetDocuments };
          } else if (scope) {
            // Apply scope filters
            switch (scope) {
              case 'api-docs':
                whereClause.type = 'api';
                break;
              case 'guides':
                whereClause.type = 'guide';
                break;
              case 'readme':
                whereClause.path = { contains: 'README' };
                break;
            }
          }

          const documents = await prisma.document.findMany({
            where: whereClause,
            select: { id: true, path: true },
            take: 50, // Limit for safety
          });

          await job.updateProgress(10);

          const results: EditResult[] = [];
          let successCount = 0;
          let failedCount = 0;

          for (let i = 0; i < documents.length; i++) {
            const doc = documents[i];
            if (!doc) continue;

            const result = await processDocumentEdit(doc.id, instruction);
            results.push(result);

            if (result.status === 'success') {
              successCount++;
            } else {
              failedCount++;
            }

            // Update progress
            const progress = 10 + Math.floor((i / documents.length) * 85);
            await job.updateProgress(progress);
          }

          // Create batch record
          const batch = await prisma.batchNLEdit.create({
            data: {
              repositoryId,
              instruction,
              scope: scope || 'all',
              totalDocuments: documents.length,
              editedDocuments: successCount,
              skippedDocuments: failedCount,
              results: results.filter(r => r.editId).map(r => r.editId as string),
            },
          });

          await job.updateProgress(100);

          log.info(
            {
              jobId: job.id,
              batchId: batch.id,
              repositoryId,
              totalDocuments: documents.length,
              successCount,
              failedCount,
            },
            'Completed batch NL edit'
          );

          return;
        } else {
          throw new Error('Invalid job type or missing parameters');
        }
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId }, 'NL editor job failed');
        throw error;
      }
    },
    { concurrency: 2 } // Process up to 2 batch edits concurrently
  );

  log.info('NL editor worker started');
  return worker;
}
