import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { NotFoundError, ValidationError, createLogger } from '@docsynth/utils';

const log = createLogger('onboarding-copilot');

// Type assertion for new Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

// ============================================================================
// Path Generation
// ============================================================================

// Generate personalized onboarding path
app.post('/paths/generate', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId') as string;
  const body = await c.req.json<{
    repositoryId: string;
    role: string;
    userId: string;
    teamContext?: string;
  }>();

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  if (!body.role) {
    throw new ValidationError('role is required');
  }

  if (!body.userId) {
    throw new ValidationError('userId is required');
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Gather repository documents for context
  const documents = await prisma.document.findMany({
    where: { repositoryId: body.repositoryId },
    select: { id: true, path: true, type: true, title: true },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  // Build onboarding steps based on role and available documentation
  const steps = generateStepsForRole(body.role, documents, body.teamContext);

  // Calculate estimated total time
  const estimatedMinutes = steps.reduce((sum, step) => sum + step.estimatedMins, 0);

  // Create the onboarding path
  const path = await db.onboardingCopilotPath.create({
    data: {
      repositoryId: body.repositoryId,
      organizationId: orgId,
      userId: body.userId,
      role: body.role,
      teamContext: body.teamContext,
      steps,
      estimatedMinutes,
      status: 'active',
      progress: 0,
      createdAt: new Date(),
    },
  });

  log.info({
    pathId: path.id,
    repositoryId: body.repositoryId,
    userId: body.userId,
    role: body.role,
    stepCount: steps.length,
  }, 'Onboarding path generated');

  return c.json({
    success: true,
    data: {
      pathId: path.id,
      repositoryId: body.repositoryId,
      role: body.role,
      steps,
      estimatedMinutes,
      status: 'active',
    },
  }, 201);
});

// ============================================================================
// Path Management
// ============================================================================

// Get a specific onboarding path with steps
app.get('/paths/:pathId', requireAuth, requireOrgAccess, async (c) => {
  const pathId = c.req.param('pathId') ?? '';
  const orgId = c.get('organizationId') as string;

  const path = await db.onboardingCopilotPath.findFirst({
    where: { id: pathId, organizationId: orgId },
  });

  if (!path) {
    throw new NotFoundError('OnboardingCopilotPath', pathId);
  }

  return c.json({
    success: true,
    data: path,
  });
});

// List paths for user
app.get('/paths', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId') as string;
  const { userId, limit, offset } = c.req.query();

  const whereClause: Record<string, unknown> = { organizationId: orgId };
  if (userId) whereClause.userId = userId;

  const [paths, total] = await Promise.all([
    db.onboardingCopilotPath.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit ? parseInt(limit, 10) : 20,
      skip: offset ? parseInt(offset, 10) : 0,
    }),
    db.onboardingCopilotPath.count({ where: whereClause }),
  ]);

  return c.json({
    success: true,
    data: { paths, total },
  });
});

// ============================================================================
// Progress Tracking
// ============================================================================

