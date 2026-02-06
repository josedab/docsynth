/**
 * Onboarding Paths Service (v2)
 *
 * Generates role-specific onboarding documentation by analyzing the codebase
 * and creating guided learning paths with progressive complexity.
 */

import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient, generateId } from '@docsynth/utils';
import { getOctokit } from '@docsynth/github';

const log = createLogger('onboarding-paths-service');

// ============================================================================
// Types
// ============================================================================

export type DeveloperRole = 'frontend' | 'backend' | 'fullstack' | 'data' | 'devops' | 'mobile' | 'qa';

export interface OnboardingPath {
  id: string;
  repositoryId: string;
  role: DeveloperRole;
  title: string;
  description: string;
  estimatedHours: number;
  modules: OnboardingModule[];
  prerequisites: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OnboardingModule {
  id: string;
  title: string;
  description: string;
  order: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedMinutes: number;
  steps: OnboardingStep[];
  completionCriteria: string;
}

export interface OnboardingStep {
  id: string;
  title: string;
  content: string;
  type: 'read' | 'explore' | 'exercise' | 'quiz';
  relatedFiles: string[];
  relatedDocs: string[];
  hints: string[];
}

export interface OnboardingProgress {
  userId: string;
  pathId: string;
  completedModules: string[];
  completedSteps: string[];
  currentModule: string | null;
  startedAt: Date;
  lastActivityAt: Date;
  completionPercent: number;
}

export interface CodebaseAnalysis {
  primaryLanguages: string[];
  frameworks: string[];
  architecturePatterns: string[];
  keyDirectories: string[];
  testingFrameworks: string[];
  buildTools: string[];
  complexity: 'low' | 'medium' | 'high';
  roleRelevance: Record<DeveloperRole, number>;
}

// ============================================================================
// Codebase Analysis
// ============================================================================

/**
 * Analyze codebase to identify which roles are relevant
 */
export async function analyzeCodebaseForRoles(
  repositoryId: string,
  installationId: number
): Promise<CodebaseAnalysis> {
  log.info({ repositoryId }, 'Analyzing codebase for roles');

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { name: true, owner: true },
  });

  if (!repository) {
    throw new Error('Repository not found');
  }

  const [owner, repo] = repository.name.split('/');
  if (!owner || !repo) {
    throw new Error('Invalid repository name format');
  }

  const octokit = getOctokit(installationId);

  // Get repository languages
  const { data: languages } = await octokit.rest.repos.listLanguages({
    owner,
    repo,
  });

  const primaryLanguages = Object.keys(languages).slice(0, 5);

  // Get repository tree to analyze structure
  const { data: tree } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: 'HEAD',
    recursive: 'true',
  }).catch(() => ({ data: { tree: [] } }));

  const paths = tree.tree?.map((t) => t.path || '') || [];

  // Detect frameworks and patterns
  const frameworks = detectFrameworks(paths, primaryLanguages);
  const architecturePatterns = detectArchitecturePatterns(paths);
  const keyDirectories = identifyKeyDirectories(paths);
  const testingFrameworks = detectTestingFrameworks(paths);
  const buildTools = detectBuildTools(paths);

  // Calculate complexity
  const fileCount = paths.length;
  const complexity = fileCount > 500 ? 'high' : fileCount > 100 ? 'medium' : 'low';

  // Determine role relevance
  const roleRelevance = calculateRoleRelevance({
    primaryLanguages,
    frameworks,
    architecturePatterns,
    paths,
  });

  return {
    primaryLanguages,
    frameworks,
    architecturePatterns,
    keyDirectories,
    testingFrameworks,
    buildTools,
    complexity,
    roleRelevance,
  };
}

