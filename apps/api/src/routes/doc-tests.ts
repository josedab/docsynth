import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import {
  extractCodeExamples,
  extractAssertions,
  generateTest,
  generateTestsForDocument,
  getDocTestSuite,
  updateTestValidation,
  detectTestFramework,
} from '../services/doc-test.js';
import type { TestFramework, TestValidationResult } from '@docsynth/types';

const app = new Hono();

// Type assertion for new Prisma models (requires db:generate)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Code Example Routes
// ============================================================================

// Extract code examples from a document
app.post('/documents/:documentId/examples/extract', requireAuth, async (c) => {
  const documentId = c.req.param('documentId');

  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    throw new NotFoundError('Document', documentId);
  }

  const examples = await extractCodeExamples(documentId);

  return c.json({
    success: true,
    data: {
      documentId,
      examplesExtracted: examples.length,
      examples,
    },
  }, 201);
});

// Get code examples for a document
app.get('/documents/:documentId/examples', requireAuth, async (c) => {
  const documentId = c.req.param('documentId');

  const examples = await db.codeExample.findMany({
    where: { documentId },
    include: {
      assertions: true,
      tests: {
        select: {
          id: true,
          testFramework: true,
          status: true,
          createdAt: true,
        },
      },
    },
    orderBy: { lineNumber: 'asc' },
  });

  return c.json({
    success: true,
    data: examples,
  });
});

// Get a specific code example
app.get('/examples/:exampleId', requireAuth, async (c) => {
  const exampleId = c.req.param('exampleId');

  const example = await db.codeExample.findUnique({
    where: { id: exampleId },
    include: {
      document: {
        select: { id: true, path: true, title: true },
      },
      assertions: true,
      tests: true,
    },
  });

  if (!example) {
    throw new NotFoundError('CodeExample', exampleId);
  }

  return c.json({
    success: true,
    data: example,
  });
});

// ============================================================================
// Assertion Routes
// ============================================================================

// Extract assertions from a code example
app.post('/examples/:exampleId/assertions/extract', requireAuth, async (c) => {
  const exampleId = c.req.param('exampleId');

  const example = await db.codeExample.findUnique({
    where: { id: exampleId },
  });

  if (!example) {
    throw new NotFoundError('CodeExample', exampleId);
  }

  const assertions = await extractAssertions(exampleId);

  return c.json({
    success: true,
    data: {
      exampleId,
      assertionsExtracted: assertions.length,
      assertions,
    },
  }, 201);
});

// Get assertions for a code example
app.get('/examples/:exampleId/assertions', requireAuth, async (c) => {
  const exampleId = c.req.param('exampleId');

  const assertions = await db.extractedAssertion.findMany({
    where: { codeExampleId: exampleId },
    orderBy: { confidence: 'desc' },
  });

  return c.json({
    success: true,
    data: assertions,
  });
});

// ============================================================================
// Test Generation Routes
// ============================================================================

// Generate test for a specific code example
app.post('/examples/:exampleId/tests/generate', requireAuth, async (c) => {
  const exampleId = c.req.param('exampleId');
  const body = await c.req.json<{ framework?: TestFramework }>();

  const example = await db.codeExample.findUnique({
    where: { id: exampleId },
    include: {
      document: {
        select: { repositoryId: true },
      },
    },
  });

  if (!example) {
    throw new NotFoundError('CodeExample', exampleId);
  }

  // Detect or use provided framework
  const framework = body.framework ?? await detectTestFramework(example.document.repositoryId);

  const test = await generateTest(exampleId, framework);

  return c.json({
    success: true,
    data: test,
  }, 201);
});

// Generate tests for all examples in a document
app.post('/documents/:documentId/tests/generate', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ framework?: TestFramework; async?: boolean }>()
    .catch(() => ({ framework: undefined, async: undefined } as { framework?: TestFramework; async?: boolean }));

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      repository: {
        select: { id: true, organizationId: true },
      },
    },
  });

  if (!document) {
    throw new NotFoundError('Document', documentId);
  }

  if (document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  // If async, queue the job
  if (body.async) {
    await addJob(QUEUE_NAMES.DOC_TEST_GENERATION, {
      repositoryId: document.repository.id,
      documentId,
    });

    return c.json({
      success: true,
      data: {
        documentId,
        status: 'queued',
        message: 'Test generation job has been queued',
      },
    }, 202);
  }

  const framework = body.framework ?? await detectTestFramework(document.repository.id);
  const suite = await generateTestsForDocument(documentId, framework);

  return c.json({
    success: true,
    data: suite,
  }, 201);
});

