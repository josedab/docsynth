import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createLogger } from '@docsynth/utils';
import type { StylePatterns, ToneProfile } from '@docsynth/types';

const log = createLogger('style-analyzer-service');

export interface AnalyzedStyle {
  patterns: StylePatterns;
  terminology: Record<string, string>;
  tone: ToneProfile;
  samplePhrases: string[];
}

export class StyleAnalyzerService {
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

  async analyzeExistingDocs(documents: string[]): Promise<AnalyzedStyle> {
    log.info({ docCount: documents.length }, 'Analyzing existing documentation style');

    if (documents.length === 0) {
      return this.getDefaultStyle();
    }

    // Combine documents for analysis (limit to avoid token limits)
    const combinedContent = documents
      .map((doc) => doc.slice(0, 3000))
      .join('\n\n---\n\n')
      .slice(0, 15000);

    const prompt = this.buildStyleAnalysisPrompt(combinedContent);
    const analysis = await this.runAnalysis(prompt);

    return analysis;
  }

  private buildStyleAnalysisPrompt(content: string): string {
    return `Analyze the following documentation samples and extract the writing style patterns:

## Documentation Samples
${content}

---

Analyze and return a JSON object with the following structure:

{
  "patterns": {
    "headingStyle": "atx" or "setext",
    "listStyle": "dash" or "asterisk" or "plus",
    "codeBlockStyle": "fenced" or "indented",
    "emphasisStyle": "asterisk" or "underscore",
    "linkStyle": "inline" or "reference",
    "sectionOrder": ["Overview", "Installation", "Usage", ...] // typical section order
  },
  "terminology": {
    // Key terms and their preferred forms, e.g.:
    "api": "API",
    "javascript": "JavaScript",
    "typescript": "TypeScript"
    // Add 5-10 common terms found in the docs
  },
  "tone": {
    "formality": 0.0 to 1.0, // 0 = casual, 1 = formal
    "technicality": 0.0 to 1.0, // 0 = beginner-friendly, 1 = expert-level
    "verbosity": 0.0 to 1.0, // 0 = concise, 1 = detailed
    "exampleFrequency": 0.0 to 1.0 // 0 = few examples, 1 = many examples
  },
  "samplePhrases": [
    // 5-10 characteristic phrases from the docs that capture the voice
  ]
}

Return ONLY the JSON object, no explanations:`;
  }

  private async runAnalysis(prompt: string): Promise<AnalyzedStyle> {
    if (this.anthropic) {
      try {
        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
        return this.parseAnalysisResponse(text);
      } catch (error) {
        log.warn({ error }, 'Anthropic analysis failed');
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
        return this.parseAnalysisResponse(text);
      } catch (error) {
        log.warn({ error }, 'OpenAI analysis failed');
      }
    }

    return this.getDefaultStyle();
  }

  private parseAnalysisResponse(text: string): AnalyzedStyle {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          patterns: {
            headingStyle: parsed.patterns?.headingStyle ?? 'atx',
            listStyle: parsed.patterns?.listStyle ?? 'dash',
            codeBlockStyle: parsed.patterns?.codeBlockStyle ?? 'fenced',
            emphasisStyle: parsed.patterns?.emphasisStyle ?? 'asterisk',
            linkStyle: parsed.patterns?.linkStyle ?? 'inline',
            sectionOrder: parsed.patterns?.sectionOrder ?? [],
          },
          terminology: parsed.terminology ?? {},
          tone: {
            formality: parsed.tone?.formality ?? 0.5,
            technicality: parsed.tone?.technicality ?? 0.5,
            verbosity: parsed.tone?.verbosity ?? 0.5,
            exampleFrequency: parsed.tone?.exampleFrequency ?? 0.5,
          },
          samplePhrases: parsed.samplePhrases ?? [],
        };
      }
    } catch (error) {
      log.warn({ error }, 'Failed to parse style analysis');
    }

    return this.getDefaultStyle();
  }

  private getDefaultStyle(): AnalyzedStyle {
    return {
      patterns: {
        headingStyle: 'atx',
        listStyle: 'dash',
        codeBlockStyle: 'fenced',
        emphasisStyle: 'asterisk',
        linkStyle: 'inline',
        sectionOrder: ['Overview', 'Installation', 'Usage', 'API', 'Examples', 'Contributing'],
      },
      terminology: {
        api: 'API',
        javascript: 'JavaScript',
        typescript: 'TypeScript',
        npm: 'npm',
        cli: 'CLI',
      },
      tone: {
        formality: 0.5,
        technicality: 0.6,
        verbosity: 0.5,
        exampleFrequency: 0.6,
      },
      samplePhrases: [],
    };
  }

  buildStyleGuide(style: AnalyzedStyle): string {
    const lines: string[] = [
      '## Documentation Style Guide',
      '',
      '### Formatting',
      `- Use ${style.patterns.headingStyle === 'atx' ? '# headings' : 'underline headings'}`,
      `- Use ${style.patterns.listStyle} for list items`,
      `- Use ${style.patterns.codeBlockStyle} code blocks`,
      `- Use ${style.patterns.emphasisStyle === 'asterisk' ? '*asterisks*' : '_underscores_'} for emphasis`,
      '',
      '### Tone',
      `- Formality: ${style.tone.formality > 0.6 ? 'Formal' : style.tone.formality < 0.4 ? 'Casual' : 'Balanced'}`,
      `- Technical level: ${style.tone.technicality > 0.6 ? 'Expert' : style.tone.technicality < 0.4 ? 'Beginner-friendly' : 'Intermediate'}`,
      `- Detail level: ${style.tone.verbosity > 0.6 ? 'Detailed' : style.tone.verbosity < 0.4 ? 'Concise' : 'Moderate'}`,
      `- Include ${style.tone.exampleFrequency > 0.5 ? 'frequent' : 'occasional'} code examples`,
      '',
      '### Terminology',
    ];

    for (const [key, value] of Object.entries(style.terminology)) {
      lines.push(`- Use "${value}" (not "${key}")`);
    }

    if (style.samplePhrases.length > 0) {
      lines.push('', '### Example Phrases');
      for (const phrase of style.samplePhrases.slice(0, 5)) {
        lines.push(`- "${phrase}"`);
      }
    }

    return lines.join('\n');
  }
}

export const styleAnalyzerService = new StyleAnalyzerService();
