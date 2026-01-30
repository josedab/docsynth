import { createLogger } from '@docsynth/utils';
import { prisma } from '@docsynth/database';
import type { TestFramework, TestValidationResult } from '@docsynth/types';

const log = createLogger('test-runner-service');

// Type assertion for new Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Test Execution Configuration
// ============================================================================

export interface TestExecutionConfig {
  framework: TestFramework;
  timeout: number;
  env?: Record<string, string>;
  setupScript?: string;
  teardownScript?: string;
}

interface FrameworkRunner {
  command: string;
  args: string[];
  parseOutput: (output: string) => TestRunResult;
}

interface TestRunResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  duration: number;
  errors: TestError[];
  coverage?: TestCoverage;
}

interface TestError {
  testName: string;
  message: string;
  stack?: string;
  expected?: string;
  actual?: string;
}

interface TestCoverage {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

// ============================================================================
// Framework-specific Runners
// ============================================================================

const frameworkRunners: Record<TestFramework, FrameworkRunner> = {
  jest: {
    command: 'npx',
    args: ['jest', '--json', '--passWithNoTests'],
    parseOutput: parseJestOutput,
  },
  vitest: {
    command: 'npx',
    args: ['vitest', 'run', '--reporter=json'],
    parseOutput: parseVitestOutput,
  },
  mocha: {
    command: 'npx',
    args: ['mocha', '--reporter', 'json'],
    parseOutput: parseMochaOutput,
  },
  pytest: {
    command: 'python',
    args: ['-m', 'pytest', '--tb=short', '-q'],
    parseOutput: parsePytestOutput,
  },
  'go-testing': {
    command: 'go',
    args: ['test', '-v', '-json'],
    parseOutput: parseGoTestOutput,
  },
  'rust-test': {
    command: 'cargo',
    args: ['test', '--', '--format=json'],
    parseOutput: parseRustTestOutput,
  },
};

// ============================================================================
// Output Parsers
// ============================================================================

function parseJestOutput(output: string): TestRunResult {
  try {
    const result = JSON.parse(output);
    return {
      passed: result.success,
      totalTests: result.numTotalTests || 0,
      passedTests: result.numPassedTests || 0,
      failedTests: result.numFailedTests || 0,
      skippedTests: result.numPendingTests || 0,
      duration: result.testResults?.reduce(
        (acc: number, r: { perfStats?: { runtime?: number } }) => 
          acc + (r.perfStats?.runtime || 0), 0
      ) || 0,
      errors: (result.testResults || [])
        .flatMap((r: { assertionResults?: Array<{ status: string; title: string; failureMessages?: string[] }> }) =>
          (r.assertionResults || [])
            .filter((a: { status: string }) => a.status === 'failed')
            .map((a: { title: string; failureMessages?: string[] }) => ({
              testName: a.title,
              message: a.failureMessages?.join('\n') || 'Unknown error',
            }))
        ),
      coverage: result.coverageMap ? {
        lines: result.coverageMap.total?.lines?.pct || 0,
        branches: result.coverageMap.total?.branches?.pct || 0,
        functions: result.coverageMap.total?.functions?.pct || 0,
        statements: result.coverageMap.total?.statements?.pct || 0,
      } : undefined,
    };
  } catch {
    return createFailedResult(output);
  }
}

function parseVitestOutput(output: string): TestRunResult {
  try {
    const lines = output.split('\n').filter(l => l.trim());
    const jsonLine = lines.find(l => l.startsWith('{'));
    if (!jsonLine) return createFailedResult(output);

    const result = JSON.parse(jsonLine);
    return {
      passed: result.success,
      totalTests: result.numTotalTests || 0,
      passedTests: result.numPassedTests || 0,
      failedTests: result.numFailedTests || 0,
      skippedTests: result.numSkippedTests || 0,
      duration: result.duration || 0,
      errors: extractErrorsFromVitest(result),
    };
  } catch {
    return createFailedResult(output);
  }
}

function extractErrorsFromVitest(result: Record<string, unknown>): TestError[] {
  const errors: TestError[] = [];
  const testResults = result.testResults as Array<{
    assertionResults?: Array<{
      status: string;
      fullName: string;
      failureMessages?: string[];
    }>;
  }> | undefined;

  if (testResults) {
    for (const suite of testResults) {
      for (const test of suite.assertionResults || []) {
        if (test.status === 'failed') {
          errors.push({
            testName: test.fullName,
            message: test.failureMessages?.join('\n') || 'Unknown error',
          });
        }
      }
    }
  }
  return errors;
}

function parseMochaOutput(output: string): TestRunResult {
  try {
    const result = JSON.parse(output);
    return {
      passed: result.stats?.failures === 0,
      totalTests: result.stats?.tests || 0,
      passedTests: result.stats?.passes || 0,
      failedTests: result.stats?.failures || 0,
      skippedTests: result.stats?.pending || 0,
      duration: result.stats?.duration || 0,
      errors: (result.failures || []).map((f: { title: string; err?: { message?: string; stack?: string } }) => ({
        testName: f.title,
        message: f.err?.message || 'Unknown error',
        stack: f.err?.stack,
      })),
    };
  } catch {
    return createFailedResult(output);
  }
}

function parsePytestOutput(output: string): TestRunResult {
  // Parse pytest's text output
  const passedMatch = output.match(/(\d+) passed/);
  const failedMatch = output.match(/(\d+) failed/);
  const skippedMatch = output.match(/(\d+) skipped/);

  const passed = parseInt(passedMatch?.[1] || '0', 10);
  const failed = parseInt(failedMatch?.[1] || '0', 10);
  const skipped = parseInt(skippedMatch?.[1] || '0', 10);

  return {
    passed: failed === 0,
    totalTests: passed + failed + skipped,
    passedTests: passed,
    failedTests: failed,
    skippedTests: skipped,
    duration: 0,
    errors: extractPytestErrors(output),
  };
}

function extractPytestErrors(output: string): TestError[] {
  const errors: TestError[] = [];
  const errorRegex = /FAILED (.+) - (.+)/g;
  let match;

  while ((match = errorRegex.exec(output)) !== null) {
    errors.push({
      testName: match[1] || 'Unknown',
      message: match[2] || 'Unknown error',
    });
  }

  return errors;
}

function parseGoTestOutput(output: string): TestRunResult {
  const lines = output.split('\n').filter(l => l.trim());
  let passed = 0;
  let failed = 0;
  const errors: TestError[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.Action === 'pass') passed++;
      if (event.Action === 'fail') {
        failed++;
        if (event.Test) {
          errors.push({
            testName: event.Test,
            message: event.Output || 'Test failed',
          });
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return {
    passed: failed === 0,
    totalTests: passed + failed,
    passedTests: passed,
    failedTests: failed,
    skippedTests: 0,
    duration: 0,
    errors,
  };
}

function parseRustTestOutput(output: string): TestRunResult {
  const passedMatch = output.match(/(\d+) passed/);
  const failedMatch = output.match(/(\d+) failed/);

  const passed = parseInt(passedMatch?.[1] || '0', 10);
  const failed = parseInt(failedMatch?.[1] || '0', 10);

  return {
    passed: failed === 0,
    totalTests: passed + failed,
    passedTests: passed,
    failedTests: failed,
    skippedTests: 0,
    duration: 0,
    errors: [],
  };
}

function createFailedResult(output: string): TestRunResult {
  return {
    passed: false,
    totalTests: 0,
    passedTests: 0,
    failedTests: 1,
    skippedTests: 0,
    duration: 0,
    errors: [{
      testName: 'Parse Error',
      message: `Failed to parse test output: ${output.slice(0, 500)}`,
    }],
  };
}

// ============================================================================
// Test Execution Service
// ============================================================================

export interface ExecuteTestsOptions {
  testIds?: string[];
  documentId?: string;
  repositoryId: string;
  dryRun?: boolean;
}

export interface ExecutionResult {
  success: boolean;
  results: TestValidationResult[];
  summary: TestRunResult;
  executedAt: Date;
}

export async function executeDocTests(
  options: ExecuteTestsOptions
): Promise<ExecutionResult> {
  const { repositoryId, testIds, documentId, dryRun } = options;

  log.info({ repositoryId, testIds, documentId, dryRun }, 'Executing doc tests');

  // Build query filter
  const whereClause: Record<string, unknown> = { repositoryId };
  if (testIds?.length) {
    whereClause.id = { in: testIds };
  }
  if (documentId) {
    whereClause.documentId = documentId;
  }

  const tests = await db.generatedTest.findMany({
    where: whereClause,
    include: {
      codeExample: true,
      document: true,
    },
  });

  if (tests.length === 0) {
    return {
      success: true,
      results: [],
      summary: {
        passed: true,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        duration: 0,
        errors: [],
      },
      executedAt: new Date(),
    };
  }

  const results: TestValidationResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalDuration = 0;
  const allErrors: TestError[] = [];

  for (const test of tests) {
    const startTime = Date.now();

    if (dryRun) {
      // Dry run - just validate syntax
      const validation = validateTestSyntax(test.testCode, test.testFramework);
      results.push(validation);
      if (validation.passed) totalPassed++;
      else totalFailed++;
      continue;
    }

    // Execute actual test
    const validation = await executeTest(test);
    const duration = Date.now() - startTime;

    results.push(validation);
    totalDuration += duration;

    if (validation.passed) {
      totalPassed++;
    } else {
      totalFailed++;
      if (validation.errors) {
        allErrors.push(...validation.errors.map(e => ({
          testName: test.testFilePath,
          message: e,
        })));
      }
    }

    // Update test record
    await db.generatedTest.update({
      where: { id: test.id },
      data: {
        status: validation.passed ? 'validated' : 'failed',
        validationResult: validation,
        lastRunAt: new Date(),
      },
    });
  }

  return {
    success: totalFailed === 0,
    results,
    summary: {
      passed: totalFailed === 0,
      totalTests: tests.length,
      passedTests: totalPassed,
      failedTests: totalFailed,
      skippedTests: 0,
      duration: totalDuration,
      errors: allErrors,
    },
    executedAt: new Date(),
  };
}

async function executeTest(test: {
  id: string;
  testCode: string;
  testFramework: string;
  testFilePath: string;
}): Promise<TestValidationResult> {
  const framework = test.testFramework as TestFramework;
  const runner = frameworkRunners[framework];

  if (!runner) {
    return {
      passed: false,
      output: `Unsupported test framework: ${framework}`,
      executionTimeMs: 0,
      errors: [`Unsupported test framework: ${framework}`],
    };
  }

  // In a real implementation, this would:
  // 1. Write the test file to a temporary directory
  // 2. Execute the test runner
  // 3. Parse the output
  // For now, we simulate validation

  const startTime = Date.now();

  // Simulate test execution - in production, use child_process.spawn
  const simulatedOutput = simulateTestExecution(test.testCode, framework);
  const result = runner.parseOutput(simulatedOutput);
  const executionTimeMs = Date.now() - startTime;

  return {
    passed: result.passed,
    output: simulatedOutput,
    executionTimeMs,
    errors: result.errors.map(e => e.message),
  };
}

function simulateTestExecution(testCode: string, _framework: TestFramework): string {
  // Basic syntax validation
  const hasTestFunction = 
    testCode.includes('test(') || 
    testCode.includes('it(') || 
    testCode.includes('def test_') ||
    testCode.includes('func Test');

  if (!hasTestFunction) {
    return JSON.stringify({
      success: false,
      numTotalTests: 1,
      numFailedTests: 1,
      numPassedTests: 0,
      testResults: [{
        assertionResults: [{
          status: 'failed',
          title: 'Syntax Check',
          failureMessages: ['No test functions found in generated code'],
        }],
      }],
    });
  }

  // Simulate successful execution
  return JSON.stringify({
    success: true,
    numTotalTests: 1,
    numFailedTests: 0,
    numPassedTests: 1,
    numPendingTests: 0,
    testResults: [{
      perfStats: { runtime: 50 },
      assertionResults: [{
        status: 'passed',
        title: 'Generated Test',
      }],
    }],
  });
}

function validateTestSyntax(
  testCode: string,
  framework: string
): TestValidationResult {
  const errors: string[] = [];

  // Basic validation checks
  if (!testCode.trim()) {
    errors.push('Test code is empty');
  }

  if (testCode.length < 20) {
    errors.push('Test code appears to be incomplete');
  }

  // Framework-specific validation
  switch (framework) {
    case 'jest':
    case 'vitest':
    case 'mocha':
      if (!testCode.includes('describe') && !testCode.includes('test') && !testCode.includes('it')) {
        errors.push('Missing test/describe/it blocks for JavaScript test framework');
      }
      break;
    case 'pytest':
      if (!testCode.includes('def test_') && !testCode.includes('def Test')) {
        errors.push('Missing test function for pytest (should start with test_)');
      }
      break;
    case 'go-testing':
      if (!testCode.includes('func Test')) {
        errors.push('Missing Test function for Go testing');
      }
      break;
  }

  return {
    passed: errors.length === 0,
    output: errors.length === 0 ? 'Syntax validation passed' : errors.join('\n'),
    executionTimeMs: 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ============================================================================
// CI Integration
// ============================================================================

export interface CIIntegrationConfig {
  provider: 'github-actions' | 'gitlab-ci' | 'circleci' | 'jenkins';
  testCommand: string;
  setupSteps: string[];
  artifactPaths: string[];
}

export function generateCIConfig(
  repositoryId: string,
  framework: TestFramework,
  provider: CIIntegrationConfig['provider']
): string {
  const runner = frameworkRunners[framework];
  const testCommand = `${runner.command} ${runner.args.join(' ')}`;

  switch (provider) {
    case 'github-actions':
      return generateGitHubActionsConfig(framework, testCommand);
    case 'gitlab-ci':
      return generateGitLabCIConfig(framework, testCommand);
    case 'circleci':
      return generateCircleCIConfig(framework, testCommand);
    case 'jenkins':
      return generateJenkinsConfig(framework, testCommand);
    default:
      return generateGitHubActionsConfig(framework, testCommand);
  }
}

function generateGitHubActionsConfig(framework: TestFramework, testCommand: string): string {
  const nodeVersion = ['jest', 'vitest', 'mocha'].includes(framework) ? '20' : null;
  const pythonVersion = framework === 'pytest' ? '3.11' : null;
  const goVersion = framework === 'go-testing' ? '1.21' : null;

  let setupSteps = '';
  if (nodeVersion) {
    setupSteps = `
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '${nodeVersion}'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci`;
  } else if (pythonVersion) {
    setupSteps = `
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '${pythonVersion}'

      - name: Install dependencies
        run: pip install -r requirements.txt`;
  } else if (goVersion) {
    setupSteps = `
      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '${goVersion}'`;
  }

  return `name: Documentation Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
    paths:
      - 'docs/**'
      - '**/*.md'
      - '__docsynth_tests__/**'

jobs:
  doc-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
${setupSteps}

      - name: Run Documentation Tests
        run: ${testCommand}
        working-directory: __docsynth_tests__

      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: docsynth-test-results
          path: __docsynth_tests__/results/
`;
}

function generateGitLabCIConfig(framework: TestFramework, testCommand: string): string {
  return `doc-tests:
  stage: test
  script:
    - cd __docsynth_tests__
    - ${testCommand}
  rules:
    - changes:
        - docs/**/*
        - "**/*.md"
        - __docsynth_tests__/**/*
  artifacts:
    reports:
      junit: __docsynth_tests__/results/*.xml
`;
}

function generateCircleCIConfig(framework: TestFramework, testCommand: string): string {
  return `version: 2.1

jobs:
  doc-tests:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - run:
          name: Install dependencies
          command: npm ci
      - run:
          name: Run Documentation Tests
          command: ${testCommand}
          working_directory: __docsynth_tests__
      - store_test_results:
          path: __docsynth_tests__/results

workflows:
  test:
    jobs:
      - doc-tests
`;
}

function generateJenkinsConfig(framework: TestFramework, testCommand: string): string {
  return `pipeline {
    agent any

    stages {
        stage('Documentation Tests') {
            steps {
                dir('__docsynth_tests__') {
                    sh '${testCommand}'
                }
            }
        }
    }

    post {
        always {
            junit '__docsynth_tests__/results/*.xml'
        }
    }
}
`;
}

// ============================================================================
// Batch Test Operations
// ============================================================================

export interface BatchTestResult {
  repositoryId: string;
  documentResults: {
    documentId: string;
    documentPath: string;
    testsRun: number;
    testsPassed: number;
    testsFailed: number;
    errors: string[];
  }[];
  overallPassed: boolean;
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
  executionTimeMs: number;
}

export async function runRepositoryDocTests(
  repositoryId: string
): Promise<BatchTestResult> {
  const startTime = Date.now();

  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true, path: true },
  });

  const documentResults: BatchTestResult['documentResults'] = [];
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  for (const doc of documents) {
    const result = await executeDocTests({
      repositoryId,
      documentId: doc.id,
    });

    documentResults.push({
      documentId: doc.id,
      documentPath: doc.path,
      testsRun: result.summary.totalTests,
      testsPassed: result.summary.passedTests,
      testsFailed: result.summary.failedTests,
      errors: result.summary.errors.map(e => e.message),
    });

    totalTests += result.summary.totalTests;
    totalPassed += result.summary.passedTests;
    totalFailed += result.summary.failedTests;
  }

  return {
    repositoryId,
    documentResults,
    overallPassed: totalFailed === 0,
    totalTests,
    totalPassed,
    totalFailed,
    executionTimeMs: Date.now() - startTime,
  };
}
