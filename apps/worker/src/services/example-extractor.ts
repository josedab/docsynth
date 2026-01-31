import { createLogger } from '@docsynth/utils';
import type { SandboxConfig } from '@docsynth/types';

const log = createLogger('example-extractor');

interface ExtractedExample {
  title: string;
  description: string;
  language: string;
  code: string;
  expectedOutput?: string;
  lineStart: number;
  lineEnd: number;
  dependencies: string[];
  isRunnable: boolean;
}

interface CodeBlock {
  language: string;
  code: string;
  lineStart: number;
  lineEnd: number;
  meta?: string;
}

class ExampleExtractorService {
  /**
   * Extract code examples from markdown documentation
   */
  extractExamples(content: string, documentPath: string): ExtractedExample[] {
    const codeBlocks = this.parseCodeBlocks(content);
    const examples: ExtractedExample[] = [];

    for (const block of codeBlocks) {
      // Skip non-runnable blocks
      if (!this.isRunnableLanguage(block.language)) {
        continue;
      }

      // Skip configuration/data blocks
      if (this.isConfigBlock(block)) {
        continue;
      }

      const example = this.processCodeBlock(block, content, documentPath);
      if (example) {
        examples.push(example);
      }
    }

    log.info({ count: examples.length, documentPath }, 'Extracted examples');
    return examples;
  }

  /**
   * Parse fenced code blocks from markdown
   */
  private parseCodeBlocks(content: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const lines = content.split('\n');
    let inBlock = false;
    let currentBlock: Partial<CodeBlock> = {};
    let blockContent: string[] = [];
    let blockStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const fenceMatch = line.match(/^```(\w+)?(?:\s+(.*))?$/);

      if (fenceMatch && !inBlock) {
        // Start of code block
        inBlock = true;
        blockStartLine = i + 1; // 1-indexed
        currentBlock = {
          language: fenceMatch[1]?.toLowerCase() || 'text',
          meta: fenceMatch[2],
        };
        blockContent = [];
      } else if (line.startsWith('```') && inBlock) {
        // End of code block
        blocks.push({
          language: currentBlock.language || 'text',
          code: blockContent.join('\n'),
          lineStart: blockStartLine,
          lineEnd: i + 1,
          meta: currentBlock.meta,
        });
        inBlock = false;
        currentBlock = {};
      } else if (inBlock) {
        blockContent.push(line);
      }
    }

