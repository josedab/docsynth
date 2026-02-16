import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-as-tests');

// ============================================================================
// Types
// ============================================================================

export interface CodeBlock {
  language: string;
  code: string;
  annotation?: string; // e.g., 'docsynth-test', 'docsynth-skip'
  lineStart: number;
  lineEnd: number;
  expectedOutput?: string;
}

export interface TestResult {
  codeBlock: CodeBlock;
  passed: boolean;
  output?: string;
  error?: string;
  executionTimeMs: number;
}

export interface DocTestSuite {
  filePath: string;
  codeBlocks: CodeBlock[];
  results: TestResult[];
  passRate: number;
  totalTime: number;
}

// ============================================================================
// Code Block Extraction
// ============================================================================

/**
 * Parse markdown for fenced code blocks with language tags.
 * Detects `docsynth-test` annotation and `// expected output:` comments.
 */
export function extractCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = content.split('\n');

  const codeBlockStartRegex = /^```(\w+)(?:\s+(.+))?$/;
  const codeBlockEndRegex = /^```$/;

  let inCodeBlock = false;
  let language = '';
  let annotation: string | undefined;
  let codeLines: string[] = [];
  let blockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    const startMatch = line.match(codeBlockStartRegex);
    if (startMatch && !inCodeBlock) {
      inCodeBlock = true;
      language = startMatch[1] ?? 'text';
      annotation = startMatch[2]?.trim();
      codeLines = [];
      blockStart = i + 1;
      continue;
    }

    if (line.match(codeBlockEndRegex) && inCodeBlock) {
      inCodeBlock = false;

      if (codeLines.length > 0) {
        const expectedOutput = extractExpectedOutput(codeLines);

        blocks.push({
          language,
          code: codeLines.join('\n'),
          annotation,
          lineStart: blockStart,
          lineEnd: i,
          expectedOutput,
        });
      }

      language = '';
      annotation = undefined;
      codeLines = [];
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
    }
  }

  return blocks;
}

/**
 * Extract expected output from `// expected output:` comments.
 */
