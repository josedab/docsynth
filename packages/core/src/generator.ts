import type { ChangeAnalysisResult, FileChange, GenerationResult } from './analyzer.js';

// ============================================================================
// Types
// ============================================================================

export interface GenerationOptions {
  /** Which doc types to generate */
  docTypes: string[];
  /** Version string for changelog entries */
  version?: string;
  /** Whether to use LLM for richer output (placeholder for future integration) */
  useLLM?: boolean;
}

// ============================================================================
// Generation Functions
// ============================================================================

/**
 * Generate documentation based on change analysis.
 * Currently produces template-based output; LLM integration is a future enhancement.
 */
export async function generateDocumentation(
  analysis: ChangeAnalysisResult,
  options: GenerationOptions
): Promise<GenerationResult[]> {
  const results: GenerationResult[] = [];

  for (const docType of options.docTypes) {
    switch (docType) {
      case 'readme':
        results.push({
          content: generateReadmeSection(analysis.changedFiles),
          type: 'readme',
          path: 'README.md',
          metadata: { impactScore: analysis.impactScore },
        });
        break;
      case 'changelog':
        results.push({
          content: generateChangelogEntry(analysis.changedFiles, options.version),
          type: 'changelog',
          path: 'CHANGELOG.md',
          metadata: { version: options.version },
        });
        break;
      case 'api-reference':
        results.push({
          content: generateAPIReference(analysis.changedFiles),
          type: 'api-reference',
          path: 'docs/api-reference.md',
          metadata: {},
        });
        break;
    }
  }

  return results;
}

/**
 * Generate a README section summarizing changes.
 */
export function generateReadmeSection(changes: FileChange[]): string {
  const lines: string[] = ['## Recent Changes', ''];

  const added = changes.filter((f) => f.type === 'added');
  const modified = changes.filter((f) => f.type === 'modified');
  const deleted = changes.filter((f) => f.type === 'deleted');

  if (added.length > 0) {
    lines.push('### Added', '');
    for (const file of added) {
      lines.push(`- \`${file.path}\``);
    }
    lines.push('');
  }

  if (modified.length > 0) {
    lines.push('### Modified', '');
    for (const file of modified) {
      lines.push(`- \`${file.path}\` (+${file.additions}/-${file.deletions})`);
    }
    lines.push('');
  }

  if (deleted.length > 0) {
    lines.push('### Removed', '');
    for (const file of deleted) {
      lines.push(`- \`${file.path}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate a changelog entry from changes.
 */
export function generateChangelogEntry(changes: FileChange[], version?: string): string {
  const date = new Date().toISOString().split('T')[0];
  const header = version ? `## [${version}] - ${date}` : `## [Unreleased] - ${date}`;

  const lines: string[] = [header, ''];

  const added = changes.filter((f) => f.type === 'added');
  const modified = changes.filter((f) => f.type === 'modified');
  const deleted = changes.filter((f) => f.type === 'deleted');
  const breaking = changes.filter((f) => f.isBreaking);

  if (breaking.length > 0) {
    lines.push('### ⚠️ Breaking Changes', '');
    for (const file of breaking) {
      lines.push(`- Breaking change in \`${file.path}\``);
    }
    lines.push('');
  }

  if (added.length > 0) {
    lines.push('### Added', '');
    for (const file of added) {
      lines.push(`- Added \`${file.path}\``);
    }
    lines.push('');
  }

  if (modified.length > 0) {
    lines.push('### Changed', '');
    for (const file of modified) {
      lines.push(`- Updated \`${file.path}\``);
    }
    lines.push('');
  }

  if (deleted.length > 0) {
    lines.push('### Removed', '');
    for (const file of deleted) {
      lines.push(`- Removed \`${file.path}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Internal Helpers
// ============================================================================

function generateAPIReference(changes: FileChange[]): string {
  const apiChanges = changes.filter((f) => f.isPublicAPI);

  if (apiChanges.length === 0) {
    return '# API Reference\n\nNo public API changes detected.\n';
  }

  const lines: string[] = ['# API Reference Changes', ''];

  for (const file of apiChanges) {
    lines.push(`## \`${file.path}\``, '');
    lines.push(`- **Type**: ${file.type}`);
    lines.push(`- **Changes**: +${file.additions}/-${file.deletions}`);
    if (file.isBreaking) lines.push('- **⚠️ Breaking change**');
    lines.push('');
  }

  return lines.join('\n');
}
