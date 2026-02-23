/**
 * Interactive Documentation Playground Service
 *
 * Extracts runnable code examples from documentation, creates
 * sandbox playground instances, executes code safely, and manages
 * playground lifecycle and configuration.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId } from '@docsynth/utils';

const log = createLogger('doc-playground-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface Playground {
  id: string;
  repositoryId: string;
  documentPath: string;
  language: string;
  code: string;
  expectedOutput?: string;
  status: 'ready' | 'running' | 'completed' | 'failed';
  output?: string;
  errorOutput?: string;
  executionTimeMs?: number;
  createdAt: Date;
}

export interface ExtractedExample {
  documentPath: string;
  language: string;
  code: string;
  lineStart: number;
  lineEnd: number;
  metadata?: Record<string, unknown>;
}

export interface PlaygroundConfig {
  repositoryId: string;
  enabledLanguages: string[];
  defaultTimeout: number;
  maxConcurrent: number;
  sandboxed: boolean;
}

export interface ExecutionResult {
  playgroundId: string;
  success: boolean;
  output: string;
  errorOutput: string;
  executionTimeMs: number;
  exitCode: number;
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Extract runnable code blocks from documentation files.
 */
export async function extractExamples(
  repositoryId: string,
  documentPath?: string
): Promise<ExtractedExample[]> {
  log.info({ repositoryId, documentPath }, 'Extracting code examples');

  const where: Record<string, unknown> = { repositoryId };
  if (documentPath) where.path = documentPath;

  const docs = await db.document.findMany({ where, select: { path: true, content: true } });
  const examples: ExtractedExample[] = [];

  for (const doc of docs) {
    const content = doc.content ?? '';
    const lines = content.split('\n');
    let inBlock = false;
    let blockLang = '';
    let blockCode: string[] = [];
    let blockStart = 0;
    let metadata: Record<string, unknown> = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!inBlock && line.trimStart().startsWith('```')) {
        inBlock = true;
        blockStart = i + 1;
        blockCode = [];
        const langMatch = line.match(/```(\w+)/);
        blockLang = langMatch ? langMatch[1] : '';

        // Parse metadata comments (e.g., ```js {run} or ```python title="example")
        const metaMatch = line.match(/\{([^}]+)\}/);
        if (metaMatch) {
          metadata = { runnable: metaMatch[1].includes('run') };
        }
      } else if (inBlock && line.trimStart().startsWith('```')) {
        inBlock = false;
        const code = blockCode.join('\n');

        if (blockLang && isExecutableBlock(blockLang) && code.trim().length > 0) {
          examples.push({
            documentPath: doc.path,
            language: blockLang,
            code,
            lineStart: blockStart + 1,
            lineEnd: i + 1,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          });
        }
        metadata = {};
      } else if (inBlock) {
        blockCode.push(line);
      }
    }
  }

  log.info({ repositoryId, exampleCount: examples.length }, 'Examples extracted');
  return examples;
}

/**
 * Create a new playground instance.
 */
export async function createPlayground(
  repositoryId: string,
  language: string,
  code: string,
  documentPath?: string
): Promise<Playground> {
  const config = await getPlaygroundConfig(repositoryId);

  if (!config.enabledLanguages.includes(language)) {
    throw new Error(`Language "${language}" is not enabled for this repository`);
  }

  const id = generateId();
  const now = new Date();

  const playground: Playground = {
    id,
    repositoryId,
    documentPath: documentPath ?? '',
    language,
    code,
    status: 'ready',
    createdAt: now,
  };

  await db.docPlayground.create({
    data: {
      id,
      repositoryId,
      documentPath: documentPath ?? '',
      language,
      code,
      status: 'ready',
      createdAt: now,
    },
  });

  log.info({ id, repositoryId, language }, 'Playground created');
  return playground;
}

/**
 * Execute code in a sandboxed playground.
 */
export async function executePlayground(playgroundId: string): Promise<ExecutionResult> {
  log.info({ playgroundId }, 'Executing playground');

  const pg = await db.docPlayground.findUnique({ where: { id: playgroundId } });
  if (!pg) throw new Error(`Playground not found: ${playgroundId}`);

  const config = await getPlaygroundConfig(pg.repositoryId);

  await db.docPlayground.update({ where: { id: playgroundId }, data: { status: 'running' } });

  const startMs = Date.now();
  let output = '';
  let errorOutput = '';
  let exitCode = 0;

  try {
    const command = buildSandboxCommand(
      pg.language,
      pg.code,
      config.defaultTimeout,
      config.sandboxed
    );
    log.debug({ playgroundId, command: command.slice(0, 100) }, 'Running sandbox command');

    // Simulate execution — in production, this spawns an isolated process
    const result = await simulateExecution(pg.language, pg.code, config.defaultTimeout);
    output = result.output;
    errorOutput = result.errorOutput;
    exitCode = result.exitCode;
  } catch (err) {
    errorOutput = err instanceof Error ? err.message : String(err);
    exitCode = 1;
  }

  const executionTimeMs = Date.now() - startMs;
  const success = exitCode === 0;
  const status = success ? 'completed' : 'failed';

  await db.docPlayground.update({
    where: { id: playgroundId },
    data: { status, output, errorOutput, executionTimeMs },
  });

  const result: ExecutionResult = {
    playgroundId,
    success,
    output,
    errorOutput,
    executionTimeMs,
    exitCode,
  };
  log.info({ playgroundId, success, executionTimeMs }, 'Execution complete');
  return result;
}