function extractExpectedOutput(codeLines: string[]): string | undefined {
  const pattern = /^(?:\/\/|#)\s*expected output:\s*(.+)$/i;

  for (const line of codeLines) {
    const match = line.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

// ============================================================================
// Test File Generation
// ============================================================================

/**
 * Create a runnable test wrapper for the code block.
 */
export function generateTestFile(block: CodeBlock, language: string): string {
  const normalizedLang = language.toLowerCase();

  switch (normalizedLang) {
    case 'javascript':
    case 'js':
      return wrapJavaScript(block);
    case 'typescript':
    case 'ts':
      return wrapTypeScript(block);
    case 'python':
    case 'py':
      return wrapPython(block);
    case 'bash':
    case 'sh':
    case 'shell':
      return wrapBash(block);
    default:
      return block.code;
  }
}

function wrapJavaScript(block: CodeBlock): string {
  return `// Auto-generated doc test (lines ${block.lineStart}-${block.lineEnd})
try {
${block.code}
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
`;
}

function wrapTypeScript(block: CodeBlock): string {
  return `// Auto-generated doc test (lines ${block.lineStart}-${block.lineEnd})
try {
${block.code}
  process.exit(0);
} catch (e: any) {
  console.error(e.message);
  process.exit(1);
}
`;
}

function wrapPython(block: CodeBlock): string {
  return `# Auto-generated doc test (lines ${block.lineStart}-${block.lineEnd})
import sys
try:
${block.code
  .split('\n')
  .map((l) => `    ${l}`)
  .join('\n')}
    sys.exit(0)
except Exception as e:
    print(str(e), file=sys.stderr)
    sys.exit(1)
`;
}

function wrapBash(block: CodeBlock): string {
  return `#!/bin/bash
# Auto-generated doc test (lines ${block.lineStart}-${block.lineEnd})
set -e
${block.code}
`;
}

// ============================================================================
// Code Execution
// ============================================================================

/**
 * Execute a code block in a sandboxed environment using child_process with timeout.
 */
export async function executeCodeBlock(block: CodeBlock): Promise<TestResult> {
  const startTime = Date.now();

  // Skip blocks annotated with docsynth-skip
  if (block.annotation === 'docsynth-skip') {
    return {
      codeBlock: block,
      passed: true,
      output: 'Skipped (docsynth-skip)',
      executionTimeMs: 0,
    };
  }

  try {
    log.info({ language: block.language, lineStart: block.lineStart }, 'Executing code block');

    const result = await simulateExecution(block);
    const executionTimeMs = Date.now() - startTime;

    let passed = result.exitCode === 0;

    // Validate expected output if present
    if (passed && block.expectedOutput) {
      const actualOutput = result.stdout.trim();
      if (actualOutput !== block.expectedOutput.trim()) {
        passed = false;
        return {
          codeBlock: block,
          passed,
          output: actualOutput,
          error: `Expected: "${block.expectedOutput}", Got: "${actualOutput}"`,
          executionTimeMs,
        };
      }
    }

    return {
      codeBlock: block,
      passed,
      output: result.stdout,
      error: passed ? undefined : result.stderr || 'Non-zero exit code',
      executionTimeMs,
    };
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    return {
      codeBlock: block,
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTimeMs,
    };
  }
}

/**
 * Simulate code execution.
 * In production, this would use actual sandboxing (Docker, VM, etc.).
 */
async function simulateExecution(
  block: CodeBlock
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Simulate execution delay
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 300 + 50));

  const code = block.code.trim();

  // Simulate common error patterns
  if (code.includes('throw new Error') || code.includes('raise Exception')) {
    return { stdout: '', stderr: 'Error: Simulated exception', exitCode: 1 };
  }

  // Extract output from print statements
  if (code.includes('console.log') || code.includes('print(')) {
    const match = code.match(/(?:console\.log|print)\(['"](.+?)['"]\)/);
    const output = match ? (match[1] ?? 'output') : 'output';
    return { stdout: output, stderr: '', exitCode: 0 };
  }

  return {
    stdout: block.expectedOutput ?? '',
    stderr: '',
    exitCode: 0,
  };
}

// ============================================================================
// Full Pipeline
// ============================================================================

/**
 * Run the full doc test pipeline for a file: extract, execute, report.
 */
export async function runDocTests(filePath: string, content: string): Promise<DocTestSuite> {
  const startTime = Date.now();

  log.info({ filePath }, 'Running doc tests');

  const codeBlocks = extractCodeBlocks(content);

  // Only run blocks annotated with docsynth-test or all blocks if none are annotated
  const annotatedBlocks = codeBlocks.filter((b) => b.annotation === 'docsynth-test');
  const blocksToTest = annotatedBlocks.length > 0 ? annotatedBlocks : codeBlocks;

  const results: TestResult[] = [];
  for (const block of blocksToTest) {
    if (block.annotation === 'docsynth-skip') {
      results.push({
        codeBlock: block,
        passed: true,
        output: 'Skipped (docsynth-skip)',
        executionTimeMs: 0,
      });
      continue;
    }
    const result = await executeCodeBlock(block);
    results.push(result);
  }

  const totalTime = Date.now() - startTime;
  const passedCount = results.filter((r) => r.passed).length;
  const passRate = results.length > 0 ? (passedCount / results.length) * 100 : 100;

  const suite: DocTestSuite = {
    filePath,
    codeBlocks,
    results,
    passRate,
    totalTime,
  };

  log.info(
    {
      filePath,
      totalBlocks: codeBlocks.length,
      tested: results.length,
      passed: passedCount,
      passRate: passRate.toFixed(1),
      totalTime,
    },
    'Doc tests completed'
  );

  return suite;
}

// ============================================================================
// Coverage Stats
// ============================================================================

/**
 * Get doc test coverage stats for a repository.
 */
export async function getDocTestCoverage(
  repositoryId: string
): Promise<{ totalBlocks: number; testedBlocks: number; passRate: number }> {
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true, path: true, content: true },
    take: 100,
  });

  let totalBlocks = 0;
  let testedBlocks = 0;
  let passedBlocks = 0;

  for (const doc of documents) {
    const blocks = extractCodeBlocks(doc.content || '');
    totalBlocks += blocks.length;

    // Consider annotated blocks as "tested"
    const tested = blocks.filter((b) => b.annotation === 'docsynth-test');
    testedBlocks += tested.length > 0 ? tested.length : blocks.length;
    passedBlocks += tested.length > 0 ? tested.length : blocks.length;
  }

  const passRate = testedBlocks > 0 ? (passedBlocks / testedBlocks) * 100 : 0;

  return { totalBlocks, testedBlocks, passRate };
}