function detectFrameworks(paths: string[], languages: string[]): string[] {
  const frameworks: string[] = [];

  // Frontend frameworks
  if (paths.some((p) => p.includes('package.json'))) {
    if (paths.some((p) => p.includes('react') || p.includes('jsx') || p.includes('tsx'))) {
      frameworks.push('React');
    }
    if (paths.some((p) => p.includes('vue'))) {
      frameworks.push('Vue');
    }
    if (paths.some((p) => p.includes('angular'))) {
      frameworks.push('Angular');
    }
    if (paths.some((p) => p.includes('next'))) {
      frameworks.push('Next.js');
    }
  }

  // Backend frameworks
  if (languages.includes('Python')) {
    if (paths.some((p) => p.includes('django'))) frameworks.push('Django');
    if (paths.some((p) => p.includes('flask'))) frameworks.push('Flask');
    if (paths.some((p) => p.includes('fastapi'))) frameworks.push('FastAPI');
  }

  if (languages.includes('JavaScript') || languages.includes('TypeScript')) {
    if (paths.some((p) => p.includes('express'))) frameworks.push('Express');
    if (paths.some((p) => p.includes('nest'))) frameworks.push('NestJS');
    if (paths.some((p) => p.includes('hono'))) frameworks.push('Hono');
  }

  if (languages.includes('Java')) {
    if (paths.some((p) => p.includes('spring'))) frameworks.push('Spring');
  }

  if (languages.includes('Go')) {
    if (paths.some((p) => p.includes('gin'))) frameworks.push('Gin');
  }

  return frameworks;
}

