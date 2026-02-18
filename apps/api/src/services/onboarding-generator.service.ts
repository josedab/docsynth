/**
 * Onboarding Generator Service
 *
 * Analyzes a codebase to generate personalized "Getting Started" guides
 * for new developers, including architecture overview, key files,
 * setup steps, and first-task suggestions.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('onboarding-generator-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface CodebaseTopology {
  repositoryId: string;
  entryPoints: EntryPoint[];
  keyAbstractions: KeyAbstraction[];
  dependencyGraph: DependencyNode[];
  hotFiles: HotFile[];
  architecturePattern: string;
  complexity: 'simple' | 'moderate' | 'complex';
}

export interface EntryPoint {
  path: string;
  type: 'application' | 'library' | 'api' | 'cli' | 'worker';
  description: string;
  importance: number;
}

export interface KeyAbstraction {
  name: string;
  type: 'pattern' | 'module' | 'service' | 'component';
  files: string[];
  description: string;
}

export interface DependencyNode {
  name: string;
  path: string;
  dependsOn: string[];
  dependedBy: string[];
}

export interface HotFile {
  path: string;
  editFrequency: number;
  description: string;
  relevanceScore: number;
}

export interface OnboardingPath {
  id: string;
  repositoryId: string;
  role: string;
  title: string;
  estimatedTime: string;
  steps: OnboardingStep[];
  progress: number;
  createdAt: Date;
}

export interface OnboardingStep {
  order: number;
  title: string;
  type: 'read' | 'setup' | 'explore' | 'task' | 'quiz';
  description: string;
  resources: StepResource[];
  estimatedMinutes: number;
  completed: boolean;
}

export interface StepResource {
  type: 'file' | 'doc' | 'link' | 'command';
  value: string;
  label: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Analyze codebase topology
 */
export async function analyzeTopology(repositoryId: string): Promise<CodebaseTopology> {
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { path: true, content: true, updatedAt: true },
  });

  const entryPoints = detectEntryPoints(documents);
  const keyAbstractions = detectKeyAbstractions(documents);
  const dependencyGraph = buildDependencyGraph(documents);
  const hotFiles = detectHotFiles(documents);
  const architecturePattern = detectArchPattern(documents);
  const complexity = assessComplexity(documents.length, entryPoints.length, keyAbstractions.length);

  const topology: CodebaseTopology = {
    repositoryId,
    entryPoints,
    keyAbstractions,
    dependencyGraph,
    hotFiles,
    architecturePattern,
    complexity,
  };

  await db.codebaseTopology.upsert({
    where: { repositoryId },
    create: { repositoryId, topology: JSON.parse(JSON.stringify(topology)), createdAt: new Date() },
    update: { topology: JSON.parse(JSON.stringify(topology)), updatedAt: new Date() },
  });

  log.info(
    { repositoryId, entryPoints: entryPoints.length, abstractions: keyAbstractions.length },
    'Codebase topology analyzed'
  );

  return topology;
}

/**
 * Generate personalized onboarding path
 */
