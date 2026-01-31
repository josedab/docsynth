import { createWorker, QUEUE_NAMES, type DocTestGenerationJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';
import type { TestFramework } from '@docsynth/types';

const log = createLogger('doc-test-worker');

// Type assertion for new Prisma models (requires db:generate)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// Code example extraction regex patterns
const CODE_BLOCK_REGEX = /```(\w+)?\n([\s\S]*?)```/g;

interface ExtractedExample {
  language: string;
  code: string;
  lineStart: number;
  lineEnd: number;
  context: string;
  source: string;
}

function extractCodeExamplesFromContent(content: string): ExtractedExample[] {
  const examples: ExtractedExample[] = [];
  let match;
  let lineOffset = 0;
  
  while ((match = CODE_BLOCK_REGEX.exec(content)) !== null) {
    const beforeMatch = content.slice(0, match.index);
    lineOffset = beforeMatch.split('\n').length;
    const codeLines = (match[2] ?? '').split('\n').length;
    
    // Get context (text before code block)
    const contextStart = Math.max(0, beforeMatch.lastIndexOf('\n\n'));
    const context = beforeMatch.slice(contextStart).trim();
    
    examples.push({
      language: match[1] ?? 'text',
      code: match[2] ?? '',
      lineStart: lineOffset,
      lineEnd: lineOffset + codeLines,
      context,
      source: 'documentation',
    });
  }
  
  return examples;
}

interface ExtractedAssertion {
  description: string;
  expectedBehavior: string;
  inputExample?: string;
  outputExample?: string;
  codeExampleId: string;
}

async function extractAssertionsFromExample(example: { id: string; code: string; language: string; context: string }): Promise<ExtractedAssertion[]> {
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Analyze this ${example.language} code example and extract testable assertions.

Context: ${example.context}

Code:
\`\`\`${example.language}
${example.code}
\`\`\`

Return a JSON array of assertions, each with:
- description: What is being tested
- expectedBehavior: The expected outcome
- inputExample: Sample input (if applicable)
- outputExample: Expected output (if applicable)

Return ONLY valid JSON array, no other text.`,
      },
    ],
  });

  try {
    const responseText = message.content[0]?.type === 'text' ? message.content[0].text : '[]';
    const assertions = JSON.parse(responseText) as Array<{
      description: string;
      expectedBehavior: string;
      inputExample?: string;
      outputExample?: string;
    }>;
    
    return assertions.map((a) => ({
      ...a,
      codeExampleId: example.id,
    }));
  } catch {
    log.warn({ exampleId: example.id }, 'Failed to parse assertions');
    return [];
  }
}

function getTestFrameworkTemplate(framework: TestFramework): { setup: string; testWrapper: string; assertPattern: string } {
  switch (framework) {
    case 'jest':
      return {
        setup: "import { describe, it, expect } from '@jest/globals';",
        testWrapper: 'describe("{{suiteName}}", () => { it("{{testName}}", () => { {{testBody}} }); });',
        assertPattern: 'expect({{actual}}).{{matcher}}({{expected}});',
      };
    case 'vitest':
      return {
        setup: "import { describe, it, expect } from 'vitest';",
        testWrapper: 'describe("{{suiteName}}", () => { it("{{testName}}", () => { {{testBody}} }); });',
        assertPattern: 'expect({{actual}}).{{matcher}}({{expected}});',
      };
    case 'pytest':
      return {
        setup: 'import pytest',
        testWrapper: 'def test_{{testName}}():\n    {{testBody}}',
        assertPattern: 'assert {{actual}} {{operator}} {{expected}}',
      };
    case 'go-testing':
      return {
        setup: 'import "testing"',
        testWrapper: 'func Test{{testName}}(t *testing.T) { {{testBody}} }',
        assertPattern: 'if {{actual}} != {{expected}} { t.Errorf("got %v, want %v", {{actual}}, {{expected}}) }',
      };
    case 'mocha':
      return {
        setup: "import { describe, it } from 'mocha';\nimport { expect } from 'chai';",
        testWrapper: 'describe("{{suiteName}}", () => { it("{{testName}}", () => { {{testBody}} }); });',
        assertPattern: 'expect({{actual}}).to.{{matcher}}({{expected}});',
      };
    default:
      return {
        setup: '',
        testWrapper: '// {{testName}}\n{{testBody}}',
        assertPattern: '// Assert: {{actual}} should equal {{expected}}',
      };
  }
}

