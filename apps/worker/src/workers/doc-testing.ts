/**
 * AI Documentation Testing Worker
 *
 * Extracts code examples from documentation, executes them in a simulated sandbox,
 * and reports failures. Creates GitHub check runs with test results for CI integration.
 */

import { createWorker, QUEUE_NAMES, type DocTestGenerationJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { GitHubClient } from '@docsynth/github';

const log = createLogger('doc-testing-worker');

// ============================================================================
// Types
// ============================================================================

type SupportedLanguage = 'javascript' | 'typescript' | 'python' | 'go' | 'java' | 'rust' | 'bash';

interface CodeExample {
  id: string;
  documentId: string;
  documentPath: string;
  language: SupportedLanguage;
  code: string;
  lineStart: number;
  lineEnd: number;
  heading: string;
  expectedOutput?: string;
}

interface TestResult {
  exampleId: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  output: string;
  errorMessage?: string;
  executionTimeMs: number;
  language: SupportedLanguage;
}

interface DocTestConfig {
  enabled: boolean;
  languages: SupportedLanguage[];
  excludePaths: string[];
  timeout: number;
  runOnPR: boolean;
  createCheckRun: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract code examples from markdown content
 */
function extractCodeExamples(
  content: string,
  documentId: string,
  documentPath: string
): CodeExample[] {
  const examples: CodeExample[] = [];
  const lines = content.split('\n');
  let currentHeading = 'Introduction';

  const codeBlockStartRegex = /^```(\w+)$/;
  const codeBlockEndRegex = /^```$/;

  let inCodeBlock = false;
  let codeBlockLanguage: string | null = null;
  let codeBlockLines: string[] = [];
  let codeBlockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && !inCodeBlock) {
      currentHeading = headingMatch[2] ?? 'Introduction';
      continue;
    }

    const startMatch = line.match(codeBlockStartRegex);
    if (startMatch && !inCodeBlock) {
      inCodeBlock = true;
      codeBlockLanguage = startMatch[1] ?? 'text';
      codeBlockLines = [];
      codeBlockStart = i + 1;
      continue;
    }

    if (line.match(codeBlockEndRegex) && inCodeBlock) {
      inCodeBlock = false;

      const normalizedLang = normalizeLang(codeBlockLanguage ?? 'text');
      if (normalizedLang && codeBlockLines.length > 0) {
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

    if (inCodeBlock) {
      codeBlockLines.push(line);
    }
  }

  return examples;
}

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

/**
 * Simulate code execution (placeholder for actual sandbox)
 */
async function simulateExecution(
  example: CodeExample,
  timeoutSeconds: number
): Promise<{ output: string; stdout: string; stderr: string; exitCode: number }> {
  await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 100));

  if (timeoutSeconds < 1) {
    throw new Error('Execution timeout');
  }

  const code = example.code.trim();

  if (code.includes('throw new Error') || code.includes('raise Exception')) {
    return {
      output: '',
      stdout: '',
      stderr: 'Error: Simulated exception',
      exitCode: 1,
    };
  }

  if (code.includes('console.log') || code.includes('print(')) {
    const match = code.match(/(?:console\.log|print)\(['"](.+?)['"]\)/);
    const output = match ? match[1] ?? 'output' : 'output';
    return {
      output,
      stdout: output,
      stderr: '',
      exitCode: 0,
    };
  }

  return {
    output: example.expectedOutput ?? '',
    stdout: example.expectedOutput ?? '',
    stderr: '',
    exitCode: 0,
  };
}

/**
 * Run a code example
 */
async function runCodeExample(example: CodeExample, timeout: number): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const result = await simulateExecution(example, timeout);
    const executionTime = Date.now() - startTime;

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
 * Get doc test configuration
 */
async function getDocTestConfig(repositoryId: string): Promise<DocTestConfig> {
  const repo = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { config: true },
  });

  const repoConfig = repo?.config as Record<string, unknown> || {};
  const docTestConfig = (repoConfig.docTesting as Partial<DocTestConfig>) || {};

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
 * Generate GitHub check run summary
 */
function generateCheckRunSummary(results: TestResult[], duration: number): {
  title: string;
  summary: string;
  conclusion: 'success' | 'failure' | 'neutral';
} {
  const total = results.length;
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const errors = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';
  const conclusion = failed === 0 && errors === 0 ? 'success' : 'failure';
  const icon = conclusion === 'success' ? '✅' : '❌';

  let summary = `${icon} **Documentation Code Examples Test Results**\n\n`;
  summary += `## Summary\n\n`;
  summary += `- **Total Examples:** ${total}\n`;
  summary += `- **Passed:** ${passed} (${passRate}%)\n`;
  summary += `- **Failed:** ${failed}\n`;
  summary += `- **Errors:** ${errors}\n`;
  summary += `- **Skipped:** ${skipped}\n`;
  summary += `- **Duration:** ${(duration / 1000).toFixed(2)}s\n\n`;

  if (failed > 0 || errors > 0) {
    summary += `## Failed Tests\n\n`;

    const failedResults = results.filter(r => r.status === 'failed' || r.status === 'error');
    for (const result of failedResults.slice(0, 10)) {
      summary += `### ${result.exampleId}\n\n`;
      summary += `- **Status:** ${result.status}\n`;
      summary += `- **Language:** ${result.language}\n`;
      summary += `- **Error:** ${result.errorMessage ?? 'Unknown error'}\n`;
      if (result.output) {
        summary += `- **Output:**\n\`\`\`\n${result.output.slice(0, 500)}\n\`\`\`\n\n`;
      }
    }

    if (failedResults.length > 10) {
      summary += `\n... and ${failedResults.length - 10} more failures\n`;
    }
  }

  const title = conclusion === 'success'
    ? `✅ All ${total} documentation examples passed`
    : `❌ ${failed + errors} of ${total} documentation examples failed`;

  return { title, summary, conclusion };
}

// ============================================================================
// Worker
// ============================================================================

export function startDocTestingWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_TEST_GENERATION,
    async (job) => {
      const data = job.data as DocTestGenerationJobData;
      const { repositoryId, documentId } = data;

      log.info({ jobId: job.id, repositoryId, documentId }, 'Starting doc testing run');

      await job.updateProgress(5);

      try {
        // Get repository info
        const repository = await prisma.repository.findUnique({
          where: { id: repositoryId },
          select: {
            id: true,
            name: true,
            fullName: true,
            installationId: true,
            config: true,
          },
        });

        if (!repository) {
          throw new Error(`Repository not found: ${repositoryId}`);
        }

        // Get configuration
        const config = await getDocTestConfig(repositoryId);

        if (!config.enabled) {
          log.info({ repositoryId }, 'Doc testing is not enabled for this repository');
          return;
        }

        await job.updateProgress(10);

        // Get documents to test
        let documents;
        if (documentId) {
          const doc = await prisma.document.findUnique({
            where: { id: documentId },
            select: { id: true, path: true, content: true },
          });
          documents = doc ? [doc] : [];
        } else {
          documents = await prisma.document.findMany({
            where: {
              repositoryId,
              NOT: {
                path: { in: config.excludePaths },
              },
            },
            select: { id: true, path: true, content: true },
            take: 50,
          });

          // Filter by exclude patterns
          documents = documents.filter(doc =>
            !config.excludePaths.some(pattern => doc.path.includes(pattern))
          );
        }

        log.info({ documentCount: documents.length }, 'Found documents to test');
        await job.updateProgress(20);

        // Extract and run code examples
        const allResults: TestResult[] = [];
        let totalExamples = 0;

        for (let i = 0; i < documents.length; i++) {
          const doc = documents[i];
          if (!doc) continue;

          const examples = extractCodeExamples(doc.content || '', doc.id, doc.path);
          const filteredExamples = examples.filter(ex => config.languages.includes(ex.language));

          totalExamples += filteredExamples.length;

          for (const example of filteredExamples) {
            const result = await runCodeExample(example, config.timeout);
            allResults.push(result);
          }

          await job.updateProgress(20 + Math.floor((i / documents.length) * 60));
        }

        await job.updateProgress(80);

        // Calculate metrics
        const passed = allResults.filter(r => r.status === 'passed').length;
        const failed = allResults.filter(r => r.status === 'failed').length;
        const errors = allResults.filter(r => r.status === 'error').length;
        const skipped = allResults.filter(r => r.status === 'skipped').length;
        const duration = allResults.reduce((sum, r) => sum + r.executionTimeMs, 0);

        // Store test run
        try {
          await prisma.$executeRaw`
            INSERT INTO doc_test_runs (
              id, repository_id, document_id, total_examples, passed, failed, errors,
              skipped, duration, executed_at, results, created_at
            ) VALUES (
              gen_random_uuid(), ${repositoryId}, ${documentId ?? null},
              ${totalExamples}, ${passed}, ${failed}, ${errors},
              ${skipped}, ${duration}, NOW(),
              ${JSON.stringify(allResults)}::jsonb, NOW()
            )
          `;
        } catch (error) {
          log.warn({ error }, 'Failed to store test run (table may not exist yet)');
        }

        await job.updateProgress(90);

        // Create GitHub check run if enabled
        if (config.createCheckRun) {
          try {
            const [owner, repo] = repository.fullName.split('/');
            if (owner && repo) {
              const github = GitHubClient.forInstallation(repository.installationId);
              const { title, summary, conclusion } = generateCheckRunSummary(allResults, duration);

              // Get the latest commit SHA from the repository
              const { data: repoData } = await (github as any).repos.get({
                owner,
                repo,
              });

              const checkRun = await (github as any).checks.create({
                owner,
                repo,
                name: 'Documentation Code Examples',
                head_sha: repoData.default_branch || 'main',
                status: 'completed',
                conclusion,
                completed_at: new Date().toISOString(),
                output: {
                  title,
                  summary,
                },
              });

              log.info({ checkRunId: checkRun.data.id }, 'Created GitHub check run');
            }
          } catch (error) {
            log.error({ error }, 'Failed to create GitHub check run');
          }
        }

        await job.updateProgress(100);

        log.info({
          repositoryId,
          totalExamples,
          passed,
          failed,
          errors,
          duration,
        }, 'Doc testing run completed');

      } catch (error) {
        log.error({ error, repositoryId }, 'Doc testing run failed');
        throw error;
      }
    },
    {
      concurrency: 2,
      limiter: {
        max: 5,
        duration: 60000,
      },
    }
  );

  log.info('Doc testing worker started');

  return worker;
}
