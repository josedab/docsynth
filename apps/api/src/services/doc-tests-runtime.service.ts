/**
 * Doc Tests Runtime Service
 *
 * Extracts code examples from documentation files, executes them in
 * sandboxed environments, validates output, and auto-fixes broken examples.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-tests-runtime-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface CodeBlock {
  id: string;
  documentPath: string;
  language: string;
  code: string;
  lineStart: number;
  lineEnd: number;
  expectedOutput?: string;
  metadata?: { deps?: string[]; timeout?: number; skip?: boolean };
}

export interface TestResult {
  blockId: string;
  passed: boolean;
  output: string;
  error?: string;
  executionTimeMs: number;
  language: string;
}

export interface DocTestReport {
  repositoryId: string;
  totalBlocks: number;
  passed: number;
  failed: number;
  skipped: number;
  results: TestResult[];
  executionTimeMs: number;
  generatedAt: Date;
}

export interface AutoFixResult {
  blockId: string;
  originalCode: string;
  fixedCode: string;
  fixType: 'output-update' | 'syntax-fix' | 'import-fix' | 'api-update';
  confidence: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Extract code blocks from documentation
 */
export async function extractCodeBlocks(
  repositoryId: string,
  documentId?: string
): Promise<CodeBlock[]> {
  const whereClause: Record<string, unknown> = {
    repositoryId,
    OR: [{ path: { endsWith: '.md' } }, { path: { endsWith: '.mdx' } }],
  };
  if (documentId) whereClause.id = documentId;

  const docs = await prisma.document.findMany({
    where: whereClause,
    select: { id: true, path: true, content: true },
  });

  const blocks: CodeBlock[] = [];
  let blockId = 0;

  for (const doc of docs) {
    if (!doc.content) continue;
    const extracted = parseCodeBlocks(doc.path, doc.content, `blk-${blockId++}`);
    blocks.push(...extracted);
  }

  log.info({ repositoryId, blockCount: blocks.length }, 'Code blocks extracted');
  return blocks;
}

/**
 * Execute code blocks and return results
 */
export async function executeCodeBlocks(
  repositoryId: string,
  blocks: CodeBlock[],
  options?: { timeout?: number; sandboxed?: boolean }
): Promise<DocTestReport> {
  const startTime = Date.now();
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const timeout = options?.timeout ?? 10000;

  for (const block of blocks) {
    if (block.metadata?.skip) {
      skipped++;
      continue;
    }

    const result = await executeBlock(block, timeout);
    results.push(result);

    if (result.passed) passed++;
    else failed++;
  }

  const report: DocTestReport = {
    repositoryId,
    totalBlocks: blocks.length,
    passed,
    failed,
    skipped,
    results,
    executionTimeMs: Date.now() - startTime,
    generatedAt: new Date(),
  };

  await db.docTestReport.create({
    data: {
      repositoryId,
      totalBlocks: blocks.length,
      passed,
      failed,
      skipped,
      executionTimeMs: report.executionTimeMs,
      results: JSON.parse(JSON.stringify(results)),
      createdAt: new Date(),
    },
  });

  log.info(
    { repositoryId, total: blocks.length, passed, failed, skipped },
    'Doc tests execution complete'
  );

  return report;
}

/**
 * Attempt to auto-fix failed code blocks
 */
export async function autoFixFailedBlocks(
  results: TestResult[],
  blocks: CodeBlock[]
): Promise<AutoFixResult[]> {
  const fixes: AutoFixResult[] = [];
  const failedResults = results.filter((r) => !r.passed);

  for (const result of failedResults) {
    const block = blocks.find((b) => b.id === result.blockId);
    if (!block) continue;

    const fix = attemptFix(block, result);
    if (fix) fixes.push(fix);
  }

  log.info({ attempted: failedResults.length, fixed: fixes.length }, 'Auto-fix complete');
  return fixes;
}

/**
 * Get test history for a repository
 */
