/**
 * Executable Documentation Testing API Routes
 * 
 * Provides endpoints for testing code examples in documentation
 * and integrating with CI/CD pipelines.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';

const router = new Hono();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

router.use('*', requireAuth);

// Get test results for a repository
router.get('/results/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const { status, language, limit = '50' } = c.req.query();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { repositoryId };
  if (status) {
    where.validationStatus = status;
  }
  if (language) {
    where.language = language;
  }

  const examples = await db.interactiveExample.findMany({
    where,
    take: parseInt(limit, 10),
    orderBy: { lastValidated: 'desc' },
  });

  const summary = await db.interactiveExample.groupBy({
    by: ['validationStatus'],
    where: { repositoryId },
    _count: true,
  });

  return c.json({
    examples,
    summary: summary.reduce((acc: Record<string, number>, s: { validationStatus: string | null; _count: number }) => {
      acc[s.validationStatus || 'unknown'] = s._count;
      return acc;
    }, {} as Record<string, number>),
  });
});

// Get single example details
router.get('/example/:exampleId', async (c) => {
  const exampleId = c.req.param('exampleId') ?? '';

  const example = await db.interactiveExample.findUnique({
    where: { id: exampleId },
  });

  if (!example) {
    return c.json({ error: 'Example not found' }, 404);
  }

  // Get recent executions
  const executions = await db.exampleExecution.findMany({
    where: { exampleId },
    take: 10,
    orderBy: { createdAt: 'desc' },
  });

  return c.json({
    example,
    executions,
  });
});

// Trigger validation for a single example
router.post('/validate/:exampleId', async (c) => {
  const exampleId = c.req.param('exampleId') ?? '';

  const example = await db.interactiveExample.findUnique({
    where: { id: exampleId },
  });

  if (!example) {
    return c.json({ error: 'Example not found' }, 404);
  }

  const job = await addJob(
    QUEUE_NAMES.EXAMPLE_VALIDATION,
    {
      repositoryId: example.repositoryId,
      exampleId,
    },
    {
      jobId: `validate-example-${exampleId}-${Date.now()}`,
    }
  );

  return c.json({
    message: 'Validation queued',
    jobId: job.id,
    exampleId,
  });
});

// Trigger validation for all examples in a repository
router.post('/validate-all/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const job = await addJob(
    QUEUE_NAMES.EXAMPLE_VALIDATION,
    {
      repositoryId,
      validateAll: true,
    },
    {
      jobId: `validate-all-${repositoryId}-${Date.now()}`,
    }
  );

  return c.json({
    message: 'Full validation queued',
    jobId: job.id,
    repositoryId,
  });
});

// Extract examples from documents
router.post('/extract/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const body = await c.req.json().catch(() => ({}));

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const job = await addJob(
    QUEUE_NAMES.EXAMPLE_VALIDATION,
    {
      repositoryId,
      documentId: body.documentId,
    },
    {
      jobId: `extract-examples-${repositoryId}-${Date.now()}`,
    }
  );

  return c.json({
    message: 'Example extraction queued',
    jobId: job.id,
    repositoryId,
  });
});

// CI/CD Integration: Generate workflow
const workflowSchema = z.object({
  provider: z.enum(['github', 'gitlab', 'jenkins']),
  branch: z.string().default('main'),
  trigger: z.enum(['push', 'pull_request', 'schedule', 'manual']).default('pull_request'),
  schedule: z.string().optional(),
  failOnBrokenExamples: z.boolean().default(true),
  languages: z.array(z.string()).optional(),
  maxParallel: z.number().min(1).max(10).optional(),
  timeout: z.number().min(5).max(120).optional(),
});

router.post('/cicd/generate/:repositoryId', requireOrgAccess, async (c) => {
  const { repositoryId } = c.req.param();
  const body = await c.req.json();

  const parsed = workflowSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  // Detect languages if not provided
  let languages = parsed.data.languages || [];
  if (languages.length === 0) {
    const examples = await db.interactiveExample.findMany({
      where: { repositoryId },
      select: { language: true },
      distinct: ['language'],
    });
    languages = examples.map((e: { language: string }) => e.language);
    if (languages.length === 0) {
      languages = ['javascript', 'typescript'];
    }
  }

  const config = {
    ...parsed.data,
    languages,
  };

  // Use inline workflow generation
  const workflowContent = generateMinimalWorkflow(repository.name, config);

  return c.json({
    provider: parsed.data.provider,
    config,
    workflow: workflowContent,
    filename: parsed.data.provider === 'github' ? '.github/workflows/docsynth-tests.yml' : '.gitlab-ci.yml',
  });
});

// Get CI/CD run history
router.get('/cicd/history/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const { limit = '20' } = c.req.query();

  const logs = await prisma.auditLog.findMany({
    where: {
      resourceType: 'repository',
      resourceId: repositoryId,
      action: 'ci_run',
    },
    orderBy: { createdAt: 'desc' },
    take: parseInt(limit, 10),
  });

  const runs = logs.map((log) => ({
    id: log.id,
    ...(typeof log.details === 'object' ? log.details as Record<string, unknown> : {}),
    recordedAt: log.createdAt,
  }));

  return c.json({ runs });
});

// Report CI/CD run results (called from CI)
const ciResultSchema = z.object({
  runId: z.string(),
  branch: z.string(),
  commit: z.string(),
  status: z.enum(['pending', 'running', 'passed', 'failed']),
  totalExamples: z.number(),
  passedExamples: z.number(),
  failedExamples: z.number(),
  skippedExamples: z.number().default(0),
  failureDetails: z.array(z.object({
    exampleId: z.string().optional(),
    documentPath: z.string(),
    language: z.string(),
    lineStart: z.number(),
    lineEnd: z.number(),
    error: z.string(),
    expectedOutput: z.string().optional(),
    actualOutput: z.string().optional(),
  })).default([]),
});

router.post('/cicd/report/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const body = await c.req.json();

  const parsed = ciResultSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { id: true, organizationId: true },
  });

  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  // Record in audit log
  const { generateId } = await import('@docsynth/utils');
  const id = generateId();

  await prisma.auditLog.create({
    data: {
      id,
      action: 'ci_run',
      resourceType: 'repository',
      resourceId: repositoryId,
      details: JSON.parse(JSON.stringify({
        ...parsed.data,
        startedAt: new Date().toISOString(),
        completedAt: parsed.data.status !== 'running' ? new Date().toISOString() : null,
      })),
      organizationId: repository.organizationId,
    },
  });

  // Create health alerts for failures
  if (parsed.data.status === 'failed' && parsed.data.failedExamples > 0) {
    const alertId = generateId();
    await prisma.healthAlert.create({
      data: {
        id: alertId,
        repositoryId,
        organizationId: repository.organizationId,
        alertType: 'broken_example',
        severity: 'high',
        title: 'CI/CD detected broken examples',
        message: `CI/CD run found ${parsed.data.failedExamples} broken code example(s)`,
        metadata: JSON.parse(JSON.stringify({
          runId: parsed.data.runId,
          commit: parsed.data.commit,
          branch: parsed.data.branch,
          failures: parsed.data.failureDetails.slice(0, 10), // Limit stored failures
        })),
      },
    });
  }

  return c.json({
    message: 'CI run recorded',
    reportId: id,
    status: parsed.data.status,
  });
});

// Get broken examples summary
router.get('/broken/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';

  const brokenExamples = await db.interactiveExample.findMany({
    where: {
      repositoryId,
      validationStatus: 'invalid',
    },
    orderBy: { lastValidated: 'desc' },
  });

  // Get latest execution for each broken example
  const withExecutions = await Promise.all(
    brokenExamples.map(async (example: { id: string; title: string; language: string; lastValidated: Date | null }) => {
      const lastExecution = await db.exampleExecution.findFirst({
        where: { exampleId: example.id },
        orderBy: { createdAt: 'desc' },
      });
      return {
        ...example,
        lastExecution,
      };
    })
  );

  return c.json({
    total: brokenExamples.length,
    examples: withExecutions,
  });
});

/**
 * Minimal workflow generation fallback
 */
function generateMinimalWorkflow(
  repoName: string,
  config: { provider: string; branch: string; trigger: string; languages: string[]; failOnBrokenExamples: boolean }
): string {
  if (config.provider === 'gitlab') {
    return `# DocSynth Documentation Tests for ${repoName}
stages:
  - test

test-docs:
  stage: test
  image: node:20
  script:
    - npm install -g @docsynth/cli
    - docsynth test-examples --format json
`;
  }

  return `# DocSynth Documentation Tests for ${repoName}
name: Documentation Tests

on:
  ${config.trigger}:
    branches: [${config.branch}]

jobs:
  test-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install -g @docsynth/cli
      - run: docsynth test-examples ${config.failOnBrokenExamples ? '--fail-on-error' : ''}
`;
}

export default router;
