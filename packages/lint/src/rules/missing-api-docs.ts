import type { LintRule, LintContext, LintIssue } from '../linter.js';

/**
 * Detects public exports without corresponding documentation.
 */
export const missingApiDocsRule: LintRule = {
  id: 'missing-api-docs',
  name: 'Missing API Documentation',
  description: 'Detects public exports without documentation',
  severity: 'warning',
  category: 'completeness',
  check(context: LintContext): LintIssue[] {
    const issues: LintIssue[] = [];

    if (!context.sourceFiles?.length) return issues;

    for (const sourceFile of context.sourceFiles) {
      for (const exp of sourceFile.exports) {
        if (!exp.hasJSDoc) {
          const mentioned = context.content.includes(exp.name);
          if (!mentioned) {
            issues.push({
              ruleId: this.id,
              severity: this.severity,
              message: `Exported ${exp.kind} '${exp.name}' from ${sourceFile.path} is not documented`,
              line: 1,
            });
          }
        }
      }
    }

    return issues;
  },
};
