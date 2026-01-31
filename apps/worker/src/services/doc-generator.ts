import { createLogger, createLLMClient, type LLMClient } from '@docsynth/utils';
import { GitHubClient } from '@docsynth/github';
import type { FileChange, DocumentType, GeneratedDocument } from '@docsynth/types';

const log = createLogger('doc-generator-service');

export interface GenerationContext {
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
  existingReadme: string | null;
}

export interface GenerationResult {
  documents: GeneratedDocument[];
  tokensUsed: number;
}

export class DocGeneratorService {
  private llmClient: LLMClient;

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient ?? createLLMClient();
  }

  async generateDocumentation(
    client: GitHubClient,
    context: GenerationContext
  ): Promise<GenerationResult> {
    log.info({ owner: context.owner, repo: context.repo, prNumber: context.prNumber }, 'Generating documentation');

    const documents: GeneratedDocument[] = [];
    let totalTokens = 0;

    // 1. Generate/update README if needed
    const readmeChanges = this.shouldUpdateReadme(context.changes);
    if (readmeChanges) {
      const readme = await this.generateReadme(context);
      documents.push(readme.document);
      totalTokens += readme.tokensUsed;
    }

    // 2. Generate changelog entry
    const changelog = await this.generateChangelog(context);
    documents.push(changelog.document);
    totalTokens += changelog.tokensUsed;

    // 3. Generate API docs if there are new exports
    const hasApiChanges = context.changes.some((c) =>
      c.semanticChanges.some((sc) =>
        ['new-export', 'new-function', 'new-class', 'new-interface'].includes(sc.type)
      )
    );
    if (hasApiChanges) {
      const apiDocs = await this.generateApiDocs(context);
      documents.push(apiDocs.document);
      totalTokens += apiDocs.tokensUsed;
    }

    log.info({ documentsGenerated: documents.length, totalTokens }, 'Documentation generated');

    return { documents, tokensUsed: totalTokens };
  }

  private shouldUpdateReadme(changes: FileChange[]): boolean {
    // Update README if entry points or significant exports changed
    return changes.some(
      (c) =>
        c.path.includes('index') ||
        c.path.includes('main') ||
        c.semanticChanges.some((sc) => ['new-export', 'new-class'].includes(sc.type))
    );
  }

  private async generateReadme(
    context: GenerationContext
  ): Promise<{ document: GeneratedDocument; tokensUsed: number }> {
    const prompt = this.buildReadmePrompt(context);
    const { content, tokensUsed } = await this.generate(prompt);

    return {
      document: {
        path: 'README.md',
        type: 'readme' as DocumentType,
        title: context.repo,
        content,
        action: context.existingReadme ? 'update' : 'create',
      },
      tokensUsed,
    };
  }

  private buildReadmePrompt(context: GenerationContext): string {
    const newExports = context.changes
      .flatMap((c) => c.semanticChanges)
      .filter((sc) => ['new-export', 'new-function', 'new-class', 'new-interface'].includes(sc.type));

    return `You are a technical writer creating documentation for a software project.

## Project: ${context.owner}/${context.repo}

## Recent Changes (PR #${context.prNumber}: ${context.prTitle})
${context.prBody ?? 'No description'}

## New Exports/Features
${newExports.map((e) => `- ${e.name}: ${e.description}`).join('\n') || 'No new exports'}

## Intent
${
  context.intent
    ? `
- **Purpose:** ${context.intent.businessPurpose}
- **Approach:** ${context.intent.technicalApproach}
- **Key Concepts:** ${context.intent.keyConcepts.join(', ')}
- **Audience:** ${context.intent.targetAudience}
`
    : 'Not available'
}

${context.existingReadme ? `## Existing README (to update)\n${context.existingReadme.slice(0, 2000)}...` : '## Generate a new README'}

---

Generate a professional README.md that:
1. Clearly explains what the project does
2. Shows how to install and get started
3. Includes usage examples for new features
4. Documents the API for new exports
5. Matches a professional open source project style

Use markdown formatting with proper headings, code blocks, and tables where appropriate.
Include a "Recent Changes" or "What's New" section highlighting the PR changes.

Output ONLY the README content, no explanations:`;
  }

  private async generateChangelog(
    context: GenerationContext
  ): Promise<{ document: GeneratedDocument; tokensUsed: number }> {
    const prompt = this.buildChangelogPrompt(context);
    const { content, tokensUsed } = await this.generate(prompt);

    return {
      document: {
        path: 'CHANGELOG.md',
        type: 'changelog' as DocumentType,
        title: 'Changelog Entry',
        content,
        action: 'update',
      },
      tokensUsed,
    };
  }

  private buildChangelogPrompt(context: GenerationContext): string {
    const semanticChanges = context.changes.flatMap((c) => c.semanticChanges);
    const hasBreaking = semanticChanges.some((sc) => sc.breaking);
    const newFeatures = semanticChanges.filter((sc) =>
      ['new-export', 'new-function', 'new-class'].includes(sc.type)
    );
    const fixes = semanticChanges.filter((sc) => sc.type === 'logic-change');

    return `Generate a changelog entry in "Keep a Changelog" format for this PR:

## PR #${context.prNumber}: ${context.prTitle}
${context.prBody ?? ''}

## Changes Detected
- Breaking changes: ${hasBreaking ? 'Yes' : 'No'}
- New features: ${newFeatures.length}
- Fixes/changes: ${fixes.length}

## Semantic Changes
${semanticChanges.map((sc) => `- [${sc.type}] ${sc.name}: ${sc.description}`).join('\n') || 'Minor changes'}

## Intent
${context.intent?.businessPurpose ?? 'See PR description'}

---

Generate a changelog entry following this format:
\`\`\`markdown
## [Unreleased]

### Added
- Feature descriptions...

### Changed
- Change descriptions...

### Fixed
- Fix descriptions...

### Breaking Changes
- Breaking change descriptions (if any)...
\`\`\`

Be concise but informative. Link to the PR number. Output ONLY the changelog entry:`;
  }

  private async generateApiDocs(
    context: GenerationContext
  ): Promise<{ document: GeneratedDocument; tokensUsed: number }> {
    const prompt = this.buildApiDocsPrompt(context);
    const { content, tokensUsed } = await this.generate(prompt);

    return {
      document: {
        path: 'docs/api-reference.md',
        type: 'api-reference' as DocumentType,
        title: 'API Reference',
        content,
        action: 'update',
      },
      tokensUsed,
    };
  }

  private buildApiDocsPrompt(context: GenerationContext): string {
    const apiChanges = context.changes
      .flatMap((c) =>
        c.semanticChanges.map((sc) => ({
          file: c.path,
          ...sc,
        }))
      )
      .filter((sc) =>
        ['new-export', 'new-function', 'new-class', 'new-interface', 'api-change'].includes(sc.type)
      );

    return `Generate API documentation for these new/changed exports:

## Project: ${context.owner}/${context.repo}

## API Changes
${apiChanges.map((c) => `### ${c.name} (${c.type})\nFile: ${c.file}\n${c.description}`).join('\n\n')}

## Context
${context.intent?.technicalApproach ?? 'See code changes'}

---

Generate API reference documentation with:
1. Function/class signatures
2. Parameter descriptions with types
3. Return value descriptions
4. Usage examples
5. Related functions/classes

Use this format:
\`\`\`markdown
# API Reference

## FunctionName

Description of what the function does.

### Signature
\\\`typescript
function name(param: Type): ReturnType
\\\`

### Parameters
| Name | Type | Description |
|------|------|-------------|
| param | Type | Description |

### Returns
Description of return value

### Example
\\\`typescript
// Example usage
\\\`
\`\`\`

Output ONLY the API documentation:`;
  }

  private async generate(prompt: string): Promise<{ content: string; tokensUsed: number }> {
    const result = await this.llmClient.generate(prompt, { maxTokens: 4096 });
    
    if (result.provider === 'fallback' || !result.content) {
      return {
        content: this.generateFallbackContent(prompt),
        tokensUsed: 0,
      };
    }

    return { content: result.content, tokensUsed: result.tokensUsed };
  }

  private generateFallbackContent(prompt: string): string {
    // Basic fallback when no LLM is available
    if (prompt.includes('README')) {
      return `# Project

Documentation will be generated when LLM API keys are configured.

## Setup

\`\`\`bash
npm install
\`\`\`

## Usage

See source code for API details.
`;
    }

    if (prompt.includes('changelog')) {
      return `## [Unreleased]

### Changed
- See pull request for details
`;
    }

    return `# API Reference

Documentation pending. Configure ANTHROPIC_API_KEY or OPENAI_API_KEY for generated docs.
`;
  }
}

export const docGeneratorService = new DocGeneratorService();
