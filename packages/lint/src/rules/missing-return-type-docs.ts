import type { LintRule, LintContext, LintIssue } from '../linter.js';

/**
 * Detects functions documented without return type information.
 */
export const missingReturnTypeDocsRule: LintRule = {
  id: 'missing-return-type-docs',
  name: 'Missing Return Type Documentation',
  description: 'Detects functions documented without return type info',
  severity: 'warning',
  category: 'completeness',
  check(context: LintContext): LintIssue[] {
    const issues: LintIssue[] = [];

    if (!context.sourceFiles?.length) return issues;

    for (const sf of context.sourceFiles) {
      for (const exp of sf.exports) {
        if (exp.kind !== 'function') continue;

        // Check if the function is documented in this file
        const funcRegex = new RegExp(`#+\\s+.*${escapeRegex(exp.name)}`, 'i');
        const funcMatch = context.content.match(funcRegex);
        if (!funcMatch) continue;

        // Check for return type documentation
        const hasReturnDoc =
          /@returns?\b/i.test(context.content) ||
          /\breturns?\s*[:–-]/i.test(context.content) ||
          /\*\*Returns\*\*/i.test(context.content);

        if (!hasReturnDoc) {
          const line = context.content.split('\n').findIndex((l) => funcRegex.test(l));
          issues.push({
            ruleId: this.id,
            severity: this.severity,
            message: `Function '${exp.name}' is documented but missing return type information`,
            line: line !== -1 ? line + 1 : undefined,
          });
        }
      }
    }

    return issues;
  },
};

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