export async function generateOnboardingPath(
  repositoryId: string,
  role: string,
  options?: {
    includeSetupSteps?: boolean;
    includeArchOverview?: boolean;
    includeFirstTasks?: boolean;
    maxSteps?: number;
  }
): Promise<OnboardingPath> {
  const stored = await db.codebaseTopology.findUnique({ where: { repositoryId } });
  const topology = stored?.topology
    ? (stored.topology as unknown as CodebaseTopology)
    : await analyzeTopology(repositoryId);

  const steps: OnboardingStep[] = [];
  let order = 1;
  const maxSteps = options?.maxSteps ?? 10;

  // Step 1: Repository overview
  steps.push({
    order: order++,
    title: 'Understand the Project',
    type: 'read',
    description: `This is a ${topology.complexity} project using a ${topology.architecturePattern} architecture.`,
    resources: [
      { type: 'file', value: 'README.md', label: 'Project README' },
      ...topology.entryPoints.slice(0, 2).map((ep) => ({
        type: 'file' as const,
        value: ep.path,
        label: `Entry point: ${ep.type}`,
      })),
    ],
    estimatedMinutes: 15,
    completed: false,
  });

  // Step 2: Setup
  if (options?.includeSetupSteps !== false) {
    steps.push({
      order: order++,
      title: 'Set Up Development Environment',
      type: 'setup',
      description: 'Install dependencies and verify the project builds.',
      resources: [
        { type: 'command', value: 'npm install', label: 'Install dependencies' },
        { type: 'command', value: 'npm run build', label: 'Build the project' },
        { type: 'command', value: 'npm test', label: 'Run tests' },
      ],
      estimatedMinutes: 20,
      completed: false,
    });
  }

  // Step 3: Architecture overview
  if (options?.includeArchOverview !== false) {
    steps.push({
      order: order++,
      title: 'Learn the Architecture',
      type: 'read',
      description: `Key abstractions: ${topology.keyAbstractions
        .slice(0, 3)
        .map((a) => a.name)
        .join(', ')}.`,
      resources: topology.keyAbstractions.slice(0, 5).map((a) => ({
        type: 'file' as const,
        value: a.files[0] ?? '',
        label: `${a.name} (${a.type})`,
      })),
      estimatedMinutes: 30,
      completed: false,
    });
  }

  // Role-specific steps
  const roleSteps = generateRoleSpecificSteps(role, topology, order);
  steps.push(...roleSteps.slice(0, maxSteps - steps.length));

  // First tasks
  if (options?.includeFirstTasks !== false && steps.length < maxSteps) {
    steps.push({
      order: steps.length + 1,
      title: 'Your First Contribution',
      type: 'task',
      description: 'Try making a small change to get familiar with the workflow.',
      resources: [
        { type: 'doc', value: 'CONTRIBUTING.md', label: 'Contribution guide' },
        ...topology.hotFiles.slice(0, 2).map((f) => ({
          type: 'file' as const,
          value: f.path,
          label: `Frequently edited: ${f.path}`,
        })),
      ],
      estimatedMinutes: 45,
      completed: false,
    });
  }

  const totalMinutes = steps.reduce((sum, s) => sum + s.estimatedMinutes, 0);
  const path: OnboardingPath = {
    id: `onb-${repositoryId}-${role}-${Date.now()}`,
    repositoryId,
    role,
    title: `${role.charAt(0).toUpperCase() + role.slice(1)} Onboarding Path`,
    estimatedTime:
      totalMinutes > 60 ? `${Math.round(totalMinutes / 60)} hours` : `${totalMinutes} minutes`,
    steps,
    progress: 0,
    createdAt: new Date(),
  };

  await db.onboardingGeneratorPath.create({
    data: {
      id: path.id,
      repositoryId,
      role,
      title: path.title,
      steps: JSON.parse(JSON.stringify(steps)),
      progress: 0,
      createdAt: new Date(),
    },
  });

  log.info({ repositoryId, role, stepCount: steps.length }, 'Onboarding path generated');

  return path;
}

/**
 * Get an existing onboarding path
 */
export async function getOnboardingPath(pathId: string): Promise<OnboardingPath | null> {
  const stored = await db.onboardingGeneratorPath.findUnique({ where: { id: pathId } });
  if (!stored) return null;

  return {
    id: stored.id,
    repositoryId: stored.repositoryId,
    role: stored.role,
    title: stored.title,
    estimatedTime: '',
    steps: stored.steps as unknown as OnboardingStep[],
    progress: stored.progress ?? 0,
    createdAt: stored.createdAt,
  };
}

/**
 * Update step completion status
 */
export async function completeStep(
  pathId: string,
  stepOrder: number
): Promise<OnboardingPath | null> {
  const path = await getOnboardingPath(pathId);
  if (!path) return null;

  const step = path.steps.find((s) => s.order === stepOrder);
  if (step) step.completed = true;

  const completedCount = path.steps.filter((s) => s.completed).length;
  const progress = Math.round((completedCount / path.steps.length) * 100);

  await db.onboardingGeneratorPath.update({
    where: { id: pathId },
    data: {
      steps: JSON.parse(JSON.stringify(path.steps)),
      progress,
      updatedAt: new Date(),
    },
  });

  return { ...path, progress };
}

// ============================================================================
// Helper Functions
// ============================================================================

function detectEntryPoints(
  documents: Array<{ path: string; content: string | null }>
): EntryPoint[] {
  const entryPatterns: Array<{ pattern: RegExp; type: EntryPoint['type']; importance: number }> = [
    { pattern: /src\/(index|main|app|server)\.(ts|js)$/, type: 'application', importance: 10 },
    { pattern: /src\/routes\/index\.(ts|js)$/, type: 'api', importance: 8 },
    { pattern: /src\/workers?\/(index|main)\.(ts|js)$/, type: 'worker', importance: 7 },
    { pattern: /bin\/|cli\.(ts|js)$/, type: 'cli', importance: 6 },
    { pattern: /packages\/[^/]+\/src\/index\.(ts|js)$/, type: 'library', importance: 5 },
  ];

  const entries: EntryPoint[] = [];
  for (const doc of documents) {
    for (const ep of entryPatterns) {
      if (ep.pattern.test(doc.path)) {
        entries.push({
          path: doc.path,
          type: ep.type,
          description: `${ep.type} entry point`,
          importance: ep.importance,
        });
        break;
      }
    }
  }

  return entries.sort((a, b) => b.importance - a.importance);
}

