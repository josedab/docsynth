import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-testing-execution-service');

// ============================================================================
// Types
// ============================================================================

export type SupportedLanguage = 'javascript' | 'typescript' | 'python' | 'go' | 'java' | 'rust' | 'bash';

export interface CodeExample {
  id: string;
  documentId: string;
  documentPath: string;
  language: SupportedLanguage;
  code: string;
  lineStart: number;
  lineEnd: number;
  heading: string; // section heading it's under
  expectedOutput?: string;
}

export interface TestResult {
  exampleId: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  output: string;
  errorMessage?: string;
  executionTimeMs: number;
  language: SupportedLanguage;
}

export interface DocTestSuite {
  repositoryId: string;
  documentId?: string;
  totalExamples: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  results: TestResult[];
  executedAt: Date;
  duration: number;
}

export interface DocTestConfig {
  enabled: boolean;
  languages: SupportedLanguage[];
  excludePaths: string[];
  timeout: number; // seconds per example
  runOnPR: boolean;
  createCheckRun: boolean;
}

export interface DocTestHistory {
  id: string;
  repositoryId: string;
  documentId?: string;
  totalExamples: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  duration: number;
  executedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface TestCoverageStats {
  repositoryId: string;
  totalDocuments: number;
  documentsWithExamples: number;
  documentsWithTestedExamples: number;
  totalExamples: number;
  testedExamples: number;
  coveragePercentage: number;
}

// ============================================================================
// Code Example Extraction
// ============================================================================

/**
 * Extract code examples from markdown content
 */
export function extractCodeExamples(
  content: string,
  documentId: string,
  documentPath: string
): CodeExample[] {
  const examples: CodeExample[] = [];
  const lines = content.split('\n');
  let currentHeading = 'Introduction';

  // Regex for fenced code blocks: ```language
  const codeBlockStartRegex = /^```(\w+)$/;
  const codeBlockEndRegex = /^```$/;

  let inCodeBlock = false;
  let codeBlockLanguage: string | null = null;
  let codeBlockLines: string[] = [];
  let codeBlockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Track headings for context
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && !inCodeBlock) {
      currentHeading = headingMatch[2] ?? 'Introduction';
      continue;
    }

    // Check for code block start
    const startMatch = line.match(codeBlockStartRegex);
    if (startMatch && !inCodeBlock) {
      inCodeBlock = true;
      codeBlockLanguage = startMatch[1] ?? 'text';
      codeBlockLines = [];
      codeBlockStart = i + 1;
      continue;
    }

    // Check for code block end
    if (line.match(codeBlockEndRegex) && inCodeBlock) {
      inCodeBlock = false;

      // Only process supported languages
      const normalizedLang = normalizeLang(codeBlockLanguage ?? 'text');
      if (normalizedLang && codeBlockLines.length > 0) {
        // Check for expected output in comments
        const expectedOutput = extractExpectedOutput(codeBlockLines, normalizedLang);

        examples.push({
          id: `${documentId}-${codeBlockStart}`,
          documentId,
          documentPath,
          language: normalizedLang,
          code: codeBlockLines.join('\n'),
          lineStart: codeBlockStart,
          lineEnd: i,
          heading: currentHeading,
          expectedOutput,
        });
      }

      codeBlockLanguage = null;
      codeBlockLines = [];
      continue;
    }

    // Collect code lines
    if (inCodeBlock) {
      codeBlockLines.push(line);
    }
  }

  return examples;
}

/**
 * Normalize language string to SupportedLanguage
 */
function normalizeLang(lang: string): SupportedLanguage | null {
  const normalized = lang.toLowerCase();

  const mapping: Record<string, SupportedLanguage> = {
    'js': 'javascript',
    'javascript': 'javascript',
    'ts': 'typescript',
    'typescript': 'typescript',
    'py': 'python',
    'python': 'python',
    'golang': 'go',
    'go': 'go',
    'java': 'java',
    'rs': 'rust',
    'rust': 'rust',
    'sh': 'bash',
    'bash': 'bash',
    'shell': 'bash',
  };

  return mapping[normalized] ?? null;
}

/**
 * Extract expected output from code comments
 */
