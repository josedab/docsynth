/**
 * Interactive Code Examples V2 Service
 *
 * Live, executable code examples in documentation that automatically
 * update when APIs change and can be run in the browser.
 */

import { prisma } from '@docsynth/database';
import { getAnthropicClient } from '@docsynth/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export type ExampleRuntime = 'nodejs' | 'python' | 'go' | 'rust' | 'browser';

export interface InteractiveExample {
  id: string;
  documentId: string;
  repositoryId: string;
  title: string;
  language: string;
  runtime: ExampleRuntime;
  code: string;
  expectedOutput?: string;
  dependencies: Record<string, string>;
  isValid: boolean;
  shareUrl?: string;
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  memoryUsedMB: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Generate interactive examples from a document's code blocks
 */
export async function generateExamplesFromDocument(
  documentId: string,
  repositoryId: string
): Promise<InteractiveExample[]> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { content: true, title: true, path: true },
  });

  if (!doc?.content) return [];

  const codeBlocks = extractCodeBlocks(doc.content);
  const examples: InteractiveExample[] = [];

  for (const block of codeBlocks) {
    const runtime = inferRuntime(block.language);
    if (!runtime) continue;

    const example: InteractiveExample = {
      id: `example-${documentId}-${examples.length}`,
      documentId,
      repositoryId,
      title: block.title || `Example ${examples.length + 1}`,
      language: block.language,
      runtime,
      code: block.code,
      expectedOutput: block.expectedOutput,
      dependencies: {},
      isValid: true,
      shareUrl: undefined,
    };

    // Use LLM to enhance example if available
    const anthropic = getAnthropicClient();
    if (anthropic) {
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system:
            'You are a code example expert. Given a code snippet, make it self-contained and runnable. Return ONLY valid JSON.',
          messages: [
            {
              role: 'user',
              content: `Make this ${block.language} code example runnable:\n\`\`\`${block.language}\n${block.code}\n\`\`\`\n\nReturn: {"code":"runnable code","dependencies":{"pkg":"version"},"expectedOutput":"expected stdout"}`,
            },
          ],
        });

        const text = response.content[0];
        if (text && text.type === 'text') {
          const match = (text as { type: 'text'; text: string }).text.match(/\{[\s\S]*\}/);
          if (match) {
            const enhanced = JSON.parse(match[0]);
            example.code = enhanced.code || example.code;
            example.dependencies = enhanced.dependencies || {};
            example.expectedOutput = enhanced.expectedOutput || example.expectedOutput;
          }
        }
      } catch {
        // Keep original code block
      }
    }

    examples.push(example);

    // Persist
    await db.interactiveExampleV2.create({
      data: {
        documentId,
        repositoryId,
        title: example.title,
        language: example.language,
        runtime: example.runtime,
        code: example.code,
        expectedOutput: example.expectedOutput || null,
        dependencies: example.dependencies,
        isValid: true,
      },
    });
  }

  return examples;
}

/**
 * Validate all examples for a repository
 */
export async function validateExamples(repositoryId: string): Promise<{
  total: number;
  valid: number;
  invalid: number;
  results: Array<{ exampleId: string; valid: boolean; error?: string }>;
}> {
  const examples = await db.interactiveExampleV2.findMany({
    where: { repositoryId },
  });

  const results: Array<{ exampleId: string; valid: boolean; error?: string }> = [];

  for (const example of examples) {
    const valid = validateCodeSyntax(example.code as string, example.language as string);
    results.push({
      exampleId: example.id as string,
      valid,
      error: valid ? undefined : 'Syntax validation failed',
    });

    await db.interactiveExampleV2.update({
      where: { id: example.id },
      data: { isValid: valid, lastValidated: new Date() },
    });
  }

  return {
    total: examples.length,
    valid: results.filter((r) => r.valid).length,
    invalid: results.filter((r) => !r.valid).length,
    results,
  };
}

/**
 * Get examples for a document
 */
export async function getDocumentExamples(documentId: string) {
  return db.interactiveExampleV2.findMany({
    where: { documentId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Get execution history for an example
 */
export async function getExampleExecutions(exampleId: string, limit: number = 10) {
  return db.exampleExecution.findMany({
    where: { exampleId },
    orderBy: { executedAt: 'desc' },
    take: limit,
  });
}

/**
 * Record an example execution
 */
export async function recordExecution(exampleId: string, result: ExecutionResult): Promise<void> {
  await db.exampleExecution.create({
    data: {
      exampleId,
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      memoryMB: result.memoryUsedMB,
    },
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

interface CodeBlock {
  language: string;
  code: string;
  title?: string;
  expectedOutput?: string;
}

function extractCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const lang = match[1] || 'text';
    const code = match[2] || '';

    if (['javascript', 'typescript', 'js', 'ts', 'python', 'py', 'go', 'rust'].includes(lang)) {
      blocks.push({ language: lang, code: code.trim() });
    }
  }

  return blocks;
}

function inferRuntime(language: string): ExampleRuntime | null {
  const runtimeMap: Record<string, ExampleRuntime> = {
    javascript: 'nodejs',
    js: 'nodejs',
    typescript: 'nodejs',
    ts: 'nodejs',
    python: 'python',
    py: 'python',
    go: 'go',
    rust: 'rust',
    html: 'browser',
    css: 'browser',
  };
  return runtimeMap[language] || null;
}

function validateCodeSyntax(code: string, _language: string): boolean {
  // Basic syntax validation
  if (!code || code.trim().length === 0) return false;

  // Check balanced brackets
  const openBraces = (code.match(/\{/g) || []).length;
  const closeBraces = (code.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) return false;

  const openParens = (code.match(/\(/g) || []).length;
  const closeParens = (code.match(/\)/g) || []).length;
  if (openParens !== closeParens) return false;

  return true;
}
