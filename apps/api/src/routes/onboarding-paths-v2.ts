/**
 * Onboarding Paths API Routes (v2)
 *
 * Role-specific onboarding documentation with guided learning paths
 * and progressive complexity.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import * as onboardingPathsService from '../services/onboarding-paths.service.js';

const app = new Hono();

// Apply authentication to all routes
app.use('*', requireAuth);

// ============================================================================
// Schemas
// ============================================================================

const generatePathSchema = z.object({
  repositoryId: z.string().min(1),
  role: z.enum(['frontend', 'backend', 'fullstack', 'data', 'devops', 'mobile', 'qa']),
});

const trackProgressSchema = z.object({
  stepId: z.string().min(1),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /generate
 * Generate onboarding path for a specific role
 */
app.post('/generate', rateLimit('ai'), async (c) => {
  const body = await c.req.json();
  const parsed = generatePathSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  const { repositoryId, role } = parsed.data;

  // Verify repository access
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { installationId: true },
  });

  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const pathId = await onboardingPathsService.generateOnboardingPath(
      repositoryId,
      role,
      repository.installationId
    );

    const path = await onboardingPathsService.getOnboardingPath(pathId);

    return c.json({
      message: 'Onboarding path generated',
      path,
    });
  } catch (error) {
    console.error('Failed to generate onboarding path:', error);
    return c.json({ error: 'Failed to generate onboarding path' }, 500);
  }
});

/**
 * GET /paths/:repositoryId
 * List all onboarding paths for a repository
 */
app.get('/paths/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  if (!repositoryId) {
    return c.json({ error: 'Repository ID is required' }, 400);
  }

  try {
    const paths = await onboardingPathsService.getOnboardingPaths(repositoryId);

    return c.json({
      paths: paths.map((p) => ({
        id: p.id,
        role: p.role,
        title: p.title,
        description: p.description,
        estimatedHours: p.estimatedHours,
        moduleCount: p.modules.length,
        prerequisites: p.prerequisites,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    console.error('Failed to list paths:', error);
    return c.json({ error: 'Failed to list paths' }, 500);
  }
});

/**
 * GET /path/:pathId
 * Get a specific onboarding path with all modules and steps
 */
app.get('/path/:pathId', async (c) => {
  const pathId = c.req.param('pathId');

  if (!pathId) {
    return c.json({ error: 'Path ID is required' }, 400);
  }

  const path = await onboardingPathsService.getOnboardingPath(pathId);

  if (!path) {
    return c.json({ error: 'Path not found' }, 404);
  }

  return c.json({ path });
});

/**
 * GET /path/:pathId/module/:moduleId
 * Get a specific module with all its steps
 */
app.get('/path/:pathId/module/:moduleId', async (c) => {
  const pathId = c.req.param('pathId');
  const moduleId = c.req.param('moduleId');

  if (!pathId || !moduleId) {
    return c.json({ error: 'Path ID and Module ID are required' }, 400);
  }

  const path = await onboardingPathsService.getOnboardingPath(pathId);

  if (!path) {
    return c.json({ error: 'Path not found' }, 404);
  }

  const module = path.modules.find((m) => m.id === moduleId);

  if (!module) {
    return c.json({ error: 'Module not found' }, 404);
  }

  return c.json({ module });
});

/**
 * POST /progress/:pathId/step/:stepId
 * Mark a step as completed
 */
app.post('/progress/:pathId/step/:stepId', async (c) => {
  const pathId = c.req.param('pathId');
  const stepId = c.req.param('stepId');
  const user = c.get('user');

  if (!pathId || !stepId) {
    return c.json({ error: 'Path ID and Step ID are required' }, 400);
  }

  try {
    await onboardingPathsService.trackProgress(user.id, pathId, stepId);

    const progress = await onboardingPathsService.getProgress(user.id, pathId);

    return c.json({
      message: 'Progress updated',
      progress,
    });
  } catch (error) {
    console.error('Failed to track progress:', error);
    return c.json({ error: 'Failed to track progress' }, 500);
  }
});

/**
 * GET /progress/:pathId
 * Get user's progress on a specific path
 */
app.get('/progress/:pathId', async (c) => {
  const pathId = c.req.param('pathId');
  const user = c.get('user');

  if (!pathId) {
    return c.json({ error: 'Path ID is required' }, 400);
  }

  const progress = await onboardingPathsService.getProgress(user.id, pathId);

  if (!progress) {
    return c.json({ error: 'Progress not found. Start the path first.' }, 404);
  }

  const path = await onboardingPathsService.getOnboardingPath(pathId);

  return c.json({
    progress,
    path: path ? {
      id: path.id,
      title: path.title,
      role: path.role,
      moduleCount: path.modules.length,
    } : null,
  });
});

/**
 * GET /suggestions/:pathId
 * Get AI-powered next step suggestions
 */
app.get('/suggestions/:pathId', rateLimit('ai'), async (c) => {
  const pathId = c.req.param('pathId');
  const user = c.get('user');

  if (!pathId) {
    return c.json({ error: 'Path ID is required' }, 400);
  }

  try {
    const suggestions = await onboardingPathsService.suggestNextSteps(user.id, pathId);

    return c.json({ suggestions });
  } catch (error) {
    console.error('Failed to get suggestions:', error);
    return c.json({ error: 'Failed to get suggestions' }, 500);
  }
});

/**
 * GET /roles/:repositoryId
 * Analyze repository and suggest relevant roles
 */
app.get('/roles/:repositoryId', requireOrgAccess, rateLimit('ai'), async (c) => {
  const repositoryId = c.req.param('repositoryId');

  if (!repositoryId) {
    return c.json({ error: 'Repository ID is required' }, 400);
  }

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { installationId: true },
  });

  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const analysis = await onboardingPathsService.analyzeCodebaseForRoles(
      repositoryId,
      repository.installationId
    );

    // Sort roles by relevance
    const rankedRoles = Object.entries(analysis.roleRelevance)
      .filter(([_, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([role, score]) => ({
        role,
        score,
        recommended: score >= 3,
      }));

    return c.json({
      analysis: {
        primaryLanguages: analysis.primaryLanguages,
        frameworks: analysis.frameworks,
        architecturePatterns: analysis.architecturePatterns,
        complexity: analysis.complexity,
      },
      roles: rankedRoles,
    });
  } catch (error) {
    console.error('Failed to analyze repository:', error);
    return c.json({ error: 'Failed to analyze repository' }, 500);
  }
});

/**
 * DELETE /path/:pathId
 * Delete an onboarding path
 */
app.delete('/path/:pathId', async (c) => {
  const pathId = c.req.param('pathId');
  const user = c.get('user');

  if (!pathId) {
    return c.json({ error: 'Path ID is required' }, 400);
  }

  const path = await prisma.onboardingPathV2.findUnique({
    where: { id: pathId },
    select: { repositoryId: true },
  });

  if (!path) {
    return c.json({ error: 'Path not found' }, 404);
  }

  // Check if user has access to the repository
  const repository = await prisma.repository.findUnique({
    where: { id: path.repositoryId },
    select: { organizationId: true },
  });

  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: repository.organizationId,
      },
    },
  });

  if (!membership) {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  try {
    // Delete progress records first
    await prisma.onboardingProgressV2.deleteMany({
      where: { pathId },
    });

    // Delete the path
    await prisma.onboardingPathV2.delete({
      where: { id: pathId },
    });

    return c.json({ message: 'Path deleted successfully' });
  } catch (error) {
    console.error('Failed to delete path:', error);
    return c.json({ error: 'Failed to delete path' }, 500);
  }
});

