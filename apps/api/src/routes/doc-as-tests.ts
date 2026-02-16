import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  extractCodeBlocks,
  runDocTests,
  getDocTestCoverage,
  type DocTestSuite,
} from '../services/doc-as-tests.service.js';

const app = new Hono();

// ============================================================================
// Extract Code Blocks
// ============================================================================

app.post('/extract', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req
    .json<{
      content: string;
    }>()
    .catch(() => ({}) as { content: string });

  if (!body.content) {
    throw new ValidationError('content is required');
  }

  const codeBlocks = extractCodeBlocks(body.content);

  return c.json({
    success: true,
    data: {
      codeBlocks,
      totalBlocks: codeBlocks.length,
      languages: [...new Set(codeBlocks.map((b) => b.language))],
    },
  });
});

// ============================================================================
// Run Tests
// ============================================================================

app.post('/run', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req
    .json<{
      content: string;
      filePath: string;
      language?: string;
    }>()
    .catch(() => ({}) as { content: string; filePath: string; language?: string });

  if (!body.content || !body.filePath) {
    throw new ValidationError('content and filePath are required');
  }

  const suite = await runDocTests(body.filePath, body.content);

  return c.json({
    success: true,
    data: {
      suite,
    },
  });
});

// ============================================================================
// Run Suite for Repository
// ============================================================================

app.post('/run-suite/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!repo) throw new NotFoundError('Repository', repositoryId);

  const job = await addJob(QUEUE_NAMES.DOC_AS_TESTS, {
    repositoryId,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Doc-as-tests suite queued for execution',
    },
  });
});

// ============================================================================
// Coverage Stats
// ============================================================================

app.get('/coverage/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!repo) throw new NotFoundError('Repository', repositoryId);

  const coverage = await getDocTestCoverage(repositoryId);

  return c.json({
    success: true,
    data: {
      repositoryId,
      repository: repo,
      ...coverage,
    },
  });
});

// ============================================================================
// Recent Results
// ============================================================================

app.get('/results/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!repo) throw new NotFoundError('Repository', repositoryId);

  try {
    const runs = await prisma.$queryRaw<
      Array<{
        id: string;
        repository_id: string;
        file_path: string;
        total_blocks: number;
        pass_rate: number;
        total_time: number;
        executed_at: Date;
        results: unknown;
      }>
    >`
      SELECT id, repository_id, file_path, total_blocks, pass_rate,
             total_time, executed_at, results
      FROM doc_as_test_runs
      WHERE repository_id = ${repositoryId}
      ORDER BY executed_at DESC
      LIMIT 50
    `;

    return c.json({
      success: true,
      data: {
        repositoryId,
        repository: repo,
        runs,
        totalRuns: runs.length,
      },
    });
  } catch {
    return c.json({
      success: true,
      data: {
        repositoryId,
        repository: repo,
        runs: [],
        totalRuns: 0,
      },
    });
  }
});

// ============================================================================
// Detailed Report
// ============================================================================

app.get('/report/:suiteId', requireAuth, requireOrgAccess, async (c) => {
  const suiteId = c.req.param('suiteId');
  const orgId = c.get('organizationId');

  try {
    const runs = await prisma.$queryRaw<
      Array<{
        id: string;
        repository_id: string;
        file_path: string;
        total_blocks: number;
        pass_rate: number;
        total_time: number;
        executed_at: Date;
        results: unknown;
        code_blocks: unknown;
      }>
    >`
      SELECT id, repository_id, file_path, total_blocks, pass_rate,
             total_time, executed_at, results, code_blocks
      FROM doc_as_test_runs
      WHERE id = ${suiteId}
      LIMIT 1
    `;

    if (runs.length === 0) {
      throw new NotFoundError('Test suite', suiteId);
    }

    const run = runs[0]!;

    // Verify access to repository
    const repo = await prisma.repository.findFirst({
      where: { id: run.repository_id, organizationId: orgId },
      select: { id: true, name: true },
    });
    if (!repo) throw new NotFoundError('Repository', run.repository_id);

    const suite: DocTestSuite = {
      filePath: run.file_path,
      codeBlocks: run.code_blocks as DocTestSuite['codeBlocks'],
      results: run.results as DocTestSuite['results'],
      passRate: run.pass_rate,
      totalTime: run.total_time,
    };

    return c.json({
      success: true,
      data: {
        suite,
        repository: repo,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;

    return c.json(
      {
        success: false,
        error: 'Test suite not found or database table does not exist',
      },
      404
    );
  }
});

export { app as docAsTestsRoutes };
