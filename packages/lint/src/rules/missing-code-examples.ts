import type { LintRule, LintContext, LintIssue } from '../linter.js';

/**
 * Detects API documentation without code examples.
 */
export const missingCodeExamplesRule: LintRule = {
  id: 'missing-code-examples',
  name: 'Missing Code Examples',
  description: 'Detects API docs without code examples',
  severity: 'warning',
  category: 'completeness',
  check(context: LintContext): LintIssue[] {
    const issues: LintIssue[] = [];

    // Only check files that look like API documentation
    const isApiDoc =
      context.filePath.includes('api') ||
      context.content.toLowerCase().includes('## api') ||
      context.content.toLowerCase().includes('## usage') ||
      context.content.toLowerCase().includes('## reference');

    if (!isApiDoc) return issues;

    const hasCodeBlock = /```[\s\S]*?```/.test(context.content);

    if (!hasCodeBlock) {
      issues.push({
        ruleId: this.id,
        severity: this.severity,
        message: 'API documentation should include at least one code example',
        line: 1,
      });
    }

    return issues;
  },
};