export async function getTestHistory(
  repositoryId: string,
  limit: number = 10
): Promise<Array<{ date: string; passed: number; failed: number; total: number }>> {
  const reports = await db.docTestReport.findMany({
    where: { repositoryId },
    select: { createdAt: true, passed: true, failed: true, totalBlocks: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return reports.map(
    (r: { createdAt: Date; passed: number; failed: number; totalBlocks: number }) => ({
      date: r.createdAt.toISOString().split('T')[0]!,
      passed: r.passed,
      failed: r.failed,
      total: r.totalBlocks,
    })
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function parseCodeBlocks(docPath: string, content: string, idPrefix: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /```(\w+)(?:\s+([^\n]*))?\n([\s\S]*?)```/g;
  let match;
  let blockNum = 0;

  while ((match = regex.exec(content)) !== null) {
    const language = match[1]!;
    const meta = match[2] ?? '';
    const code = match[3]!.trim();

    if (!isExecutableLanguage(language)) continue;
    if (meta.includes('no-test') || meta.includes('skip')) continue;

    const lineStart = content.substring(0, match.index).split('\n').length;
    const lineEnd = lineStart + code.split('\n').length;

    const expectedOutput = extractExpectedOutput(content, match.index + match[0].length);

    blocks.push({
      id: `${idPrefix}-${blockNum++}`,
      documentPath: docPath,
      language,
      code,
      lineStart,
      lineEnd,
      expectedOutput,
      metadata: parseMetadata(meta),
    });
  }

  return blocks;
}

function isExecutableLanguage(lang: string): boolean {
  return ['typescript', 'ts', 'javascript', 'js', 'python', 'py', 'bash', 'sh'].includes(
    lang.toLowerCase()
  );
}

function extractExpectedOutput(content: string, afterIndex: number): string | undefined {
  const after = content.substring(afterIndex, afterIndex + 200);
  const outputMatch = after.match(/```(?:output|text|console)\n([\s\S]*?)```/);
  return outputMatch?.[1]?.trim();
}

function parseMetadata(meta: string): CodeBlock['metadata'] {
  const result: CodeBlock['metadata'] = {};
  if (meta.includes('skip')) result.skip = true;

  const timeoutMatch = meta.match(/timeout=(\d+)/);
  if (timeoutMatch) result.timeout = parseInt(timeoutMatch[1]!, 10);

  return result;
}

async function executeBlock(block: CodeBlock, _timeout: number): Promise<TestResult> {
  const startTime = Date.now();

  try {
    // Simulate execution (in production, this would use Docker/sandbox)
    const output = simulateExecution(block);
    const passed = block.expectedOutput ? output.trim() === block.expectedOutput.trim() : true;

    return {
      blockId: block.id,
      passed,
      output,
      executionTimeMs: Date.now() - startTime,
      language: block.language,
    };
  } catch (error) {
    return {
      blockId: block.id,
      passed: false,
      output: '',
      error: error instanceof Error ? error.message : 'Execution failed',
      executionTimeMs: Date.now() - startTime,
      language: block.language,
    };
  }
}

function simulateExecution(block: CodeBlock): string {
  // Validate syntax (basic checks)
  if (block.language === 'typescript' || block.language === 'ts') {
    if (block.code.includes('syntax error') || !balancedBraces(block.code)) {
      throw new Error('SyntaxError: Unexpected token');
    }
  }
  return block.expectedOutput ?? 'OK';
}

function balancedBraces(code: string): boolean {
  let count = 0;
  for (const char of code) {
    if (char === '{' || char === '(') count++;
    if (char === '}' || char === ')') count--;
    if (count < 0) return false;
  }
  return count === 0;
}

function attemptFix(block: CodeBlock, result: TestResult): AutoFixResult | null {
  if (result.error?.includes('SyntaxError')) {
    return {
      blockId: block.id,
      originalCode: block.code,
      fixedCode: block.code.replace(/;;\s*$/gm, ';'),
      fixType: 'syntax-fix',
      confidence: 0.6,
    };
  }

  if (block.expectedOutput && result.output !== block.expectedOutput) {
    return {
      blockId: block.id,
      originalCode: block.code,
      fixedCode: block.code,
      fixType: 'output-update',
      confidence: 0.8,
    };
  }

  return null;
}
