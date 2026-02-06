/**
 * Onboarding Paths Worker
 *
 * Processes background jobs for generating personalized developer onboarding paths.
 * Analyzes codebase structure and creates role-specific learning modules.
 */

import { createWorker, QUEUE_NAMES, type OnboardingPathJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger, createLLMClient, generateId } from '@docsynth/utils';
import { getOctokit } from '@docsynth/github';
import type { DeveloperRole } from '../../../api/src/services/onboarding-paths.service.js';

const log = createLogger('onboarding-paths-worker');

interface CodebaseMetrics {
  fileCount: number;
  directoryCount: number;
  languageDistribution: Record<string, number>;
  averageFileSize: number;
  testCoverage: boolean;
  documentationQuality: 'low' | 'medium' | 'high';
}

interface GeneratedModule {
  id: string;
  title: string;
  description: string;
  order: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedMinutes: number;
  completionCriteria: string;
  steps: Array<{
    id: string;
    title: string;
    content: string;
    type: 'read' | 'explore' | 'exercise' | 'quiz';
    relatedFiles: string[];
    relatedDocs: string[];
    hints: string[];
  }>;
}

export function startOnboardingPathsWorker() {
  const worker = createWorker(
    QUEUE_NAMES.ONBOARDING_PATH,
    async (job) => {
      const data = job.data as OnboardingPathJobData;
      const { repositoryId, action, targetRole, userId, pathId } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Processing onboarding path job');

      await job.updateProgress(5);

      try {
        switch (action) {
          case 'generate':
            return await generateOnboardingPath(job, repositoryId, targetRole);
          case 'update':
            return await updateOnboardingPath(job, pathId);
          case 'personalize':
            return await personalizeOnboardingPath(job, repositoryId, userId);
          default:
            throw new Error(`Unknown action: ${action}`);
        }
      } catch (error) {
        log.error({ error, repositoryId, action }, 'Onboarding path job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Onboarding paths worker started');
  return worker;
}

/**
 * Generate a new onboarding path for a specific role
 */
async function generateOnboardingPath(
  job: { updateProgress: (progress: number) => Promise<void> },
  repositoryId: string,
  targetRole?: string
): Promise<{ pathId: string; moduleCount: number }> {
  await job.updateProgress(10);

  // Get repository info
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { name: true, owner: true, installationId: true },
  });

  if (!repository) {
    throw new Error('Repository not found');
  }

  const [owner, repo] = repository.name.split('/');
  if (!owner || !repo) {
    throw new Error('Invalid repository name format');
  }

  await job.updateProgress(20);

  // Analyze codebase
  const octokit = getOctokit(repository.installationId);
  const analysis = await analyzeCodebase(octokit, owner, repo);

  await job.updateProgress(40);

  // Determine target role if not specified
  const role = (targetRole || detectPrimaryRole(analysis)) as DeveloperRole;

  // Get relevant documents
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true, title: true, path: true, type: true, content: true },
    take: 100,
  });

  await job.updateProgress(50);

  // Generate modules using LLM
  const llmClient = createLLMClient();
  const modules = await generateModules(llmClient, role, analysis, documents);

  await job.updateProgress(80);

  // Create path in database
  const pathId = generateId('onb_path');
  const totalMinutes = modules.reduce((sum, m) => sum + m.estimatedMinutes, 0);

  await prisma.onboardingPathV2.create({
    data: {
      id: pathId,
      repositoryId,
      role,
      title: `${capitalizeRole(role)} Developer Onboarding`,
      description: `Comprehensive ${role} onboarding path with ${modules.length} progressive modules`,
      estimatedHours: Math.ceil(totalMinutes / 60),
      modules: modules as unknown as Record<string, unknown>[],
      prerequisites: getPrerequisites(role, analysis),
    },
  });

  await job.updateProgress(100);

  log.info({ pathId, role, moduleCount: modules.length }, 'Onboarding path generated');

  return { pathId, moduleCount: modules.length };
}

/**
 * Update an existing onboarding path
 */
