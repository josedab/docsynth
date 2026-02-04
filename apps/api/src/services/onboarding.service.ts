/**
 * Personalized Onboarding Paths Service
 * 
 * Generates and manages personalized learning journeys for developers
 * based on their role, experience level, and repository structure.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId, getAnthropicClient } from '@docsynth/utils';

const log = createLogger('onboarding-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export type TargetRole = 'frontend' | 'backend' | 'fullstack' | 'devops' | 'newbie' | 'data';
export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';
export type StepType = 'read_doc' | 'run_example' | 'quiz' | 'code_task' | 'checkpoint';

export interface CreatePathInput {
  repositoryId: string;
  title: string;
  description?: string;
  targetRole: TargetRole;
  difficulty: DifficultyLevel;
  estimatedHours: number;
  prerequisites?: string[];
  isDefault?: boolean;
  steps?: CreateStepInput[];
}

export interface CreateStepInput {
  title: string;
  description?: string;
  stepType: StepType;
  contentId?: string;
  content?: Record<string, unknown>;
  estimatedMins: number;
  isOptional?: boolean;
}

export interface OnboardingPath {
  id: string;
  repositoryId: string;
  title: string;
  description?: string;
  targetRole: TargetRole;
  difficulty: DifficultyLevel;
  estimatedHours: number;
  prerequisites: string[];
  isDefault: boolean;
  steps: OnboardingStep[];
  createdAt: Date;
}

export interface OnboardingStep {
  id: string;
  pathId: string;
  orderIndex: number;
  title: string;
  description?: string;
  stepType: StepType;
  contentId?: string;
  content: Record<string, unknown>;
  estimatedMins: number;
  isOptional: boolean;
}

export interface UserProgress {
  pathId: string;
  userId: string;
  currentStepIdx: number;
  completedSteps: string[];
  progress: number;
  startedAt: Date;
  lastActivityAt: Date;
  completedAt?: Date;
}

export interface SkillAssessment {
  technicalLevel: DifficultyLevel;
  primaryLanguages: string[];
  experienceYears: number;
  familiarity: {
    [area: string]: 'none' | 'basic' | 'intermediate' | 'advanced';
  };
}

class OnboardingService {
  private anthropic = getAnthropicClient();

  /**
   * Generate a personalized onboarding path based on user profile and repository
   */
  async generatePersonalizedPath(
    repositoryId: string,
    userId: string,
    assessment?: SkillAssessment
  ): Promise<string> {
    log.info({ repositoryId, userId }, 'Generating personalized onboarding path');

    // Analyze repository structure
    const repoAnalysis = await this.analyzeRepository(repositoryId);

    // Determine target role and difficulty
    const targetRole = this.determineTargetRole(assessment, repoAnalysis);
    const difficulty = assessment?.technicalLevel || 'beginner';

    // Get relevant documents for the path
    const documents = await prisma.document.findMany({
      where: { repositoryId },
      select: { id: true, path: true, title: true, type: true },
      orderBy: { path: 'asc' },
    });

    // Get examples
    const examples = await prisma.interactiveExample.findMany({
      where: { repositoryId, isRunnable: true },
      select: { id: true, title: true, language: true, documentId: true },
      take: 20,
    });

    // Generate path using AI
    const steps = await this.generatePathSteps(
      repoAnalysis,
      documents,
      examples,
      targetRole,
      difficulty
    );

    // Create the path
    const pathId = await this.createPath({
      repositoryId,
      title: `${this.capitalizeRole(targetRole)} Onboarding - ${this.capitalizeRole(difficulty)}`,
      description: `Personalized learning path for ${targetRole} developers at ${difficulty} level`,
      targetRole,
      difficulty,
      estimatedHours: this.calculateEstimatedHours(steps),
      prerequisites: this.getPrerequisites(targetRole, difficulty),
      isDefault: false,
      steps,
    });

    // Start progress tracking for the user
    await this.startPath(pathId, userId);

    return pathId;
  }

  /**
   * Analyze repository to understand its structure
   */
  private async analyzeRepository(repositoryId: string): Promise<{
    languages: string[];
    documentCount: number;
    hasExamples: boolean;
    topics: string[];
    complexity: string;
  }> {
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { name: true },
    });

    const documentCount = await prisma.document.count({ where: { repositoryId } });
    const exampleCount = await prisma.interactiveExample.count({ where: { repositoryId } });

    // Get languages from examples
    const examples = await prisma.interactiveExample.findMany({
      where: { repositoryId },
      select: { language: true },
      distinct: ['language'],
    });

    const languages = examples.map((e) => e.language);

    // Analyze document titles for topics
    const docs = await prisma.document.findMany({
      where: { repositoryId },
      select: { title: true, path: true },
      take: 50,
    });

    const topics = this.extractTopics(docs.map((d) => d.title || d.path));

    return {
      languages: languages.length > 0 ? languages : ['javascript', 'typescript'],
      documentCount,
      hasExamples: exampleCount > 0,
      topics,
      complexity: documentCount > 50 ? 'high' : documentCount > 20 ? 'medium' : 'low',
    };
  }

  /**
   * Extract topics from document titles
   */
  private extractTopics(titles: string[]): string[] {
    const topicKeywords = new Map<string, number>();
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'on', 'readme', 'md']);

    for (const title of titles) {
      const words = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
      for (const word of words) {
        if (word.length > 2 && !commonWords.has(word)) {
          topicKeywords.set(word, (topicKeywords.get(word) || 0) + 1);
        }
      }
    }

    return Array.from(topicKeywords.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * Determine target role based on assessment and repo analysis
   */
  private determineTargetRole(
    assessment: SkillAssessment | undefined,
    repoAnalysis: { languages: string[]; topics: string[] }
  ): TargetRole {
    if (!assessment) {
      return 'newbie';
    }

    const langs = assessment.primaryLanguages.map((l) => l.toLowerCase());
    const repoLangs = repoAnalysis.languages.map((l) => l.toLowerCase());

    const frontendLangs = ['javascript', 'typescript', 'react', 'vue', 'angular'];
    const backendLangs = ['python', 'java', 'go', 'rust', 'node'];
    const devopsLangs = ['bash', 'yaml', 'dockerfile', 'terraform'];

    const isFrontend = langs.some((l) => frontendLangs.includes(l));
    const isBackend = langs.some((l) => backendLangs.includes(l));
    const isDevops = langs.some((l) => devopsLangs.includes(l));

    if (isFrontend && isBackend) return 'fullstack';
    if (isDevops) return 'devops';
    if (isFrontend) return 'frontend';
    if (isBackend) return 'backend';

    // Check repo languages
    if (repoLangs.some((l) => frontendLangs.includes(l))) return 'frontend';
    if (repoLangs.some((l) => backendLangs.includes(l))) return 'backend';

    return 'newbie';
  }

  /**
   * Generate path steps using AI
   */
  private async generatePathSteps(
    repoAnalysis: { languages: string[]; documentCount: number; hasExamples: boolean; topics: string[] },
    documents: { id: string; path: string; title: string | null; type: string }[],
    examples: { id: string; title: string; language: string; documentId: string }[],
    targetRole: TargetRole,
    difficulty: DifficultyLevel
  ): Promise<CreateStepInput[]> {
    if (!this.anthropic) {
      // Fallback to basic path generation
      return this.generateBasicPath(documents, examples, targetRole, difficulty);
    }

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        system: `You are an onboarding path designer. Create a learning journey for a ${targetRole} developer at ${difficulty} level.

Available step types:
- read_doc: Read a documentation page
- run_example: Run and experiment with a code example
- quiz: Answer questions to test understanding
- code_task: Complete a coding task
- checkpoint: Progress checkpoint with summary

Return JSON array of steps:
[
  {
    "title": "Step title",
    "description": "What the learner will do",
    "stepType": "read_doc",
    "contentId": "document_id_if_applicable",
    "content": { "questions": ["..."] },
    "estimatedMins": 10,
    "isOptional": false
  }
]

Create 8-15 steps that build progressively. Start with overview, then specifics, then practice.`,
        messages: [
          {
            role: 'user',
            content: `Design an onboarding path for this repository:

Topics: ${repoAnalysis.topics.join(', ')}
Languages: ${repoAnalysis.languages.join(', ')}
Document count: ${repoAnalysis.documentCount}
Has examples: ${repoAnalysis.hasExamples}

Available documents (first 30):
${documents.slice(0, 30).map((d) => `- ${d.id}: ${d.title || d.path} (${d.type})`).join('\n')}

Available examples (first 10):
${examples.slice(0, 10).map((e) => `- ${e.id}: ${e.title} (${e.language})`).join('\n')}`,
          },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const steps = JSON.parse(jsonMatch[0]) as CreateStepInput[];
        return steps.map((step, idx) => ({
          ...step,
          estimatedMins: step.estimatedMins || 10,
          isOptional: step.isOptional || false,
        }));
      }
    } catch (error) {
      log.warn({ error }, 'AI path generation failed, using fallback');
    }

    return this.generateBasicPath(documents, examples, targetRole, difficulty);
  }

  /**
   * Generate a basic path without AI
   */
  private generateBasicPath(
    documents: { id: string; path: string; title: string | null; type: string }[],
    examples: { id: string; title: string; language: string; documentId: string }[],
    targetRole: TargetRole,
    difficulty: DifficultyLevel
  ): CreateStepInput[] {
    const steps: CreateStepInput[] = [];

    // Step 1: Welcome
    steps.push({
      title: 'Welcome & Overview',
      description: 'Introduction to the project and what you will learn',
      stepType: 'checkpoint',
      estimatedMins: 5,
      content: {
        message: 'Welcome! This path will guide you through understanding this codebase.',
      },
    });

    // Find README
    const readme = documents.find((d) => d.path.toLowerCase().includes('readme'));
    if (readme) {
      steps.push({
        title: 'Project Overview',
        description: 'Read the main README to understand the project',
        stepType: 'read_doc',
        contentId: readme.id,
        estimatedMins: 15,
      });
    }

    // Add getting started docs
    const gettingStarted = documents.filter((d) =>
      d.path.toLowerCase().includes('getting-started') ||
      d.path.toLowerCase().includes('quickstart') ||
      d.path.toLowerCase().includes('installation')
    );

    for (const doc of gettingStarted.slice(0, 2)) {
      steps.push({
        title: doc.title || 'Getting Started',
        description: `Read: ${doc.path}`,
        stepType: 'read_doc',
        contentId: doc.id,
        estimatedMins: 10,
      });
    }

    // Add examples
    for (const example of examples.slice(0, 3)) {
      steps.push({
        title: `Try: ${example.title}`,
        description: `Run and experiment with this ${example.language} example`,
        stepType: 'run_example',
        contentId: example.id,
        estimatedMins: 15,
      });
    }

    // Add architecture/concepts docs
    const conceptDocs = documents.filter((d) =>
      d.path.toLowerCase().includes('architecture') ||
      d.path.toLowerCase().includes('concepts') ||
      d.path.toLowerCase().includes('guide')
    );

    for (const doc of conceptDocs.slice(0, 3)) {
      steps.push({
        title: doc.title || 'Core Concepts',
        description: `Deep dive: ${doc.path}`,
        stepType: 'read_doc',
        contentId: doc.id,
        estimatedMins: 20,
        isOptional: true,
      });
    }

    // Quiz checkpoint
    steps.push({
      title: 'Knowledge Check',
      description: 'Test your understanding of the basics',
      stepType: 'quiz',
      estimatedMins: 10,
      content: {
        questions: [
          'What is the main purpose of this project?',
          'What are the key components?',
          'How do you get started?',
        ],
      },
    });

    // Final checkpoint
    steps.push({
      title: 'Onboarding Complete!',
      description: 'Congratulations on completing the onboarding path',
      stepType: 'checkpoint',
      estimatedMins: 5,
      content: {
        message: 'You have completed the basic onboarding. Explore more docs to deepen your knowledge.',
        nextSteps: ['Explore API documentation', 'Try more examples', 'Join the community'],
      },
    });

    return steps;
  }

  /**
   * Create a new onboarding path
   */
  async createPath(input: CreatePathInput): Promise<string> {
    const pathId = generateId();

    await db.onboardingPath.create({
      data: {
        id: pathId,
        repositoryId: input.repositoryId,
        title: input.title,
        description: input.description,
        targetRole: input.targetRole,
        difficulty: input.difficulty,
        estimatedHours: input.estimatedHours,
        prerequisites: input.prerequisites || [],
        isDefault: input.isDefault || false,
      },
    });

    // Create steps
    if (input.steps && input.steps.length > 0) {
      for (let i = 0; i < input.steps.length; i++) {
        const step = input.steps[i];
        if (!step) continue;
        await db.onboardingStep.create({
          data: {
            id: generateId(),
            pathId,
            orderIndex: i,
            title: step.title,
            description: step.description,
            stepType: step.stepType,
            contentId: step.contentId,
            content: step.content || {},
            estimatedMins: step.estimatedMins,
            isOptional: step.isOptional || false,
          },
        });
      }
    }

    log.info({ pathId, stepCount: input.steps?.length }, 'Onboarding path created');
    return pathId;
  }

  /**
   * Get an onboarding path with all steps
   */
  async getPath(pathId: string): Promise<OnboardingPath | null> {
    const path = await db.onboardingPath.findUnique({
      where: { id: pathId },
      include: {
        steps: {
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    if (!path) return null;

    return {
      id: path.id,
      repositoryId: path.repositoryId,
      title: path.title,
      description: path.description,
      targetRole: path.targetRole as TargetRole,
      difficulty: path.difficulty as DifficultyLevel,
      estimatedHours: path.estimatedHours,
      prerequisites: path.prerequisites as string[],
      isDefault: path.isDefault,
      steps: path.steps.map((s: {
        id: string;
        pathId: string;
        orderIndex: number;
        title: string;
        description: string | null;
        stepType: string;
        contentId: string | null;
        content: Record<string, unknown>;
        estimatedMins: number;
        isOptional: boolean;
      }) => ({
        id: s.id,
        pathId: s.pathId,
        orderIndex: s.orderIndex,
        title: s.title,
        description: s.description || undefined,
        stepType: s.stepType as StepType,
        contentId: s.contentId || undefined,
        content: s.content,
        estimatedMins: s.estimatedMins,
        isOptional: s.isOptional,
      })),
      createdAt: path.createdAt,
    };
  }

  /**
   * List available paths for a repository
   */
  async listPaths(repositoryId: string): Promise<Omit<OnboardingPath, 'steps'>[]> {
    const paths = await db.onboardingPath.findMany({
      where: { repositoryId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });

    return paths.map((p: {
      id: string;
      repositoryId: string;
      title: string;
      description: string | null;
      targetRole: string;
      difficulty: string;
      estimatedHours: number;
      prerequisites: string[];
      isDefault: boolean;
      createdAt: Date;
    }) => ({
      id: p.id,
      repositoryId: p.repositoryId,
      title: p.title,
      description: p.description || undefined,
      targetRole: p.targetRole as TargetRole,
      difficulty: p.difficulty as DifficultyLevel,
      estimatedHours: p.estimatedHours,
      prerequisites: p.prerequisites,
      isDefault: p.isDefault,
      steps: [],
      createdAt: p.createdAt,
    }));
  }

  /**
   * Start a user on an onboarding path
   */
  async startPath(pathId: string, userId: string): Promise<void> {
    const existing = await db.onboardingPathProgress.findUnique({
      where: {
        pathId_userId: { pathId, userId },
      },
    });

    if (existing) {
      // Reset progress
      await db.onboardingPathProgress.update({
        where: { pathId_userId: { pathId, userId } },
        data: {
          currentStepIdx: 0,
          completedSteps: [],
          progress: 0,
          startedAt: new Date(),
          lastActivityAt: new Date(),
          completedAt: null,
        },
      });
    } else {
      await db.onboardingPathProgress.create({
        data: {
          id: generateId(),
          pathId,
          userId,
          currentStepIdx: 0,
          completedSteps: [],
          progress: 0,
        },
      });
    }
  }

  /**
   * Get user's progress on a path
   */
  async getProgress(pathId: string, userId: string): Promise<UserProgress | null> {
    const progress = await db.onboardingPathProgress.findUnique({
      where: {
        pathId_userId: { pathId, userId },
      },
    });

    if (!progress) return null;

    return {
      pathId: progress.pathId,
      userId: progress.userId,
      currentStepIdx: progress.currentStepIdx,
      completedSteps: progress.completedSteps as string[],
      progress: progress.progress,
      startedAt: progress.startedAt,
      lastActivityAt: progress.lastActivityAt,
      completedAt: progress.completedAt || undefined,
    };
  }

  /**
   * Complete a step and advance progress
   */
  async completeStep(pathId: string, userId: string, stepId: string): Promise<void> {
    const path = await this.getPath(pathId);
    if (!path) throw new Error('Path not found');

    const progress = await this.getProgress(pathId, userId);
    if (!progress) throw new Error('Progress not found');

    const completedSteps = [...progress.completedSteps, stepId];
    const totalSteps = path.steps.filter((s) => !s.isOptional).length;
    const completedRequired = completedSteps.filter((sid) => {
      const step = path.steps.find((s) => s.id === sid);
      return step && !step.isOptional;
    }).length;

    const progressPercent = Math.round((completedRequired / totalSteps) * 100);
    const currentStepIdx = Math.min(progress.currentStepIdx + 1, path.steps.length - 1);

    await db.onboardingPathProgress.update({
      where: {
        pathId_userId: { pathId, userId },
      },
      data: {
        currentStepIdx,
        completedSteps,
        progress: progressPercent,
        lastActivityAt: new Date(),
        completedAt: progressPercent >= 100 ? new Date() : null,
      },
    });
  }

  /**
   * Get all paths user is enrolled in
   */
  async getUserPaths(userId: string): Promise<Array<{
    path: Omit<OnboardingPath, 'steps'>;
    progress: UserProgress;
  }>> {
    const enrollments = await db.onboardingPathProgress.findMany({
      where: { userId },
      include: { path: true },
    });

    return enrollments.map((e: {
      path: {
        id: string;
        repositoryId: string;
        title: string;
        description: string | null;
        targetRole: string;
        difficulty: string;
        estimatedHours: number;
        prerequisites: string[];
        isDefault: boolean;
        createdAt: Date;
      };
      pathId: string;
      userId: string;
      currentStepIdx: number;
      completedSteps: string[];
      progress: number;
      startedAt: Date;
      lastActivityAt: Date;
      completedAt: Date | null;
    }) => ({
      path: {
        id: e.path.id,
        repositoryId: e.path.repositoryId,
        title: e.path.title,
        description: e.path.description || undefined,
        targetRole: e.path.targetRole as TargetRole,
        difficulty: e.path.difficulty as DifficultyLevel,
        estimatedHours: e.path.estimatedHours,
        prerequisites: e.path.prerequisites,
        isDefault: e.path.isDefault,
        steps: [],
        createdAt: e.path.createdAt,
      },
      progress: {
        pathId: e.pathId,
        userId: e.userId,
        currentStepIdx: e.currentStepIdx,
        completedSteps: e.completedSteps as string[],
        progress: e.progress,
        startedAt: e.startedAt,
        lastActivityAt: e.lastActivityAt,
        completedAt: e.completedAt || undefined,
      },
    }));
  }

  // Helper methods
  private capitalizeRole(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private calculateEstimatedHours(steps: CreateStepInput[]): number {
    const totalMins = steps.reduce((sum, s) => sum + s.estimatedMins, 0);
    return Math.round(totalMins / 60 * 10) / 10;
  }

  private getPrerequisites(role: TargetRole, difficulty: DifficultyLevel): string[] {
    const prereqs: string[] = [];

    if (difficulty !== 'beginner') {
      prereqs.push('Basic understanding of software development');
    }

    if (role === 'frontend') {
      prereqs.push('HTML/CSS basics', 'JavaScript fundamentals');
    } else if (role === 'backend') {
      prereqs.push('Programming basics', 'HTTP/REST concepts');
    } else if (role === 'devops') {
      prereqs.push('Linux command line', 'Basic scripting');
    }

    return prereqs;
  }

  // ============================================
  // Public utility methods (for testing/external use)
  // ============================================

  /**
   * Calculate progress percentage
   */
  calculateProgress(completedSteps: number[] | string[], totalSteps: number): number {
    if (totalSteps === 0) return 0;
    return Math.round((completedSteps.length / totalSteps) * 100);
  }

  /**
   * Get difficulty ordering for sorting
   */
  getDifficultyOrder(difficulty: string): number {
    const order: Record<string, number> = {
      beginner: 1,
      intermediate: 2,
      advanced: 3,
    };
    return order[difficulty] ?? 0;
  }

  /**
   * Estimate total time from steps
   */
  estimateTotalTime(steps: Array<{ estimatedMins: number }>): number {
    const totalMins = steps.reduce((sum, s) => sum + s.estimatedMins, 0);
    return totalMins / 60; // Return hours
  }
}

export const onboardingService = new OnboardingService();
