import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '@docsynth/utils';
import type { FileChange, DocumentType } from '@docsynth/types';

const log = createLogger('pr-preview-service');

export interface PRPreviewResult {
  previewComment: string;
  suggestedDocTypes: DocumentType[];
  affectedDocs: string[];
  estimatedChanges: {
    creates: number;
    updates: number;
  };
}

export interface DocumentationImpactInput {
  affectedDocs: string[];
  newDocsNeeded: string[];
  updatePriority: 'high' | 'medium' | 'low';
}

export interface PRPreviewInput {
  prNumber: number;
  prTitle: string;
  prBody: string | null;
  authorUsername: string;
  changes: FileChange[];
  documentationImpact: DocumentationImpactInput;
  repositoryName: string;
  existingDocs: string[];
}

class PRPreviewService {
  private anthropic: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.anthropic) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
    return this.anthropic;
  }

  async generatePreview(input: PRPreviewInput): Promise<PRPreviewResult> {
    log.info({ prNumber: input.prNumber }, 'Generating PR preview');

    const { suggestedDocTypes, affectedDocs, creates, updates } =
      this.analyzeDocumentationNeeds(input);

    // Generate a summary of what documentation will be created/updated
    const previewSummary = await this.generatePreviewSummary(input, suggestedDocTypes, affectedDocs);

    const previewComment = this.formatPreviewComment({
      prNumber: input.prNumber,
      repositoryName: input.repositoryName,
      suggestedDocTypes,
      affectedDocs,
      creates,
      updates,
      previewSummary,
      changes: input.changes,
    });

    return {
      previewComment,
      suggestedDocTypes,
      affectedDocs,
      estimatedChanges: { creates, updates },
    };
  }

  private analyzeDocumentationNeeds(input: PRPreviewInput): {
    suggestedDocTypes: DocumentType[];
    affectedDocs: string[];
    creates: number;
    updates: number;
  } {
    const suggestedDocTypes: DocumentType[] = [];
    const affectedDocs: string[] = [...input.documentationImpact.affectedDocs];
    let creates = 0;
    let updates = 0;

    // Convert string doc types from impact analysis to DocumentType
    const validDocTypes: DocumentType[] = ['README', 'API_REFERENCE', 'CHANGELOG', 'GUIDE', 'TUTORIAL', 'ARCHITECTURE', 'ADR', 'INLINE_COMMENT'];
    for (const docTypeStr of input.documentationImpact.newDocsNeeded) {
      const docType = validDocTypes.find(t => t === docTypeStr || t.toLowerCase() === docTypeStr.toLowerCase());
      if (docType && !suggestedDocTypes.includes(docType)) {
        suggestedDocTypes.push(docType);
        creates++;
      }
    }

    // Analyze changes to determine additional doc types
    for (const change of input.changes) {
      for (const semantic of change.semanticChanges) {
        switch (semantic.type) {
          case 'new-export':
          case 'new-function':
          case 'new-class':
          case 'new-interface':
            if (!suggestedDocTypes.includes('API_REFERENCE')) {
              suggestedDocTypes.push('API_REFERENCE');
            }
            break;
          case 'api-change':
          case 'signature-change':
            if (!suggestedDocTypes.includes('API_REFERENCE')) {
              suggestedDocTypes.push('API_REFERENCE');
            }
            if (!suggestedDocTypes.includes('CHANGELOG')) {
              suggestedDocTypes.push('CHANGELOG');
            }
            break;
          case 'deprecation':
          case 'removal':
            if (!suggestedDocTypes.includes('CHANGELOG')) {
              suggestedDocTypes.push('CHANGELOG');
            }
            break;
        }

        if (semantic.breaking && !suggestedDocTypes.includes('CHANGELOG')) {
          suggestedDocTypes.push('CHANGELOG');
        }
      }
    }

    // Check for README updates
    const hasSignificantChanges = input.changes.some(
      (c) => c.additions + c.deletions > 50 || c.semanticChanges.length > 2
    );
    if (hasSignificantChanges && !suggestedDocTypes.includes('README')) {
      suggestedDocTypes.push('README');
    }

    // Count updates for existing docs
    for (const doc of affectedDocs) {
      if (input.existingDocs.includes(doc)) {
        updates++;
      } else {
        creates++;
      }
    }

    return { suggestedDocTypes, affectedDocs, creates, updates };
  }

  private async generatePreviewSummary(
    input: PRPreviewInput,
    suggestedDocTypes: DocumentType[],
    affectedDocs: string[]
  ): Promise<string> {
    const client = this.getClient();

    const changesDescription = input.changes
      .slice(0, 10) // Limit to first 10 files
      .map((c) => {
        const semanticDesc = c.semanticChanges
          .slice(0, 3)
          .map((s) => `${s.type}: ${s.name}`)
          .join(', ');
        return `- ${c.path} (${c.changeType}): ${semanticDesc || 'minor changes'}`;
      })
      .join('\n');

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `You are a documentation assistant. Based on this PR, provide a brief (2-3 sentences) summary of what documentation changes will be made.

PR Title: ${input.prTitle}
PR Description: ${input.prBody || 'No description'}

Key file changes:
${changesDescription}

Documentation types to generate: ${suggestedDocTypes.join(', ')}
Affected docs: ${affectedDocs.join(', ') || 'None existing'}

Provide a concise summary of what documentation will be created or updated. Focus on the user-facing impact.`,
          },
        ],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      return textBlock?.type === 'text' ? textBlock.text : 'Documentation updates will be generated based on code changes.';
    } catch (error) {
      log.error({ error }, 'Failed to generate preview summary');
      return 'Documentation updates will be generated based on the code changes in this PR.';
    }
  }

  private formatPreviewComment(params: {
    prNumber: number;
    repositoryName: string;
    suggestedDocTypes: DocumentType[];
    affectedDocs: string[];
    creates: number;
    updates: number;
    previewSummary: string;
    changes: FileChange[];
  }): string {
    const {
      suggestedDocTypes,
      affectedDocs,
      creates,
      updates,
      previewSummary,
      changes,
    } = params;

    const breakingChanges = changes.flatMap((c) =>
      c.semanticChanges.filter((s) => s.breaking).map((s) => `- \`${s.name}\`: ${s.description}`)
    );

    const docTypeEmoji: Record<DocumentType, string> = {
      README: '📖',
      API_REFERENCE: '🔌',
      CHANGELOG: '📋',
      GUIDE: '📚',
      TUTORIAL: '🎓',
      ARCHITECTURE: '🏗️',
      ADR: '📝',
      INLINE_COMMENT: '💬',
    };

    const docTypesList = suggestedDocTypes
      .map((dt) => `${docTypeEmoji[dt] || '📄'} ${dt.replace('_', ' ')}`)
      .join('\n');

    let comment = `<!-- docsynth-preview -->
## 📚 DocSynth Documentation Preview

${previewSummary}

### Planned Documentation Changes

| Type | Count |
|------|-------|
| 🆕 New Docs | ${creates} |
| ✏️ Updates | ${updates} |

### Documentation Types
${docTypesList || '_No documentation changes detected_'}
`;

    if (affectedDocs.length > 0) {
      comment += `
### Affected Documentation Files
${affectedDocs.map((d) => `- \`${d}\``).join('\n')}
`;
    }

    if (breakingChanges.length > 0) {
      comment += `
### ⚠️ Breaking Changes Detected
${breakingChanges.join('\n')}
`;
    }

    comment += `
---
<details>
<summary>💡 How this works</summary>

DocSynth will automatically generate documentation when this PR is merged. The documentation will be created as a new PR for review.

**Want to customize?** Add a \`.docsynth.json\` config file or use PR comments:
- \`/docsynth skip\` - Skip documentation for this PR
- \`/docsynth include [path]\` - Include specific files
- \`/docsynth exclude [path]\` - Exclude specific files

</details>

*Generated by [DocSynth](https://docsynth.dev) • [Feedback](https://github.com/docsynth/docsynth/issues)*
`;

    return comment;
  }
}

export const prPreviewService = new PRPreviewService();
