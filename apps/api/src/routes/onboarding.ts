import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { NotFoundError, ValidationError, generateId } from '@docsynth/utils';

const app = new Hono();

// Local types for onboarding
interface OnboardingPath {
  id: string;
  repositoryId: string;
  name: string;
  description: string;
  role: 'frontend' | 'backend' | 'fullstack' | 'devops' | 'general';
  estimatedDuration: number;
  steps: OnboardingStep[];
  createdAt: Date;
}

interface OnboardingStep {
  id: string;
  order: number;
  title: string;
  description: string;
  documentIds: string[];
  conceptIds: string[];
  checklistItems: string[];
  estimatedDuration: number;
}

interface OnboardingProgress {
  userId: string;
  pathId: string;
  completedSteps: string[];
  currentStepId: string;
  startedAt: Date;
  lastActivityAt: Date;
}

// In-memory progress store (in production, use database)
const progressStore = new Map<string, OnboardingProgress>();

// Generate onboarding path for a repository
app.post('/generate', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    role: OnboardingPath['role'];
    customFocus?: string;
  }>();

  if (!body.repositoryId || !body.role) {
    throw new ValidationError('repositoryId and role are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
    include: {
      documents: {
        select: { id: true, path: true, type: true, title: true, content: true },
        orderBy: { type: 'asc' },
      },
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Generate role-based onboarding path
  const path = await generateOnboardingPath(
    repository,
    body.role,
    body.customFocus
  );

  return c.json({
    success: true,
    data: path,
  }, 201);
});

// Get onboarding paths for a repository
app.get('/:repositoryId/paths', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Check for stored paths in metadata
  const metadata = repository.metadata as Record<string, unknown> ?? {};
  const paths = (metadata.onboardingPaths as OnboardingPath[]) ?? [];

  return c.json({
    success: true,
    data: paths,
  });
});

// Start an onboarding path
app.post('/paths/:pathId/start', requireAuth, async (c) => {
  const pathId = c.req.param('pathId');
  const userId = c.get('userId');

  const progressId = `${userId}-${pathId}`;
  const existing = progressStore.get(progressId);

  if (existing) {
    return c.json({
      success: true,
      data: existing,
      message: 'Continuing existing progress',
    });
  }

  const progress: OnboardingProgress = {
    userId,
    pathId,
    completedSteps: [],
    currentStepId: 'step-1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
  };

  progressStore.set(progressId, progress);

  return c.json({
    success: true,
    data: progress,
  }, 201);
});

// Get onboarding progress
app.get('/progress', requireAuth, async (c) => {
  const userId = c.get('userId');
  const pathId = c.req.query('pathId');

  if (pathId) {
    const progress = progressStore.get(`${userId}-${pathId}`);
    return c.json({
      success: true,
      data: progress ?? null,
    });
  }

  // Get all progress for user
  const userProgress: OnboardingProgress[] = [];
  progressStore.forEach((progress, key) => {
    if (key.startsWith(`${userId}-`)) {
      userProgress.push(progress);
    }
  });

  return c.json({
    success: true,
    data: userProgress,
  });
});

// Complete a step
app.post('/paths/:pathId/steps/:stepId/complete', requireAuth, async (c) => {
  const pathId = c.req.param('pathId');
  const stepId = c.req.param('stepId');
  const userId = c.get('userId');

  const progressId = `${userId}-${pathId}`;
  const progress = progressStore.get(progressId);

  if (!progress) {
    throw new NotFoundError('Onboarding progress', progressId);
  }

  if (!progress.completedSteps.includes(stepId)) {
    progress.completedSteps.push(stepId);
  }

  // Move to next step
  const stepNumber = parseInt(stepId.replace('step-', ''), 10);
  progress.currentStepId = `step-${stepNumber + 1}`;
  progress.lastActivityAt = new Date();

  progressStore.set(progressId, progress);

  return c.json({
    success: true,
    data: progress,
  });
});

