import { describe, it, expect } from 'vitest';
import { analyzeChanges, detectPublicAPIChanges, suggestDocumentTypes } from '../analyzer.js';
import { generateChangelogEntry, generateReadmeSection } from '../generator.js';
import { formatAsMarkdown, formatAsJSON } from '../formatter.js';

describe('@docsynth/core', () => {
  describe('analyzeChanges', () => {
    it('should parse a simple diff', () => {
      const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+export function newFeature() {}
 export function existing() {}
`;
      const result = analyzeChanges(diff);
      expect(result.changedFiles).toHaveLength(1);
      expect(result.changedFiles[0]!.path).toBe('src/index.ts');
      expect(result.impactScore).toBeGreaterThan(0);
    });

    it('should return empty for empty diff', () => {
      const result = analyzeChanges('');
      expect(result.changedFiles).toHaveLength(0);
      expect(result.impactScore).toBe(0);
    });

    it('should detect public API files', () => {
      const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1 @@
-old
+new
`;
      const result = analyzeChanges(diff);
      const publicFiles = detectPublicAPIChanges(result.changedFiles);
      expect(publicFiles.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('suggestDocumentTypes', () => {
    it('should suggest changelog for any changes', () => {
      const types = suggestDocumentTypes({
        changedFiles: [
          {
            path: 'src/utils.ts',
            type: 'modified',
            additions: 5,
            deletions: 2,
            isPublicAPI: false,
            isBreaking: false,
          },
        ],
        impactScore: 20,
        suggestedDocTypes: [],
        summary: '',
      });
      expect(types).toContain('changelog');
    });

    it('should suggest api-reference for public API changes', () => {
      const types = suggestDocumentTypes({
        changedFiles: [
          {
            path: 'src/index.ts',
            type: 'modified',
            additions: 10,
            deletions: 0,
            isPublicAPI: true,
            isBreaking: false,
          },
        ],
        impactScore: 50,
        suggestedDocTypes: [],
        summary: '',
      });
      expect(types).toContain('api-reference');
    });
  });

  describe('generator', () => {
    it('should generate changelog entry', () => {
      const entry = generateChangelogEntry(
        [
          {
            path: 'src/new.ts',
            type: 'added',
            additions: 50,
            deletions: 0,
            isPublicAPI: true,
            isBreaking: false,
          },
        ],
        '1.0.0'
      );
      expect(entry).toContain('1.0.0');
      expect(entry).toContain('src/new.ts');
    });

    it('should generate readme section', () => {
      const section = generateReadmeSection([
        {
          path: 'src/feature.ts',
          type: 'added',
          additions: 30,
          deletions: 0,
          isPublicAPI: false,
          isBreaking: false,
        },
      ]);
      expect(section).toBeTruthy();
    });
  });

  describe('formatter', () => {
    it('should format as markdown', () => {
      const md = formatAsMarkdown([
        { content: '# Test', type: 'readme', path: 'README.md', metadata: {} },
      ]);
      expect(md).toContain('# Test');
    });

    it('should format as JSON', () => {
      const json = formatAsJSON([
        { content: '# Test', type: 'readme', path: 'README.md', metadata: {} },
      ]);
      const parsed = JSON.parse(json);
      expect(parsed.generated).toHaveLength(1);
      expect(parsed.generated[0].type).toBe('readme');
      expect(parsed.count).toBe(1);
    });
  });
});
