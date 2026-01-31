import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createLogger } from '@docsynth/utils';

const log = createLogger('quality-scorer-service');

export interface QualityScore {
  overall: number;
  dimensions: {
    accuracy: number;
    completeness: number;
    clarity: number;
    consistency: number;
    usefulness: number;
  };
  issues: QualityIssue[];
  suggestions: string[];
}

export interface QualityIssue {
  type: 'error' | 'warning' | 'info';
  category: 'accuracy' | 'completeness' | 'clarity' | 'consistency' | 'usefulness';
  message: string;
  location?: string;
}

export class QualityScorerService {
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

  async scoreDocumentation(
    generatedDoc: string,
    codeContext: string,
    styleGuide?: string
  ): Promise<QualityScore> {
    log.info('Scoring documentation quality');

    const prompt = this.buildScoringPrompt(generatedDoc, codeContext, styleGuide);
    const score = await this.runScoring(prompt);

    return score;
  }

  private buildScoringPrompt(doc: string, code: string, styleGuide?: string): string {
    return `You are a documentation quality reviewer. Score the following generated documentation.

## Code Context (what the documentation describes)
\`\`\`
${code.slice(0, 5000)}
\`\`\`

## Generated Documentation
${doc.slice(0, 8000)}

${styleGuide ? `## Style Guide\n${styleGuide}` : ''}

---

Evaluate the documentation on these dimensions (score 0.0 to 1.0):

1. **Accuracy**: Does the documentation correctly describe the code? Are there any factual errors?
2. **Completeness**: Are all important features, parameters, and return values documented?
3. **Clarity**: Is the documentation easy to understand? Is it well-organized?
4. **Consistency**: Does it follow consistent formatting and terminology?
5. **Usefulness**: Would a developer find this documentation helpful?

Return a JSON object:
{
  "overall": 0.0-1.0,
  "dimensions": {
    "accuracy": 0.0-1.0,
    "completeness": 0.0-1.0,
    "clarity": 0.0-1.0,
    "consistency": 0.0-1.0,
    "usefulness": 0.0-1.0
  },
  "issues": [
    {
      "type": "error" | "warning" | "info",
      "category": "accuracy" | "completeness" | "clarity" | "consistency" | "usefulness",
      "message": "Description of the issue",
      "location": "Optional: where in the doc"
    }
  ],
  "suggestions": [
    "Specific improvement suggestions"
  ]
}

Return ONLY the JSON object:`;
  }

  private async runScoring(prompt: string): Promise<QualityScore> {
    if (this.anthropic) {
      try {
        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
        return this.parseScoringResponse(text);
      } catch (error) {
        log.warn({ error }, 'Anthropic scoring failed');
      }
    }

    if (this.openai) {
      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.choices[0]?.message?.content ?? '';
        return this.parseScoringResponse(text);
      } catch (error) {
        log.warn({ error }, 'OpenAI scoring failed');
      }
    }

    return this.getDefaultScore();
  }

  private parseScoringResponse(text: string): QualityScore {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          overall: parsed.overall ?? 0.5,
          dimensions: {
            accuracy: parsed.dimensions?.accuracy ?? 0.5,
            completeness: parsed.dimensions?.completeness ?? 0.5,
            clarity: parsed.dimensions?.clarity ?? 0.5,
            consistency: parsed.dimensions?.consistency ?? 0.5,
            usefulness: parsed.dimensions?.usefulness ?? 0.5,
          },
          issues: (parsed.issues ?? []).map((issue: QualityIssue) => ({
            type: issue.type ?? 'info',
            category: issue.category ?? 'usefulness',
            message: issue.message ?? '',
            location: issue.location,
          })),
          suggestions: parsed.suggestions ?? [],
        };
      }
    } catch (error) {
      log.warn({ error }, 'Failed to parse scoring response');
    }

    return this.getDefaultScore();
  }

  private getDefaultScore(): QualityScore {
    return {
      overall: 0.7,
      dimensions: {
        accuracy: 0.7,
        completeness: 0.7,
        clarity: 0.7,
        consistency: 0.7,
        usefulness: 0.7,
      },
      issues: [],
      suggestions: [],
    };
  }

  meetsQualityThreshold(score: QualityScore, threshold = 0.6): boolean {
    return (
      score.overall >= threshold &&
      score.dimensions.accuracy >= threshold &&
      !score.issues.some((i) => i.type === 'error')
    );
  }
}

export const qualityScorerService = new QualityScorerService();
