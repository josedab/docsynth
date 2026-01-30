import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';

const app = new Hono();

// List ADRs for repository
app.get('/repository/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { status, limit, offset } = c.req.query();

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const whereClause: Record<string, unknown> = { repositoryId };
  if (status) whereClause.status = status;

  const [adrs, total] = await Promise.all([
    prisma.architectureDecision.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit ? parseInt(limit, 10) : 20,
      skip: offset ? parseInt(offset, 10) : 0,
    }),
    prisma.architectureDecision.count({ where: whereClause }),
  ]);

  return c.json({
    success: true,
    data: { adrs, total },
  });
});

// Get single ADR
app.get('/:adrId', requireAuth, requireOrgAccess, async (c) => {
  const adrId = c.req.param('adrId');
  const orgId = c.get('organizationId');

  const adr = await prisma.architectureDecision.findUnique({
    where: { id: adrId },
    include: { repository: true },
  });

  if (!adr || adr.repository.organizationId !== orgId) {
    throw new NotFoundError('ADR', adrId);
  }

  return c.json({
    success: true,
    data: adr,
  });
});

// Generate ADR from PR
app.post('/generate', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    pullRequestId?: string;
    title?: string;
    context?: string;
    decisionDrivers?: string[];
    consideredOptions?: Array<{
      name: string;
      description: string;
      pros: string[];
      cons: string[];
    }>;
  }>();

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Queue ADR generation job
  const job = await addJob(QUEUE_NAMES.ADR_GENERATION, {
    repositoryId: body.repositoryId,
    pullRequestId: body.pullRequestId,
    title: body.title,
    context: body.context,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'ADR generation started',
    },
  });
});

// Update ADR
app.put('/:adrId', requireAuth, requireOrgAccess, async (c) => {
  const adrId = c.req.param('adrId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    title?: string;
    status?: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
    context?: string;
    decision?: string;
    consequences?: string;
    alternatives?: unknown[];
    deciders?: string[];
  }>();

  const adr = await prisma.architectureDecision.findUnique({
    where: { id: adrId },
    include: { repository: true },
  });

  if (!adr || adr.repository.organizationId !== orgId) {
    throw new NotFoundError('ADR', adrId);
  }

  const updated = await prisma.architectureDecision.update({
    where: { id: adrId },
    data: {
      title: body.title,
      status: body.status,
      context: body.context,
      decision: body.decision,
      consequences: body.consequences,
      alternatives: body.alternatives as object | undefined,
      deciders: body.deciders as object | undefined,
    },
  });

  return c.json({
    success: true,
    data: updated,
  });
});

// Delete ADR
app.delete('/:adrId', requireAuth, requireOrgAccess, async (c) => {
  const adrId = c.req.param('adrId');
  const orgId = c.get('organizationId');

  const adr = await prisma.architectureDecision.findUnique({
    where: { id: adrId },
    include: { repository: true },
  });

  if (!adr || adr.repository.organizationId !== orgId) {
    throw new NotFoundError('ADR', adrId);
  }

  await prisma.architectureDecision.delete({
    where: { id: adrId },
  });

  return c.json({ success: true });
});

// Supersede ADR
app.post('/:adrId/supersede', requireAuth, requireOrgAccess, async (c) => {
  const adrId = c.req.param('adrId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ supersededById: string }>();

  if (!body.supersededById) {
    throw new ValidationError('supersededById is required');
  }

  const adr = await prisma.architectureDecision.findUnique({
    where: { id: adrId },
    include: { repository: true },
  });

  if (!adr || adr.repository.organizationId !== orgId) {
    throw new NotFoundError('ADR', adrId);
  }

  // Verify new ADR exists
  const newAdr = await prisma.architectureDecision.findUnique({
    where: { id: body.supersededById },
    include: { repository: true },
  });

  if (!newAdr || newAdr.repository.organizationId !== orgId) {
    throw new NotFoundError('ADR', body.supersededById);
  }

  await prisma.architectureDecision.update({
    where: { id: adrId },
    data: {
      status: 'superseded',
      supersededBy: body.supersededById,
    },
  });

  return c.json({ success: true });
});

// Generate ADR number
app.get('/repository/:repositoryId/next-number', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const count = await prisma.architectureDecision.count({
    where: { repositoryId },
  });

  return c.json({
    success: true,
    data: { nextNumber: count + 1 },
  });
});

export const adrRoutes = app;