async function generateTestCode(
  assertion: { description: string; expectedBehavior: string; inputExample?: string; outputExample?: string },
  example: { code: string; language: string },
  framework: TestFramework
): Promise<string> {
  const template = getTestFrameworkTemplate(framework);
  
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Generate a test for this assertion using ${framework}:

Assertion: ${assertion.description}
Expected: ${assertion.expectedBehavior}
Input: ${assertion.inputExample ?? 'N/A'}
Output: ${assertion.outputExample ?? 'N/A'}

Code being tested:
\`\`\`${example.language}
${example.code}
\`\`\`

Test framework setup: ${template.setup}
Test wrapper pattern: ${template.testWrapper}
Assert pattern: ${template.assertPattern}

Return ONLY the test code, no explanations.`,
      },
    ],
  });

  return message.content[0]?.type === 'text' ? message.content[0].text : '';
}

async function detectTestFramework(repositoryId: string): Promise<TestFramework> {
  const repo = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { metadata: true },
  });

  const metadata = repo?.metadata as Record<string, unknown> | null;
  if (metadata?.testFramework) {
    return metadata.testFramework as TestFramework;
  }

  // Default based on language in metadata
  const language = (metadata?.primaryLanguage as string)?.toLowerCase();
  switch (language) {
    case 'python':
      return 'pytest';
    case 'go':
      return 'go-testing';
    case 'typescript':
    case 'javascript':
      return 'vitest';
    default:
      return 'vitest';
  }
}

export function startDocTestWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_TEST_GENERATION,
    async (job) => {
      const data = job.data as DocTestGenerationJobData;

      log.info({ jobId: job.id, documentId: data.documentId, repositoryId: data.repositoryId }, 'Processing doc-to-test generation');

      await job.updateProgress(5);

      // Detect test framework
      const framework = await detectTestFramework(data.repositoryId);
      log.info({ framework }, 'Using test framework');

      // Get document content
      const document = await prisma.document.findUnique({
        where: { id: data.documentId },
      });

      if (!document) {
        throw new Error(`Document not found: ${data.documentId}`);
      }

      await job.updateProgress(10);

      // Extract code examples
      const rawExamples = extractCodeExamplesFromContent(document.content);
      log.info({ documentId: data.documentId, examplesFound: rawExamples.length }, 'Extracted code examples');

      await job.updateProgress(20);

      // Store code examples
      const storedExamples = [];
      for (const example of rawExamples) {
        const stored = await db.codeExample.create({
          data: {
            documentId: data.documentId,
            language: example.language,
            code: example.code,
            lineNumber: example.lineStart,
            context: example.context,
          },
        });
        storedExamples.push(stored);
      }

      await job.updateProgress(30);

      // Extract assertions from each example
      let totalAssertions = 0;
      let processed = 0;
      for (const example of storedExamples) {
        const assertions = await extractAssertionsFromExample(example);
        
        for (const assertion of assertions) {
          await db.extractedAssertion.create({
            data: {
              codeExampleId: example.id,
              description: assertion.description,
              expectedBehavior: assertion.expectedBehavior,
              inputExample: assertion.inputExample,
              outputExample: assertion.outputExample,
            },
          });
          totalAssertions++;
        }

        processed++;
        await job.updateProgress(30 + (processed / storedExamples.length) * 30);
      }

      log.info({ documentId: data.documentId, totalAssertions }, 'Extracted assertions');

      await job.updateProgress(60);

      // Generate tests for each example with assertions
      let testsGenerated = 0;
      processed = 0;
      for (const example of storedExamples) {
        const assertions = await db.extractedAssertion.findMany({
          where: { codeExampleId: example.id },
        });

        if (assertions.length === 0) {
          processed++;
          continue;
        }

        // Generate combined test for all assertions
        let testCode = '';
        for (const assertion of assertions) {
          const code = await generateTestCode(assertion, example, framework);
          testCode += code + '\n\n';
        }

        if (testCode.trim()) {
          await db.generatedTest.create({
            data: {
              codeExampleId: example.id,
              framework,
              testCode: testCode.trim(),
              language: example.language,
              status: 'pending',
            },
          });
          testsGenerated++;
        }

        processed++;
        await job.updateProgress(60 + (processed / storedExamples.length) * 35);
      }

      log.info({ documentId: data.documentId, testsGenerated }, 'Generated tests');

      await job.updateProgress(100);

      log.info({ jobId: job.id, examplesProcessed: storedExamples.length, testsGenerated }, 'Doc-to-test generation complete');
    },
    {
      concurrency: 2,
      limiter: {
        max: 5,
        duration: 60000,
      },
    }
  );

  log.info('Doc-test generation worker started');

  return worker;
}
