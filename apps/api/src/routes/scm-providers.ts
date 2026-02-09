// ============================================================================
// SCM Providers Routes
// ============================================================================
// This module provides REST API endpoints for managing SCM provider
// configurations and testing connectivity to different SCM platforms.

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import {
  createSCMProvider,
  detectProvider,
  parseRepoUrl,
  getSupportedProviders,
  getProviderCapabilities,
  isSupportedProvider,
  type ProviderConfig,
} from '../services/scm-provider-factory.js';
import type { SCMProviderType } from '../services/scm-provider.js';

const app = new Hono();

// ============================================================================
// List Supported Providers
// ============================================================================

app.get('/', async (c) => {
  const providers = getSupportedProviders();

  const providersWithCapabilities = providers.map((type) => ({
    type,
    ...getProviderCapabilities(type),
  }));

  return c.json({
    success: true,
    data: {
      providers: providersWithCapabilities,
      default: 'github',
    },
  });
});

// ============================================================================
// Test Provider Connection
// ============================================================================

app.post('/test', requireAuth, async (c) => {
  const body = await c.req.json<{
    type: SCMProviderType;
    config: ProviderConfig;
    testRepo?: { owner: string; repo: string };
  }>();

  if (!body.type || !body.config) {
    throw new ValidationError('Provider type and config are required');
  }

  if (!isSupportedProvider(body.type)) {
    throw new ValidationError(`Unsupported provider type: ${body.type}`);
  }

  try {
    const provider = createSCMProvider(body.type, body.config);

    // Test with a repository if provided
    let testResult: {
      connected: boolean;
      repository?: {
        name: string;
        fullName: string;
        defaultBranch: string;
      };
      error?: string;
    };

    if (body.testRepo) {
      try {
        const repo = await provider.getRepository(body.testRepo.owner, body.testRepo.repo);
        testResult = {
          connected: true,
          repository: {
            name: repo.name,
            fullName: repo.fullName,
            defaultBranch: repo.defaultBranch,
          },
        };
      } catch (error) {
        testResult = {
          connected: false,
          error: error instanceof Error ? error.message : 'Failed to connect to repository',
        };
      }
    } else {
      // Just verify the provider was created successfully
      testResult = {
        connected: true,
      };
    }

    return c.json({
      success: true,
      data: {
        provider: body.type,
        ...testResult,
      },
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Provider test failed',
        },
      },
      400
    );
  }
});

// ============================================================================
// Get Provider for Repository
// ============================================================================

app.get('/:repositoryId', requireAuth, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: {
      id: true,
      name: true,
      fullName: true,
      config: true,
      metadata: true,
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Extract provider info from metadata or config
  const metadata = repository.metadata as Record<string, unknown> | null;
  const providerType = (metadata?.providerType as SCMProviderType | undefined) ?? 'github';

  const providerConfig = metadata?.providerConfig as Record<string, unknown> | undefined;

  return c.json({
    success: true,
    data: {
      repositoryId: repository.id,
      repositoryName: repository.name,
      repositoryFullName: repository.fullName,
      provider: {
        type: providerType,
        ...getProviderCapabilities(providerType),
        configured: !!providerConfig,
      },
    },
  });
});

// ============================================================================
// Set/Update Provider Config for Repository
// ============================================================================