    return blocks;
  }

  /**
   * Check if language is runnable
   */
  private isRunnableLanguage(language: string): boolean {
    const runnableLanguages = [
      'javascript', 'js',
      'typescript', 'ts',
      'python', 'py',
      'go', 'golang',
      'rust', 'rs',
      'bash', 'sh', 'shell',
      'node',
    ];
    return runnableLanguages.includes(language.toLowerCase());
  }

  /**
   * Check if block is configuration/data only
   */
  private isConfigBlock(block: CodeBlock): boolean {
    // Skip JSON, YAML, TOML config blocks
    const configLanguages = ['json', 'yaml', 'yml', 'toml', 'xml', 'csv'];
    if (configLanguages.includes(block.language)) {
      return true;
    }

    // Skip blocks that are just variable declarations or imports only
    const lines = block.code.trim().split('\n');
    const hasExecutableCode = lines.some((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) {
        return false;
      }
      // Check for function calls, console.log, print, etc.
      return (
        trimmed.includes('(') ||
        trimmed.includes('console.') ||
        trimmed.includes('print(') ||
        trimmed.includes('fmt.') ||
        trimmed.includes('assert')
      );
    });

    return !hasExecutableCode;
  }

  /**
   * Process a code block into an example
   */
  private processCodeBlock(
    block: CodeBlock,
    content: string,
    _documentPath: string
  ): ExtractedExample | null {
    const lines = content.split('\n');

    // Find context (heading before code block)
    let title = 'Code Example';
    let description = '';

    for (let i = block.lineStart - 2; i >= 0; i--) {
      const line = lines[i]?.trim() ?? '';

      if (line.startsWith('#')) {
        title = line.replace(/^#+\s*/, '');
        break;
      }

      if (line && !line.startsWith('```') && !description) {
        description = line;
      }
    }

    // Extract expected output from code or comments
    const expectedOutput = this.extractExpectedOutput(block.code);

    // Detect dependencies
    const dependencies = this.detectDependencies(block.code, block.language);

    // Determine if runnable
    const isRunnable = this.isCompleteExample(block.code, block.language);

    return {
      title,
      description,
      language: this.normalizeLanguage(block.language),
      code: block.code,
      expectedOutput,
      lineStart: block.lineStart,
      lineEnd: block.lineEnd,
      dependencies,
      isRunnable,
    };
  }

  /**
   * Extract expected output from code comments
   */
  private extractExpectedOutput(code: string): string | undefined {
    const patterns = [
      /\/\/\s*(?:Output|Returns|Expected|Result):\s*(.+)/i,
      /#\s*(?:Output|Returns|Expected|Result):\s*(.+)/i,
      /\/\*\s*(?:Output|Returns|Expected|Result):\s*([\s\S]*?)\*\//i,
      /"""[\s\S]*?(?:Output|Returns|Expected|Result):\s*([\s\S]*?)"""/i,
    ];

    for (const pattern of patterns) {
      const match = code.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    // Check for console.log/print statements with expected output comments
    const outputMatch = code.match(
      /(?:console\.log|print|fmt\.Println?)\([^)]+\)\s*\/\/\s*(.+)/
    );
    if (outputMatch?.[1]) {
      return outputMatch[1].trim();
    }

    return undefined;
  }

  /**
   * Detect package dependencies from imports
   */
  private detectDependencies(code: string, language: string): string[] {
    const deps: Set<string> = new Set();

    switch (language) {
      case 'javascript':
      case 'js':
      case 'typescript':
      case 'ts': {
        // require('package') or import ... from 'package'
        const requireMatches = code.matchAll(/require\(['"]([@\w/-]+)['"]\)/g);
        const importMatches = code.matchAll(/from\s+['"]([@\w/-]+)['"]/g);

        for (const match of requireMatches) {
          const pkg = match[1];
          if (pkg && !this.isBuiltinModule(pkg, 'node')) {
            deps.add(pkg);
          }
        }
        for (const match of importMatches) {
          const pkg = match[1];
          if (pkg && !this.isBuiltinModule(pkg, 'node')) {
            deps.add(pkg);
          }
        }
        break;
      }

      case 'python':
      case 'py': {
        // import package or from package import ...
        const importMatches = code.matchAll(/^(?:import|from)\s+([\w]+)/gm);
        for (const match of importMatches) {
          const pkg = match[1];
          if (pkg && !this.isBuiltinModule(pkg, 'python')) {
            deps.add(pkg);
          }
        }
        break;
      }

      case 'go':
      case 'golang': {
        // import "package"
        const importMatches = code.matchAll(/import\s+(?:\(\s*)?[`"]([^`"]+)[`"]/g);
        for (const match of importMatches) {
          const pkg = match[1];
          if (pkg && !pkg.startsWith('fmt') && !pkg.startsWith('os')) {
            deps.add(pkg);
          }
        }
        break;
      }
    }

    return Array.from(deps);
  }

  /**
   * Check if a module is built-in
   */
  private isBuiltinModule(module: string, runtime: string): boolean {
    const builtins: Record<string, string[]> = {
      node: [
        'fs', 'path', 'os', 'http', 'https', 'crypto', 'util', 'events',
        'stream', 'buffer', 'url', 'querystring', 'child_process', 'assert',
      ],
      python: [
        'os', 'sys', 'json', 're', 'math', 'datetime', 'collections',
        'itertools', 'functools', 'typing', 'abc', 'io', 'pathlib',
      ],
    };

    return builtins[runtime]?.includes(module.split('/')[0] ?? '') ?? false;
  }

  /**
   * Check if example is complete and executable
   */
  private isCompleteExample(code: string, language: string): boolean {
    // Check for incomplete code indicators
    const incompletePatterns = [
      /\.\.\./,          // Ellipsis
      /\/\/\s*\.\.\./,   // Comment ellipsis
      /#\s*\.\.\./,      // Python comment ellipsis
      /TODO/i,           // TODO marker
      /FIXME/i,          // FIXME marker
      /your.*here/i,     // "your code here" placeholders
      /placeholder/i,    // Placeholder text
    ];

    for (const pattern of incompletePatterns) {
      if (pattern.test(code)) {
        return false;
      }
    }

    // Language-specific checks
    switch (language) {
      case 'javascript':
      case 'js':
      case 'typescript':
      case 'ts':
        // Should have actual executable statements
        return /(?:console\.|return |function |const |let |var |=|\(.*\))/m.test(code);

      case 'python':
      case 'py':
        return /(?:print\(|return |def |class |=)/m.test(code);

      case 'go':
      case 'golang':
        // Go needs main function or package declaration
        return /package\s+\w+/.test(code);

      default:
        return true;
    }
  }

  /**
   * Normalize language name
   */
  private normalizeLanguage(lang: string): string {
    const mapping: Record<string, string> = {
      js: 'javascript',
      ts: 'typescript',
      py: 'python',
      golang: 'go',
      rs: 'rust',
      sh: 'bash',
      shell: 'bash',
      node: 'javascript',
    };
    return mapping[lang.toLowerCase()] || lang.toLowerCase();
  }

  /**
   * Generate sandbox configuration for an example
   */
  generateSandboxConfig(language: string, _dependencies: string[]): SandboxConfig {
    const baseConfig: SandboxConfig = {
      runtime: 'node',
      timeout: 30000,
      memoryLimit: 256,
      networkAccess: false,
      fileSystemAccess: false,
    };

    switch (language) {
      case 'javascript':
      case 'typescript':
        return {
          ...baseConfig,
          runtime: 'node',
          nodeVersion: '20',
        };

      case 'python':
        return {
          ...baseConfig,
          runtime: 'python',
          pythonVersion: '3.11',
        };

      case 'go':
        return {
          ...baseConfig,
          runtime: 'go',
        };

      case 'rust':
        return {
          ...baseConfig,
          runtime: 'rust',
          timeout: 60000, // Rust compilation takes longer
        };

      default:
        return baseConfig;
    }
  }
}

export const exampleExtractorService = new ExampleExtractorService();