async function updateOnboardingPath(
  job: { updateProgress: (progress: number) => Promise<void> },
  pathId?: string
): Promise<{ pathId: string; updated: boolean }> {
  if (!pathId) {
    throw new Error('Path ID is required for update action');
  }

  await job.updateProgress(20);

  const path = await prisma.onboardingPathV2.findUnique({
    where: { id: pathId },
    include: { repository: true },
  });

  if (!path) {
    throw new Error('Path not found');
  }

  await job.updateProgress(40);

  // Re-analyze codebase to detect changes
  const [owner, repo] = path.repository.name.split('/');
  if (!owner || !repo) {
    throw new Error('Invalid repository name format');
  }

  const octokit = getOctokit(path.repository.installationId);
  const analysis = await analyzeCodebase(octokit, owner, repo);

  await job.updateProgress(60);

  // Get updated documents
  const documents = await prisma.document.findMany({
    where: { repositoryId: path.repositoryId },
    select: { id: true, title: true, path: true, type: true, content: true },
    take: 100,
  });

  // Regenerate modules
  const llmClient = createLLMClient();
  const updatedModules = await generateModules(
    llmClient,
    path.role as DeveloperRole,
    analysis,
    documents
  );

  await job.updateProgress(80);

  // Update path
  const totalMinutes = updatedModules.reduce((sum, m) => sum + m.estimatedMinutes, 0);

  await prisma.onboardingPathV2.update({
    where: { id: pathId },
    data: {
      modules: updatedModules as unknown as Record<string, unknown>[],
      estimatedHours: Math.ceil(totalMinutes / 60),
      updatedAt: new Date(),
    },
  });

  await job.updateProgress(100);

  log.info({ pathId, moduleCount: updatedModules.length }, 'Onboarding path updated');

  return { pathId, updated: true };
}

/**
 * Personalize an onboarding path for a specific user
 */
async function personalizeOnboardingPath(
  job: { updateProgress: (progress: number) => Promise<void> },
  repositoryId: string,
  userId?: string
): Promise<{ pathId: string; personalized: boolean }> {
  if (!userId) {
    throw new Error('User ID is required for personalize action');
  }

  await job.updateProgress(20);

  // Get user's learning history and preferences
  const userProgress = await prisma.onboardingProgressV2.findMany({
    where: { userId },
    include: { path: true },
  });

  await job.updateProgress(40);

  // Analyze user's skill level and preferences
  const userProfile = analyzeUserProfile(userProgress);

  // Generate path using detected preferences
  const result = await generateOnboardingPath(job, repositoryId, userProfile.preferredRole);

  log.info({ userId, pathId: result.pathId }, 'Personalized path created');

  return { pathId: result.pathId, personalized: true };
}

// ============================================================================
// Helper Functions
// ============================================================================

async function analyzeCodebase(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string
): Promise<CodebaseMetrics> {
  try {
    // Get repository languages
    const { data: languages } = await octokit.rest.repos.listLanguages({ owner, repo });

    // Get repository tree
    const { data: tree } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: 'HEAD',
      recursive: 'true',
    });

    const files = tree.tree?.filter((t) => t.type === 'blob') || [];
    const directories = tree.tree?.filter((t) => t.type === 'tree') || [];

    // Calculate metrics
    const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
    const averageFileSize = files.length > 0 ? totalSize / files.length : 0;

    // Detect test coverage
    const testFiles = files.filter(
      (f) => f.path?.match(/\.(test|spec)\.(ts|js|tsx|jsx|py|go)$/)
    );
    const testCoverage = testFiles.length > 10;

    // Assess documentation quality
    const docFiles = files.filter(
      (f) => f.path?.match(/\.(md|mdx|rst|txt)$/) && !f.path?.includes('node_modules')
    );
    const documentationQuality =
      docFiles.length > 20 ? 'high' : docFiles.length > 5 ? 'medium' : 'low';

    return {
      fileCount: files.length,
      directoryCount: directories.length,
      languageDistribution: languages,
      averageFileSize,
      testCoverage,
      documentationQuality,
    };
  } catch (error) {
    log.warn({ error }, 'Failed to analyze codebase, using defaults');
    return {
      fileCount: 0,
      directoryCount: 0,
      languageDistribution: {},
      averageFileSize: 0,
      testCoverage: false,
      documentationQuality: 'low',
    };
  }
}

