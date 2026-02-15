import type { LintRule, LintContext, LintIssue } from '../linter.js';

/**
 * Detects broken markdown internal links (relative links to .md files).
 */
export const brokenInternalLinkRule: LintRule = {
  id: 'broken-internal-link',
  name: 'Broken Internal Link',
  description: 'Detects broken markdown internal links',
  severity: 'warning',
  category: 'links',
  check(context: LintContext): LintIssue[] {
    const issues: LintIssue[] = [];
    const lines = context.content.split('\n');

    // Match markdown links: [text](path)
    const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;

    for (let i = 0; i < lines.length; i++) {
      let match;
      while ((match = linkRegex.exec(lines[i]!)) !== null) {
        const href = match[2]!;

        // Skip external links
        if (href.startsWith('http://') || href.startsWith('https://')) {
          continue;
        }

        // Check anchor links (both pure #anchor and path#anchor)
        if (href.includes('#')) {
          const anchor = href.split('#')[1]!;
          const headingSlug = anchor.toLowerCase().replace(/[^a-z0-9-]/g, '');
          const headings = context.content
            .split('\n')
            .filter((l) => l.startsWith('#'))
            .map((h) =>
              h
                .replace(/^#+\s*/, '')
                .toLowerCase()
                .replace(/[^a-z0-9 -]/g, '')
                .replace(/\s+/g, '-')
            );

          if (!headings.includes(headingSlug)) {
            issues.push({
              ruleId: this.id,
              severity: this.severity,
              message: `Internal link anchor '#${anchor}' does not match any heading`,
              line: i + 1,
              column: match.index + 1,
            });
          }
        }

        // Flag empty link targets
        if (href.trim() === '') {
          issues.push({
            ruleId: this.id,
            severity: this.severity,
            message: 'Empty link target detected',
            line: i + 1,
            column: match.index + 1,
          });
        }
      }
    }

    return issues;
  },
};
