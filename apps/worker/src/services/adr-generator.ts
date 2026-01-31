import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createLogger } from '@docsynth/utils';
import type { FileChange, GeneratedDocument } from '@docsynth/types';

const log = createLogger('adr-generator');

export interface ADRContext {
  prTitle: string;
  prBody: string | null;
  prNumber: number;
  owner: string;
  repo: string;
  changes: FileChange[];
  intent: {
    businessPurpose: string;
    technicalApproach: string;
    alternativesConsidered: string[];
    keyConcepts: string[];
  } | null;
  existingADRs: string[];
}

export interface ADRResult {
  document: GeneratedDocument;
  tokensUsed: number;
  adrNumber: number;
}

export class ADRGeneratorService {
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

  // Determine if changes warrant an ADR
  shouldGenerateADR(changes: FileChange[]): boolean {
    const hasArchitecturalChanges = changes.some((c) =>
      c.semanticChanges.some((sc) =>
        [
          'new-module',
          'api-change',
          'breaking-change',
          'new-dependency',
          'architecture-change',
        ].includes(sc.type) || sc.breaking
      )
    );

    const hasSignificantChanges = changes.some((c) =>
      c.path.includes('architecture') ||
      c.path.includes('config') ||
      c.path.includes('package.json') ||
      (c.additions > 100 && c.semanticChanges.some((sc) => sc.type === 'new-class'))
    );

    return hasArchitecturalChanges || hasSignificantChanges;
  }

  // Get next ADR number from existing ADRs
  getNextADRNumber(existingADRs: string[]): number {
    const numbers = existingADRs
      .map((adr) => {
        const match = adr.match(/(\d{4})/);
        return match ? parseInt(match[1]!, 10) : 0;
      })
      .filter((n) => n > 0);

    return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  }

  async generateADR(context: ADRContext): Promise<ADRResult> {
    log.info(
      { owner: context.owner, repo: context.repo, prNumber: context.prNumber },
      'Generating ADR'
    );

    const adrNumber = this.getNextADRNumber(context.existingADRs);
    const prompt = this.buildADRPrompt(context, adrNumber);
    const { content, tokensUsed } = await this.generate(prompt);

    // Generate filename
    const titleSlug = context.prTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50);
    const filename = `docs/adr/${String(adrNumber).padStart(4, '0')}-${titleSlug}.md`;

    return {
      document: {
        path: filename,
        type: 'ADR',
        title: `ADR ${adrNumber}: ${context.prTitle}`,
        content,
        action: 'create',
      },
      tokensUsed,
      adrNumber,
    };
  }

  private buildADRPrompt(context: ADRContext, adrNumber: number): string {
    const semanticChanges = context.changes.flatMap((c) => c.semanticChanges);
    const breakingChanges = semanticChanges.filter((sc) => sc.breaking);
    const newComponents = semanticChanges.filter((sc) =>
      ['new-class', 'new-module', 'new-export'].includes(sc.type)
    );

    return `Generate an Architecture Decision Record (ADR) for this change:

## Context
**Repository:** ${context.owner}/${context.repo}
**PR #${context.prNumber}:** ${context.prTitle}

**PR Description:**
${context.prBody ?? 'No description provided'}

## Changes Made
**Files changed:** ${context.changes.length}
**New components:** ${newComponents.map((c) => c.name).join(', ') || 'None'}
**Breaking changes:** ${breakingChanges.length > 0 ? breakingChanges.map((c) => c.description).join(', ') : 'None'}

## Intent (if available)
${
  context.intent
    ? `
- **Business Purpose:** ${context.intent.businessPurpose}
- **Technical Approach:** ${context.intent.technicalApproach}
- **Alternatives Considered:** ${context.intent.alternativesConsidered.join(', ') || 'Not specified'}
- **Key Concepts:** ${context.intent.keyConcepts.join(', ')}
`
    : 'Intent not available - infer from changes'
}

## Existing ADRs
${context.existingADRs.length > 0 ? context.existingADRs.join('\n') : 'No existing ADRs'}

---

Generate an ADR following this template:

# ADR ${String(adrNumber).padStart(4, '0')}: [Title]

## Status
Accepted

## Date
${new Date().toISOString().split('T')[0]}

## Context
Describe the context and problem statement. What is the issue that is motivating this decision?

## Decision
Describe the change that is being proposed or has been agreed upon.

## Consequences

### Positive
- List the positive outcomes

### Negative
- List the negative outcomes or trade-offs

### Neutral
- List neutral observations

## Alternatives Considered
Describe alternatives that were considered and why they were not chosen.

## Related Decisions
Link to related ADRs if applicable.

## References
- PR #${context.prNumber}
- Any other relevant references

---

Output ONLY the ADR content in markdown format:`;
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

    // Fallback template
    return {
      content: this.generateFallbackADR(prompt),
      tokensUsed: 0,
    };
  }

  private generateFallbackADR(_prompt: string): string {
    const dateStr = new Date().toISOString().split('T')[0];

    return `# ADR 0001: Architecture Decision

## Status
Proposed

## Date
${dateStr}

## Context
This ADR documents an architectural decision made as part of a code change. 
Full AI-generated content requires ANTHROPIC_API_KEY or OPENAI_API_KEY configuration.

## Decision
See the associated pull request for details about the decision.

## Consequences

### Positive
- To be documented

### Negative
- To be documented

### Neutral
- To be documented

## Alternatives Considered
Not documented - configure LLM API keys for full ADR generation.

## References
- See pull request description
`;
  }
}

export const adrGeneratorService = new ADRGeneratorService();
