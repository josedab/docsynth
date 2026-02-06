/**
 * Natural Language Doc Editor Service
 *
 * Allows developers to modify documentation through natural language commands.
 * Supports single-doc edits, batch edits across multiple documents, and AI-powered suggestions.
 */

import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';

const log = createLogger('nl-editor-service');

// ============================================================================
// Types
// ============================================================================

export interface NLEditRequest {
  documentId: string;
  instruction: string;
  sectionHeading?: string; // scope edit to a section
  context?: {
    relatedCode?: string;
    style?: string;
  };
}

export interface NLEditResult {
  id: string;
  documentId: string;
  instruction: string;
  originalContent: string;
  editedContent: string;
  diff: string;
  sectionsModified: string[];
  confidence: number;
  status: 'preview' | 'applied' | 'rejected';
  createdAt: Date;
}

export interface BatchEditRequest {
  instruction: string;
  repositoryId: string;
  targetDocuments?: string[]; // doc IDs, or all if empty
  scope?: 'all' | 'api-docs' | 'guides' | 'readme';
}

export interface BatchEditResult {
  id: string;
  instruction: string;
  results: NLEditResult[];
  totalDocuments: number;
  editedDocuments: number;
  skippedDocuments: number;
}

export interface EditSuggestion {
  id: string;
  documentId: string;
  instruction: string;
  reason: string;
  confidence: number;
  priority: 'low' | 'medium' | 'high';
}

// ============================================================================
// Section Extraction
// ============================================================================

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

// ============================================================================
// Diff Generation
// ============================================================================

/**
 * Generate a readable diff between original and edited content
 */
export function generateDiff(original: string, edited: string): string {
  const originalLines = original.split('\n');
  const editedLines = edited.split('\n');
  const diffLines: string[] = [];

  const maxLines = Math.max(originalLines.length, editedLines.length);
  let contextWindow = 3; // Lines of context around changes
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

  return diffLines.slice(0, 100).join('\n'); // Limit diff size
}

// ============================================================================
// Natural Language Edit Processing
// ============================================================================

/**
 * Process a natural language edit request using LLM
 */