/**
 * POST /path/:pathId/start
 * Start a path for the current user (initializes progress)
 */
app.post('/path/:pathId/start', async (c) => {
  const pathId = c.req.param('pathId');
  const user = c.get('user');

  if (!pathId) {
    return c.json({ error: 'Path ID is required' }, 400);
  }

  const path = await onboardingPathsService.getOnboardingPath(pathId);

  if (!path) {
    return c.json({ error: 'Path not found' }, 404);
  }

  // Check if already started
  const existing = await prisma.onboardingProgressV2.findUnique({
    where: { userId_pathId: { userId: user.id, pathId } },
  });

  if (existing) {
    return c.json({
      message: 'Path already started',
      progress: {
        userId: existing.userId,
        pathId: existing.pathId,
        completedModules: existing.completedModules,
        completedSteps: existing.completedSteps,
        currentModule: existing.currentModule,
        startedAt: existing.startedAt,
        lastActivityAt: existing.lastActivityAt,
        completionPercent: existing.completionPercent,
      },
    });
  }

  try {
    const progressId = await prisma.onboardingProgressV2.create({
      data: {
        id: `prog_${Date.now()}`,
        userId: user.id,
        pathId,
        completedModules: [],
        completedSteps: [],
        currentModule: path.modules[0]?.id || null,
        completionPercent: 0,
      },
    });

    const progress = await onboardingPathsService.getProgress(user.id, pathId);

    return c.json({
      message: 'Path started',
      progress,
    });
  } catch (error) {
    console.error('Failed to start path:', error);
    return c.json({ error: 'Failed to start path' }, 500);
  }
});

/**
 * GET /my-paths
 * Get all paths the current user has started
 */
app.get('/my-paths', async (c) => {
  const user = c.get('user');

  const progressRecords = await prisma.onboardingProgressV2.findMany({
    where: { userId: user.id },
    include: {
      path: {
        select: {
          id: true,
          role: true,
          title: true,
          description: true,
          estimatedHours: true,
          modules: true,
          createdAt: true,
        },
      },
    },
    orderBy: { lastActivityAt: 'desc' },
  });

  const paths = progressRecords.map((record) => ({
    pathId: record.pathId,
    role: record.path.role,
    title: record.path.title,
    description: record.path.description,
    estimatedHours: record.path.estimatedHours,
    moduleCount: (record.path.modules as unknown as Array<unknown>).length,
    progress: {
      completionPercent: record.completionPercent,
      currentModule: record.currentModule,
      completedSteps: (record.completedSteps as string[]).length,
      startedAt: record.startedAt,
      lastActivityAt: record.lastActivityAt,
    },
  }));

  return c.json({ paths });
});

export { app as onboardingPathsV2Routes };
