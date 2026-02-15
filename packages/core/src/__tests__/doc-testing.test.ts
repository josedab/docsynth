import { describe, it, expect } from 'vitest';
import {
  extractCodeBlocks,
  normalizeLanguage,
  isSupportedLanguage,
  validateCodeBlock,
  validateDocument,
  type CodeBlock,
} from '../doc-testing.js';

describe('doc-testing', () => {
  describe('extractCodeBlocks', () => {
    it('should extract a single code block with language', () => {
      const md = `# Example

\`\`\`typescript
const x = 1;
\`\`\`
`;
      const blocks = extractCodeBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.language).toBe('typescript');
      expect(blocks[0]!.code).toBe('const x = 1;');
      expect(blocks[0]!.heading).toBe('Example');
    });

    it('should extract multiple code blocks', () => {
      const md = `## Setup

\`\`\`js
import { foo } from 'bar';
\`\`\`

## Usage

\`\`\`python
def main():
    pass
\`\`\`
`;
      const blocks = extractCodeBlocks(md);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]!.language).toBe('javascript');
      expect(blocks[0]!.heading).toBe('Setup');
      expect(blocks[1]!.language).toBe('python');
      expect(blocks[1]!.heading).toBe('Usage');
    });

    it('should handle code blocks without language', () => {
      const md = `\`\`\`
plain text
\`\`\``;
      const blocks = extractCodeBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.language).toBe('');
    });

    it('should track line numbers', () => {
      const md = `line 1
line 2
\`\`\`ts
code here
\`\`\`
`;
      const blocks = extractCodeBlocks(md);
      expect(blocks[0]!.startLine).toBe(4); // 1-indexed, line after ```
      expect(blocks[0]!.endLine).toBe(5);
    });

    it('should return empty array for markdown without code blocks', () => {
      expect(extractCodeBlocks('# Just a heading')).toHaveLength(0);
    });
  });

  describe('normalizeLanguage', () => {
    it('should map aliases to canonical names', () => {
      expect(normalizeLanguage('ts')).toBe('typescript');
      expect(normalizeLanguage('js')).toBe('javascript');
      expect(normalizeLanguage('py')).toBe('python');
      expect(normalizeLanguage('golang')).toBe('go');
      expect(normalizeLanguage('rs')).toBe('rust');
    });

    it('should be case-insensitive', () => {
      expect(normalizeLanguage('TypeScript')).toBe('typescript');
      expect(normalizeLanguage('PYTHON')).toBe('python');
    });

    it('should return unknown languages as-is', () => {
      expect(normalizeLanguage('haskell')).toBe('haskell');
    });
  });

  describe('isSupportedLanguage', () => {
    it('should return true for supported languages', () => {
      expect(isSupportedLanguage('typescript')).toBe(true);
      expect(isSupportedLanguage('python')).toBe(true);
      expect(isSupportedLanguage('go')).toBe(true);
      expect(isSupportedLanguage('rust')).toBe(true);
      expect(isSupportedLanguage('java')).toBe(true);
    });

    it('should return false for unsupported languages', () => {
      expect(isSupportedLanguage('haskell')).toBe(false);
      expect(isSupportedLanguage('')).toBe(false);
    });
  });

  describe('validateCodeBlock', () => {
    const makeBlock = (language: string, code: string): CodeBlock => ({
      language,
      code,
      startLine: 1,
      endLine: 1,
      heading: null,
    });

    it('should validate balanced brackets in TypeScript', () => {
      const result = validateCodeBlock(makeBlock('typescript', 'function foo() { return [1]; }'));
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect unbalanced brackets', () => {
      const result = validateCodeBlock(makeBlock('javascript', 'function foo() {'));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Unclosed'))).toBe(true);
    });

    it('should detect unterminated template literal in JS', () => {
      const result = validateCodeBlock(makeBlock('typescript', 'const s = `hello'));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('template literal'))).toBe(true);
    });

    it('should detect missing colon in Python', () => {
      const result = validateCodeBlock(makeBlock('python', 'def foo()'));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('colon'))).toBe(true);
    });

    it('should accept valid Python code', () => {
      const result = validateCodeBlock(makeBlock('python', 'def foo():\n    return 1'));
      expect(result.valid).toBe(true);
    });

    it('should detect missing semicolon on Rust let binding', () => {
      const result = validateCodeBlock(makeBlock('rust', 'let x = 5'));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('semicolon'))).toBe(true);
    });

    it('should accept valid Rust let binding', () => {
      const result = validateCodeBlock(makeBlock('rust', 'let x = 5;'));
      expect(result.valid).toBe(true);
    });

    it('should return valid for unsupported language', () => {
      const result = validateCodeBlock(makeBlock('haskell', 'invalid'));
      expect(result.valid).toBe(true);
    });
  });

  describe('validateDocument', () => {
    it('should validate all supported code blocks in markdown', () => {
      const md = `# API

\`\`\`typescript
const x = 1;
\`\`\`

\`\`\`python
def greet():
    print("hi")
\`\`\`
`;
      const result = validateDocument(md);
      expect(result.codeBlocks).toBe(2);
      expect(result.validBlocks).toBe(2);
      expect(result.invalidBlocks).toBe(0);
    });

    it('should report invalid blocks', () => {
      const md = `\`\`\`javascript
function broken() {
\`\`\``;
      const result = validateDocument(md);
      expect(result.codeBlocks).toBe(1);
      expect(result.invalidBlocks).toBe(1);
    });

    it('should skip unsupported languages', () => {
      const md = `\`\`\`bash
echo hello
\`\`\``;
      const result = validateDocument(md);
      expect(result.codeBlocks).toBe(0);
    });
  });
});