// Helper: Generate onboarding path based on role
async function generateOnboardingPath(
  repository: {
    id: string;
    name: string;
    documents: { id: string; path: string; type: string; title: string; content: string }[];
  },
  role: OnboardingPath['role'],
  customFocus?: string
): Promise<OnboardingPath> {
  const roleDescriptions = {
    frontend: 'frontend developer focused on UI, components, and user experience',
    backend: 'backend developer focused on APIs, services, and data',
    fullstack: 'fullstack developer working across the entire stack',
    devops: 'DevOps engineer focused on deployment, CI/CD, and infrastructure',
    general: 'general contributor wanting to understand the project',
  };

  // Organize documents by relevance to role
  const relevantDocs = prioritizeDocumentsForRole(repository.documents, role);

  // Generate steps from documents
  const steps: OnboardingStep[] = [];
  let totalDuration = 0;

  // Step 1: Always start with README/Overview
  const readmeDocs = relevantDocs.filter((d) => d.type === 'README');
  if (readmeDocs.length > 0) {
    steps.push({
      id: 'step-1',
      order: 1,
      title: 'Project Overview',
      description: 'Understand what this project does and its main features',
      documentIds: readmeDocs.map((d) => d.id),
      conceptIds: [],
      checklistItems: [
        'Read the project README',
        'Understand the main purpose',
        'Review the feature list',
        'Check setup requirements',
      ],
      estimatedDuration: 15,
    });
    totalDuration += 15;
  }

  // Step 2: Architecture (for technical roles)
  if (['backend', 'fullstack', 'devops'].includes(role)) {
    const archDocs = relevantDocs.filter((d) => d.type === 'ARCHITECTURE');
    if (archDocs.length > 0) {
      steps.push({
        id: `step-${steps.length + 1}`,
        order: steps.length + 1,
        title: 'System Architecture',
        description: 'Learn about the system architecture and components',
        documentIds: archDocs.map((d) => d.id),
        conceptIds: [],
        checklistItems: [
          'Review architecture diagrams',
          'Understand component responsibilities',
          'Learn about data flow',
        ],
        estimatedDuration: 20,
      });
      totalDuration += 20;
    }
  }

  // Step 3: API Documentation (for backend/fullstack)
  if (['backend', 'fullstack', 'frontend'].includes(role)) {
    const apiDocs = relevantDocs.filter((d) => d.type === 'API_REFERENCE');
    if (apiDocs.length > 0) {
      steps.push({
        id: `step-${steps.length + 1}`,
        order: steps.length + 1,
        title: 'API Reference',
        description: 'Learn about the available APIs and endpoints',
        documentIds: apiDocs.map((d) => d.id),
        conceptIds: [],
        checklistItems: [
          'Review API endpoints',
          'Understand authentication',
          'Try example requests',
        ],
        estimatedDuration: 25,
      });
      totalDuration += 25;
    }
  }

  // Step 4: Guides and Tutorials
  const guideDocs = relevantDocs.filter((d) => ['GUIDE', 'TUTORIAL'].includes(d.type));
  if (guideDocs.length > 0) {
    steps.push({
      id: `step-${steps.length + 1}`,
      order: steps.length + 1,
      title: 'Getting Hands-On',
      description: 'Follow tutorials and guides to start working with the codebase',
      documentIds: guideDocs.slice(0, 3).map((d) => d.id),
      conceptIds: [],
      checklistItems: [
        'Complete a beginner tutorial',
        'Set up your development environment',
        'Make your first change',
      ],
      estimatedDuration: 30,
    });
    totalDuration += 30;
  }

  // Step 5: Contributing/ADRs
  const contributingDocs = relevantDocs.filter((d) => d.type === 'ADR');
  steps.push({
    id: `step-${steps.length + 1}`,
    order: steps.length + 1,
    title: 'Contributing Guidelines',
    description: 'Learn how to contribute effectively to this project',
    documentIds: contributingDocs.slice(0, 2).map((d) => d.id),
    conceptIds: [],
    checklistItems: [
      'Review coding standards',
      'Understand the PR process',
      'Learn about testing requirements',
    ],
    estimatedDuration: 15,
  });
  totalDuration += 15;

  return {
    id: generateId('path'),
    repositoryId: repository.id,
    name: `${repository.name} Onboarding (${role})`,
    description: `Onboarding path for a ${roleDescriptions[role]}. ${customFocus ? `Focus: ${customFocus}` : ''}`,
    role,
    estimatedDuration: totalDuration,
    steps,
    createdAt: new Date(),
  };
}

// Helper: Prioritize documents based on role
function prioritizeDocumentsForRole(
  documents: { id: string; path: string; type: string; title: string; content: string }[],
  role: OnboardingPath['role']
): typeof documents {
  const rolePriorities: Record<OnboardingPath['role'], string[]> = {
    frontend: ['README', 'GUIDE', 'TUTORIAL', 'API_REFERENCE', 'ARCHITECTURE'],
    backend: ['README', 'ARCHITECTURE', 'API_REFERENCE', 'ADR', 'GUIDE'],
    fullstack: ['README', 'ARCHITECTURE', 'API_REFERENCE', 'GUIDE', 'TUTORIAL'],
    devops: ['README', 'ARCHITECTURE', 'ADR', 'GUIDE', 'CHANGELOG'],
    general: ['README', 'GUIDE', 'TUTORIAL', 'ARCHITECTURE', 'API_REFERENCE'],
  };

  const priorities = rolePriorities[role] ?? rolePriorities.general;

  return [...documents].sort((a, b) => {
    const aIndex = priorities.indexOf(a.type);
    const bIndex = priorities.indexOf(b.type);
    const aPriority = aIndex === -1 ? 100 : aIndex;
    const bPriority = bIndex === -1 ? 100 : bIndex;
    return aPriority - bPriority;
  });
}

export { app as onboardingRoutes };
