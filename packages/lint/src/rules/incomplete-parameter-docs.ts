import type { LintRule, LintContext, LintIssue } from '../linter.js';

/**
 * Detects documented functions with missing parameter descriptions.
 */
export const incompleteParameterDocsRule: LintRule = {
  id: 'incomplete-parameter-docs',
  name: 'Incomplete Parameter Documentation',
  description: 'Detects documented functions with missing parameter descriptions',
  severity: 'warning',
  category: 'completeness',
  check(context: LintContext): LintIssue[] {
    const issues: LintIssue[] = [];

    if (!context.sourceFiles?.length) return issues;

    // Find functions mentioned in the doc that have parameters
    for (const sf of context.sourceFiles) {
      for (const exp of sf.exports) {
        if (exp.kind !== 'function' || !exp.parameters?.length) continue;

        // Check if the function is mentioned in the doc
        const funcRegex = new RegExp(`#+\\s+.*${escapeRegex(exp.name)}`, 'i');
        const funcMatch = context.content.match(funcRegex);
        if (!funcMatch) continue;

        // Check if each parameter is documented
        for (const param of exp.parameters) {
          const paramDocRegex = new RegExp(`[-*]\\s+\`?${escapeRegex(param)}\`?\\s*[:-]`, 'i');
          const paramTagRegex = new RegExp(`@param\\s+.*${escapeRegex(param)}`, 'i');

          if (!paramDocRegex.test(context.content) && !paramTagRegex.test(context.content)) {
            const line = context.content.split('\n').findIndex((l) => funcRegex.test(l));
            issues.push({
              ruleId: this.id,
              severity: this.severity,
              message: `Parameter '${param}' of '${exp.name}' is not documented`,
              line: line !== -1 ? line + 1 : undefined,
            });
          }
        }
      }
    }

    return issues;
  },
};

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