app.put('/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const body = await c.req.json<{
    type: SCMProviderType;
    config: ProviderConfig;
  }>();

  if (!body.type || !body.config) {
    throw new ValidationError('Provider type and config are required');
  }

  if (!isSupportedProvider(body.type)) {
    throw new ValidationError(`Unsupported provider type: ${body.type}`);
  }

  // Verify repository belongs to organization
  const repository = await prisma.repository.findFirst({
    where: {
      id: repositoryId,
      organizationId: orgId,
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Test the provider configuration
  try {
    const provider = createSCMProvider(body.type, body.config);

    // Try to fetch the repository to validate the config
    const [owner, repo] = repository.fullName.split('/');
    if (owner && repo) {
      await provider.getRepository(owner, repo);
    }
  } catch (error) {
    throw new ValidationError(
      `Failed to validate provider configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Update repository metadata with provider info
  const metadata = (repository.metadata as Record<string, unknown>) ?? {};
  metadata.providerType = body.type;
  metadata.providerConfig = body.config as unknown as Record<string, unknown>;

  const updated = await prisma.repository.update({
    where: { id: repositoryId },
    data: {
      metadata: metadata as object,
    },
  });

  return c.json({
    success: true,
    data: {
      repositoryId: updated.id,
      provider: {
        type: body.type,
        ...getProviderCapabilities(body.type),
        configured: true,
      },
    },
  });
});

// ============================================================================
// Detect Provider from URL
// ============================================================================

app.post('/detect', async (c) => {
  const body = await c.req.json<{
    url: string;
  }>();

  if (!body.url) {
    throw new ValidationError('Repository URL is required');
  }

  try {
    const providerType = detectProvider(body.url);
    const { owner, repo } = parseRepoUrl(body.url);

    return c.json({
      success: true,
      data: {
        url: body.url,
        provider: {
          type: providerType,
          ...getProviderCapabilities(providerType),
        },
        repository: {
          owner,
          repo,
          fullName: `${owner}/${repo}`,
        },
      },
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Failed to detect provider',
        },
      },
      400
    );
  }
});

// ============================================================================
// Get Provider Statistics for Organization
// ============================================================================

app.get('/stats/organization', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const repositories = await prisma.repository.findMany({
    where: { organizationId: orgId },
    select: {
      metadata: true,
    },
  });

  // Count repositories by provider type
  const providerCounts: Record<string, number> = {
    github: 0,
    gitlab: 0,
    bitbucket: 0,
  };

  for (const repo of repositories) {
    const metadata = repo.metadata as Record<string, unknown> | null;
    const providerType = (metadata?.providerType as string | undefined) ?? 'github';

    if (providerType in providerCounts) {
      providerCounts[providerType]!++;
    }
  }

  return c.json({
    success: true,
    data: {
      totalRepositories: repositories.length,
      byProvider: providerCounts,
      supportedProviders: getSupportedProviders(),
    },
  });
});

// ============================================================================
// Migrate Repository to Different Provider
// ============================================================================

app.post('/:repositoryId/migrate', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const body = await c.req.json<{
    targetProvider: SCMProviderType;
    targetConfig: ProviderConfig;
    newFullName?: string; // e.g., "newowner/newrepo"
  }>();

  if (!body.targetProvider || !body.targetConfig) {
    throw new ValidationError('Target provider type and config are required');
  }

  if (!isSupportedProvider(body.targetProvider)) {
    throw new ValidationError(`Unsupported provider type: ${body.targetProvider}`);
  }

  // Verify repository belongs to organization
  const repository = await prisma.repository.findFirst({
    where: {
      id: repositoryId,
      organizationId: orgId,
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Test the new provider configuration
  try {
    const provider = createSCMProvider(body.targetProvider, body.targetConfig);

    const fullName = body.newFullName ?? repository.fullName;
    const [owner, repo] = fullName.split('/');
    if (owner && repo) {
      await provider.getRepository(owner, repo);
    }
  } catch (error) {
    throw new ValidationError(
      `Failed to validate target provider configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Update repository with new provider info
  const metadata = (repository.metadata as Record<string, unknown>) ?? {};
  const oldProviderType = metadata.providerType ?? 'github';

  metadata.providerType = body.targetProvider;
  metadata.providerConfig = body.targetConfig as unknown as Record<string, unknown>;
  metadata.migrationHistory = [
    ...((metadata.migrationHistory as unknown[]) ?? []),
    {
      from: oldProviderType,
      to: body.targetProvider,
      migratedAt: new Date().toISOString(),
    },
  ];

  const updateData: {
    metadata: object;
    fullName?: string;
    githubFullName?: string;
  } = {
    metadata: metadata as object,
  };

  if (body.newFullName) {
    updateData.fullName = body.newFullName;
    updateData.githubFullName = body.newFullName;
  }

  const updated = await prisma.repository.update({
    where: { id: repositoryId },
    data: updateData,
  });

  return c.json({
    success: true,
    data: {
      repositoryId: updated.id,
      migrated: true,
      from: oldProviderType,
      to: body.targetProvider,
      newFullName: updated.fullName,
    },
  });
});

export { app as scmProviderRoutes };
