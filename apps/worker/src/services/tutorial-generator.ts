import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createLogger } from '@docsynth/utils';
import type { FileChange, GeneratedDocument } from '@docsynth/types';

const log = createLogger('tutorial-generator');

export interface TutorialContext {
  prTitle: string;
  prBody: string | null;
  prNumber: number;
  owner: string;
  repo: string;
  changes: FileChange[];
  intent: {
    businessPurpose: string;
    technicalApproach: string;
    keyConcepts: string[];
    targetAudience: string;
  } | null;
  existingTutorials: string[];
  codeExamples: CodeExample[];
}

export interface CodeExample {
  file: string;
  language: string;
  code: string;
  description?: string;
}

export interface TutorialResult {
  document: GeneratedDocument;
  tokensUsed: number;
}

export class TutorialGeneratorService {
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

  // Determine if changes warrant a tutorial
  shouldGenerateTutorial(changes: FileChange[]): boolean {
    const hasNewFeature = changes.some((c) =>
      c.semanticChanges.some((sc) =>
        ['new-export', 'new-function', 'new-class', 'new-api'].includes(sc.type)
      )
    );

    const hasUserFacingChanges = changes.some(
      (c) =>
        c.path.includes('api') ||
        c.path.includes('cli') ||
        c.path.includes('commands') ||
        c.path.includes('routes')
    );

    const isSignificant = changes.reduce((sum, c) => sum + c.additions, 0) > 50;

    return hasNewFeature && (hasUserFacingChanges || isSignificant);
  }

  // Extract code examples from changes
  extractCodeExamples(changes: FileChange[]): CodeExample[] {
    const examples: CodeExample[] = [];

    for (const change of changes) {
      // Look for new exports and functions
      const newExports = change.semanticChanges.filter((sc) =>
        ['new-export', 'new-function', 'new-class'].includes(sc.type)
      );

      for (const exp of newExports) {
        examples.push({
          file: change.path,
          language: this.detectLanguage(change.path),
          code: `// Example usage of ${exp.name}\n// See ${change.path}`,
          description: exp.description,
        });
      }
    }

    return examples.slice(0, 5); // Limit to 5 examples
  }

  private detectLanguage(filepath: string): string {
    const ext = filepath.split('.').pop()?.toLowerCase();
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
      php: 'php',
    };
    return langMap[ext ?? ''] ?? 'text';
  }

  async generateTutorial(context: TutorialContext): Promise<TutorialResult> {
    log.info(
      { owner: context.owner, repo: context.repo, prNumber: context.prNumber },
      'Generating tutorial'
    );

    const prompt = this.buildTutorialPrompt(context);
    const { content, tokensUsed } = await this.generate(prompt);

    // Generate filename
    const titleSlug = context.prTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50);
    const filename = `docs/tutorials/${titleSlug}.md`;

    return {
      document: {
        path: filename,
        type: 'TUTORIAL',
        title: `Tutorial: ${context.prTitle}`,
        content,
        action: 'create',
      },
      tokensUsed,
    };
  }

  private buildTutorialPrompt(context: TutorialContext): string {
    const newFeatures = context.changes
      .flatMap((c) => c.semanticChanges)
      .filter((sc) => ['new-export', 'new-function', 'new-class', 'new-api'].includes(sc.type));

    return `Generate a comprehensive tutorial for this new feature:

## Feature Context
**Repository:** ${context.owner}/${context.repo}
**PR #${context.prNumber}:** ${context.prTitle}

**Description:**
${context.prBody ?? 'No description provided'}

## New Features/APIs
${newFeatures.map((f) => `- **${f.name}**: ${f.description}`).join('\n') || 'See code changes'}

## Target Audience
${context.intent?.targetAudience ?? 'Developers using this library/tool'}

## Business Purpose
${context.intent?.businessPurpose ?? 'See PR description'}

## Key Concepts
${context.intent?.keyConcepts?.join(', ') ?? 'See code changes'}

## Code Examples
${context.codeExamples.map((ex) => `### ${ex.file}\n\`\`\`${ex.language}\n${ex.code}\n\`\`\`\n${ex.description || ''}`).join('\n\n')}

## Existing Tutorials
${context.existingTutorials.length > 0 ? context.existingTutorials.join('\n') : 'No existing tutorials'}

---

Generate a tutorial following this structure:

# [Feature Name] Tutorial

## Overview
Brief introduction to what this tutorial covers and what the reader will learn.

## Prerequisites
- List required knowledge
- Required tools/setup

## Getting Started

### Step 1: [First Step Title]
Detailed explanation with code examples.

\`\`\`typescript
// Code example
\`\`\`

### Step 2: [Second Step Title]
Continue with the tutorial...

## Working Example
A complete working example that demonstrates the feature.

## Common Patterns
Show common usage patterns and best practices.

## Troubleshooting
Address common issues and their solutions.

## Next Steps
- What to explore next
- Related documentation

---

Guidelines:
1. Use clear, beginner-friendly language
2. Include complete, runnable code examples
3. Explain the "why" behind each step
4. Add helpful tips and notes
5. Keep examples practical and realistic

Output ONLY the tutorial content in markdown format:`;
  }

  private async generate(prompt: string): Promise<{ content: string; tokensUsed: number }> {
    if (this.anthropic) {
      try {
        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
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
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        });

        const content = response.choices[0]?.message?.content ?? '';
        return { content, tokensUsed: response.usage?.total_tokens ?? 0 };
      } catch (error) {
        log.warn({ error }, 'OpenAI generation failed');
      }
    }

    return {
      content: this.generateFallbackTutorial(),
      tokensUsed: 0,
    };
  }

  private generateFallbackTutorial(): string {
    return `# Feature Tutorial

## Overview
This tutorial covers a new feature added to the project.

> **Note:** Full AI-generated tutorials require ANTHROPIC_API_KEY or OPENAI_API_KEY configuration.

## Prerequisites
- Basic knowledge of the project
- Development environment set up

## Getting Started

### Step 1: Installation
Ensure you have the latest version installed:

\`\`\`bash
npm install
\`\`\`

### Step 2: Basic Usage
See the pull request description and code changes for usage details.

## Next Steps
- Review the API documentation
- Check the changelog for related changes
`;
  }

  // Generate a quick-start guide instead of a full tutorial
  async generateQuickStart(context: TutorialContext): Promise<TutorialResult> {
    log.info({ prNumber: context.prNumber }, 'Generating quick-start guide');

    const prompt = `Generate a concise quick-start guide for:

**Feature:** ${context.prTitle}
**Description:** ${context.prBody ?? 'No description'}

**New APIs:**
${context.changes
  .flatMap((c) => c.semanticChanges)
  .filter((sc) => sc.type === 'new-export')
  .map((sc) => `- ${sc.name}: ${sc.description}`)
  .join('\n') || 'See changes'}

Generate a quick-start guide with:
1. One-paragraph overview
2. Installation command
3. Basic usage example (5-10 lines of code)
4. Link to full documentation

Keep it under 100 lines. Output ONLY markdown:`;

    const { content, tokensUsed } = await this.generate(prompt);

    const titleSlug = context.prTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40);

    return {
      document: {
        path: `docs/quickstart/${titleSlug}.md`,
        type: 'GUIDE',
        title: `Quick Start: ${context.prTitle}`,
        content,
        action: 'create',
      },
      tokensUsed,
    };
  }
}

export const tutorialGeneratorService = new TutorialGeneratorService();
