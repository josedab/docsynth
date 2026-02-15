import type { LintRule, LintContext, LintIssue } from '../linter.js';

/**
 * Detects hardcoded version numbers that may become outdated.
 */
export const outdatedVersionReferenceRule: LintRule = {
  id: 'outdated-version-reference',
  name: 'Outdated Version Reference',
  description: 'Detects hardcoded version numbers',
  severity: 'info',
  category: 'accuracy',
  check(context: LintContext): LintIssue[] {
    const issues: LintIssue[] = [];
    const lines = context.content.split('\n');

    // Match semver patterns like v1.2.3, 1.2.3, @1.2.3
    const versionRegex = /(?:v|@)?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/g;

    for (let i = 0; i < lines.length; i++) {
      // Skip lines inside code blocks
      const line = lines[i]!;
      if (line.startsWith('```')) continue;

      let match;
      while ((match = versionRegex.exec(line)) !== null) {
        issues.push({
          ruleId: this.id,
          severity: this.severity,
          message: `Hardcoded version '${match[0]}' may become outdated`,
          line: i + 1,
          column: match.index + 1,
        });
      }
    }

    return issues;
  },
};
