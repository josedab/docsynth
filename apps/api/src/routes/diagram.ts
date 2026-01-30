import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';

const app = new Hono();

// List diagrams for repository
app.get('/repository/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { type, limit, offset } = c.req.query();

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const whereClause: Record<string, unknown> = { repositoryId };
  if (type) whereClause.type = type;

  const [diagrams, total] = await Promise.all([
    prisma.architectureDiagram.findMany({
      where: whereClause,
      orderBy: { updatedAt: 'desc' },
      take: limit ? parseInt(limit, 10) : 20,
      skip: offset ? parseInt(offset, 10) : 0,
    }),
    prisma.architectureDiagram.count({ where: whereClause }),
  ]);

  return c.json({
    success: true,
    data: { diagrams, total },
  });
});

// Get single diagram
app.get('/:diagramId', requireAuth, requireOrgAccess, async (c) => {
  const diagramId = c.req.param('diagramId');
  const orgId = c.get('organizationId');

  const diagram = await prisma.architectureDiagram.findUnique({
    where: { id: diagramId },
    include: { repository: true },
  });

  if (!diagram || diagram.repository.organizationId !== orgId) {
    throw new NotFoundError('Diagram', diagramId);
  }

  return c.json({
    success: true,
    data: diagram,
  });
});

// Generate diagram
app.post('/generate', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    type: 'component' | 'sequence' | 'dataflow' | 'deployment' | 'entity' | 'class';
    scope?: string;
    includeExternal?: boolean;
    format?: 'mermaid' | 'plantuml' | 'd2';
  }>();

  if (!body.repositoryId || !body.type) {
    throw new ValidationError('repositoryId and type are required');
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Queue diagram generation job
  const job = await addJob(QUEUE_NAMES.DIAGRAM_GENERATION, {
    repositoryId: body.repositoryId,
    diagramType: body.type,
    scope: body.scope ? [body.scope] : undefined,
    format: body.format ?? 'mermaid',
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Diagram generation started',
    },
  });
});

// Update diagram
app.put('/:diagramId', requireAuth, requireOrgAccess, async (c) => {
  const diagramId = c.req.param('diagramId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    title?: string;
    description?: string;
    content?: string;
  }>();

  const diagram = await prisma.architectureDiagram.findUnique({
    where: { id: diagramId },
    include: { repository: true },
  });

  if (!diagram || diagram.repository.organizationId !== orgId) {
    throw new NotFoundError('Diagram', diagramId);
  }

  const updated = await prisma.architectureDiagram.update({
    where: { id: diagramId },
    data: {
      name: body.title,
      description: body.description,
      source: body.content,
    },
  });

  return c.json({
    success: true,
    data: updated,
  });
});

// Delete diagram
app.delete('/:diagramId', requireAuth, requireOrgAccess, async (c) => {
  const diagramId = c.req.param('diagramId');
  const orgId = c.get('organizationId');

  const diagram = await prisma.architectureDiagram.findUnique({
    where: { id: diagramId },
    include: { repository: true },
  });

  if (!diagram || diagram.repository.organizationId !== orgId) {
    throw new NotFoundError('Diagram', diagramId);
  }

  await prisma.architectureDiagram.delete({
    where: { id: diagramId },
  });

  return c.json({ success: true });
});

// Regenerate diagram
app.post('/:diagramId/regenerate', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const diagramId = c.req.param('diagramId');
  const orgId = c.get('organizationId');

  const diagram = await prisma.architectureDiagram.findUnique({
    where: { id: diagramId },
    include: { repository: true },
  });

  if (!diagram || diagram.repository.organizationId !== orgId) {
    throw new NotFoundError('Diagram', diagramId);
  }

  // Queue regeneration
  const job = await addJob(QUEUE_NAMES.DIAGRAM_GENERATION, {
    repositoryId: diagram.repositoryId,
    diagramId: diagram.id,
    diagramType: diagram.diagramType,
    scope: ((diagram.metadata as Record<string, unknown>)?.scope as string[]) || undefined,
    format: diagram.format,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Diagram regeneration started',
    },
  });
});

// List diagram types
app.get('/types/available', requireAuth, async (c) => {
  const types = [
    { type: 'component', name: 'Component Diagram', description: 'Shows system components and their relationships' },
    { type: 'sequence', name: 'Sequence Diagram', description: 'Shows interaction flows between components' },
    { type: 'dataflow', name: 'Data Flow Diagram', description: 'Shows how data moves through the system' },
    { type: 'deployment', name: 'Deployment Diagram', description: 'Shows infrastructure and deployment topology' },
    { type: 'entity', name: 'Entity Relationship Diagram', description: 'Shows database entities and relationships' },
    { type: 'class', name: 'Class Diagram', description: 'Shows classes, interfaces, and inheritance' },
  ];

  return c.json({
    success: true,
    data: types,
  });
});

export const diagramRoutes = app;
