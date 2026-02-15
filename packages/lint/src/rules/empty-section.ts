import type { LintRule, LintContext, LintIssue } from '../linter.js';

/**
 * Detects empty or stub sections in documentation.
 */
export const emptySectionRule: LintRule = {
  id: 'empty-section',
  name: 'Empty Section',
  description: 'Detects empty or stub sections in docs',
  severity: 'warning',
  category: 'structure',
  check(context: LintContext): LintIssue[] {
    const issues: LintIssue[] = [];
    const lines = context.content.split('\n');

    const stubPhrases = [
      'todo',
      'tbd',
      'coming soon',
      'work in progress',
      'placeholder',
      'to be written',
      'fill in',
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Detect heading lines
      if (!line.startsWith('#')) continue;

      // Find the content between this heading and the next heading (or EOF)
      let nextHeadingIndex = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]!.startsWith('#')) {
          nextHeadingIndex = j;
          break;
        }
      }

      const sectionContent = lines
        .slice(i + 1, nextHeadingIndex)
        .join('\n')
        .trim();

      // Empty section
      if (sectionContent === '') {
        issues.push({
          ruleId: this.id,
          severity: this.severity,
          message: `Section '${line.replace(/^#+\s*/, '')}' is empty`,
          line: i + 1,
        });
        continue;
      }

      // Stub section
      const lower = sectionContent.toLowerCase();
      for (const phrase of stubPhrases) {
        if (lower === phrase || lower === `${phrase}.`) {
          issues.push({
            ruleId: this.id,
            severity: this.severity,
            message: `Section '${line.replace(/^#+\s*/, '')}' appears to be a stub ('${sectionContent}')`,
            line: i + 1,
          });
          break;
        }
      }
    }

    return issues;
  },
};