function detectKeyAbstractions(
  documents: Array<{ path: string; content: string | null }>
): KeyAbstraction[] {
  const abstractions: KeyAbstraction[] = [];
  const dirGroups = new Map<string, string[]>();

  for (const doc of documents) {
    const parts = doc.path.split('/');
    if (parts.length >= 2) {
      const dir = parts.slice(0, -1).join('/');
      if (!dirGroups.has(dir)) dirGroups.set(dir, []);
      dirGroups.get(dir)!.push(doc.path);
    }
  }

  for (const [dir, files] of dirGroups) {
    if (files.length >= 3) {
      const name = dir.split('/').pop() ?? dir;
      abstractions.push({
        name,
        type: name.includes('service')
          ? 'service'
          : name.includes('route')
            ? 'module'
            : 'component',
        files: files.slice(0, 5),
        description: `Module with ${files.length} files`,
      });
    }
  }

  return abstractions.slice(0, 10);
}

function buildDependencyGraph(
  documents: Array<{ path: string; content: string | null }>
): DependencyNode[] {
  const nodes: DependencyNode[] = [];

  for (const doc of documents.slice(0, 50)) {
    if (!doc.content) continue;
    const imports = doc.content.matchAll(/from\s+['"]([^'"]+)['"]/g);
    const deps: string[] = [];
    for (const match of imports) {
      if (match[1] && !match[1].startsWith('.')) deps.push(match[1]);
    }
    if (deps.length > 0) {
      nodes.push({ name: doc.path, path: doc.path, dependsOn: deps, dependedBy: [] });
    }
  }

  return nodes.slice(0, 20);
}

function detectHotFiles(documents: Array<{ path: string; updatedAt: Date }>): HotFile[] {
  const now = Date.now();
  return documents
    .map((doc) => ({
      path: doc.path,
      editFrequency: Math.max(
        1,
        Math.round(10 - (now - new Date(doc.updatedAt).getTime()) / (7 * 24 * 60 * 60 * 1000))
      ),
      description: `Last updated ${Math.round((now - new Date(doc.updatedAt).getTime()) / (24 * 60 * 60 * 1000))} days ago`,
      relevanceScore: 5,
    }))
    .sort((a, b) => b.editFrequency - a.editFrequency)
    .slice(0, 10);
}

function detectArchPattern(documents: Array<{ path: string }>): string {
  const paths = documents.map((d) => d.path.toLowerCase());
  if (paths.some((p) => p.includes('routes/')) && paths.some((p) => p.includes('services/')))
    return 'layered (routes → services → data)';
  if (paths.some((p) => p.includes('controllers/')) && paths.some((p) => p.includes('models/')))
    return 'MVC';
  if (paths.some((p) => p.includes('workers/')) || paths.some((p) => p.includes('queue')))
    return 'event-driven with worker queues';
  return 'modular';
}

function assessComplexity(
  fileCount: number,
  entryCount: number,
  abstractionCount: number
): 'simple' | 'moderate' | 'complex' {
  const score = fileCount * 0.1 + entryCount * 2 + abstractionCount * 3;
  if (score > 50) return 'complex';
  if (score > 20) return 'moderate';
  return 'simple';
}

function generateRoleSpecificSteps(
  role: string,
  topology: CodebaseTopology,
  startOrder: number
): OnboardingStep[] {
  const steps: OnboardingStep[] = [];

  switch (role) {
    case 'frontend':
      steps.push({
        order: startOrder,
        title: 'Explore UI Components',
        type: 'explore',
        description: 'Navigate through the frontend components and understand the UI layer.',
        resources: topology.entryPoints
          .filter((ep) => ep.type === 'application')
          .map((ep) => ({ type: 'file' as const, value: ep.path, label: ep.description })),
        estimatedMinutes: 30,
        completed: false,
      });
      break;

    case 'backend':
      steps.push({
        order: startOrder,
        title: 'Understand API Layer',
        type: 'explore',
        description: 'Walk through the API routes and service layer.',
        resources: topology.entryPoints
          .filter((ep) => ep.type === 'api' || ep.type === 'worker')
          .map((ep) => ({ type: 'file' as const, value: ep.path, label: ep.description })),
        estimatedMinutes: 30,
        completed: false,
      });
      break;

    default:
      steps.push({
        order: startOrder,
        title: 'Explore Key Modules',
        type: 'explore',
        description: 'Browse the most important parts of the codebase.',
        resources: topology.keyAbstractions.slice(0, 3).map((a) => ({
          type: 'file' as const,
          value: a.files[0] ?? '',
          label: a.name,
        })),
        estimatedMinutes: 25,
        completed: false,
      });
  }

  return steps;
}
