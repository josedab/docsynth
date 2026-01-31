import { describe, it, expect } from 'vitest';
import { exampleExtractorService } from '../services/example-extractor.js';

describe('ExampleExtractorService', () => {
  describe('extractExamples', () => {
    it('should extract JavaScript code blocks from markdown', () => {
      const content = `
# My API

## Getting Started

Here's how to use the API:

\`\`\`javascript
const client = new MyClient();
client.connect();
console.log('Connected!');
\`\`\`

## Advanced Usage

\`\`\`javascript
const result = await client.query('SELECT * FROM users');
console.log(result);
\`\`\`
`;

      const examples = exampleExtractorService.extractExamples(content, 'README.md');

      expect(examples.length).toBe(2);
      expect(examples[0]!.language).toBe('javascript');
      expect(examples[0]!.isRunnable).toBe(true);
      expect(examples[0]!.code).toContain('console.log');
    });

    it('should extract TypeScript code blocks', () => {
      const content = `
# TypeScript Example

\`\`\`typescript
interface User {
  id: string;
  name: string;
}

function getUser(id: string): User {
  return { id, name: 'Test' };
}

console.log(getUser('1'));
\`\`\`
`;

      const examples = exampleExtractorService.extractExamples(content, 'api.md');

      expect(examples.length).toBe(1);
      expect(examples[0]!.language).toBe('typescript');
    });

    it('should extract Python code blocks', () => {
      const content = `
# Python Example

\`\`\`python
def hello(name):
    print(f"Hello, {name}!")

hello("World")
\`\`\`
`;

      const examples = exampleExtractorService.extractExamples(content, 'guide.md');

      expect(examples.length).toBe(1);
      expect(examples[0]!.language).toBe('python');
      expect(examples[0]!.isRunnable).toBe(true);
    });

    it('should skip JSON/YAML config blocks', () => {
      const content = `
# Configuration

\`\`\`json
{
  "name": "my-app",
  "version": "1.0.0"
}
\`\`\`

\`\`\`yaml
name: my-app
version: 1.0.0
\`\`\`
`;

      const examples = exampleExtractorService.extractExamples(content, 'config.md');

      expect(examples.length).toBe(0);
    });

    it('should detect incomplete examples', () => {
      const content = `
# Example

\`\`\`javascript
// TODO: Implement this
const result = doSomething();
// ...
\`\`\`
`;

      const examples = exampleExtractorService.extractExamples(content, 'incomplete.md');

      expect(examples.length).toBe(1);
      expect(examples[0]!.isRunnable).toBe(false);
    });

    it('should extract expected output from comments', () => {
      const content = `
# Example

\`\`\`javascript
const x = 1 + 1;
console.log(x); // Output: 2
\`\`\`
`;

      const examples = exampleExtractorService.extractExamples(content, 'output.md');

      expect(examples.length).toBe(1);
      expect(examples[0]!.expectedOutput).toBe('2');
    });

    it('should detect dependencies from imports', () => {
      const content = `
# Example

\`\`\`javascript
const express = require('express');
const lodash = require('lodash');

const app = express();
console.log(lodash.chunk([1, 2, 3], 2));
\`\`\`
`;

      const examples = exampleExtractorService.extractExamples(content, 'deps.md');

      expect(examples.length).toBe(1);
      expect(examples[0]!.dependencies).toContain('express');
      expect(examples[0]!.dependencies).toContain('lodash');
    });

    it('should not include Node.js builtins as dependencies', () => {
      const content = `
# Example

\`\`\`javascript
const fs = require('fs');
const path = require('path');
console.log(path.join('a', 'b'));
\`\`\`
`;

      const examples = exampleExtractorService.extractExamples(content, 'builtins.md');

      expect(examples.length).toBe(1);
      expect(examples[0]!.dependencies).not.toContain('fs');
      expect(examples[0]!.dependencies).not.toContain('path');
    });

    it('should use heading before code block as title', () => {
      const content = `
# Authentication

## Login Example

\`\`\`javascript
const token = await auth.login('user', 'pass');
console.log(token);
\`\`\`
`;

      const examples = exampleExtractorService.extractExamples(content, 'auth.md');

      expect(examples.length).toBe(1);
      expect(examples[0]!.title).toBe('Login Example');
    });

    it('should track line numbers', () => {
      const content = `Line 1
Line 2
Line 3
\`\`\`javascript
console.log('test');
\`\`\`
Line 7`;

      const examples = exampleExtractorService.extractExamples(content, 'lines.md');

      expect(examples.length).toBe(1);
      expect(examples[0]!.lineStart).toBe(4);
      expect(examples[0]!.lineEnd).toBe(6);
    });
  });

  describe('generateSandboxConfig', () => {
    it('should generate Node.js config for JavaScript', () => {
      const config = exampleExtractorService.generateSandboxConfig('javascript', []);

      expect(config.runtime).toBe('node');
      expect(config.nodeVersion).toBe('20');
      expect(config.timeout).toBe(30000);
    });

    it('should generate Python config', () => {
      const config = exampleExtractorService.generateSandboxConfig('python', []);

      expect(config.runtime).toBe('python');
      expect(config.pythonVersion).toBe('3.11');
    });

    it('should generate Go config', () => {
      const config = exampleExtractorService.generateSandboxConfig('go', []);

      expect(config.runtime).toBe('go');
    });

    it('should set longer timeout for Rust', () => {
      const config = exampleExtractorService.generateSandboxConfig('rust', []);

      expect(config.runtime).toBe('rust');
      expect(config.timeout).toBe(60000);
    });

    it('should disable network access by default', () => {
      const config = exampleExtractorService.generateSandboxConfig('javascript', []);

      expect(config.networkAccess).toBe(false);
      expect(config.fileSystemAccess).toBe(false);
    });
  });
});
