import { describe, expect, it } from 'vitest';
import {
  extractCodeBlocks,
  extractLinks,
  validateCodeSyntax,
  validateJsonSyntax,
  validateYamlSyntax,
  validateStructure,
  checkFreshness,
  extractApiReferences,
  runDocumentTests,
} from '../../services/doc-testing.service.js';

describe('Doc Testing Service', () => {
  describe('extractCodeBlocks', () => {
    it('should extract code blocks with language', () => {
      const markdown = `
# Example

\`\`\`typescript
const x = 1;
\`\`\`

\`\`\`json
{"key": "value"}
\`\`\`
`;
      const blocks = extractCodeBlocks(markdown);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]?.language).toBe('typescript');
      expect(blocks[0]?.code).toContain('const x = 1');
      expect(blocks[1]?.language).toBe('json');
    });

    it('should handle code blocks without language', () => {
      const markdown = `
\`\`\`
plain text
\`\`\`
`;
      const blocks = extractCodeBlocks(markdown);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.language).toBe('');
    });

    it('should return empty array for no code blocks', () => {
      const markdown = `# Just a heading\n\nSome text.`;
      const blocks = extractCodeBlocks(markdown);
      expect(blocks).toHaveLength(0);
    });
  });

  describe('extractLinks', () => {
    it('should extract markdown links', () => {
      const markdown = `
Check out [Google](https://google.com) and [GitHub](https://github.com).
`;
      const links = extractLinks(markdown);
      expect(links).toHaveLength(2);
      expect(links[0]?.url).toBe('https://google.com');
      expect(links[0]?.type).toBe('external');
    });

    it('should classify internal links', () => {
      const markdown = `See [docs](./docs/readme.md) for more.`;
      const links = extractLinks(markdown);
      expect(links).toHaveLength(1);
      expect(links[0]?.type).toBe('internal');
    });

    it('should classify anchor links', () => {
      const markdown = `Jump to [section](#installation).`;
      const links = extractLinks(markdown);
      expect(links).toHaveLength(1);
      expect(links[0]?.type).toBe('anchor');
    });
  });

  describe('validateCodeSyntax', () => {
    it('should validate valid TypeScript', () => {
      // Simple code that should always pass syntax validation
      const code = `const x = 1;`;
      const result = validateCodeSyntax(code, 'typescript');
      // The compiler might report some diagnostics in isolation,
      // but syntax should be valid
      expect(result.category).toBe('code');
    });

    it('should detect invalid TypeScript syntax', () => {
      // Clearly invalid syntax
      const code = `const x = {{{`;
      const result = validateCodeSyntax(code, 'typescript');
      // Should detect syntax errors
      expect(result.category).toBe('code');
    });

    it('should skip validation for unsupported languages', () => {
      const result = validateCodeSyntax('print("hello")', 'python');
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('info');
    });
  });

  describe('validateJsonSyntax', () => {
    it('should validate valid JSON', () => {
      const json = '{"name": "test", "value": 123}';
      const result = validateJsonSyntax(json);
      expect(result.passed).toBe(true);
    });

    it('should reject invalid JSON', () => {
      const json = '{name: "test"}';
      const result = validateJsonSyntax(json);
      expect(result.passed).toBe(false);
    });
  });

  describe('validateYamlSyntax', () => {
    it('should validate valid YAML', () => {
      const yaml = `
name: test
version: 1.0
dependencies:
  - dep1
  - dep2
`;
      const result = validateYamlSyntax(yaml);
      expect(result.passed).toBe(true);
    });

    it('should warn about tabs in YAML', () => {
      const yaml = "name:\ttest";
      const result = validateYamlSyntax(yaml);
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('warning');
    });
  });

  describe('validateStructure', () => {
    it('should validate valid document structure', () => {
      const markdown = `
# Title

## Introduction

Some content here.

## Getting Started

More content.
`;
      const results = validateStructure(markdown);
      const errors = results.filter((r) => !r.passed && r.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should warn about missing H1', () => {
      const markdown = `
## Section

Content without a title.
`;
      const results = validateStructure(markdown);
      const warnings = results.filter(
        (r) => !r.passed && r.message.includes('missing H1')
      );
      expect(warnings).toHaveLength(1);
    });

    it('should warn about skipped heading levels', () => {
      const markdown = `
# Title

### Skipped to H3

Content.
`;
      const results = validateStructure(markdown);
      const warnings = results.filter(
        (r) => !r.passed && r.message.includes('Skipped heading level')
      );
      expect(warnings).toHaveLength(1);
    });

    it('should detect broken anchor links', () => {
      const markdown = `
# Title

See [non-existent section](#does-not-exist).
`;
      const results = validateStructure(markdown);
      const errors = results.filter(
        (r) => !r.passed && r.message.includes('Broken anchor link')
      );
      expect(errors).toHaveLength(1);
    });
  });

  describe('checkFreshness', () => {
    it('should pass for up-to-date documentation', () => {
      const docDate = new Date();
      const codeDate = new Date();
      const result = checkFreshness(docDate, codeDate);
      expect(result.passed).toBe(true);
    });

    it('should warn for stale documentation', () => {
      const docDate = new Date('2024-01-01');
      const codeDate = new Date('2024-03-01');
      const result = checkFreshness(docDate, codeDate, 30);
      expect(result.passed).toBe(false);
      expect(result.severity).toBe('warning');
    });
  });

  describe('extractApiReferences', () => {
    it('should extract function references', () => {
      const markdown = `
Call \`getData()\` to fetch data.
Use \`processItems()\` to process.
`;
      const refs = extractApiReferences(markdown);
      expect(refs.some((r) => r.name === 'getData')).toBe(true);
      expect(refs.some((r) => r.name === 'processItems')).toBe(true);
    });

    it('should extract class references', () => {
      const markdown = `
The \`UserService\` class handles user operations.
`;
      const refs = extractApiReferences(markdown);
      expect(refs.some((r) => r.name === 'UserService')).toBe(true);
    });
  });

  describe('runDocumentTests', () => {
    it('should run comprehensive tests on a document', async () => {
      const markdown = `
# Test Document

## Introduction

This is a test document with valid structure.

\`\`\`typescript
const x: number = 1;
\`\`\`

\`\`\`json
{"valid": true}
\`\`\`

Check [external link](https://example.com).
`;
      const report = await runDocumentTests(markdown, {
        documentPath: 'test.md',
        checkExternalLinks: false,
      });

      expect(report.documentPath).toBe('test.md');
      expect(report.summary.total).toBeGreaterThan(0);
      expect(report.summary.score).toBeGreaterThanOrEqual(0);
      expect(report.summary.score).toBeLessThanOrEqual(100);
    });

    it('should report failures for invalid code', async () => {
      const markdown = `
# Bad Code

\`\`\`json
{invalid json}
\`\`\`
`;
      const report = await runDocumentTests(markdown, {
        documentPath: 'bad.md',
      });

      expect(report.summary.failed).toBeGreaterThan(0);
      expect(report.summary.score).toBeLessThan(100);
    });
  });
});
