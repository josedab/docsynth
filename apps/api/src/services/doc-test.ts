import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';
import type {
  CodeExample,
  ExtractedAssertion,
  GeneratedTest,
  TestFramework,
  TestValidationResult,
  DocTestSuite,
} from '@docsynth/types';

const log = createLogger('doc-test-service');

// Type assertion for new Prisma models (requires db:generate to be run)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Code Example Extraction
// ============================================================================

interface ExtractedCodeBlock {
  language: string;
  code: string;
  lineNumber: number;
  description?: string;
  expectedOutput?: string;
}

export async function extractCodeExamples(documentId: string): Promise<CodeExample[]> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const codeBlocks = parseCodeBlocks(document.content);
  const examples: CodeExample[] = [];

  for (const block of codeBlocks) {
    // Only process testable code (skip markdown, config, etc.)
    if (!isTestableLanguage(block.language)) {
      continue;
    }

    // Get surrounding context
    const context = extractContext(document.content, block.lineNumber);

    const example = await db.codeExample.create({
      data: {
        documentId,
        language: block.language,
        code: block.code,
        description: block.description,
        expectedOutput: block.expectedOutput,
        lineNumber: block.lineNumber,
        context,
      },
    });

    examples.push({
      id: example.id,
      documentId: example.documentId,
      language: example.language,
      code: example.code,
      description: example.description ?? undefined,
      expectedOutput: example.expectedOutput ?? undefined,
      lineNumber: example.lineNumber,
      context: example.context,
    });
  }

  log.info({ documentId, examplesExtracted: examples.length }, 'Extracted code examples');
  return examples;
}

function parseCodeBlocks(content: string): ExtractedCodeBlock[] {
  const blocks: ExtractedCodeBlock[] = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  const lines = content.split('\n');

  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const beforeMatch = content.slice(0, match.index);
    const lineNumber = beforeMatch.split('\n').length;
    
    const language = match[1] ?? 'text';
    const code = (match[2] ?? '').trim();

    // Look for description in preceding lines
    const description = extractPrecedingDescription(lines, lineNumber - 1);
    
    // Look for expected output pattern
    const expectedOutput = extractExpectedOutput(code, content.slice(match.index + match[0].length));

    blocks.push({
      language,
      code,
      lineNumber,
      description,
      expectedOutput,
    });
  }

  return blocks;
}

function extractPrecedingDescription(lines: string[], lineIndex: number): string | undefined {
  const descLines: string[] = [];
  
  for (let i = lineIndex - 1; i >= 0 && i >= lineIndex - 5; i--) {
    const line = lines[i]?.trim();
    if (!line || line.startsWith('#') || line.startsWith('```')) {
      break;
    }
    descLines.unshift(line);
  }

  return descLines.length > 0 ? descLines.join(' ') : undefined;
}

function extractExpectedOutput(code: string, afterContent: string): string | undefined {
  // Check for inline comments with output
  const outputMatch = code.match(/\/\/\s*(?:Output|Returns|Result):\s*(.+)/i);
  if (outputMatch?.[1]) {
    return outputMatch[1].trim();
  }

  // Check for output block after code
  const afterLines = afterContent.split('\n').slice(0, 10);
  for (const line of afterLines) {
    if (line.includes('Output:') || line.includes('Returns:') || line.includes('Result:')) {
      const afterOutputMatch = line.match(/(?:Output|Returns|Result):\s*(.+)/i);
      if (afterOutputMatch?.[1]) {
        return afterOutputMatch[1].trim();
      }
    }
  }

  return undefined;
}

function extractContext(content: string, lineNumber: number): string {
  const lines = content.split('\n');
  const start = Math.max(0, lineNumber - 10);
  const end = Math.min(lines.length, lineNumber + 20);
  return lines.slice(start, end).join('\n');
}

function isTestableLanguage(language: string): boolean {
  const testableLanguages = [
    'javascript', 'js',
    'typescript', 'ts',
    'python', 'py',
    'go', 'golang',
    'rust', 'rs',
    'java',
    'ruby', 'rb',
    'php',
  ];
  return testableLanguages.includes(language.toLowerCase());
}

// ============================================================================
// Assertion Extraction
// ============================================================================