/**
 * Get the current state of a playground.
 */
export async function getPlayground(playgroundId: string): Promise<Playground | null> {
  const row = await db.docPlayground.findUnique({ where: { id: playgroundId } });
  if (!row) return null;

  return {
    id: row.id,
    repositoryId: row.repositoryId,
    documentPath: row.documentPath,
    language: row.language,
    code: row.code,
    expectedOutput: row.expectedOutput ?? undefined,
    status: row.status,
    output: row.output ?? undefined,
    errorOutput: row.errorOutput ?? undefined,
    executionTimeMs: row.executionTimeMs ?? undefined,
    createdAt: row.createdAt,
  };
}

/**
 * List playgrounds for a repository, optionally filtered by document path.
 */
export async function listPlaygrounds(
  repositoryId: string,
  documentPath?: string
): Promise<Playground[]> {
  const where: Record<string, unknown> = { repositoryId };
  if (documentPath) where.documentPath = documentPath;

  const rows = await db.docPlayground.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((r: any) => ({
    id: r.id,
    repositoryId: r.repositoryId,
    documentPath: r.documentPath,
    language: r.language,
    code: r.code,
    expectedOutput: r.expectedOutput ?? undefined,
    status: r.status,
    output: r.output ?? undefined,
    errorOutput: r.errorOutput ?? undefined,
    executionTimeMs: r.executionTimeMs ?? undefined,
    createdAt: r.createdAt,
  }));
}

/**
 * Get sandbox configuration for a repository.
 */
export async function getPlaygroundConfig(repositoryId: string): Promise<PlaygroundConfig> {
  const config = await db.docPlaygroundConfig.findFirst({ where: { repositoryId } });

  if (config) {
    return {
      repositoryId,
      enabledLanguages:
        typeof config.enabledLanguages === 'string'
          ? JSON.parse(config.enabledLanguages)
          : (config.enabledLanguages ?? DEFAULT_LANGUAGES),
      defaultTimeout: config.defaultTimeout ?? 30000,
      maxConcurrent: config.maxConcurrent ?? 5,
      sandboxed: config.sandboxed !== false,
    };
  }

  return {
    repositoryId,
    enabledLanguages: DEFAULT_LANGUAGES,
    defaultTimeout: 30000,
    maxConcurrent: 5,
    sandboxed: true,
  };
}

/**
 * Clean up expired playgrounds older than maxAgeHours.
 */
export async function cleanupExpiredPlaygrounds(maxAgeHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

  const { count } = await db.docPlayground.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      status: { in: ['completed', 'failed'] },
    },
  });

  log.info({ maxAgeHours, deletedCount: count }, 'Cleaned up expired playgrounds');
  return count;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_LANGUAGES = ['javascript', 'typescript', 'python', 'bash', 'sh', 'go', 'rust'];

const LANGUAGE_RUNNERS: Record<string, string> = {
  javascript: 'node',
  typescript: 'npx ts-node',
  python: 'python3',
  bash: 'bash',
  sh: 'sh',
  go: 'go run',
  rust: 'cargo script',
};

// ============================================================================
// Helpers
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _detectLanguage(code: string): string {
  if (code.includes('console.log') || code.includes('const ') || code.includes('let '))
    return 'javascript';
  if (code.includes('import ') && code.includes('from ')) return 'typescript';
  if (code.includes('def ') || code.includes('print(')) return 'python';
  if (code.includes('func ') && code.includes('package ')) return 'go';
  if (code.includes('fn ') && code.includes('let mut')) return 'rust';
  if (code.startsWith('#!/bin/bash') || code.startsWith('#!/bin/sh')) return 'bash';
  return 'javascript';
}

function buildSandboxCommand(
  language: string,
  code: string,
  timeout: number,
  sandboxed: boolean
): string {
  const runner = LANGUAGE_RUNNERS[language] ?? 'node';
  const timeoutSec = Math.ceil(timeout / 1000);
  const escapedCode = code.replace(/'/g, "'\\''");

  if (sandboxed) {
    return `timeout ${timeoutSec} ${runner} -e '${escapedCode}' 2>&1`;
  }

  return `${runner} -e '${escapedCode}' 2>&1`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _parseOutput(rawOutput: string): { stdout: string; stderr: string } {
  const lines = rawOutput.split('\n');
  const stderr: string[] = [];
  const stdout: string[] = [];

  for (const line of lines) {
    if (line.startsWith('Error:') || line.startsWith('Traceback') || line.includes('STDERR:')) {
      stderr.push(line);
    } else {
      stdout.push(line);
    }
  }

  return { stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

function isExecutableBlock(language: string): boolean {
  const executable = new Set([
    'javascript',
    'js',
    'typescript',
    'ts',
    'python',
    'py',
    'bash',
    'sh',
    'shell',
    'go',
    'rust',
    'ruby',
    'rb',
  ]);
  return executable.has(language.toLowerCase());
}

async function simulateExecution(
  language: string,
  _code: string,
  _timeout: number
): Promise<{ output: string; errorOutput: string; exitCode: number }> {
  // Placeholder: in production, this spawns a sandboxed process
  log.debug({ language }, 'Simulating code execution');
  return { output: '', errorOutput: '', exitCode: 0 };
}