function detectPrimaryRole(metrics: CodebaseMetrics): string {
  const languages = Object.keys(metrics.languageDistribution);

  // Frontend indicators
  if (languages.some((l) => ['TypeScript', 'JavaScript', 'HTML', 'CSS'].includes(l))) {
    return 'frontend';
  }

  // Backend indicators
  if (languages.some((l) => ['Python', 'Java', 'Go', 'Rust', 'Ruby'].includes(l))) {
    return 'backend';
  }

  // Data indicators
  if (languages.some((l) => ['Python', 'R', 'Julia'].includes(l))) {
    return 'data';
  }

  // DevOps indicators
  if (languages.some((l) => ['Shell', 'Dockerfile', 'HCL'].includes(l))) {
    return 'devops';
  }

  // Mobile indicators
  if (languages.some((l) => ['Swift', 'Kotlin', 'Dart'].includes(l))) {
    return 'mobile';
  }

  // Default to backend
  return 'backend';
}

async function generateModules(
  llmClient: ReturnType<typeof createLLMClient>,
  role: DeveloperRole,
  metrics: CodebaseMetrics,
  documents: Array<{ id: string; title: string | null; path: string; type: string; content: string }>
): Promise<GeneratedModule[]> {
  const prompt = `Generate a comprehensive onboarding path for a ${role} developer.

Codebase Context:
- File Count: ${metrics.fileCount}
- Languages: ${Object.keys(metrics.languageDistribution).join(', ')}
- Test Coverage: ${metrics.testCoverage ? 'Yes' : 'No'}
- Documentation Quality: ${metrics.documentationQuality}

Available Documents (first 10):
${documents.slice(0, 10).map((d) => `- ${d.title || d.path}`).join('\n')}

Create 5-7 modules with progressive difficulty:
1. Getting Started (beginner) - Setup and basics
2. Core Concepts (beginner) - Fundamental understanding
3. Architecture & Patterns (intermediate) - System design
4. Hands-on Development (intermediate) - Practical exercises
5. Advanced Topics (advanced) - Deep dives
6. Best Practices (advanced) - Professional workflows
7. Contributing (advanced) - How to contribute effectively

Each module should have 3-5 steps (read, explore, exercise, or quiz).

Return JSON:
{
  "modules": [
    {
      "id": "module-1",
      "title": "Getting Started",
      "description": "Set up your environment and understand the project",
      "order": 1,
      "difficulty": "beginner",
      "estimatedMinutes": 60,
      "completionCriteria": "Can run the project locally",
      "steps": [
        {
          "id": "step-1",
          "title": "Clone and Install",
          "content": "Clone the repository and install dependencies...",
          "type": "exercise",
          "relatedFiles": ["README.md", "package.json"],
          "relatedDocs": [],
          "hints": ["Read the README carefully", "Check prerequisites"]
        }
      ]
    }
  ]
}`;

  try {
    const response = await llmClient.generate(prompt, { maxTokens: 4096 });
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.modules.map((m: GeneratedModule) => ({
        ...m,
        id: m.id || generateId('mod'),
        steps: m.steps.map((s) => ({
          ...s,
          id: s.id || generateId('step'),
        })),
      }));
    }
  } catch (error) {
    log.warn({ error }, 'LLM generation failed, using fallback');
  }

  // Fallback to basic modules
  return generateFallbackModules(role, documents);
}