export async function extractAssertions(codeExampleId: string): Promise<ExtractedAssertion[]> {
  const example = await db.codeExample.findUnique({
    where: { id: codeExampleId },
  });

  if (!example) {
    throw new Error(`Code example not found: ${codeExampleId}`);
  }

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `Analyze this code example and extract testable assertions. Return JSON array.

Code (${example.language}):
\`\`\`${example.language}
${example.code}
\`\`\`

${example.description ? `Description: ${example.description}` : ''}
${example.expectedOutput ? `Expected Output: ${example.expectedOutput}` : ''}

Context:
${example.context}

Extract assertions in this JSON format:
[
  {
    "assertionType": "return-value" | "throws" | "side-effect" | "type-check",
    "inputDescription": "description of input/setup",
    "expectedBehavior": "what should happen",
    "confidence": 0.0-1.0
  }
]

Only return the JSON array, no other text.`,
      },
    ],
  });

  const content = response.content[0]?.type === 'text' ? response.content[0].text : '[]';
  
  let assertionsData: Array<{
    assertionType: string;
    inputDescription: string;
    expectedBehavior: string;
    confidence: number;
  }>;

  try {
    assertionsData = JSON.parse(content);
  } catch {
    log.warn({ codeExampleId }, 'Failed to parse assertions JSON');
    assertionsData = [];
  }

  const assertions: ExtractedAssertion[] = [];

  for (const data of assertionsData) {
    const assertion = await db.extractedAssertion.create({
      data: {
        codeExampleId,
        assertionType: data.assertionType,
        inputDescription: data.inputDescription,
        expectedBehavior: data.expectedBehavior,
        confidence: data.confidence,
      },
    });

    assertions.push({
      id: assertion.id,
      codeExampleId: assertion.codeExampleId,
      assertionType: assertion.assertionType as ExtractedAssertion['assertionType'],
      inputDescription: assertion.inputDescription,
      expectedBehavior: assertion.expectedBehavior,
      confidence: assertion.confidence,
    });
  }

  log.info({ codeExampleId, assertionsExtracted: assertions.length }, 'Extracted assertions');
  return assertions;
}

// ============================================================================
// Test Generation
// ============================================================================