// Update progress on a step
app.put('/paths/:pathId/progress', requireAuth, requireOrgAccess, async (c) => {
  const pathId = c.req.param('pathId') ?? '';
  const orgId = c.get('organizationId') as string;
  const body = await c.req.json<{
    stepId: string;
    completed: boolean;
    timeSpent?: number;
  }>();

  if (!body.stepId) {
    throw new ValidationError('stepId is required');
  }

  if (typeof body.completed !== 'boolean') {
    throw new ValidationError('completed must be a boolean');
  }

  const path = await db.onboardingCopilotPath.findFirst({
    where: { id: pathId, organizationId: orgId },
  });

  if (!path) {
    throw new NotFoundError('OnboardingCopilotPath', pathId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps = (path.steps as any[]) || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stepIndex = steps.findIndex((s: any) => s.id === body.stepId);

  if (stepIndex === -1) {
    throw new NotFoundError('Step', body.stepId);
  }

  // Update the step's completion status
  steps[stepIndex].completed = body.completed;
  steps[stepIndex].completedAt = body.completed ? new Date().toISOString() : null;
  if (body.timeSpent !== undefined) {
    steps[stepIndex].timeSpent = body.timeSpent;
  }

  // Recalculate overall progress
  const completedCount = steps.filter((s: { completed?: boolean }) => s.completed).length;
  const progress = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

  const isComplete = progress === 100;

  const updated = await db.onboardingCopilotPath.update({
    where: { id: pathId },
    data: {
      steps,
      progress,
      status: isComplete ? 'completed' : 'active',
      completedAt: isComplete ? new Date() : null,
    },
  });

  log.info({
    pathId,
    stepId: body.stepId,
    completed: body.completed,
    progress,
  }, 'Onboarding step progress updated');

  return c.json({
    success: true,
    data: {
      pathId,
      stepId: body.stepId,
      completed: body.completed,
      progress: updated.progress,
      status: updated.status,
    },
  });
});

// ============================================================================
// Analytics
// ============================================================================

// Get analytics for a path
app.get('/paths/:pathId/analytics', requireAuth, requireOrgAccess, async (c) => {
  const pathId = c.req.param('pathId') ?? '';
  const orgId = c.get('organizationId') as string;

  const path = await db.onboardingCopilotPath.findFirst({
    where: { id: pathId, organizationId: orgId },
  });

  if (!path) {
    throw new NotFoundError('OnboardingCopilotPath', pathId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps = (path.steps as any[]) || [];
  const completedSteps = steps.filter((s: { completed?: boolean }) => s.completed);
  const totalTimeSpent = steps.reduce((sum: number, s: { timeSpent?: number }) => sum + (s.timeSpent || 0), 0);

  // Identify bottleneck steps (steps that took longest relative to estimate)
  const bottleneckSteps = steps
    .filter((s: { timeSpent?: number; estimatedMins?: number }) => s.timeSpent && s.estimatedMins)
    .map((s: { id: string; title: string; timeSpent: number; estimatedMins: number }) => ({
      stepId: s.id,
      title: s.title,
      timeSpent: s.timeSpent,
      estimatedMins: s.estimatedMins,
      overagePercent: Math.round(((s.timeSpent - s.estimatedMins) / s.estimatedMins) * 100),
    }))
    .filter((s) => s.overagePercent > 0)
    .sort((a, b) => b.overagePercent - a.overagePercent)
    .slice(0, 5);

  // Calculate average time per step
  const avgTimePerStep = completedSteps.length > 0
    ? Math.round(totalTimeSpent / completedSteps.length)
    : 0;

  return c.json({
    success: true,
    data: {
      pathId,
      completionRate: path.progress,
      totalSteps: steps.length,
      completedSteps: completedSteps.length,
      remainingSteps: steps.length - completedSteps.length,
      totalTimeSpent,
      avgTimePerStep,
      estimatedMinutes: path.estimatedMinutes,
      bottleneckSteps,
      status: path.status,
    },
  });
});

// ============================================================================
// Quiz
// ============================================================================

// Submit quiz answer for a step
app.post('/paths/:pathId/quiz', requireAuth, requireOrgAccess, async (c) => {
  const pathId = c.req.param('pathId') ?? '';
  const orgId = c.get('organizationId') as string;
  const userId = c.get('userId') as string;
  const body = await c.req.json<{
    stepId: string;
    answers: Array<{ questionId: string; answer: string }>;
  }>();

  if (!body.stepId) {
    throw new ValidationError('stepId is required');
  }

  if (!body.answers || body.answers.length === 0) {
    throw new ValidationError('answers are required');
  }

  const path = await db.onboardingCopilotPath.findFirst({
    where: { id: pathId, organizationId: orgId },
  });

  if (!path) {
    throw new NotFoundError('OnboardingCopilotPath', pathId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps = (path.steps as any[]) || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const step = steps.find((s: any) => s.id === body.stepId);

  if (!step) {
    throw new NotFoundError('Step', body.stepId);
  }

  // Store the quiz submission
  const submission = await db.onboardingCopilotQuizSubmission.create({
    data: {
      pathId,
      stepId: body.stepId,
      userId,
      answers: body.answers,
      submittedAt: new Date(),
    },
  });

  log.info({
    pathId,
    stepId: body.stepId,
    userId,
    answerCount: body.answers.length,
  }, 'Quiz answers submitted');

  return c.json({
    success: true,
    data: {
      submissionId: submission.id,
      pathId,
      stepId: body.stepId,
      message: 'Quiz answers submitted successfully',
    },
  });
});

// ============================================================================
// Recommendations
// ============================================================================

// Get onboarding recommendations based on repo analysis
app.get('/recommendations/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const orgId = c.get('organizationId') as string;

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Gather repository data for recommendations
  const [documents, existingPaths] = await Promise.all([
    prisma.document.findMany({
      where: { repositoryId },
      select: { id: true, path: true, type: true, title: true, content: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
    db.onboardingCopilotPath.findMany({
      where: { repositoryId },
      select: { role: true, progress: true, status: true },
    }),
  ]);

  // Analyze document types for recommendations
  const docTypes = new Map<string, number>();
  for (const doc of documents) {
    docTypes.set(doc.type, (docTypes.get(doc.type) || 0) + 1);
  }

  // Determine which document types have good coverage
  const hasReadme = documents.some((d) => d.type === 'README');
  const hasApiDocs = documents.some((d) => d.type === 'API_REFERENCE');
  const hasGuides = documents.some((d) => d.type === 'GUIDE');
  const hasArchitecture = documents.some((d) => d.type === 'ARCHITECTURE');

  // Build recommendations
  const recommendations: Array<{
    type: string;
    priority: 'high' | 'medium' | 'low';
    title: string;
    description: string;
  }> = [];

  if (!hasReadme) {
    recommendations.push({
      type: 'missing_doc',
      priority: 'high',
      title: 'Add README documentation',
      description: 'A README is essential for new team members to get started quickly.',
    });
  }

  if (!hasArchitecture) {
    recommendations.push({
      type: 'missing_doc',
      priority: 'medium',
      title: 'Add architecture documentation',
      description: 'Architecture docs help new developers understand the system design.',
    });
  }

  if (!hasGuides) {
    recommendations.push({
      type: 'missing_doc',
      priority: 'medium',
      title: 'Create getting started guides',
      description: 'Step-by-step guides reduce onboarding time significantly.',
    });
  }

  if (!hasApiDocs) {
    recommendations.push({
      type: 'missing_doc',
      priority: 'medium',
      title: 'Add API reference documentation',
      description: 'API references are critical for developers integrating with this codebase.',
    });
  }

  // Suggest roles based on existing paths
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingRoles = new Set(existingPaths.map((p: any) => p.role));
  const suggestedRoles = ['frontend', 'backend', 'fullstack', 'devops', 'data'].filter(
    (role) => !existingRoles.has(role)
  );

  if (suggestedRoles.length > 0) {
    recommendations.push({
      type: 'new_path',
      priority: 'low',
      title: `Create paths for: ${suggestedRoles.join(', ')}`,
      description: 'Consider creating role-specific onboarding paths for broader team coverage.',
    });
  }

  // Calculate completion stats from existing paths
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pathStats = existingPaths.reduce((acc: { total: number; completed: number; avgProgress: number }, p: any) => {
    acc.total++;
    if (p.status === 'completed') acc.completed++;
    acc.avgProgress += p.progress || 0;
    return acc;
  }, { total: 0, completed: 0, avgProgress: 0 });

  if (pathStats.total > 0) {
    pathStats.avgProgress = Math.round(pathStats.avgProgress / pathStats.total);
  }

  return c.json({
    success: true,
    data: {
      repositoryId,
      documentCoverage: {
        total: documents.length,
        byType: Object.fromEntries(docTypes),
        hasReadme,
        hasApiDocs,
        hasGuides,
        hasArchitecture,
      },
      existingPaths: pathStats,
      recommendations,
      suggestedRoles,
    },
  });
});

// ============================================================================
// Helpers
// ============================================================================

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  type: 'read_doc' | 'explore_code' | 'quiz' | 'task' | 'checkpoint';
  estimatedMins: number;
  completed: boolean;
  completedAt: string | null;
  timeSpent: number | null;
  documentId?: string;
}

function generateStepsForRole(
  role: string,
  documents: Array<{ id: string; path: string; type: string; title: string }>,
  teamContext?: string,
): OnboardingStep[] {
  const steps: OnboardingStep[] = [];
  let stepCounter = 0;

  const makeStep = (
    title: string,
    description: string,
    type: OnboardingStep['type'],
    estimatedMins: number,
    documentId?: string,
  ): OnboardingStep => ({
    id: `step_${++stepCounter}`,
    title,
    description,
    type,
    estimatedMins,
    completed: false,
    completedAt: null,
    timeSpent: null,
    documentId,
  });

  // Always start with README
  const readme = documents.find((d) => d.type === 'README');
  if (readme) {
    steps.push(makeStep(
      'Read the project README',
      'Start by reading the project overview and setup instructions.',
      'read_doc',
      10,
      readme.id,
    ));
  }

  // Architecture docs early on
  const archDoc = documents.find((d) => d.type === 'ARCHITECTURE');
  if (archDoc) {
    steps.push(makeStep(
      'Understand the architecture',
      'Review the system architecture and key design decisions.',
      'read_doc',
      20,
      archDoc.id,
    ));
  }

  // Role-specific steps
  if (role === 'frontend' || role === 'fullstack') {
    const guides = documents.filter((d) => d.type === 'GUIDE');
    for (const guide of guides.slice(0, 3)) {
      steps.push(makeStep(
        `Read guide: ${guide.title}`,
        'Follow this guide to understand frontend patterns and conventions.',
        'read_doc',
        15,
        guide.id,
      ));
    }
  }

  if (role === 'backend' || role === 'fullstack') {
    const apiDocs = documents.filter((d) => d.type === 'API_REFERENCE');
    for (const apiDoc of apiDocs.slice(0, 3)) {
      steps.push(makeStep(
        `Review API: ${apiDoc.title}`,
        'Understand the API endpoints and data models.',
        'read_doc',
        15,
        apiDoc.id,
      ));
    }
  }

  if (role === 'devops') {
    steps.push(makeStep(
      'Review deployment pipeline',
      'Understand the CI/CD pipeline and deployment processes.',
      'explore_code',
      20,
    ));
  }

  // Add exploration and checkpoint steps
  steps.push(makeStep(
    'Explore the codebase',
    'Navigate through the project structure and key modules.',
    'explore_code',
    30,
  ));

  if (teamContext) {
    steps.push(makeStep(
      'Review team context',
      `Understand the team-specific context: ${teamContext}`,
      'read_doc',
      15,
    ));
  }

  steps.push(makeStep(
    'Knowledge check',
    'Complete a short quiz to verify your understanding of the project.',
    'quiz',
    10,
  ));

  steps.push(makeStep(
    'Onboarding checkpoint',
    'Meet with your team lead to discuss what you have learned and clarify any questions.',
    'checkpoint',
    15,
  ));

  return steps;
}

export { app as onboardingCopilotRoutes };
