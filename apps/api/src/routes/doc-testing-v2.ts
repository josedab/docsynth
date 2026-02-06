import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import {
  extractCodeExamples,
  runCodeExample,
  runDocTestSuite,
  getDocTestConfig,
  updateDocTestConfig,
  getTestHistory,
  generateCheckRunSummary,
  getTestCoverageStats,
  type CodeExample,
  type DocTestSuite,
  type DocTestConfig,
} from '../services/doc-testing-execution.service.js';

const app = new Hono();

// ============================================================================
// Test Suite Execution
// ============================================================================

// Run doc test suite
app.post('/run', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    documentId?: string;
  }>().catch(() => ({} as { repositoryId: string; documentId?: string }));

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  // Verify repository access
  const repo = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!repo) throw new NotFoundError('Repository', body.repositoryId);

  // Verify document access if specified
  if (body.documentId) {
    const doc = await prisma.document.findFirst({
      where: { id: body.documentId, repositoryId: body.repositoryId },
      select: { id: true },
    });
    if (!doc) throw new NotFoundError('Document', body.documentId);
  }

  // Queue the test run as a background job
  const job = await addJob(QUEUE_NAMES.DOC_TEST_GENERATION, {
    repositoryId: body.repositoryId,
    documentId: body.documentId,
    regenerate: true,
  });

  // Also run synchronously if it's a single document (for faster feedback)
  if (body.documentId) {
    try {
      const suite = await runDocTestSuite(body.repositoryId, body.documentId);
      return c.json({
        success: true,
        data: {
          jobId: job.id,
          suite,
        },
      });
    } catch (error) {
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run test suite',
        jobId: job.id,
      }, 500);
    }
  }

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Test suite queued for execution',
    },
  });
});

// ============================================================================
// Test Results
// ============================================================================

// Get test suite results
app.get('/results/:suiteId', requireAuth, requireOrgAccess, async (c) => {
  const suiteId = c.req.param('suiteId');
  const orgId = c.get('organizationId');

  try {
    // Query test run from database
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
      results: unknown;
    }>>`
      SELECT id, repository_id, document_id, total_examples, passed, failed,
             errors, skipped, duration, executed_at, results
      FROM doc_test_runs
      WHERE id = ${suiteId}
      LIMIT 1
    `;

    if (runs.length === 0) {
      throw new NotFoundError('Test suite', suiteId);
    }

    const run = runs[0];
    if (!run) {
      throw new NotFoundError('Test suite', suiteId);
    }

    // Verify access to repository
    const repo = await prisma.repository.findFirst({
      where: { id: run.repository_id, organizationId: orgId },
    });
    if (!repo) throw new NotFoundError('Repository', run.repository_id);

    const suite: DocTestSuite = {
      repositoryId: run.repository_id,
      documentId: run.document_id ?? undefined,
      totalExamples: run.total_examples,
      passed: run.passed,
      failed: run.failed,
      errors: run.errors,
      skipped: run.skipped,
      results: run.results as DocTestSuite['results'],
      executedAt: run.executed_at,
      duration: run.duration,
    };

    return c.json({
      success: true,
      data: {
        suite,
        summary: generateCheckRunSummary(suite),
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;

    return c.json({
      success: false,
      error: 'Test suite not found or database table does not exist',
    }, 404);
  }
});

// Get test history for a repository
app.get('/history/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { limit } = c.req.query();

  // Verify repository access
  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!repo) throw new NotFoundError('Repository', repositoryId);

  const history = await getTestHistory(repositoryId, limit ? parseInt(limit, 10) : 50);

  return c.json({
    success: true,
    data: {
      repositoryId,
      repository: repo,
      history,
      totalRuns: history.length,
    },
  });
});

// ============================================================================
// Code Example Extraction
// ============================================================================

// Extract and list code examples from a document
app.get('/examples/:documentId', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');

  const document = await prisma.document.findFirst({
    where: { id: documentId },
    include: {
      repository: {
        select: { id: true, organizationId: true },
      },
    },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  const examples = extractCodeExamples(
    document.content || '',
    document.id,
    document.path
  );

  // Group by language
  const byLanguage = examples.reduce((acc, example) => {
    if (!acc[example.language]) {
      acc[example.language] = [];
    }
    acc[example.language]?.push(example);
    return acc;
  }, {} as Record<string, CodeExample[]>);

  return c.json({
    success: true,
    data: {
      documentId,
      documentPath: document.path,
      totalExamples: examples.length,
      examples,
      byLanguage,
      languageCounts: Object.entries(byLanguage).map(([lang, exs]) => ({
        language: lang,
        count: exs.length,
      })),
    },
  });
});

// ============================================================================
// Configuration
// ============================================================================

// Get doc test configuration
app.get('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  // Verify repository access
  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true },
  });
  if (!repo) throw new NotFoundError('Repository', repositoryId);

  const config = await getDocTestConfig(repositoryId);

  return c.json({
    success: true,
    data: config,
  });
});

// Update doc test configuration
app.put('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<Partial<DocTestConfig>>();

  // Verify repository access
  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true },
  });
  if (!repo) throw new NotFoundError('Repository', repositoryId);

  const config = await updateDocTestConfig(repositoryId, body);

  return c.json({
    success: true,
    data: config,
  });
});

// ============================================================================
// Validation
// ============================================================================

// Validate a single code example
app.post('/validate-example', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    documentId: string;
    code: string;
    language: string;
    expectedOutput?: string;
  }>();

  if (!body.documentId || !body.code || !body.language) {
    throw new ValidationError('documentId, code, and language are required');
  }

  const document = await prisma.document.findFirst({
    where: { id: body.documentId },
    include: {
      repository: {
        select: { id: true, organizationId: true },
      },
    },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', body.documentId);
  }

  // Create a temporary code example
  const example: CodeExample = {
    id: `temp-${Date.now()}`,
    documentId: body.documentId,
    documentPath: document.path,
    language: body.language as CodeExample['language'],
    code: body.code,
    lineStart: 0,
    lineEnd: 0,
    heading: 'Test',
    expectedOutput: body.expectedOutput,
  };

  // Run the example with a default timeout
  const result = await runCodeExample(example, 30);

  return c.json({
    success: true,
    data: {
      result,
      passed: result.status === 'passed',
    },
  });
});

// ============================================================================
// Coverage Statistics
// ============================================================================

// Get test coverage stats for a repository
app.get('/coverage/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  // Verify repository access
  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!repo) throw new NotFoundError('Repository', repositoryId);

  const stats = await getTestCoverageStats(repositoryId);

  // Calculate additional metrics
  const exampleCoveragePercentage = stats.totalExamples > 0
    ? (stats.testedExamples / stats.totalExamples) * 100
    : 0;

  return c.json({
    success: true,
    data: {
      ...stats,
      repository: repo,
      exampleCoveragePercentage: Math.round(exampleCoveragePercentage * 10) / 10,
      documentCoveragePercentage: Math.round(stats.coveragePercentage * 10) / 10,
    },
  });
});

export { app as docTestingV2Routes };
