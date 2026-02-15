import type { LintRule, LintContext, LintIssue } from '../linter.js';

/**
 * Detects references to renamed or removed functions/symbols.
 */
export const staleReferenceRule: LintRule = {
  id: 'stale-reference',
  name: 'Stale Reference',
  description: 'Detects references to renamed/removed functions',
  severity: 'error',
  category: 'accuracy',
  check(context: LintContext): LintIssue[] {
    const issues: LintIssue[] = [];

    if (!context.sourceFiles?.length) return issues;

    // Build a set of all known exported symbol names
    const knownSymbols = new Set<string>();
    for (const sf of context.sourceFiles) {
      for (const exp of sf.exports) {
        knownSymbols.add(exp.name);
      }
    }

    if (knownSymbols.size === 0) return issues;

    // Look for inline code references that don't match any known symbol
    const inlineCodeRegex = /`([A-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)?)\(`/g;
    const lines = context.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      let match;
      while ((match = inlineCodeRegex.exec(lines[i]!)) !== null) {
        const ref = match[1]!;
        const baseName = ref.split('.')[0]!;
        if (!knownSymbols.has(baseName) && !knownSymbols.has(ref)) {
          issues.push({
            ruleId: this.id,
            severity: this.severity,
            message: `Reference to '${ref}' may be stale — not found in source exports`,
            line: i + 1,
            column: match.index + 1,
          });
        }
      }
    }

    return issues;
  },
};
