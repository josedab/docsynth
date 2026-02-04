/**
 * Personalized Onboarding Paths API Routes
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { onboardingService } from '../services/onboarding.service.js';

const router = new Hono();

router.use('*', requireAuth);

// Generate personalized path based on assessment
const assessmentSchema = z.object({
  technicalLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  primaryLanguages: z.array(z.string()).optional(),
  experienceYears: z.number().min(0).max(50).optional(),
  familiarity: z.record(z.string(), z.enum(['none', 'basic', 'intermediate', 'advanced'])).optional(),
});

router.post('/generate/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const parsed = assessmentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid assessment', details: parsed.error.issues }, 400);
  }

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const assessment = parsed.data && Object.keys(parsed.data).length > 0
      ? {
          technicalLevel: parsed.data.technicalLevel || 'beginner' as const,
          primaryLanguages: parsed.data.primaryLanguages || [],
          experienceYears: parsed.data.experienceYears || 0,
          familiarity: parsed.data.familiarity || {},
        }
      : undefined;

    const pathId = await onboardingService.generatePersonalizedPath(
      repositoryId,
      user?.id ?? '',
      assessment
    );

    const path = await onboardingService.getPath(pathId);

    return c.json({
      message: 'Personalized path generated',
      path,
    });
  } catch (error) {
    console.error('Failed to generate path:', error);
    return c.json({ error: 'Failed to generate path' }, 500);
  }
});

// Create a new onboarding path manually
const createPathSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  targetRole: z.enum(['frontend', 'backend', 'fullstack', 'devops', 'newbie', 'data']),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
  estimatedHours: z.number().min(0.5).max(100),
  prerequisites: z.array(z.string()).optional(),
  isDefault: z.boolean().optional(),
  steps: z.array(z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    stepType: z.enum(['read_doc', 'run_example', 'quiz', 'code_task', 'checkpoint']),
    contentId: z.string().optional(),
    content: z.record(z.string(), z.unknown()).optional(),
    estimatedMins: z.number().min(1).max(180),
    isOptional: z.boolean().optional(),
  })).optional(),
});

router.post('/create/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const body = await c.req.json();

  const parsed = createPathSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const pathId = await onboardingService.createPath({
      repositoryId,
      title: parsed.data.title,
      description: parsed.data.description,
      targetRole: parsed.data.targetRole,
      difficulty: parsed.data.difficulty,
      estimatedHours: parsed.data.estimatedHours,
      prerequisites: parsed.data.prerequisites,
      isDefault: parsed.data.isDefault,
      steps: parsed.data.steps,
    });

    return c.json({
      message: 'Onboarding path created',
      pathId,
    });
  } catch (error) {
    console.error('Failed to create path:', error);
    return c.json({ error: 'Failed to create path' }, 500);
  }
});

// List paths for a repository
router.get('/paths/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';

  const paths = await onboardingService.listPaths(repositoryId);

  return c.json({ paths });
});

// Get a specific path with all steps
router.get('/path/:pathId', async (c) => {
  const pathId = c.req.param('pathId') ?? '';

  const path = await onboardingService.getPath(pathId);

  if (!path) {
    return c.json({ error: 'Path not found' }, 404);
  }

  return c.json(path);
});

// Start a path for the current user
router.post('/start/:pathId', async (c) => {
  const { pathId } = c.req.param();
  const user = c.get('user');

  const path = await onboardingService.getPath(pathId);
  if (!path) {
    return c.json({ error: 'Path not found' }, 404);
  }

  try {
    await onboardingService.startPath(pathId, user.id);

    return c.json({
      message: 'Path started',
      pathId,
    });
  } catch (error) {
    console.error('Failed to start path:', error);
    return c.json({ error: 'Failed to start path' }, 500);
  }
});

// Get user's progress on a path
router.get('/progress/:pathId', async (c) => {
  const { pathId } = c.req.param();
  const user = c.get('user');

  const progress = await onboardingService.getProgress(pathId, user.id);

  if (!progress) {
    return c.json({ error: 'Not enrolled in this path' }, 404);
  }

  const path = await onboardingService.getPath(pathId);

  return c.json({
    path,
    progress,
    currentStep: path?.steps[progress.currentStepIdx],
  });
});

// Complete a step
router.post('/complete/:pathId/:stepId', async (c) => {
  const { pathId, stepId } = c.req.param();
  const user = c.get('user');

  try {
    await onboardingService.completeStep(pathId, user.id, stepId);

    const progress = await onboardingService.getProgress(pathId, user.id);

    return c.json({
      message: 'Step completed',
      progress,
    });
  } catch (error) {
    console.error('Failed to complete step:', error);
    return c.json({ error: 'Failed to complete step' }, 500);
  }
});

// Get all paths user is enrolled in
router.get('/my-paths', async (c) => {
  const user = c.get('user');

  const paths = await onboardingService.getUserPaths(user.id);

  return c.json({ paths });
});

// Get recommended path for a repository
router.get('/recommended/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  // Get default path if exists
  const defaultPath = await db.onboardingPath.findFirst({
    where: {
      repositoryId,
      isDefault: true,
    },
  });

  if (defaultPath) {
    const path = await onboardingService.getPath(defaultPath.id);
    return c.json({ recommended: path });
  }

  // Otherwise, get most popular
  const paths = await onboardingService.listPaths(repositoryId);
  const firstPath = paths[0];
  if (firstPath) {
    const path = await onboardingService.getPath(firstPath.id);
    return c.json({ recommended: path });
  }

  return c.json({ recommended: null });
});

export default router;