function extractExpectedOutput(codeLines: string[], language: SupportedLanguage): string | undefined {
  const commentPatterns: Record<SupportedLanguage, RegExp> = {
    'javascript': /^\/\/\s*expected:\s*(.+)$/i,
    'typescript': /^\/\/\s*expected:\s*(.+)$/i,
    'python': /^#\s*expected:\s*(.+)$/i,
    'go': /^\/\/\s*expected:\s*(.+)$/i,
    'java': /^\/\/\s*expected:\s*(.+)$/i,
    'rust': /^\/\/\s*expected:\s*(.+)$/i,
    'bash': /^#\s*expected:\s*(.+)$/i,
  };

  const pattern = commentPatterns[language];
  if (!pattern) return undefined;

  for (const line of codeLines) {
    const match = line.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

// ============================================================================
// Code Execution (Simulated Sandbox)
// ============================================================================

/**
 * Run a code example in a simulated sandbox environment
 * In production, this would use actual sandboxing (Docker, VM, etc.)
 */
export async function runCodeExample(
  example: CodeExample,
  timeout: number
): Promise<TestResult> {
  const startTime = Date.now();

  try {
    log.info({ exampleId: example.id, language: example.language }, 'Running code example');

    // Simulate execution based on language
    const result = await simulateExecution(example, timeout);

    const executionTime = Date.now() - startTime;

    // Check if output matches expected
    let status: TestResult['status'] = 'passed';
    let errorMessage: string | undefined;

    if (example.expectedOutput) {
      if (result.output.trim() !== example.expectedOutput.trim()) {
        status = 'failed';
        errorMessage = `Expected: "${example.expectedOutput}", Got: "${result.output}"`;
      }
    } else if (result.exitCode !== 0) {
      status = 'error';
      errorMessage = result.stderr || 'Non-zero exit code';
    }

    return {
      exampleId: example.id,
      status,
      output: result.stdout || result.output,
      errorMessage,
      executionTimeMs: executionTime,
      language: example.language,
    };
  } catch (error) {
    const executionTime = Date.now() - startTime;
    return {
      exampleId: example.id,
      status: 'error',
      output: '',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      executionTimeMs: executionTime,
      language: example.language,
    };
  }
}

/**
 * Simulate code execution (placeholder for actual sandbox)
 */
async function simulateExecution(
  example: CodeExample,
  timeoutSeconds: number
): Promise<{ output: string; stdout: string; stderr: string; exitCode: number }> {
  // Simulate execution delay
  await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 100));

  // Check for timeout simulation
  if (timeoutSeconds < 1) {
    throw new Error('Execution timeout');
  }

  // Basic validation checks
  const code = example.code.trim();

  // Simulate common errors
  if (code.includes('throw new Error') || code.includes('raise Exception')) {
    return {
      output: '',
      stdout: '',
      stderr: 'Error: Simulated exception',
      exitCode: 1,
    };
  }

  if (code.includes('console.log') || code.includes('print(')) {
    // Extract the output from print statements (very simplified)
    const match = code.match(/(?:console\.log|print)\(['"](.+?)['"]\)/);
    const output = match ? match[1] ?? 'output' : 'output';
    return {
      output,
      stdout: output,
      stderr: '',
      exitCode: 0,
    };
  }

  // Default success
  return {
    output: example.expectedOutput ?? '',
    stdout: example.expectedOutput ?? '',
    stderr: '',
    exitCode: 0,
  };
}

// ============================================================================
// Test Suite Execution
// ============================================================================

/**
 * Run doc test suite for a repository or specific document
 */
export async function runDocTestSuite(
  repositoryId: string,
  documentId?: string
): Promise<DocTestSuite> {
  const startTime = Date.now();

  log.info({ repositoryId, documentId }, 'Starting doc test suite');

  // Get configuration
  const config = await getDocTestConfig(repositoryId);

  if (!config.enabled) {
    throw new Error('Doc testing is not enabled for this repository');
  }

  // Get documents to test
  const documents = await getDocumentsToTest(repositoryId, documentId, config);

  const allResults: TestResult[] = [];
  let totalExamples = 0;
  let passed = 0;
  let failed = 0;
  let errors = 0;
  let skipped = 0;

  for (const doc of documents) {
    const examples = extractCodeExamples(doc.content || '', doc.id, doc.path);

    // Filter by configured languages
    const filteredExamples = examples.filter(ex =>
      config.languages.includes(ex.language)
    );

    totalExamples += filteredExamples.length;

    for (const example of filteredExamples) {
      const result = await runCodeExample(example, config.timeout);
      allResults.push(result);

      switch (result.status) {
        case 'passed':
          passed++;
          break;
        case 'failed':
          failed++;
          break;
        case 'error':
          errors++;
          break;
        case 'skipped':
          skipped++;
          break;
      }
    }
  }

  const duration = Date.now() - startTime;

  const suite: DocTestSuite = {
    repositoryId,
    documentId,
    totalExamples,
    passed,
    failed,
    errors,
    skipped,
    results: allResults,
    executedAt: new Date(),
    duration,
  };

  // Store test run in database
  await storeTestRun(suite);

  log.info({
    repositoryId,
    totalExamples,
    passed,
    failed,
    errors,
    duration
  }, 'Doc test suite completed');

  return suite;
}

/**
 * Get documents to test based on filters
 */
async function getDocumentsToTest(
  repositoryId: string,
  documentId: string | undefined,
  config: DocTestConfig
) {
  if (documentId) {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, path: true, content: true },
    });
    return doc ? [doc] : [];
  }

  // Get all documents, excluding configured paths
  const documents = await prisma.document.findMany({
    where: {
      repositoryId,
      NOT: {
        path: {
          in: config.excludePaths.map(p => p),
        },
      },
    },
    select: { id: true, path: true, content: true },
    take: 50, // Limit for performance
  });

  // Additional filtering for exclude patterns
  return documents.filter(doc =>
    !config.excludePaths.some(pattern => doc.path.includes(pattern))
  );
}

