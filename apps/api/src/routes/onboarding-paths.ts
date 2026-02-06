/**
 * Personalized Onboarding Paths API Routes
 *
 * Provides personalized learning journeys with adaptive learning,
 * progress tracking, and achievement systems.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
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

// ============================================================================
// Adaptive Learning Enhancements
// ============================================================================

// Submit quiz answer and get feedback
const submitQuizSchema = z.object({
  questionIndex: z.number().min(0),
  answer: z.string().min(1),
  timeSpentSeconds: z.number().optional(),
});

router.post('/quiz/:pathId/:stepId', async (c) => {
  const { pathId, stepId } = c.req.param();
  const user = c.get('user');
  const body = await c.req.json();

  const parsed = submitQuizSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  const path = await onboardingService.getPath(pathId);
  if (!path) {
    return c.json({ error: 'Path not found' }, 404);
  }

  const step = path.steps.find((s) => s.id === stepId);
  if (!step || step.stepType !== 'quiz') {
    return c.json({ error: 'Quiz step not found' }, 404);
  }

  // Store quiz response (for adaptive learning)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  await db.quizResponse.create({
    data: {
      id: crypto.randomUUID(),
      pathId,
      stepId,
      userId: user.id,
      questionIndex: parsed.data.questionIndex,
      answer: parsed.data.answer,
      timeSpentSeconds: parsed.data.timeSpentSeconds,
    },
  }).catch(() => {
    // Table might not exist yet
  });

  return c.json({
    submitted: true,
    questionIndex: parsed.data.questionIndex,
  });
});

// Get learning analytics for user
router.get('/analytics', async (c) => {
  const user = c.get('user');

  const userPaths = await onboardingService.getUserPaths(user.id);

  // Calculate analytics
  const totalPaths = userPaths.length;
  const completedPaths = userPaths.filter((p) => p.progress.completedAt).length;
  const inProgressPaths = totalPaths - completedPaths;

  const totalProgress = userPaths.reduce((sum, p) => sum + p.progress.progress, 0);
  const averageProgress = totalPaths > 0 ? Math.round(totalProgress / totalPaths) : 0;

  const totalStepsCompleted = userPaths.reduce(
    (sum, p) => sum + p.progress.completedSteps.length,
    0
  );

  // Calculate time spent (estimated from completed steps)
  const estimatedHoursSpent = userPaths.reduce((sum, p) => {
    const completedRatio = p.progress.progress / 100;
    return sum + p.path.estimatedHours * completedRatio;
  }, 0);

  // Get streak data
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const recentActivity = userPaths
    .filter((p) => {
      const lastActivity = new Date(p.progress.lastActivityAt);
      const daysSince = Math.floor(
        (today.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000)
      );
      return daysSince <= 7;
    })
    .map((p) => ({
      pathId: p.path.id,
      pathTitle: p.path.title,
      lastActivity: p.progress.lastActivityAt,
      progress: p.progress.progress,
    }));

  return c.json({
    overview: {
      totalPaths,
      completedPaths,
      inProgressPaths,
      averageProgress,
      totalStepsCompleted,
      estimatedHoursSpent: Math.round(estimatedHoursSpent * 10) / 10,
    },
    recentActivity,
    achievements: await getAchievements(user.id, userPaths),
  });
});

// Helper function to calculate achievements
async function getAchievements(
  userId: string,
  userPaths: Array<{
    path: { id: string; title: string; difficulty: string };
    progress: { progress: number; completedAt?: Date; completedSteps: string[] };
  }>
): Promise<Array<{ id: string; title: string; description: string; earned: boolean; earnedAt?: Date }>> {
  const achievements = [
    {
      id: 'first_path',
      title: 'First Steps',
      description: 'Started your first learning path',
      check: () => userPaths.length > 0,
    },
    {
      id: 'path_completed',
      title: 'Path Master',
      description: 'Completed a learning path',
      check: () => userPaths.some((p) => p.progress.completedAt),
    },
    {
      id: 'three_paths',
      title: 'Knowledge Seeker',
      description: 'Started 3 or more learning paths',
      check: () => userPaths.length >= 3,
    },
    {
      id: 'advanced_path',
      title: 'Advanced Learner',
      description: 'Completed an advanced difficulty path',
      check: () =>
        userPaths.some((p) => p.path.difficulty === 'advanced' && p.progress.completedAt),
    },
    {
      id: 'ten_steps',
      title: 'Step by Step',
      description: 'Completed 10 steps across all paths',
      check: () => {
        const totalSteps = userPaths.reduce(
          (sum, p) => sum + p.progress.completedSteps.length,
          0
        );
        return totalSteps >= 10;
      },
    },
    {
      id: 'fifty_steps',
      title: 'Documentation Expert',
      description: 'Completed 50 steps across all paths',
      check: () => {
        const totalSteps = userPaths.reduce(
          (sum, p) => sum + p.progress.completedSteps.length,
          0
        );
        return totalSteps >= 50;
      },
    },
  ];

  return achievements.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    earned: a.check(),
    earnedAt: a.check() ? new Date() : undefined, // Simplified - would track actual dates
  }));
}

// Clone a path to another repository
router.post('/clone/:pathId', requireOrgAccess, async (c) => {
  const { pathId } = c.req.param();
  const body = await c.req.json<{ targetRepositoryId: string; title?: string }>();

  if (!body.targetRepositoryId) {
    return c.json({ error: 'targetRepositoryId is required' }, 400);
  }

  if (!pathId) {
    return c.json({ error: 'pathId is required' }, 400);
  }

  const sourcePath = await onboardingService.getPath(pathId);
  if (!sourcePath) {
    return c.json({ error: 'Source path not found' }, 404);
  }

  const targetRepo = await prisma.repository.findUnique({
    where: { id: body.targetRepositoryId },
  });

  if (!targetRepo) {
    return c.json({ error: 'Target repository not found' }, 404);
  }

  try {
    const newPathId = await onboardingService.createPath({
      repositoryId: body.targetRepositoryId,
      title: body.title || `${sourcePath.title} (Cloned)`,
      description: sourcePath.description,
      targetRole: sourcePath.targetRole,
      difficulty: sourcePath.difficulty,
      estimatedHours: sourcePath.estimatedHours,
      prerequisites: sourcePath.prerequisites,
      isDefault: false,
      steps: sourcePath.steps.map((s) => ({
        title: s.title,
        description: s.description,
        stepType: s.stepType,
        content: s.content,
        estimatedMins: s.estimatedMins,
        isOptional: s.isOptional,
        // Note: contentId references are cleared as they may not exist in target repo
      })),
    });

    return c.json({
      message: 'Path cloned successfully',
      pathId: newPathId,
      sourcePathId: pathId,
      targetRepositoryId: body.targetRepositoryId,
    });
  } catch (error) {
    console.error('Failed to clone path:', error);
    return c.json({ error: 'Failed to clone path' }, 500);
  }
});

// Get path templates (popular paths that can be cloned)
router.get('/templates', requireOrgAccess, async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  // Find paths marked as default or with high completion rates
  const templates = await db.onboardingPath.findMany({
    where: {
      OR: [
        { isDefault: true },
        // Could add: paths with high completion rates
      ],
    },
    take: 20,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      targetRole: true,
      difficulty: true,
      estimatedHours: true,
      prerequisites: true,
      repository: {
        select: { name: true },
      },
      _count: {
        select: { steps: true },
      },
    },
  });

  return c.json({
    templates: templates.map((t: {
      id: string;
      title: string;
      description: string | null;
      targetRole: string;
      difficulty: string;
      estimatedHours: number;
      prerequisites: string[];
      repository: { name: string };
      _count: { steps: number };
    }) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      targetRole: t.targetRole,
      difficulty: t.difficulty,
      estimatedHours: t.estimatedHours,
      prerequisites: t.prerequisites,
      repositoryName: t.repository?.name,
      stepCount: t._count?.steps || 0,
    })),
  });
});

// Get suggested next steps based on current progress
router.get('/suggestions/:pathId', async (c) => {
  const { pathId } = c.req.param();
  const user = c.get('user');

  const path = await onboardingService.getPath(pathId);
  if (!path) {
    return c.json({ error: 'Path not found' }, 404);
  }

  const progress = await onboardingService.getProgress(pathId, user.id);
  if (!progress) {
    return c.json({ error: 'Not enrolled in this path' }, 404);
  }

  const completedSet = new Set(progress.completedSteps);

  // Find next uncompleted steps
  const nextSteps = path.steps
    .filter((s) => !completedSet.has(s.id))
    .slice(0, 3);

  // Find optional steps that might be interesting
  const optionalSteps = path.steps
    .filter((s) => s.isOptional && !completedSet.has(s.id))
    .slice(0, 2);

  // Suggest related paths (same repository, different difficulty)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  const relatedPaths = await db.onboardingPath.findMany({
    where: {
      repositoryId: path.repositoryId,
      id: { not: pathId },
    },
    take: 3,
    select: {
      id: true,
      title: true,
      difficulty: true,
      estimatedHours: true,
    },
  });

  return c.json({
    currentProgress: progress.progress,
    nextSteps: nextSteps.map((s) => ({
      id: s.id,
      title: s.title,
      type: s.stepType,
      estimatedMins: s.estimatedMins,
    })),
    optionalSteps: optionalSteps.map((s) => ({
      id: s.id,
      title: s.title,
      type: s.stepType,
      estimatedMins: s.estimatedMins,
    })),
    relatedPaths,
  });
});

// Update path (for maintainers)
router.put('/path/:pathId', requireOrgAccess, async (c) => {
  const { pathId } = c.req.param();
  const body = await c.req.json<{
    title?: string;
    description?: string;
    isDefault?: boolean;
  }>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  const path = await db.onboardingPath.findUnique({
    where: { id: pathId },
  });

  if (!path) {
    return c.json({ error: 'Path not found' }, 404);
  }

  const updated = await db.onboardingPath.update({
    where: { id: pathId },
    data: {
      ...(body.title && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
    },
  });

  return c.json({
    message: 'Path updated',
    path: updated,
  });
});

// Delete a path
router.delete('/path/:pathId', requireOrgAccess, async (c) => {
  const { pathId } = c.req.param();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  const path = await db.onboardingPath.findUnique({
    where: { id: pathId },
  });

  if (!path) {
    return c.json({ error: 'Path not found' }, 404);
  }

  // Delete steps first
  await db.onboardingStep.deleteMany({
    where: { pathId },
  });

  // Delete progress records
  await db.onboardingPathProgress.deleteMany({
    where: { pathId },
  });

  // Delete the path
  await db.onboardingPath.delete({
    where: { id: pathId },
  });

  return c.json({ message: 'Path deleted' });
});

export default router;