export async function processNLEdit(request: NLEditRequest): Promise<NLEditResult> {
  const { documentId, instruction, sectionHeading, context } = request;

  // Fetch the document
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, content: true, path: true, title: true },
  });

  if (!document) {
    throw new Error('Document not found');
  }

  let contentToEdit = document.content || '';
  let sectionInfo: { content: string; startLine: number; endLine: number } | null = null;

  // If scoped to a section, extract just that section
  if (sectionHeading) {
    sectionInfo = extractSection(contentToEdit, sectionHeading);
    if (!sectionInfo) {
      throw new Error(`Section "${sectionHeading}" not found in document`);
    }
    contentToEdit = sectionInfo.content;
  }

  // Build the LLM prompt
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  const systemPrompt = `You are a documentation expert. Apply the requested edit to the documentation content.
Maintain the existing style, structure, and formatting unless specifically instructed to change them.
Return ONLY the edited content, no explanations or markdown code blocks.`;

  let userPrompt = `Apply this edit instruction to the documentation:

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
    throw new Error('Unexpected response type from LLM');
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

  // High confidence if change is moderate (not too small, not too large)
  let confidence = 0.85;
  if (changeRatio < 0.05) confidence = 0.6; // Too small a change
  if (changeRatio > 2.0) confidence = 0.5; // Too large a change

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
      },
    },
  });

  log.info({ documentId, editId: editRecord.id, instruction }, 'Processed NL edit');

  return {
    id: editRecord.id,
    documentId,
    instruction,
    originalContent: document.content || '',
    editedContent: fullEditedContent,
    diff,
    sectionsModified,
    confidence,
    status: 'preview',
    createdAt: editRecord.createdAt,
  };
}

// ============================================================================
// Apply/Reject Edits
// ============================================================================

/**
 * Apply a previewed edit to the document
 */
export async function applyEdit(editId: string): Promise<NLEditResult> {
  const edit = await prisma.nLEdit.findUnique({
    where: { id: editId },
  });

  if (!edit) {
    throw new Error('Edit not found');
  }

  if (edit.status !== 'preview') {
    throw new Error(`Edit is already ${edit.status}`);
  }

  // Update the document
  await prisma.document.update({
    where: { id: edit.documentId },
    data: {
      content: edit.editedContent,
      version: { increment: 1 },
    },
  });

  // Update edit status
  const updatedEdit = await prisma.nLEdit.update({
    where: { id: editId },
    data: { status: 'applied', appliedAt: new Date() },
  });

  log.info({ editId, documentId: edit.documentId }, 'Applied NL edit');

  return {
    id: updatedEdit.id,
    documentId: updatedEdit.documentId,
    instruction: updatedEdit.instruction,
    originalContent: updatedEdit.originalContent,
    editedContent: updatedEdit.editedContent,
    diff: updatedEdit.diff,
    sectionsModified: updatedEdit.sectionsModified as string[],
    confidence: updatedEdit.confidence,
    status: updatedEdit.status as 'applied',
    createdAt: updatedEdit.createdAt,
  };
}

/**
 * Reject a previewed edit
 */
export async function rejectEdit(editId: string): Promise<NLEditResult> {
  const edit = await prisma.nLEdit.findUnique({
    where: { id: editId },
  });

  if (!edit) {
    throw new Error('Edit not found');
  }

  if (edit.status !== 'preview') {
    throw new Error(`Edit is already ${edit.status}`);
  }

  // Update edit status
  const updatedEdit = await prisma.nLEdit.update({
    where: { id: editId },
    data: { status: 'rejected', rejectedAt: new Date() },
  });

  log.info({ editId, documentId: edit.documentId }, 'Rejected NL edit');

  return {
    id: updatedEdit.id,
    documentId: updatedEdit.documentId,
    instruction: updatedEdit.instruction,
    originalContent: updatedEdit.originalContent,
    editedContent: updatedEdit.editedContent,
    diff: updatedEdit.diff,
    sectionsModified: updatedEdit.sectionsModified as string[],
    confidence: updatedEdit.confidence,
    status: updatedEdit.status as 'rejected',
    createdAt: updatedEdit.createdAt,
  };
}

// ============================================================================
// Batch Edits
// ============================================================================

/**
 * Process a batch edit across multiple documents
 */
export async function processBatchEdit(request: BatchEditRequest): Promise<BatchEditResult> {
  const { instruction, repositoryId, targetDocuments, scope } = request;

  // Build document query
  const whereClause: {
    repositoryId: string;
    id?: { in: string[] };
    type?: string;
    path?: { contains: string };
  } = { repositoryId };

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
      // 'all' - no filter
    }
  }

  const documents = await prisma.document.findMany({
    where: whereClause,
    select: { id: true, path: true, title: true },
    take: 50, // Limit for safety
  });

  const results: NLEditResult[] = [];
  let editedDocuments = 0;
  let skippedDocuments = 0;

  for (const doc of documents) {
    try {
      const result = await processNLEdit({
        documentId: doc.id,
        instruction,
      });
      results.push(result);
      editedDocuments++;
    } catch (error) {
      log.error({ documentId: doc.id, error }, 'Failed to process batch edit for document');
      skippedDocuments++;
    }
  }

  // Create batch record
  const batch = await prisma.batchNLEdit.create({
    data: {
      repositoryId,
      instruction,
      scope: scope || 'all',
      totalDocuments: documents.length,
      editedDocuments,
      skippedDocuments,
      results: results.map(r => r.id),
    },
  });

  log.info({ batchId: batch.id, repositoryId, editedDocuments, skippedDocuments }, 'Processed batch NL edit');

  return {
    id: batch.id,
    instruction,
    results,
    totalDocuments: documents.length,
    editedDocuments,
    skippedDocuments,
  };
}

// ============================================================================
// Edit History
// ============================================================================

/**
 * Get edit history for a document
 */
export async function getEditHistory(documentId: string, limit: number = 20): Promise<NLEditResult[]> {
  const edits = await prisma.nLEdit.findMany({
    where: { documentId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return edits.map(edit => ({
    id: edit.id,
    documentId: edit.documentId,
    instruction: edit.instruction,
    originalContent: edit.originalContent,
    editedContent: edit.editedContent,
    diff: edit.diff,
    sectionsModified: edit.sectionsModified as string[],
    confidence: edit.confidence,
    status: edit.status as 'preview' | 'applied' | 'rejected',
    createdAt: edit.createdAt,
  }));
}

// ============================================================================
// AI-Powered Edit Suggestions
// ============================================================================

/**
 * Generate AI-powered edit suggestions for a document
 */
export async function suggestEdits(documentId: string): Promise<EditSuggestion[]> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      repository: {
        select: { id: true, name: true },
      },
    },
  });

  if (!document) {
    throw new Error('Document not found');
  }

  const content = document.content || '';

  // Get recent code changes that might affect this doc
  const recentPRs = await prisma.pREvent.findMany({
    where: {
      repositoryId: document.repositoryId,
      mergedAt: {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
      },
    },
    orderBy: { mergedAt: 'desc' },
    take: 5,
    select: { title: true, body: true },
  });

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  const systemPrompt = `You are a documentation expert. Suggest improvements to the documentation.
Return a JSON array of suggestions, each with: instruction, reason, confidence (0-1), priority (low/medium/high).`;

  const userPrompt = `Analyze this documentation and suggest improvements:

Document: ${document.title || document.path}

Content:
\`\`\`markdown
${content.substring(0, 4000)}
\`\`\`

${recentPRs.length > 0 ? `Recent changes in the repository:\n${recentPRs.map(pr => `- ${pr.title}`).join('\n')}\n` : ''}

Suggest 3-5 specific edits that would improve this documentation. Focus on:
- Outdated information
- Missing sections
- Clarity improvements
- Technical accuracy
- Consistency

Return JSON array:
[{
  "instruction": "specific edit instruction",
  "reason": "why this edit is needed",
  "confidence": 0.0-1.0,
  "priority": "low|medium|high"
}]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: userPrompt,
    }],
  });

  const textContent = response.content[0];
  if (!textContent || textContent.type !== 'text') {
    return [];
  }

  const responseText = (textContent as { type: 'text'; text: string }).text;

  // Extract JSON from response
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return [];
  }

  try {
    const suggestions = JSON.parse(jsonMatch[0]) as Array<{
      instruction: string;
      reason: string;
      confidence: number;
      priority: 'low' | 'medium' | 'high';
    }>;

    return suggestions.map((s, i) => ({
      id: `suggestion-${documentId}-${i}`,
      documentId,
      instruction: s.instruction,
      reason: s.reason,
      confidence: s.confidence,
      priority: s.priority,
    }));
  } catch (error) {
    log.error({ error }, 'Failed to parse edit suggestions');
    return [];
  }
}