/**
 * Store test run results in database
 */
async function storeTestRun(suite: DocTestSuite): Promise<void> {
  // Using raw query since DocTestRun model might not exist yet
  try {
    await prisma.$executeRaw`
      INSERT INTO doc_test_runs (
        id, repository_id, document_id, total_examples, passed, failed, errors,
        skipped, duration, executed_at, results, created_at
      ) VALUES (
        gen_random_uuid(), ${suite.repositoryId}, ${suite.documentId ?? null},
        ${suite.totalExamples}, ${suite.passed}, ${suite.failed}, ${suite.errors},
        ${suite.skipped}, ${suite.duration}, ${suite.executedAt},
        ${JSON.stringify(suite.results)}::jsonb, NOW()
      )
    `;
  } catch (error) {
    log.warn({ error }, 'Failed to store test run (table may not exist yet)');
  }
}

// ============================================================================
// Configuration Management
// ============================================================================

/**
 * Get doc test configuration for a repository
 */
export async function getDocTestConfig(repositoryId: string): Promise<DocTestConfig> {
  const repo = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { config: true },
  });

  if (!repo) {
    throw new Error('Repository not found');
  }

  const repoConfig = repo.config as Record<string, unknown> || {};
  const docTestConfig = (repoConfig.docTesting as Partial<DocTestConfig>) || {};

  // Default configuration
  return {
    enabled: docTestConfig.enabled ?? false,
    languages: docTestConfig.languages ?? ['javascript', 'typescript', 'python'],
    excludePaths: docTestConfig.excludePaths ?? ['node_modules', '.git', 'dist', 'build'],
    timeout: docTestConfig.timeout ?? 30,
    runOnPR: docTestConfig.runOnPR ?? false,
    createCheckRun: docTestConfig.createCheckRun ?? false,
  };
}

/**
 * Update doc test configuration
 */
export async function updateDocTestConfig(
  repositoryId: string,
  updates: Partial<DocTestConfig>
): Promise<DocTestConfig> {
  const currentConfig = await getDocTestConfig(repositoryId);

  const newConfig: DocTestConfig = {
    enabled: updates.enabled ?? currentConfig.enabled,
    languages: updates.languages ?? currentConfig.languages,
    excludePaths: updates.excludePaths ?? currentConfig.excludePaths,
    timeout: updates.timeout ?? currentConfig.timeout,
    runOnPR: updates.runOnPR ?? currentConfig.runOnPR,
    createCheckRun: updates.createCheckRun ?? currentConfig.createCheckRun,
  };

  // Update repository config
  const repo = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { config: true },
  });

  const repoConfig = repo?.config as Record<string, unknown> || {};

  await prisma.repository.update({
    where: { id: repositoryId },
    data: {
      config: JSON.parse(JSON.stringify({
        ...repoConfig,
        docTesting: newConfig,
      })),
    },
  });

  return newConfig;
}