function generateFallbackModules(
  role: DeveloperRole,
  documents: Array<{ id: string; title: string | null; path: string; type: string }>
): GeneratedModule[] {
  const modules: GeneratedModule[] = [];

  // Module 1: Getting Started
  modules.push({
    id: generateId('mod'),
    title: 'Getting Started',
    description: 'Set up your development environment and understand project structure',
    order: 1,
    difficulty: 'beginner',
    estimatedMinutes: 60,
    completionCriteria: 'Can run the project locally and navigate the codebase',
    steps: [
      {
        id: generateId('step'),
        title: 'Clone Repository',
        content: 'Clone the repository and install dependencies',
        type: 'exercise',
        relatedFiles: ['README.md'],
        relatedDocs: documents.filter((d) => d.path.toLowerCase().includes('readme')).map((d) => d.id),
        hints: ['Check system requirements first', 'Follow installation steps carefully'],
      },
      {
        id: generateId('step'),
        title: 'Explore Project Structure',
        content: 'Navigate the codebase and understand the directory organization',
        type: 'explore',
        relatedFiles: ['src/', 'packages/', 'apps/'],
        relatedDocs: [],
        hints: ['Look for main entry points', 'Identify key directories'],
      },
    ],
  });

  // Module 2: Core Concepts
  modules.push({
    id: generateId('mod'),
    title: `${capitalizeRole(role)} Fundamentals`,
    description: `Learn the core ${role} concepts used in this project`,
    order: 2,
    difficulty: 'beginner',
    estimatedMinutes: 90,
    completionCriteria: `Understand key ${role} patterns and practices`,
    steps: getRoleFundamentalSteps(role, documents),
  });

  // Module 3: Hands-on Practice
  modules.push({
    id: generateId('mod'),
    title: 'Hands-on Development',
    description: 'Apply your knowledge through practical exercises',
    order: 3,
    difficulty: 'intermediate',
    estimatedMinutes: 120,
    completionCriteria: 'Can make meaningful contributions',
    steps: [
      {
        id: generateId('step'),
        title: 'Run Tests',
        content: 'Execute the test suite and understand testing patterns',
        type: 'exercise',
        relatedFiles: ['tests/', '__tests__/'],
        relatedDocs: [],
        hints: ['Check test configuration', 'Run tests in watch mode'],
      },
      {
        id: generateId('step'),
        title: 'Make a Change',
        content: 'Implement a small feature or bug fix',
        type: 'exercise',
        relatedFiles: [],
        relatedDocs: [],
        hints: ['Start with good first issues', 'Write tests for your changes'],
      },
    ],
  });

  return modules;
}

function getRoleFundamentalSteps(
  role: DeveloperRole,
  documents: Array<{ id: string; title: string | null; path: string }>
): GeneratedModule['steps'] {
  const steps: GeneratedModule['steps'] = [];

  switch (role) {
    case 'frontend':
      steps.push({
        id: generateId('step'),
        title: 'Component Architecture',
        content: 'Study the component structure and UI patterns',
        type: 'explore',
        relatedFiles: ['src/components/', 'components/'],
        relatedDocs: documents.filter((d) => d.path.includes('component')).map((d) => d.id),
        hints: ['Look for reusable components', 'Study state management patterns'],
      });
      break;
    case 'backend':
      steps.push({
        id: generateId('step'),
        title: 'API Design',
        content: 'Understand the API architecture and endpoints',
        type: 'explore',
        relatedFiles: ['src/api/', 'src/routes/'],
        relatedDocs: documents.filter((d) => d.path.match(/api|route/i)).map((d) => d.id),
        hints: ['Review request/response patterns', 'Study authentication'],
      });
      break;
    default:
      steps.push({
        id: generateId('step'),
        title: 'Core Concepts',
        content: 'Learn the fundamental concepts of the project',
        type: 'read',
        relatedFiles: [],
        relatedDocs: documents.slice(0, 3).map((d) => d.id),
        hints: ['Take notes on key concepts'],
      });
  }

  return steps;
}

function getPrerequisites(role: DeveloperRole, metrics: CodebaseMetrics): string[] {
  const prereqs = ['Basic programming knowledge', 'Git version control'];

  switch (role) {
    case 'frontend':
      prereqs.push('HTML/CSS fundamentals', 'JavaScript basics');
      break;
    case 'backend':
      prereqs.push('HTTP/REST concepts', 'Database basics');
      break;
    case 'devops':
      prereqs.push('Linux command line', 'Docker basics');
      break;
    case 'data':
      prereqs.push('SQL knowledge', 'Python basics');
      break;
    case 'mobile':
      prereqs.push('Mobile development basics');
      break;
    case 'qa':
      prereqs.push('Testing fundamentals');
      break;
  }

  if (metrics.testCoverage) {
    prereqs.push('Unit testing concepts');
  }

  return prereqs;
}

function analyzeUserProfile(
  progressRecords: Array<{ path: { role: string } }>
): { preferredRole: string; skillLevel: string } {
  if (progressRecords.length === 0) {
    return { preferredRole: 'fullstack', skillLevel: 'beginner' };
  }

  // Determine most common role
  const roleCounts = new Map<string, number>();
  for (const record of progressRecords) {
    const role = record.path.role;
    roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
  }

  const preferredRole = Array.from(roleCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'fullstack';

  // Determine skill level based on completion count
  const skillLevel = progressRecords.length > 5 ? 'advanced' : progressRecords.length > 2 ? 'intermediate' : 'beginner';

  return { preferredRole, skillLevel };
}

function capitalizeRole(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