export async function generateTest(
  codeExampleId: string,
  framework: TestFramework
): Promise<GeneratedTest> {
  const example = await db.codeExample.findUnique({
    where: { id: codeExampleId },
    include: {
      document: true,
      assertions: true,
    },
  });

  if (!example) {
    throw new Error(`Code example not found: ${codeExampleId}`);
  }

  const frameworkConfig = getFrameworkConfig(framework, example.language);

  const assertionsText = (example.assertions as Array<{assertionType: string; inputDescription: string; expectedBehavior: string}>)
    .map((a: {assertionType: string; inputDescription: string; expectedBehavior: string}) => `- ${a.assertionType}: ${a.inputDescription} → ${a.expectedBehavior}`)
    .join('\n');

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `Generate a test for this code example using ${framework}.

Code (${example.language}):
\`\`\`${example.language}
${example.code}
\`\`\`

${example.description ? `Description: ${example.description}` : ''}
${example.expectedOutput ? `Expected Output: ${example.expectedOutput}` : ''}

Assertions to test:
${assertionsText || 'Infer appropriate assertions from the code'}

Requirements:
- Use ${frameworkConfig.importStatement}
- Follow ${framework} best practices
- Include setup/teardown if needed
- Add clear test descriptions
- Handle edge cases where obvious

Return ONLY the test code, no explanations.`,
      },
    ],
  });

  const testCode = response.content[0]?.type === 'text' ? response.content[0].text : '';
  
  // Clean up any markdown code blocks from the response
  const cleanedTestCode = testCode.replace(/```\w*\n?/g, '').trim();

  const testFilePath = generateTestFilePath(
    example.document.path,
    framework,
    example.language
  );

  const test = await db.generatedTest.create({
    data: {
      documentId: example.documentId,
      repositoryId: example.document.repositoryId,
      codeExampleId,
      testFramework: framework,
      testCode: cleanedTestCode,
      testFilePath,
      status: 'generated',
    },
  });

  log.info({ testId: test.id, codeExampleId, framework }, 'Generated test');

  return {
    id: test.id,
    documentId: test.documentId,
    repositoryId: test.repositoryId,
    codeExampleId: test.codeExampleId,
    testFramework: test.testFramework as TestFramework,
    testCode: test.testCode,
    testFilePath: test.testFilePath,
    status: test.status as GeneratedTest['status'],
    createdAt: test.createdAt,
  };
}

interface FrameworkConfig {
  importStatement: string;
  extension: string;
  testSuffix: string;
}

function getFrameworkConfig(framework: TestFramework, language: string): FrameworkConfig {
  const configs: Record<TestFramework, FrameworkConfig> = {
    jest: {
      importStatement: "import { describe, it, expect } from '@jest/globals'",
      extension: language === 'typescript' ? '.test.ts' : '.test.js',
      testSuffix: '.test',
    },
    vitest: {
      importStatement: "import { describe, it, expect } from 'vitest'",
      extension: language === 'typescript' ? '.test.ts' : '.test.js',
      testSuffix: '.test',
    },
    mocha: {
      importStatement: "import { describe, it } from 'mocha'; import { expect } from 'chai'",
      extension: language === 'typescript' ? '.spec.ts' : '.spec.js',
      testSuffix: '.spec',
    },
    pytest: {
      importStatement: 'import pytest',
      extension: '_test.py',
      testSuffix: '_test',
    },
    'go-testing': {
      importStatement: 'import "testing"',
      extension: '_test.go',
      testSuffix: '_test',
    },
    'rust-test': {
      importStatement: '#[cfg(test)]',
      extension: '.rs',
      testSuffix: '_test',
    },
  };

  return configs[framework] || configs.vitest;
}

function generateTestFilePath(
  documentPath: string,
  framework: TestFramework,
  language: string
): string {
  const config = getFrameworkConfig(framework, language);
  
  // Generate test file path based on document path
  const basePath = documentPath
    .replace(/\.md$/, '')
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '');

  return `__docsynth_tests__/${basePath}${config.extension}`;
}

// ============================================================================
// Test Suite Management
// ============================================================================

export async function generateTestsForDocument(
  documentId: string,
  framework: TestFramework
): Promise<DocTestSuite> {
  // Extract code examples
  const examples = await extractCodeExamples(documentId);

  const tests: GeneratedTest[] = [];

  for (const example of examples) {
    // Extract assertions
    await extractAssertions(example.id);

    // Generate test
    const test = await generateTest(example.id, framework);
    tests.push(test);
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { repositoryId: true },
  });

  return {
    repositoryId: document?.repositoryId || '',
    documentId,
    tests,
    coverage: {
      totalExamples: examples.length,
      testedExamples: tests.length,
      passingTests: 0,
      failingTests: 0,
    },
  };
}

export async function getDocTestSuite(documentId: string): Promise<DocTestSuite | null> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { repositoryId: true },
  });

  if (!document) {
    return null;
  }

  const tests = await db.generatedTest.findMany({
    where: { documentId },
    orderBy: { createdAt: 'desc' },
  });

  const exampleCount = await db.codeExample.count({
    where: { documentId },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const typedTests = tests as any[];

  const passingTests = typedTests.filter((t: {validationResult: TestValidationResult | null}) => {
    const result = t.validationResult as TestValidationResult | null;
    return result?.passed === true;
  }).length;

  const failingTests = typedTests.filter((t: {validationResult: TestValidationResult | null}) => {
    const result = t.validationResult as TestValidationResult | null;
    return result?.passed === false;
  }).length;

  return {
    repositoryId: document.repositoryId,
    documentId,
    tests: typedTests.map((t: {id: string; documentId: string; repositoryId: string; codeExampleId: string; testFramework: string; testCode: string; testFilePath: string; status: string; validationResult: TestValidationResult | undefined; createdAt: Date}) => ({
      id: t.id,
      documentId: t.documentId,
      repositoryId: t.repositoryId,
      codeExampleId: t.codeExampleId,
      testFramework: t.testFramework as TestFramework,
      testCode: t.testCode,
      testFilePath: t.testFilePath,
      status: t.status as GeneratedTest['status'],
      validationResult: t.validationResult as TestValidationResult | undefined,
      createdAt: t.createdAt,
    })),
    coverage: {
      totalExamples: exampleCount,
      testedExamples: tests.length,
      passingTests,
      failingTests,
    },
    lastRunAt: tests[0]?.lastRunAt ?? undefined,
  };
}

export async function updateTestValidation(
  testId: string,
  result: TestValidationResult
): Promise<void> {
  await db.generatedTest.update({
    where: { id: testId },
    data: {
      status: result.passed ? 'validated' : 'failed',
      validationResult: result as object,
      lastRunAt: new Date(),
    },
  });
}

export async function detectTestFramework(repositoryId: string): Promise<TestFramework> {
  // Check for common test framework config files in repository metadata
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { metadata: true },
  });

  const metadata = repository?.metadata as Record<string, unknown> | null;
  
  // Default detection logic based on common patterns
  // In a real implementation, this would check actual files
  if (metadata?.testFramework) {
    return metadata.testFramework as TestFramework;
  }

  // Default to vitest for TypeScript/JavaScript projects
  return 'vitest';
}