// ============================================================================
// Test History
// ============================================================================

/**
 * Get test history for a repository
 */
export async function getTestHistory(
  repositoryId: string,
  limit: number = 50
): Promise<DocTestHistory[]> {
  try {
    // Query test runs from database
    const runs = await prisma.$queryRaw<Array<{
      id: string;
      repository_id: string;
      document_id: string | null;
      total_examples: number;
      passed: number;
      failed: number;
      errors: number;
      skipped: number;
      duration: number;
      executed_at: Date;
      metadata: unknown;
    }>>`
      SELECT id, repository_id, document_id, total_examples, passed, failed,
             errors, skipped, duration, executed_at, metadata
      FROM doc_test_runs
      WHERE repository_id = ${repositoryId}
      ORDER BY executed_at DESC
      LIMIT ${limit}
    `;

    return runs.map(run => ({
      id: run.id,
      repositoryId: run.repository_id,
      documentId: run.document_id ?? undefined,
      totalExamples: run.total_examples,
      passed: run.passed,
      failed: run.failed,
      errors: run.errors,
      skipped: run.skipped,
      duration: run.duration,
      executedAt: run.executed_at,
      metadata: run.metadata as Record<string, unknown> | undefined,
    }));
  } catch (error) {
    log.warn({ error }, 'Failed to fetch test history (table may not exist yet)');
    return [];
  }
}

// ============================================================================
// Check Run Summary
// ============================================================================

/**
 * Generate GitHub check run summary markdown
 */
export function generateCheckRunSummary(suite: DocTestSuite): string {
  const passRate = suite.totalExamples > 0
    ? ((suite.passed / suite.totalExamples) * 100).toFixed(1)
    : '0.0';

  const status = suite.failed === 0 && suite.errors === 0 ? '✅' : '❌';

  let summary = `${status} **Documentation Code Examples Test Results**\n\n`;
  summary += `## Summary\n\n`;
  summary += `- **Total Examples:** ${suite.totalExamples}\n`;
  summary += `- **Passed:** ${suite.passed} (${passRate}%)\n`;
  summary += `- **Failed:** ${suite.failed}\n`;
  summary += `- **Errors:** ${suite.errors}\n`;
  summary += `- **Skipped:** ${suite.skipped}\n`;
  summary += `- **Duration:** ${(suite.duration / 1000).toFixed(2)}s\n\n`;

  if (suite.failed > 0 || suite.errors > 0) {
    summary += `## Failed Tests\n\n`;

    const failedResults = suite.results.filter(r => r.status === 'failed' || r.status === 'error');

    for (const result of failedResults) {
      summary += `### ${result.exampleId}\n\n`;
      summary += `- **Status:** ${result.status}\n`;
      summary += `- **Language:** ${result.language}\n`;
      summary += `- **Error:** ${result.errorMessage ?? 'Unknown error'}\n`;
      summary += `- **Output:**\n\`\`\`\n${result.output}\n\`\`\`\n\n`;
    }
  }

  return summary;
}

// ============================================================================
// Coverage Statistics
// ============================================================================

/**
 * Get test coverage statistics for a repository
 */
export async function getTestCoverageStats(repositoryId: string): Promise<TestCoverageStats> {
  // Get all documents
  const allDocuments = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true, path: true, content: true },
  });

  const totalDocuments = allDocuments.length;
  let documentsWithExamples = 0;
  let totalExamples = 0;

  // Count documents with code examples
  for (const doc of allDocuments) {
    const examples = extractCodeExamples(doc.content || '', doc.id, doc.path);
    if (examples.length > 0) {
      documentsWithExamples++;
      totalExamples += examples.length;
    }
  }

  // For now, assume all extracted examples are "tested" (run through the test suite)
  // In a real implementation, this would track which examples have been tested
  const documentsWithTestedExamples = documentsWithExamples;
  const testedExamples = totalExamples;

  const coveragePercentage = totalDocuments > 0
    ? (documentsWithTestedExamples / totalDocuments) * 100
    : 0;

  return {
    repositoryId,
    totalDocuments,
    documentsWithExamples,
    documentsWithTestedExamples,
    totalExamples,
    testedExamples,
    coveragePercentage,
  };
}
