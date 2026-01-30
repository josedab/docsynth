import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { GitHubClient } from '@docsynth/github';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { DEFAULT_REPOSITORY_CONFIG } from '@docsynth/config';

const app = new Hono();

// List repositories for organization
app.get('/', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const perPage = Math.min(parseInt(c.req.query('perPage') ?? '20', 10), 100);

  const [repositories, total] = await Promise.all([
    prisma.repository.findMany({
      where: { organizationId: orgId },
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        githubFullName: true,
        defaultBranch: true,
        enabled: true,
        config: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            documents: true,
            prEvents: true,
          },
        },
      },
    }),
    prisma.repository.count({ where: { organizationId: orgId } }),
  ]);

  return c.json({
    success: true,
    data: repositories,
    meta: {
      page,
      perPage,
      total,
      hasMore: page * perPage < total,
    },
  });
});

// Get single repository
app.get('/:repoId', requireAuth, async (c) => {
  const repoId = c.req.param('repoId');

  const repository = await prisma.repository.findUnique({
    where: { id: repoId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
        },
      },
      styleProfile: true,
      _count: {
        select: {
          documents: true,
          prEvents: true,
        },
      },
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repoId);
  }

  return c.json({
    success: true,
    data: repository,
  });
});

// Update repository settings
app.patch('/:repoId', requireAuth, async (c) => {
  const repoId = c.req.param('repoId');
  const body = await c.req.json();

  const repository = await prisma.repository.findUnique({
    where: { id: repoId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repoId);
  }

  const updated = await prisma.repository.update({
    where: { id: repoId },
    data: {
      enabled: body.enabled ?? repository.enabled,
      config: body.config ?? repository.config,
    },
  });

  return c.json({
    success: true,
    data: updated,
  });
});

// Enable repository
app.post('/:repoId/enable', requireAuth, async (c) => {
  const repoId = c.req.param('repoId');

  const repository = await prisma.repository.update({
    where: { id: repoId },
    data: {
      enabled: true,
      config: DEFAULT_REPOSITORY_CONFIG,
    },
  });

  return c.json({
    success: true,
    data: repository,
  });
});

// Disable repository
app.post('/:repoId/disable', requireAuth, async (c) => {
  const repoId = c.req.param('repoId');

  const repository = await prisma.repository.update({
    where: { id: repoId },
    data: { enabled: false },
  });

  return c.json({
    success: true,
    data: repository,
  });
});

// Sync repositories from GitHub
app.post('/sync', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      repositories: {
        take: 1,
        select: { installationId: true },
      },
    },
  });

  if (!org || org.repositories.length === 0) {
    throw new ValidationError('No installation found for organization');
  }

  const installationId = org.repositories[0]?.installationId;
  if (!installationId) {
    throw new ValidationError('No installation ID found');
  }

  const client = GitHubClient.forInstallation(installationId);
  const repos = await client.listInstallationRepos();

  // Upsert repositories
  for (const repo of repos) {
    await prisma.repository.upsert({
      where: { githubRepoId: repo.id },
      create: {
        organizationId: orgId,
        githubRepoId: repo.id,
        githubFullName: repo.fullName,
        fullName: repo.fullName,
        name: repo.name,
        defaultBranch: repo.defaultBranch,
        installationId,
        enabled: false,
      },
      update: {
        githubFullName: repo.fullName,
        fullName: repo.fullName,
        name: repo.name,
        defaultBranch: repo.defaultBranch,
      },
    });
  }

  return c.json({
    success: true,
    data: { synced: repos.length },
  });
});

// List repository documents
app.get('/:repoId/documents', requireAuth, async (c) => {
  const repoId = c.req.param('repoId');
  const type = c.req.query('type');

  const documents = await prisma.document.findMany({
    where: {
      repositoryId: repoId,
      ...(type && { type: type.toUpperCase() as 'README' | 'API_REFERENCE' | 'CHANGELOG' | 'GUIDE' | 'TUTORIAL' | 'ARCHITECTURE' | 'ADR' | 'INLINE_COMMENT' }),
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      path: true,
      type: true,
      title: true,
      version: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return c.json({
    success: true,
    data: documents,
  });
});

// Get document content
app.get('/:repoId/documents/:docId', requireAuth, async (c) => {
  const docId = c.req.param('docId');

  const document = await prisma.document.findUnique({
    where: { id: docId },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 5,
      },
    },
  });

  if (!document) {
    throw new NotFoundError('Document', docId);
  }

  return c.json({
    success: true,
    data: document,
  });
});

// Trigger drift scan for a repository
app.post('/:repoId/drift-scan', requireAuth, requireOrgAccess, async (c) => {
  const repoId = c.req.param('repoId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repoId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repoId);
  }

  const [owner, repoName] = repository.githubFullName.split('/');
  if (!owner || !repoName) {
    throw new ValidationError('Invalid repository name format');
  }

  // Import queue functions
  const { addJob, QUEUE_NAMES } = await import('@docsynth/queue');

  await addJob(QUEUE_NAMES.DRIFT_SCAN, {
    repositoryId: repository.id,
    installationId: repository.installationId,
    owner,
    repo: repoName,
    scheduled: false,
  });

  return c.json({
    success: true,
    data: { message: 'Drift scan queued', repositoryId: repoId },
  });
});

// Get drift scan results for a repository
app.get('/:repoId/drift', requireAuth, requireOrgAccess, async (c) => {
  const repoId = c.req.param('repoId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repoId, organizationId: orgId },
    select: {
      id: true,
      name: true,
      lastDriftScanAt: true,
      metadata: true,
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repoId);
  }

  const metadata = repository.metadata as Record<string, unknown> | null;
  const lastDriftScan = metadata?.lastDriftScan as Record<string, unknown> | undefined;

  return c.json({
    success: true,
    data: {
      repositoryId: repository.id,
      repositoryName: repository.name,
      lastScanAt: repository.lastDriftScanAt,
      scan: lastDriftScan ?? null,
    },
  });
});

export { app as repoRoutes };
