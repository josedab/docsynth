import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';

const app = new Hono();

// List examples for a repository
app.get('/repository/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { documentId, status, language, limit, offset } = c.req.query();

  // Verify access
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const whereClause: Record<string, unknown> = { repositoryId };
  if (documentId) whereClause.documentId = documentId;
  if (status) whereClause.validationStatus = status;
  if (language) whereClause.language = language;

  const [examples, total] = await Promise.all([
    prisma.interactiveExample.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit ? parseInt(limit, 10) : 50,
      skip: offset ? parseInt(offset, 10) : 0,
    }),
    prisma.interactiveExample.count({ where: whereClause }),
  ]);

  // Get validation stats
  const stats = await prisma.interactiveExample.groupBy({
    by: ['validationStatus'],
    where: { repositoryId },
    _count: true,
  });

  return c.json({
    success: true,
    data: {
      examples: examples.map((e) => ({
        id: e.id,
        documentId: e.documentId,
        title: e.title,
        description: e.description,
        language: e.language,
        code: e.code,
        expectedOutput: e.expectedOutput,
        isRunnable: e.isRunnable,
        validationStatus: e.validationStatus,
        lastValidated: e.lastValidated,
        executionCount: e.executionCount,
        sourceLineStart: e.sourceLineStart,
        sourceLineEnd: e.sourceLineEnd,
        createdAt: e.createdAt,
      })),
      total,
      stats: {
        valid: stats.find((s) => s.validationStatus === 'valid')?._count || 0,
        invalid: stats.find((s) => s.validationStatus === 'invalid')?._count || 0,
        pending: stats.find((s) => s.validationStatus === 'pending')?._count || 0,
        error: stats.find((s) => s.validationStatus === 'error')?._count || 0,
      },
    },
  });
});

// Get single example
app.get('/:exampleId', requireAuth, requireOrgAccess, async (c) => {
  const exampleId = c.req.param('exampleId');
  const orgId = c.get('organizationId');

  const example = await prisma.interactiveExample.findUnique({
    where: { id: exampleId },
  });

  if (!example) {
    throw new NotFoundError('Example', exampleId);
  }

  // Get recent executions separately
  const executions = await prisma.exampleExecution.findMany({
    where: { exampleId },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  // Verify organization access
  const repository = await prisma.repository.findFirst({
    where: { id: example.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Example', exampleId);
  }

  return c.json({
    success: true,
    data: {
      ...example,
      recentExecutions: executions,
    },
  });
});

// Execute example - queues the execution and returns immediately
app.post('/:exampleId/execute', requireAuth, requireOrgAccess, rateLimit('default'), async (c) => {
  const exampleId = c.req.param('exampleId');
  const orgId = c.get('organizationId');
  await c.req.json<{ code?: string; timeout?: number }>().catch(() => ({ code: undefined, timeout: undefined }));

  const example = await prisma.interactiveExample.findUnique({
    where: { id: exampleId },
  });

  if (!example) {
    throw new NotFoundError('Example', exampleId);
  }

  // Verify organization access
  const repository = await prisma.repository.findFirst({
    where: { id: example.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Example', exampleId);
  }

  if (!example.isRunnable) {
    throw new ValidationError('This example is not runnable');
  }

  // Queue the validation job (execution is part of validation flow)
  await addJob(QUEUE_NAMES.EXAMPLE_VALIDATION, {
    repositoryId: example.repositoryId,
    exampleId,
  });

  return c.json({
    success: true,
    data: {
      message: 'Execution queued',
      exampleId,
    },
  });
});

// Validate example
app.post('/:exampleId/validate', requireAuth, requireOrgAccess, rateLimit('default'), async (c) => {
  const exampleId = c.req.param('exampleId');
  const orgId = c.get('organizationId');

  const example = await prisma.interactiveExample.findUnique({
    where: { id: exampleId },
  });

  if (!example) {
    throw new NotFoundError('Example', exampleId);
  }

  // Verify organization access
  const repository = await prisma.repository.findFirst({
    where: { id: example.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Example', exampleId);
  }

  // Queue validation job
  const job = await addJob(QUEUE_NAMES.EXAMPLE_VALIDATION, {
    repositoryId: example.repositoryId,
    exampleId,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Validation started',
    },
  });
});

// Extract examples from document
app.post('/extract', requireAuth, requireOrgAccess, rateLimit('default'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ documentId?: string; repositoryId?: string }>();

  if (!body.documentId && !body.repositoryId) {
    throw new ValidationError('Either documentId or repositoryId is required');
  }

  let repositoryId = body.repositoryId;

  if (body.documentId) {
    const document = await prisma.document.findUnique({
      where: { id: body.documentId },
      include: { repository: { select: { id: true, organizationId: true } } },
    });

    if (!document || document.repository.organizationId !== orgId) {
      throw new NotFoundError('Document', body.documentId);
    }

    repositoryId = document.repositoryId;
  } else if (repositoryId) {
    const repository = await prisma.repository.findFirst({
      where: { id: repositoryId, organizationId: orgId },
    });

    if (!repository) {
      throw new NotFoundError('Repository', repositoryId);
    }
  }

  // Queue extraction job
  const job = await addJob(QUEUE_NAMES.EXAMPLE_VALIDATION, {
    repositoryId: repositoryId!,
    documentId: body.documentId,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Example extraction started',
    },
  });
});

// Validate all examples for repository
app.post('/repository/:repositoryId/validate-all', requireAuth, requireOrgAccess, rateLimit('default'), async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const job = await addJob(QUEUE_NAMES.EXAMPLE_VALIDATION, {
    repositoryId,
    validateAll: true,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Bulk validation started',
    },
  });
});

// Get example execution history
app.get('/:exampleId/executions', requireAuth, requireOrgAccess, async (c) => {
  const exampleId = c.req.param('exampleId');
  const orgId = c.get('organizationId');
  const { limit } = c.req.query();

  const example = await prisma.interactiveExample.findUnique({
    where: { id: exampleId },
  });

  if (!example) {
    throw new NotFoundError('Example', exampleId);
  }

  // Verify organization access
  const repository = await prisma.repository.findFirst({
    where: { id: example.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Example', exampleId);
  }

  const executions = await prisma.exampleExecution.findMany({
    where: { exampleId },
    orderBy: { createdAt: 'desc' },
    take: limit ? parseInt(limit, 10) : 20,
  });

  return c.json({
    success: true,
    data: executions,
  });
});

export { app as interactiveExamplesRoutes };
