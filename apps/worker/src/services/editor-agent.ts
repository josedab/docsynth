import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createLogger } from '@docsynth/utils';
import type { GeneratedDocument } from '@docsynth/types';

const log = createLogger('editor-agent-service');

export interface EditResult {
  document: GeneratedDocument;
  edits: Edit[];
  improved: boolean;
}

export interface Edit {
  type: 'grammar' | 'clarity' | 'style' | 'structure' | 'content';
  original: string;
  replacement: string;
  reason: string;
}

export class EditorAgentService {
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  async editDocument(
    document: GeneratedDocument,
    styleGuide?: string,
    qualityIssues?: string[]
  ): Promise<EditResult> {
    log.info({ path: document.path }, 'Editing document');

    const prompt = this.buildEditPrompt(document.content, styleGuide, qualityIssues);
    const result = await this.runEdit(prompt, document);

    return result;
  }

  private buildEditPrompt(
    content: string,
    styleGuide?: string,
    qualityIssues?: string[]
  ): string {
    return `You are a technical documentation editor. Your task is to improve the following documentation.

## Original Documentation
${content}

${styleGuide ? `## Style Guide to Follow\n${styleGuide}` : ''}

${
  qualityIssues && qualityIssues.length > 0
    ? `## Issues to Address\n${qualityIssues.map((i) => `- ${i}`).join('\n')}`
    : ''
}

---

Edit the documentation to:
1. Fix any grammatical or spelling errors
2. Improve clarity and readability
3. Ensure consistent formatting
4. Address any identified quality issues
5. Maintain technical accuracy

Return a JSON object:
{
  "editedContent": "The full edited documentation",
  "edits": [
    {
      "type": "grammar" | "clarity" | "style" | "structure" | "content",
      "original": "Original text",
      "replacement": "Replacement text",
      "reason": "Why this edit was made"
    }
  ],
  "improved": true/false
}

Return ONLY the JSON object:`;
  }

  private async runEdit(prompt: string, document: GeneratedDocument): Promise<EditResult> {
    if (this.anthropic) {
      try {
        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
        return this.parseEditResponse(text, document);
      } catch (error) {
        log.warn({ error }, 'Anthropic edit failed');
      }
    }

    if (this.openai) {
      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.choices[0]?.message?.content ?? '';
        return this.parseEditResponse(text, document);
      } catch (error) {
        log.warn({ error }, 'OpenAI edit failed');
      }
    }

    // No edits if no LLM available
    return {
      document,
      edits: [],
      improved: false,
    };
  }

  private parseEditResponse(text: string, originalDoc: GeneratedDocument): EditResult {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          document: {
            ...originalDoc,
            content: parsed.editedContent ?? originalDoc.content,
          },
          edits: (parsed.edits ?? []).map((edit: Edit) => ({
            type: edit.type ?? 'content',
            original: edit.original ?? '',
            replacement: edit.replacement ?? '',
            reason: edit.reason ?? '',
          })),
          improved: parsed.improved ?? false,
        };
      }
    } catch (error) {
      log.warn({ error }, 'Failed to parse edit response');
    }

    return {
      document: originalDoc,
      edits: [],
      improved: false,
    };
  }

  async batchEdit(
    documents: GeneratedDocument[],
    styleGuide?: string
  ): Promise<EditResult[]> {
    const results: EditResult[] = [];

    for (const doc of documents) {
      const result = await this.editDocument(doc, styleGuide);
      results.push(result);
    }

    return results;
  }
}

export const editorAgentService = new EditorAgentService();
