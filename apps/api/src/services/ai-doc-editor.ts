/**
 * AI Doc Editor Service
 *
 * Provides real-time AI-powered documentation editing suggestions,
 * context-aware completions, and style improvements.
 */

import { prisma } from '@docsynth/database';
import { createLogger, createLLMClient } from '@docsynth/utils';
import { broadcastAISuggestion } from './websocket.js';

const log = createLogger('ai-doc-editor');

// Types for AI Doc Editor
export interface EditorContext {
  documentId?: string;
  repositoryId: string;
  filePath?: string;
  content: string;
  cursorPosition: { line: number; character: number };
  selection?: { start: { line: number; character: number }; end: { line: number; character: number } };
  language?: string;
}

export interface AISuggestion {
  id: string;
  text: string;
  position: { line: number; character: number };
  endPosition?: { line: number; character: number };
  type: 'insert' | 'replace' | 'delete';
  category: 'completion' | 'improvement' | 'style' | 'grammar' | 'clarity';
  confidence: number;
  reason: string;
}

export interface InlineSuggestion {
  id: string;
  suggestionText: string;
  displayText: string;
  position: { line: number; character: number };
  type: 'ghost' | 'inline' | 'tooltip';
}

export interface StyleFix {
  id: string;
  originalText: string;
  suggestedText: string;
  lineStart: number;
  lineEnd: number;
  category: 'consistency' | 'formatting' | 'terminology' | 'tone';
  explanation: string;
}

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export class AIDocEditorService {
  private llmClient = createLLMClient();

  /**
   * Get inline completion suggestions based on cursor position
   */
  async getInlineCompletion(context: EditorContext): Promise<InlineSuggestion | null> {
    try {
      const { content, cursorPosition, repositoryId } = context;
      const lines = content.split('\n');
      const currentLine = lines[cursorPosition.line] || '';
      const textBeforeCursor = currentLine.substring(0, cursorPosition.character);

      // Get style profile for the repository
      const styleProfile = await db.styleProfile.findUnique({
        where: { repositoryId },
      });

      // Get context from surrounding lines
      const contextStart = Math.max(0, cursorPosition.line - 5);
      const contextEnd = Math.min(lines.length, cursorPosition.line + 3);
      const contextLines = lines.slice(contextStart, contextEnd).join('\n');

      const prompt = `Complete the following documentation text. Return ONLY the completion text, nothing else.

Context:
\`\`\`
${contextLines}
\`\`\`

Current line (cursor at |): "${textBeforeCursor}|"

${styleProfile ? `Style notes: Use ${styleProfile.tone?.formality > 0.5 ? 'formal' : 'casual'} tone.` : ''}

Provide a natural completion for this documentation. Only return the completion text.`;

      const response = await this.llmClient.generate(prompt, { maxTokens: 256 });

      const completion = response.content || null;

      if (!completion || completion.length < 2) {
        return null;
      }

      return {
        id: `completion-${Date.now()}`,
        suggestionText: completion,
        displayText: completion.length > 50 ? completion.substring(0, 50) + '...' : completion,
        position: cursorPosition,
        type: 'ghost',
      };
    } catch (error) {
      log.error({ error }, 'Failed to get inline completion');
      return null;
    }
  }

  /**
   * Get improvement suggestions for a selected text range
   */
  async getImprovementSuggestions(context: EditorContext): Promise<AISuggestion[]> {
    try {
      if (!context.selection) {
        return [];
      }

      const { content, selection, repositoryId } = context;
      const lines = content.split('\n');

      // Extract selected text
      const selectedLines = lines.slice(selection.start.line, selection.end.line + 1);
      if (selection.start.line === selection.end.line) {
        const line = lines[selection.start.line] || '';
        selectedLines[0] = line.substring(selection.start.character, selection.end.character);
      } else {
        selectedLines[0] = (selectedLines[0] || '').substring(selection.start.character);
        selectedLines[selectedLines.length - 1] = (selectedLines[selectedLines.length - 1] || '').substring(0, selection.end.character);
      }
      const selectedText = selectedLines.join('\n');

      // Get style profile
      const styleProfile = await db.styleProfile.findUnique({
        where: { repositoryId },
      });

      const prompt = `Analyze this documentation text and suggest improvements. Return JSON only.

Selected text:
\`\`\`
${selectedText}
\`\`\`

${styleProfile ? `Style notes: The documentation should be ${styleProfile.tone?.formality > 0.5 ? 'formal' : 'casual'}.` : ''}

Return a JSON array of suggestions:
[{
  "category": "improvement|style|grammar|clarity",
  "suggestedText": "improved version",
  "reason": "why this is better",
  "confidence": 0.0-1.0
}]

Return only valid JSON, no markdown.`;

      const response = await this.llmClient.generate(prompt, { maxTokens: 1024 });

      const responseText = response.content || '[]';

      let suggestions: Array<{
        category: string;
        suggestedText: string;
        reason: string;
        confidence: number;
      }>;
      try {
        suggestions = JSON.parse(responseText);
      } catch {
        return [];
      }

      return suggestions.map((s, i) => ({
        id: `suggestion-${Date.now()}-${i}`,
        text: s.suggestedText,
        position: selection.start,
        endPosition: selection.end,
        type: 'replace' as const,
        category: s.category as AISuggestion['category'],
        confidence: s.confidence,
        reason: s.reason,
      }));
    } catch (error) {
      log.error({ error }, 'Failed to get improvement suggestions');
      return [];
    }
  }

  /**
   * Check document for style consistency and suggest fixes
   */
  async getStyleFixes(
    repositoryId: string,
    content: string
  ): Promise<StyleFix[]> {
    try {
      // Get style profile
      const styleProfile = await db.styleProfile.findUnique({
        where: { repositoryId },
      });

      if (!styleProfile) {
        return [];
      }

      const prompt = `Analyze this documentation for style consistency. Return JSON only.

Document:
\`\`\`markdown
${content}
\`\`\`

Style profile:
- Heading style: ${styleProfile.patterns?.headingStyle || 'atx'}
- List style: ${styleProfile.patterns?.listStyle || 'dash'}
- Formality: ${styleProfile.tone?.formality ?? 0.5}
- Terminology map: ${JSON.stringify(styleProfile.terminology || {})}

Find inconsistencies and return fixes as JSON:
[{
  "originalText": "the problematic text",
  "suggestedText": "the corrected text",
  "lineStart": 0,
  "lineEnd": 0,
  "category": "consistency|formatting|terminology|tone",
  "explanation": "why this should be changed"
}]

Return only valid JSON, no markdown.`;

      const response = await this.llmClient.generate(prompt, { maxTokens: 2048 });

      const responseText = response.content || '[]';

      let fixes: Array<{
        originalText: string;
        suggestedText: string;
        lineStart: number;
        lineEnd: number;
        category: string;
        explanation: string;
      }>;
      try {
        fixes = JSON.parse(responseText);
      } catch {
        return [];
      }

      return fixes.map((f, i) => ({
        id: `fix-${Date.now()}-${i}`,
        originalText: f.originalText,
        suggestedText: f.suggestedText,
        lineStart: f.lineStart,
        lineEnd: f.lineEnd,
        category: f.category as StyleFix['category'],
        explanation: f.explanation,
      }));
    } catch (error) {
      log.error({ error }, 'Failed to get style fixes');
      return [];
    }
  }

  /**
   * Generate section content based on context and heading
   */
  async generateSection(
    repositoryId: string,
    heading: string,
    context: string,
    documentType: string
  ): Promise<string | null> {
    try {
      // Get style profile
      const styleProfile = await db.styleProfile.findUnique({
        where: { repositoryId },
      });

      // Get related documents for context
      const relatedDocs = await db.document.findMany({
        where: { repositoryId },
        take: 3,
        orderBy: { updatedAt: 'desc' },
        select: { content: true, type: true },
      });

      const prompt = `Generate documentation content for the following section.

Document type: ${documentType}
Section heading: ${heading}

Existing context:
\`\`\`
${context}
\`\`\`

${styleProfile ? `Style: ${styleProfile.tone?.formality > 0.5 ? 'Formal' : 'Casual'} tone, be ${styleProfile.tone?.technicality > 0.5 ? 'technical' : 'accessible'}.` : ''}

${relatedDocs.length > 0 ? `Reference style from existing docs:\n${relatedDocs.map((d: { content: string }) => d.content.substring(0, 200)).join('\n---\n')}` : ''}

Write the content for this section. Return only the content, no heading.`;

      const response = await this.llmClient.generate(prompt, { maxTokens: 2048 });

      const sectionContent = response.content || null;
      return sectionContent;
    } catch (error) {
      log.error({ error }, 'Failed to generate section');
      return null;
    }
  }

  /**
   * Stream AI suggestions to connected clients
   */
  async streamSuggestionToClients(
    documentId: string,
    suggestion: AISuggestion
  ): Promise<void> {
    broadcastAISuggestion(documentId, {
      id: suggestion.id,
      text: suggestion.text,
      position: suggestion.position,
      endPosition: suggestion.endPosition,
      type: suggestion.type,
      reason: suggestion.reason,
    });
  }

  /**
   * Analyze document and get all suggestions
   */
  async analyzeDocument(
    repositoryId: string,
    documentId: string,
    content: string
  ): Promise<{
    styleFixes: StyleFix[];
    suggestions: AISuggestion[];
    overallScore: number;
  }> {
    try {
      const styleFixes = await this.getStyleFixes(repositoryId, content);

      // Calculate overall quality score
      const penaltyPerFix = 2;
      const baseScore = 100;
      const overallScore = Math.max(0, baseScore - styleFixes.length * penaltyPerFix);

      // Store analysis results
      await db.docReview.create({
        data: {
          repositoryId,
          documentId,
          reviewType: 'manual',
          status: 'completed',
          overallScore,
          styleScore: overallScore,
          issuesFound: styleFixes.length,
          suggestions: styleFixes.map(f => ({
            category: 'style',
            severity: 'suggestion',
            originalText: f.originalText,
            suggestion: f.suggestedText,
            explanation: f.explanation,
          })),
        },
      });

      return {
        styleFixes,
        suggestions: [],
        overallScore,
      };
    } catch (error) {
      log.error({ error }, 'Failed to analyze document');
      return { styleFixes: [], suggestions: [], overallScore: 0 };
    }
  }

  /**
   * Apply a suggestion to the document
   */
  async applySuggestion(
    documentId: string,
    suggestionId: string,
    suggestionText: string,
    position: { line: number; character: number },
    endPosition?: { line: number; character: number }
  ): Promise<{ success: boolean; newContent?: string }> {
    try {
      const document = await db.document.findUnique({
        where: { id: documentId },
      });

      if (!document) {
        return { success: false };
      }

      const lines = document.content.split('\n');

      if (endPosition) {
        // Replace operation
        if (position.line === endPosition.line) {
          const line = lines[position.line] || '';
          lines[position.line] =
            line.substring(0, position.character) +
            suggestionText +
            line.substring(endPosition.character);
        } else {
          // Multi-line replace
          const startLine = lines[position.line] || '';
          const endLine = lines[endPosition.line] || '';
          lines[position.line] =
            startLine.substring(0, position.character) +
            suggestionText +
            endLine.substring(endPosition.character);
          lines.splice(position.line + 1, endPosition.line - position.line);
        }
      } else {
        // Insert operation
        const line = lines[position.line] || '';
        lines[position.line] =
          line.substring(0, position.character) +
          suggestionText +
          line.substring(position.character);
      }

      const newContent = lines.join('\n');

      // Update document
      await db.document.update({
        where: { id: documentId },
        data: {
          content: newContent,
          version: { increment: 1 },
        },
      });

      // Create version
      await db.docVersion.create({
        data: {
          documentId,
          content: newContent,
          version: document.version + 1,
        },
      });

      log.info({ documentId, suggestionId }, 'Applied AI suggestion to document');

      return { success: true, newContent };
    } catch (error) {
      log.error({ error, documentId, suggestionId }, 'Failed to apply suggestion');
      return { success: false };
    }
  }

  /**
   * Learn from user feedback on suggestions
   */
  async recordFeedback(
    suggestionId: string,
    accepted: boolean,
    userId: string
  ): Promise<void> {
    // Store feedback for improving suggestions
    log.info({ suggestionId, accepted, userId }, 'Recorded suggestion feedback');
    // Could be used to fine-tune suggestion quality over time
  }
}

export const aiDocEditorService = new AIDocEditorService();
