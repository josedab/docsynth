import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createLogger } from '@docsynth/utils';
import type { FileChange, SemanticChange } from '@docsynth/types';

const log = createLogger('inline-comments-generator');

export interface InlineCommentContext {
  filePath: string;
  fileContent: string;
  language: string;
  semanticChanges: SemanticChange[];
  prTitle: string;
  prBody: string | null;
}

export interface GeneratedComment {
  filePath: string;
  lineNumber: number;
  comment: string;
  type: 'function' | 'class' | 'block' | 'inline';
}

export interface InlineCommentsResult {
  comments: GeneratedComment[];
  tokensUsed: number;
}

export class InlineCommentsGeneratorService {
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }

    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  // Determine if a file needs inline comments
  shouldGenerateComments(change: FileChange): boolean {
    const hasComplexLogic = change.semanticChanges.some((sc) =>
      ['logic-change', 'algorithm-change', 'new-function', 'new-class'].includes(sc.type)
    );

    const isSignificant = change.additions > 20;
    const isNotTest = !change.path.includes('.test.') && !change.path.includes('.spec.');

    return hasComplexLogic && isSignificant && isNotTest;
  }

  // Detect language from file extension
  detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      java: 'java',
      kt: 'kotlin',
      swift: 'swift',
      cs: 'csharp',
      cpp: 'cpp',
      c: 'c',
      php: 'php',
    };
    return langMap[ext ?? ''] ?? 'text';
  }

  // Get comment syntax for language
  getCommentSyntax(language: string): { single: string; multiStart: string; multiEnd: string } {
    const syntaxMap: Record<string, { single: string; multiStart: string; multiEnd: string }> = {
      typescript: { single: '//', multiStart: '/**', multiEnd: ' */' },
      javascript: { single: '//', multiStart: '/**', multiEnd: ' */' },
      python: { single: '#', multiStart: '"""', multiEnd: '"""' },
      ruby: { single: '#', multiStart: '=begin', multiEnd: '=end' },
      go: { single: '//', multiStart: '/*', multiEnd: '*/' },
      rust: { single: '//', multiStart: '/*', multiEnd: '*/' },
      java: { single: '//', multiStart: '/**', multiEnd: ' */' },
      kotlin: { single: '//', multiStart: '/**', multiEnd: ' */' },
      swift: { single: '//', multiStart: '/**', multiEnd: ' */' },
      csharp: { single: '//', multiStart: '///', multiEnd: '' },
      cpp: { single: '//', multiStart: '/**', multiEnd: ' */' },
      c: { single: '//', multiStart: '/**', multiEnd: ' */' },
      php: { single: '//', multiStart: '/**', multiEnd: ' */' },
    };
    return syntaxMap[language] ?? { single: '//', multiStart: '/*', multiEnd: '*/' };
  }

  async generateComments(context: InlineCommentContext): Promise<InlineCommentsResult> {
    log.info({ filePath: context.filePath }, 'Generating inline comments');

    const prompt = this.buildPrompt(context);
    const { content, tokensUsed } = await this.generate(prompt);

    const comments = this.parseGeneratedComments(content, context.filePath);

    return { comments, tokensUsed };
  }

  private buildPrompt(context: InlineCommentContext): string {
    const syntax = this.getCommentSyntax(context.language);

    return `Analyze this ${context.language} code and generate helpful inline comments:

## File: ${context.filePath}

## Code:
\`\`\`${context.language}
${context.fileContent}
\`\`\`

## Semantic Changes in this PR:
${context.semanticChanges.map((sc) => `- ${sc.type}: ${sc.name} - ${sc.description}`).join('\n')}

## PR Context:
**Title:** ${context.prTitle}
**Description:** ${context.prBody ?? 'No description'}

---

Generate inline comments for:
1. Complex functions - explain the algorithm and approach
2. Non-obvious logic - explain why, not what
3. Important parameters - describe expected values
4. Return values - describe what's returned and when
5. Edge cases - note any edge case handling

Comment syntax for ${context.language}:
- Single line: ${syntax.single}
- Multi-line: ${syntax.multiStart} ... ${syntax.multiEnd}

**Guidelines:**
- Only comment where it adds value
- Explain "why" not "what"
- Keep comments concise
- Use JSDoc/docstring format for functions
- Don't state the obvious

**Output format (JSON array):**
\`\`\`json
[
  {
    "lineNumber": 10,
    "type": "function",
    "comment": "The comment text"
  }
]
\`\`\`

Output ONLY the JSON array:`;
  }

  private parseGeneratedComments(content: string, filePath: string): GeneratedComment[] {
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        lineNumber: number;
        type: string;
        comment: string;
      }>;

      return parsed.map((c) => ({
        filePath,
        lineNumber: c.lineNumber,
        comment: c.comment,
        type: (c.type as 'function' | 'class' | 'block' | 'inline') || 'inline',
      }));
    } catch (error) {
      log.warn({ error }, 'Failed to parse generated comments');
      return [];
    }
  }

  private async generate(prompt: string): Promise<{ content: string; tokensUsed: number }> {
    if (this.anthropic) {
      try {
        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        });

        const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
        return { content, tokensUsed: response.usage.input_tokens + response.usage.output_tokens };
      } catch (error) {
        log.warn({ error }, 'Anthropic generation failed');
      }
    }

    if (this.openai) {
      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        });

        const content = response.choices[0]?.message?.content ?? '';
        return { content, tokensUsed: response.usage?.total_tokens ?? 0 };
      } catch (error) {
        log.warn({ error }, 'OpenAI generation failed');
      }
    }

    return { content: '[]', tokensUsed: 0 };
  }

  // Apply comments to file content
  applyCommentsToFile(
    fileContent: string,
    comments: GeneratedComment[],
    language: string
  ): string {
    const lines = fileContent.split('\n');
    const syntax = this.getCommentSyntax(language);

    // Sort comments by line number in descending order to preserve line numbers
    const sortedComments = [...comments].sort((a, b) => b.lineNumber - a.lineNumber);

    for (const comment of sortedComments) {
      if (comment.lineNumber > 0 && comment.lineNumber <= lines.length) {
        const lineIndex = comment.lineNumber - 1;
        const indentation = lines[lineIndex]?.match(/^\s*/)?.[0] ?? '';

        let formattedComment: string;
        if (comment.type === 'function' || comment.type === 'class') {
          // Multi-line JSDoc style
          formattedComment = this.formatDocComment(comment.comment, indentation, syntax);
        } else {
          // Single-line comment
          formattedComment = `${indentation}${syntax.single} ${comment.comment}`;
        }

        lines.splice(lineIndex, 0, formattedComment);
      }
    }

    return lines.join('\n');
  }

  private formatDocComment(
    comment: string,
    indentation: string,
    syntax: { multiStart: string; multiEnd: string }
  ): string {
    const lines = comment.split('\n');

    if (lines.length === 1) {
      return `${indentation}${syntax.multiStart} ${comment} ${syntax.multiEnd}`;
    }

    const formatted = [
      `${indentation}${syntax.multiStart}`,
      ...lines.map((line) => `${indentation} * ${line}`),
      `${indentation}${syntax.multiEnd}`,
    ];

    return formatted.join('\n');
  }

  // Generate comments for multiple files
  async generateCommentsForChanges(
    changes: FileChange[],
    fileContents: Map<string, string>,
    prTitle: string,
    prBody: string | null
  ): Promise<Map<string, InlineCommentsResult>> {
    const results = new Map<string, InlineCommentsResult>();

    for (const change of changes) {
      if (!this.shouldGenerateComments(change)) continue;

      const content = fileContents.get(change.path);
      if (!content) continue;

      const result = await this.generateComments({
        filePath: change.path,
        fileContent: content,
        language: this.detectLanguage(change.path),
        semanticChanges: change.semanticChanges,
        prTitle,
        prBody,
      });

      if (result.comments.length > 0) {
        results.set(change.path, result);
      }
    }

    return results;
  }
}

export const inlineCommentsGeneratorService = new InlineCommentsGeneratorService();
