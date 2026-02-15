import { describe, it, expect } from 'vitest';
import { lint, lintMultiple, loadConfig, builtInRules } from '../index.js';
import type { LintConfig, SourceFileInfo } from '../index.js';

describe('Linter', () => {
  const baseConfig = loadConfig();

  describe('builtInRules', () => {
    it('should have 8 built-in rules', () => {
      expect(builtInRules).toHaveLength(8);
    });

    it('should have unique rule IDs', () => {
      const ids = builtInRules.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('empty-section rule', () => {
    it('should detect empty sections', () => {
      const content =
        '# Title\n\nSome intro.\n\n## Empty Section\n\n## Next Section\n\nContent here.';
      const result = lint('doc.md', content, baseConfig);

      const emptySectionIssues = result.issues.filter((i) => i.ruleId === 'empty-section');
      expect(emptySectionIssues.length).toBeGreaterThanOrEqual(1);
      expect(emptySectionIssues[0]!.message).toContain('Empty Section');
    });

    it('should detect stub sections', () => {
      const content =
        '# Title\n\nSome intro.\n\n## Setup\n\nTODO\n\n## Usage\n\nReal content here.';
      const result = lint('doc.md', content, baseConfig);

      const stubIssues = result.issues.filter(
        (i) => i.ruleId === 'empty-section' && i.message.includes('stub')
      );
      expect(stubIssues.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('broken-internal-link rule', () => {
    it('should detect links to non-existent anchors', () => {
      const content = '# Getting Started\n\nSee [installation](#install-guide) for details.\n';
      const result = lint('doc.md', content, baseConfig);

      const linkIssues = result.issues.filter((i) => i.ruleId === 'broken-internal-link');
      expect(linkIssues.length).toBeGreaterThanOrEqual(1);
      expect(linkIssues[0]!.message).toContain('install-guide');
    });

    it('should not flag valid anchor links', () => {
      const content = '# Getting Started\n\nSee [getting started](#getting-started) for details.\n';
      const result = lint('doc.md', content, baseConfig);

      const linkIssues = result.issues.filter((i) => i.ruleId === 'broken-internal-link');
      expect(linkIssues).toHaveLength(0);
    });
  });

  describe('missing-code-examples rule', () => {
    it('should flag API docs without code examples', () => {
      const content = '# API Reference\n\n## Usage\n\nCall the function with the right params.\n';
      const result = lint('api-reference.md', content, baseConfig);

      const exampleIssues = result.issues.filter((i) => i.ruleId === 'missing-code-examples');
      expect(exampleIssues.length).toBeGreaterThanOrEqual(1);
    });

    it('should not flag API docs with code examples', () => {
      const content = '# API Reference\n\n## Usage\n\n```typescript\nfoo();\n```\n';
      const result = lint('api-reference.md', content, baseConfig);

      const exampleIssues = result.issues.filter((i) => i.ruleId === 'missing-code-examples');
      expect(exampleIssues).toHaveLength(0);
    });
  });

  describe('outdated-version-reference rule', () => {
    it('should detect hardcoded version numbers', () => {
      const content = '# Install\n\nRun `npm install package@1.2.3`\n';
      const result = lint('install.md', content, baseConfig);

      const versionIssues = result.issues.filter((i) => i.ruleId === 'outdated-version-reference');
      expect(versionIssues.length).toBeGreaterThanOrEqual(1);
      expect(versionIssues[0]!.message).toContain('1.2.3');
    });
  });

  describe('missing-api-docs rule', () => {
    it('should flag undocumented exports', () => {
      const sourceFiles: SourceFileInfo[] = [
        {
          path: 'src/index.ts',
          exports: [
            {
              name: 'processData',
              kind: 'function',
              hasJSDoc: false,
              parameters: ['input'],
              line: 10,
            },
          ],
        },
      ];

      const content = '# Module\n\nThis module does things.\n';
      const result = lint('module.md', content, baseConfig, sourceFiles);

      const apiIssues = result.issues.filter((i) => i.ruleId === 'missing-api-docs');
      expect(apiIssues.length).toBeGreaterThanOrEqual(1);
      expect(apiIssues[0]!.message).toContain('processData');
    });
  });

  describe('lintMultiple', () => {
    it('should lint multiple files and return results for each', () => {
      const files = [
        { filePath: 'a.md', content: '# A\n\n## Empty\n' },
        { filePath: 'b.md', content: '# B\n\nAll good content here.\n' },
      ];

      const results = lintMultiple(files, baseConfig);
      expect(results).toHaveLength(2);
      expect(results[0]!.filePath).toBe('a.md');
      expect(results[1]!.filePath).toBe('b.md');
    });
  });

  describe('scoring', () => {
    it('should return a score between 0 and 100', () => {
      const result = lint('clean.md', '# Clean Doc\n\nWell written content.\n', baseConfig);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should return stats object with error/warning/info counts', () => {
      const result = lint('test.md', '# Test\n', baseConfig);
      expect(result.stats).toHaveProperty('errors');
      expect(result.stats).toHaveProperty('warnings');
      expect(result.stats).toHaveProperty('infos');
    });
  });

  describe('config', () => {
    it('should respect rule overrides set to off', () => {
      const config: LintConfig = {
        ...baseConfig,
        rules: { ...baseConfig.rules, 'empty-section': 'off' },
      };

      const content = '# Title\n\n## Empty\n\n## Next\n\nContent.';
      const result = lint('doc.md', content, config);

      const emptySectionIssues = result.issues.filter((i) => i.ruleId === 'empty-section');
      expect(emptySectionIssues).toHaveLength(0);
    });
  });
});