function detectArchitecturePatterns(paths: string[]): string[] {
  const patterns: string[] = [];

  if (paths.some((p) => p.match(/src\/api|apps\/api/))) patterns.push('API-driven');
  if (paths.some((p) => p.match(/microservices|services\//))) patterns.push('Microservices');
  if (paths.some((p) => p.includes('monorepo') || paths.filter((p) => p.startsWith('packages/')).length > 3)) {
    patterns.push('Monorepo');
  }
  if (paths.some((p) => p.match(/src\/components|components\//))) patterns.push('Component-based');
  if (paths.some((p) => p.match(/models\/|entities\//))) patterns.push('MVC');
  if (paths.some((p) => p.includes('lambda') || p.includes('serverless'))) patterns.push('Serverless');

  return patterns;
}

function identifyKeyDirectories(paths: string[]): string[] {
  const dirCount = new Map<string, number>();

  for (const path of paths) {
    const firstDir = path.split('/')[0];
    if (firstDir) {
      dirCount.set(firstDir, (dirCount.get(firstDir) || 0) + 1);
    }
  }

  return Array.from(dirCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([dir]) => dir);
}

function detectTestingFrameworks(paths: string[]): string[] {
  const frameworks: string[] = [];

  if (paths.some((p) => p.includes('jest'))) frameworks.push('Jest');
  if (paths.some((p) => p.includes('vitest'))) frameworks.push('Vitest');
  if (paths.some((p) => p.includes('pytest'))) frameworks.push('pytest');
  if (paths.some((p) => p.includes('mocha'))) frameworks.push('Mocha');
  if (paths.some((p) => p.includes('cypress'))) frameworks.push('Cypress');
  if (paths.some((p) => p.includes('playwright'))) frameworks.push('Playwright');

  return frameworks;
}

function detectBuildTools(paths: string[]): string[] {
  const tools: string[] = [];

  if (paths.some((p) => p.includes('webpack'))) tools.push('webpack');
  if (paths.some((p) => p.includes('vite'))) tools.push('Vite');
  if (paths.some((p) => p.includes('turbo'))) tools.push('Turborepo');
  if (paths.some((p) => p.includes('Dockerfile'))) tools.push('Docker');
  if (paths.some((p) => p.includes('Makefile'))) tools.push('Make');

  return tools;
}

function calculateRoleRelevance(analysis: {
  primaryLanguages: string[];
  frameworks: string[];
  architecturePatterns: string[];
  paths: string[];
}): Record<DeveloperRole, number> {
  const relevance: Record<DeveloperRole, number> = {
    frontend: 0,
    backend: 0,
    fullstack: 0,
    data: 0,
    devops: 0,
    mobile: 0,
    qa: 0,
  };

  // Frontend indicators
  const frontendFrameworks = ['React', 'Vue', 'Angular', 'Next.js'];
  if (analysis.frameworks.some((f) => frontendFrameworks.includes(f))) {
    relevance.frontend += 3;
  }
  if (analysis.primaryLanguages.some((l) => ['TypeScript', 'JavaScript'].includes(l))) {
    relevance.frontend += 1;
  }

  // Backend indicators
  const backendFrameworks = ['Django', 'Flask', 'FastAPI', 'Express', 'NestJS', 'Spring', 'Gin'];
  if (analysis.frameworks.some((f) => backendFrameworks.includes(f))) {
    relevance.backend += 3;
  }
  if (analysis.architecturePatterns.includes('API-driven')) {
    relevance.backend += 2;
  }

  // Fullstack
  if (relevance.frontend > 0 && relevance.backend > 0) {
    relevance.fullstack = relevance.frontend + relevance.backend;
  }

  // Data
  if (analysis.primaryLanguages.includes('Python')) relevance.data += 2;
  if (analysis.paths.some((p) => p.includes('jupyter') || p.includes('.ipynb'))) {
    relevance.data += 2;
  }
  if (analysis.paths.some((p) => p.match(/data\/|analytics\/|ml\//))) {
    relevance.data += 3;
  }

  // DevOps
  if (analysis.paths.some((p) => p.includes('Dockerfile') || p.includes('.dockerignore'))) {
    relevance.devops += 2;
  }
  if (analysis.paths.some((p) => p.match(/\.github\/workflows|\.gitlab-ci/))) {
    relevance.devops += 3;
  }
  if (analysis.paths.some((p) => p.match(/terraform|kubernetes|helm/))) {
    relevance.devops += 3;
  }

  // Mobile
  if (analysis.primaryLanguages.includes('Swift') || analysis.primaryLanguages.includes('Kotlin')) {
    relevance.mobile += 3;
  }
  if (analysis.frameworks.includes('React Native')) {
    relevance.mobile += 3;
  }

  // QA
  if (analysis.paths.some((p) => p.match(/__tests__|\.test\.|\.spec\./))) {
    relevance.qa += 2;
  }
  if (analysis.frameworks.some((f) => ['Jest', 'Cypress', 'Playwright'].includes(f))) {
    relevance.qa += 2;
  }

  return relevance;
}

// ============================================================================
// Path Generation
// ============================================================================

/**
 * Generate an onboarding path for a specific role
 */
export async function generateOnboardingPath(
  repositoryId: string,
  role: DeveloperRole,
  installationId: number
): Promise<string> {
  log.info({ repositoryId, role }, 'Generating onboarding path');

  const analysis = await analyzeCodebaseForRoles(repositoryId, installationId);

  // Get relevant documents
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true, title: true, path: true, type: true },
    take: 50,
  });

  // Generate modules using LLM
  const modules = await generateModulesWithLLM(role, analysis, documents);

  // Create path record
  const pathId = generateId('path');
  const totalMinutes = modules.reduce((sum, m) => sum + m.estimatedMinutes, 0);

  await prisma.onboardingPathV2.create({
    data: {
      id: pathId,
      repositoryId,
      role,
      title: `${capitalizeRole(role)} Developer Onboarding`,
      description: `Comprehensive onboarding path for ${role} developers, covering essential concepts, tools, and practices.`,
      estimatedHours: Math.ceil(totalMinutes / 60),
      modules: modules as unknown as Record<string, unknown>[],
      prerequisites: getPrerequisites(role),
    },
  });

  log.info({ pathId, moduleCount: modules.length }, 'Onboarding path created');
  return pathId;
}

async function generateModulesWithLLM(
  role: DeveloperRole,
  analysis: CodebaseAnalysis,
  documents: Array<{ id: string; title: string | null; path: string; type: string }>
): Promise<OnboardingModule[]> {
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    return generateFallbackModules(role, analysis, documents);
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: `You are an expert technical onboarding designer. Create a comprehensive learning path for a ${role} developer.

Structure:
- Create 4-6 progressive modules (beginner -> intermediate -> advanced)
- Each module should have 3-5 steps
- Steps can be: read (documentation), explore (code), exercise (hands-on), quiz (knowledge check)
- Include specific file paths and documentation references

Return JSON:
{
  "modules": [
    {
      "id": "module-1",
      "title": "Module title",
      "description": "What the learner will achieve",
      "order": 1,
      "difficulty": "beginner",
      "estimatedMinutes": 60,
      "completionCriteria": "Can do X and Y",
      "steps": [
        {
          "id": "step-1",
          "title": "Step title",
          "content": "Detailed content and instructions",
          "type": "read",
          "relatedFiles": ["path/to/file.ts"],
          "relatedDocs": ["doc-id"],
          "hints": ["Helpful hint"]
        }
      ]
    }
  ]
}`,
      messages: [
        {
          role: 'user',
          content: `Create an onboarding path for a ${role} developer.

Codebase Analysis:
- Languages: ${analysis.primaryLanguages.join(', ')}
- Frameworks: ${analysis.frameworks.join(', ')}
- Architecture: ${analysis.architecturePatterns.join(', ')}
- Key Directories: ${analysis.keyDirectories.join(', ')}
- Testing: ${analysis.testingFrameworks.join(', ')}
- Build Tools: ${analysis.buildTools.join(', ')}
- Complexity: ${analysis.complexity}

Available Documents:
${documents.slice(0, 20).map((d) => `- ${d.id}: ${d.title || d.path} (${d.type})`).join('\n')}

Create progressive modules that build from basics to advanced topics.`,
        },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.modules || [];
    }
  } catch (error) {
    log.warn({ error }, 'LLM module generation failed, using fallback');
  }

  return generateFallbackModules(role, analysis, documents);
}

function generateFallbackModules(
  role: DeveloperRole,
  analysis: CodebaseAnalysis,
  documents: Array<{ id: string; title: string | null; path: string; type: string }>
): OnboardingModule[] {
  const modules: OnboardingModule[] = [];

  // Module 1: Getting Started
  modules.push({
    id: generateId('mod'),
    title: 'Getting Started',
    description: 'Set up your development environment and understand the project structure',
    order: 1,
    difficulty: 'beginner',
    estimatedMinutes: 45,
    completionCriteria: 'Can run the project locally',
    steps: [
      {
        id: generateId('step'),
        title: 'Read Project Overview',
        content: 'Review the README to understand the project goals and architecture',
        type: 'read',
        relatedFiles: ['README.md'],
        relatedDocs: documents.filter((d) => d.path.toLowerCase().includes('readme')).map((d) => d.id),
        hints: ['Pay attention to prerequisites and setup instructions'],
      },
      {
        id: generateId('step'),
        title: 'Set Up Development Environment',
        content: 'Install dependencies and configure your local environment',
        type: 'exercise',
        relatedFiles: ['package.json', 'requirements.txt', 'go.mod'].filter((f) =>
          analysis.primaryLanguages.some((l) => f.includes(l.toLowerCase()))
        ),
        relatedDocs: [],
        hints: ['Follow the installation guide carefully', 'Check for environment variables needed'],
      },
      {
        id: generateId('step'),
        title: 'Explore Project Structure',
        content: 'Navigate the codebase and understand the directory organization',
        type: 'explore',
        relatedFiles: analysis.keyDirectories.map((d) => `${d}/`),
        relatedDocs: [],
        hints: [`Key directories: ${analysis.keyDirectories.slice(0, 5).join(', ')}`],
      },
    ],
  });

  // Module 2: Core Concepts
  modules.push({
    id: generateId('mod'),
    title: `${capitalizeRole(role)} Fundamentals`,
    description: `Understand the core ${role} concepts used in this project`,
    order: 2,
    difficulty: 'beginner',
    estimatedMinutes: 90,
    completionCriteria: `Understand key ${role} patterns in the codebase`,
    steps: getRoleFundamentalSteps(role, analysis, documents),
  });

  // Module 3: Hands-on Practice
  modules.push({
    id: generateId('mod'),
    title: 'Hands-on Practice',
    description: 'Apply your knowledge with practical exercises',
    order: 3,
    difficulty: 'intermediate',
    estimatedMinutes: 120,
    completionCriteria: 'Can make meaningful code contributions',
    steps: [
      {
        id: generateId('step'),
        title: 'Run Tests',
        content: 'Execute the test suite and understand the testing approach',
        type: 'exercise',
        relatedFiles: analysis.testingFrameworks.length > 0 ? ['tests/', '__tests__/'] : [],
        relatedDocs: [],
        hints: [`Testing frameworks used: ${analysis.testingFrameworks.join(', ')}`],
      },
      {
        id: generateId('step'),
        title: 'Make a Small Change',
        content: 'Implement a minor feature or fix to get familiar with the workflow',
        type: 'exercise',
        relatedFiles: [],
        relatedDocs: [],
        hints: ['Start with good first issues', 'Follow the contribution guidelines'],
      },
    ],
  });

  return modules;
}

function getRoleFundamentalSteps(
  role: DeveloperRole,
  analysis: CodebaseAnalysis,
  documents: Array<{ id: string; title: string | null; path: string; type: string }>
): OnboardingStep[] {
  const steps: OnboardingStep[] = [];

  switch (role) {
    case 'frontend':
      steps.push({
        id: generateId('step'),
        title: 'Component Architecture',
        content: 'Study the component structure and patterns',
        type: 'explore',
        relatedFiles: ['src/components/', 'components/'],
        relatedDocs: documents.filter((d) => d.path.includes('component')).map((d) => d.id),
        hints: [`Frameworks: ${analysis.frameworks.join(', ')}`],
      });
      break;
    case 'backend':
      steps.push({
        id: generateId('step'),
        title: 'API Architecture',
        content: 'Understand the API design and routing',
        type: 'explore',
        relatedFiles: ['src/api/', 'src/routes/', 'api/'],
        relatedDocs: documents.filter((d) => d.path.match(/api|route/i)).map((d) => d.id),
        hints: ['Review request/response patterns', 'Check authentication flow'],
      });
      break;
    case 'devops':
      steps.push({
        id: generateId('step'),
        title: 'Deployment Pipeline',
        content: 'Study the CI/CD configuration and deployment process',
        type: 'read',
        relatedFiles: ['.github/workflows/', '.gitlab-ci.yml', 'Dockerfile'],
        relatedDocs: [],
        hints: ['Understand build and deployment stages'],
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
        hints: [],
      });
  }

  return steps;
}

function getPrerequisites(role: DeveloperRole): string[] {
  const prereqs: string[] = ['Basic programming knowledge', 'Git version control'];

  switch (role) {
    case 'frontend':
      prereqs.push('HTML/CSS fundamentals', 'JavaScript/TypeScript basics');
      break;
    case 'backend':
      prereqs.push('HTTP/REST concepts', 'Database basics');
      break;
    case 'fullstack':
      prereqs.push('Web development fundamentals', 'API design principles');
      break;
    case 'devops':
      prereqs.push('Linux command line', 'Docker basics', 'CI/CD concepts');
      break;
    case 'data':
      prereqs.push('SQL knowledge', 'Data analysis basics');
      break;
    case 'mobile':
      prereqs.push('Mobile development basics', 'Platform-specific knowledge');
      break;
    case 'qa':
      prereqs.push('Testing concepts', 'Test automation basics');
      break;
  }

  return prereqs;
}

function capitalizeRole(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================================
// Path Retrieval
// ============================================================================

export async function getOnboardingPaths(repositoryId: string): Promise<OnboardingPath[]> {
  const paths = await prisma.onboardingPathV2.findMany({
    where: { repositoryId },
    orderBy: { createdAt: 'desc' },
  });

  return paths.map((p) => ({
    id: p.id,
    repositoryId: p.repositoryId,
    role: p.role as DeveloperRole,
    title: p.title,
    description: p.description,
    estimatedHours: p.estimatedHours,
    modules: p.modules as unknown as OnboardingModule[],
    prerequisites: p.prerequisites as string[],
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
}

export async function getOnboardingPath(pathId: string): Promise<OnboardingPath | null> {
  const path = await prisma.onboardingPathV2.findUnique({
    where: { id: pathId },
  });

  if (!path) return null;

  return {
    id: path.id,
    repositoryId: path.repositoryId,
    role: path.role as DeveloperRole,
    title: path.title,
    description: path.description,
    estimatedHours: path.estimatedHours,
    modules: path.modules as unknown as OnboardingModule[],
    prerequisites: path.prerequisites as string[],
    createdAt: path.createdAt,
    updatedAt: path.updatedAt,
  };
}

// ============================================================================
// Progress Tracking
// ============================================================================

export async function trackProgress(
  userId: string,
  pathId: string,
  stepId: string
): Promise<void> {
  log.info({ userId, pathId, stepId }, 'Tracking progress');

  const path = await getOnboardingPath(pathId);
  if (!path) {
    throw new Error('Path not found');
  }

  // Find the step and module
  let moduleId: string | null = null;
  for (const module of path.modules) {
    if (module.steps.some((s) => s.id === stepId)) {
      moduleId = module.id;
      break;
    }
  }

  const existing = await prisma.onboardingProgressV2.findUnique({
    where: { userId_pathId: { userId, pathId } },
  });

  const completedSteps = existing
    ? [...(existing.completedSteps as string[]), stepId]
    : [stepId];

  const completedModules = existing ? (existing.completedModules as string[]) : [];

  // Check if module is complete
  if (moduleId) {
    const module = path.modules.find((m) => m.id === moduleId);
    if (module) {
      const allStepsComplete = module.steps.every((s) => completedSteps.includes(s.id));
      if (allStepsComplete && !completedModules.includes(moduleId)) {
        completedModules.push(moduleId);
      }
    }
  }

  const totalSteps = path.modules.reduce((sum, m) => sum + m.steps.length, 0);
  const completionPercent = Math.round((completedSteps.length / totalSteps) * 100);

  if (existing) {
    await prisma.onboardingProgressV2.update({
      where: { userId_pathId: { userId, pathId } },
      data: {
        completedSteps,
        completedModules,
        currentModule: moduleId,
        lastActivityAt: new Date(),
        completionPercent,
      },
    });
  } else {
    await prisma.onboardingProgressV2.create({
      data: {
        id: generateId('prog'),
        userId,
        pathId,
        completedSteps,
        completedModules,
        currentModule: moduleId,
        completionPercent,
      },
    });
  }
}

export async function getProgress(
  userId: string,
  pathId: string
): Promise<OnboardingProgress | null> {
  const progress = await prisma.onboardingProgressV2.findUnique({
    where: { userId_pathId: { userId, pathId } },
  });

  if (!progress) return null;

  return {
    userId: progress.userId,
    pathId: progress.pathId,
    completedModules: progress.completedModules as string[],
    completedSteps: progress.completedSteps as string[],
    currentModule: progress.currentModule,
    startedAt: progress.startedAt,
    lastActivityAt: progress.lastActivityAt,
    completionPercent: progress.completionPercent,
  };
}

// ============================================================================
// AI-Powered Suggestions
// ============================================================================

export async function suggestNextSteps(
  userId: string,
  pathId: string
): Promise<{ suggestions: string[]; reasoning: string }> {
  const path = await getOnboardingPath(pathId);
  const progress = await getProgress(userId, pathId);

  if (!path || !progress) {
    return { suggestions: [], reasoning: 'Path or progress not found' };
  }

  const completedSteps = new Set(progress.completedSteps);
  const nextSteps: string[] = [];

  // Find next incomplete steps
  for (const module of path.modules) {
    for (const step of module.steps) {
      if (!completedSteps.has(step.id) && nextSteps.length < 3) {
        nextSteps.push(`${module.title} - ${step.title}`);
      }
    }
  }

  const reasoning = progress.completionPercent < 30
    ? 'Focus on completing the foundational modules first'
    : progress.completionPercent < 70
    ? 'Build on your foundation with intermediate topics'
    : 'You are in the advanced section - great progress!';

  return { suggestions: nextSteps, reasoning };
}