// Get test suite for a document
app.get('/documents/:documentId/tests', requireAuth, async (c) => {
  const documentId = c.req.param('documentId');

  const suite = await getDocTestSuite(documentId);

  if (!suite) {
    throw new NotFoundError('Document', documentId);
  }

  return c.json({
    success: true,
    data: suite,
  });
});

// Get a specific generated test
app.get('/tests/:testId', requireAuth, async (c) => {
  const testId = c.req.param('testId');

  const test = await db.generatedTest.findUnique({
    where: { id: testId },
    include: {
      document: {
        select: { id: true, path: true, title: true },
      },
      codeExample: {
        select: { id: true, code: true, language: true, lineNumber: true },
      },
    },
  });

  if (!test) {
    throw new NotFoundError('GeneratedTest', testId);
  }

  return c.json({
    success: true,
    data: test,
  });
});

// Update test validation result
app.post('/tests/:testId/validate', requireAuth, async (c) => {
  const testId = c.req.param('testId');
  const body = await c.req.json<TestValidationResult>();

  if (typeof body.passed !== 'boolean') {
    throw new ValidationError('passed (boolean) is required');
  }

  const test = await db.generatedTest.findUnique({
    where: { id: testId },
  });

  if (!test) {
    throw new NotFoundError('GeneratedTest', testId);
  }

  await updateTestValidation(testId, body);

  const updated = await db.generatedTest.findUnique({
    where: { id: testId },
  });

  return c.json({
    success: true,
    data: updated,
  });
});

// Delete a generated test
app.delete('/tests/:testId', requireAuth, async (c) => {
  const testId = c.req.param('testId');

  const test = await db.generatedTest.findUnique({
    where: { id: testId },
  });

  if (!test) {
    throw new NotFoundError('GeneratedTest', testId);
  }

  await db.generatedTest.delete({
    where: { id: testId },
  });

  return c.json({
    success: true,
    data: { deleted: true },
  });
});

// Regenerate a test with different framework
app.post('/tests/:testId/regenerate', requireAuth, async (c) => {
  const testId = c.req.param('testId');
  const body = await c.req.json<{ framework?: TestFramework }>();

  const existingTest = await db.generatedTest.findUnique({
    where: { id: testId },
    include: {
      codeExample: {
        include: {
          document: {
            select: { repositoryId: true },
          },
        },
      },
    },
  });

  if (!existingTest) {
    throw new NotFoundError('GeneratedTest', testId);
  }

  const framework = body.framework ?? 
    existingTest.testFramework as TestFramework ?? 
    await detectTestFramework(existingTest.codeExample.document.repositoryId);

  // Delete the old test
  await db.generatedTest.delete({
    where: { id: testId },
  });

  // Generate a new one
  const newTest = await generateTest(existingTest.codeExampleId, framework);

  return c.json({
    success: true,
    data: newTest,
  }, 201);
});

// ============================================================================
// Repository-level Routes
// ============================================================================

// Get test coverage summary for a repository
app.get('/repositories/:repositoryId/coverage', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const [totalExamples, totalTests, passingTests, failingTests] = await Promise.all([
    db.codeExample.count({
      where: { document: { repositoryId } },
    }),
    db.generatedTest.count({
      where: { repositoryId },
    }),
    db.generatedTest.count({
      where: { repositoryId, status: 'validated' },
    }),
    db.generatedTest.count({
      where: { repositoryId, status: 'failed' },
    }),
  ]);

  const coverage = totalExamples > 0 ? (totalTests / totalExamples) * 100 : 0;
  const passRate = totalTests > 0 ? (passingTests / totalTests) * 100 : 0;

  return c.json({
    success: true,
    data: {
      repositoryId,
      totalExamples,
      totalTests,
      passingTests,
      failingTests,
      pendingTests: totalTests - passingTests - failingTests,
      coveragePercent: Math.round(coverage * 100) / 100,
      passRatePercent: Math.round(passRate * 100) / 100,
    },
  });
});

// Generate tests for all documents in a repository
app.post('/repositories/:repositoryId/tests/generate', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  await c.req.json<{ framework?: TestFramework }>().catch(() => ({}));

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Queue the job for async processing
  await addJob(QUEUE_NAMES.DOC_TEST_GENERATION, {
    repositoryId,
    regenerate: true,
  });

  return c.json({
    success: true,
    data: {
      repositoryId,
      status: 'queued',
      message: 'Test generation job for entire repository has been queued',
    },
  }, 202);
});

// ============================================================================
// Test Execution Routes (Feature 1: Smart Documentation Testing)
// ============================================================================

import {
  executeDocTests,
  runRepositoryDocTests,
  generateCIConfig,
  type CIIntegrationConfig,
} from '../services/test-runner.js';

// Execute tests for a document
app.post('/documents/:documentId/tests/run', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ dryRun?: boolean }>().catch(() => ({ dryRun: false }));

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { repository: { select: { id: true, organizationId: true } } },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  const result = await executeDocTests({
    repositoryId: document.repository.id,
    documentId,
    dryRun: body.dryRun ?? false,
  });

  return c.json({
    success: true,
    data: result,
  });
});

// Execute all tests for a repository
app.post('/repositories/:repositoryId/tests/run', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const result = await runRepositoryDocTests(repositoryId);

  return c.json({
    success: true,
    data: result,
  });
});

// Execute specific tests by ID
app.post('/tests/run', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ testIds: string[]; dryRun?: boolean }>();

  if (!body.testIds?.length) {
    throw new ValidationError('testIds array is required');
  }

  // Verify test ownership
  const tests = await db.generatedTest.findMany({
    where: { id: { in: body.testIds } },
    include: { repository: { select: { organizationId: true, id: true } } },
  });

  if (tests.length === 0 || tests.some((t: { repository: { organizationId: string } }) => t.repository.organizationId !== orgId)) {
    throw new NotFoundError('Tests', body.testIds.join(', '));
  }

  const repositoryId = tests[0].repository.id;
  const result = await executeDocTests({
    repositoryId,
    testIds: body.testIds,
    dryRun: body.dryRun,
  });

  return c.json({
    success: true,
    data: result,
  });
});

// ============================================================================
// CI Integration Routes
// ============================================================================

// Generate CI configuration for doc tests
app.get('/repositories/:repositoryId/ci-config', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const provider = c.req.query('provider') as CIIntegrationConfig['provider'] || 'github-actions';
  const framework = c.req.query('framework') as TestFramework || 'vitest';

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const config = generateCIConfig(repositoryId, framework, provider);

  return c.json({
    success: true,
    data: {
      provider,
      framework,
      filename: getCIFilename(provider),
      content: config,
    },
  });
});

function getCIFilename(provider: CIIntegrationConfig['provider']): string {
  switch (provider) {
    case 'github-actions':
      return '.github/workflows/docsynth-tests.yml';
    case 'gitlab-ci':
      return '.gitlab-ci.yml';
    case 'circleci':
      return '.circleci/config.yml';
    case 'jenkins':
      return 'Jenkinsfile';
    default:
      return 'ci-config.yml';
  }
}

// Get test run history for a repository
app.get('/repositories/:repositoryId/tests/history', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const limit = parseInt(c.req.query('limit') || '20', 10);

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const tests = await db.generatedTest.findMany({
    where: { 
      repositoryId,
      lastRunAt: { not: null },
    },
    orderBy: { lastRunAt: 'desc' },
    take: limit,
    select: {
      id: true,
      testFilePath: true,
      testFramework: true,
      status: true,
      validationResult: true,
      lastRunAt: true,
      document: {
        select: { path: true, title: true },
      },
    },
  });

  // Calculate aggregate stats
  const stats = {
    totalRuns: tests.length,
    passedRuns: tests.filter((t: { status: string }) => t.status === 'validated').length,
    failedRuns: tests.filter((t: { status: string }) => t.status === 'failed').length,
  };

  return c.json({
    success: true,
    data: {
      tests,
      stats,
    },
  });
});

export { app as docTestRoutes };
