import { createLogger } from '@docsynth/utils';

const log = createLogger('onboarding-service');

// Local types for the onboarding service
type StepType = 'read' | 'watch' | 'practice' | 'quiz' | 'explore';

interface StepResource {
  type: 'document' | 'code' | 'video' | 'link';
  title: string;
  url: string;
  description?: string;
}

interface StepQuiz {
  questions: QuizQuestion[];
  passingScore: number;
}

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

interface OnboardingStep {
  id: string;
  order: number;
  title: string;
  description: string;
  type: StepType;
  content: string;
  resources: StepResource[];
  quiz?: StepQuiz;
  estimatedMin: number;
}

interface OnboardingInput {
  repositoryId: string;
  role: string;
  documents: Array<{ id: string; path: string; title: string; type: string; content: string }>;
  codeFiles: Array<{ path: string; language: string }>;
}

interface GeneratedJourney {
  title: string;
  description: string;
  estimatedMin: number;
  steps: OnboardingStep[];
  prerequisites: string[];
}

// Role-specific templates for onboarding journeys
const ROLE_TEMPLATES: Record<string, { focus: string[]; skipTopics: string[] }> = {
  developer: {
    focus: ['architecture', 'setup', 'api', 'testing', 'contributing'],
    skipTopics: ['deployment', 'monitoring', 'security-admin'],
  },
  reviewer: {
    focus: ['architecture', 'coding-standards', 'testing', 'review-guidelines'],
    skipTopics: ['setup', 'contributing'],
  },
  devops: {
    focus: ['deployment', 'infrastructure', 'monitoring', 'security', 'ci-cd'],
    skipTopics: ['api-details', 'frontend'],
  },
  architect: {
    focus: ['architecture', 'design-decisions', 'security', 'scalability'],
    skipTopics: ['setup', 'basic-usage'],
  },
  new_hire: {
    focus: ['overview', 'setup', 'basic-usage', 'team-processes', 'architecture'],
    skipTopics: [],
  },
};

class OnboardingService {
  /**
   * Generate personalized onboarding journey
   */
  async generateJourney(input: OnboardingInput): Promise<GeneratedJourney> {
    const { role, documents, codeFiles } = input;

    log.info({ role, docCount: documents.length, fileCount: codeFiles.length }, 'Generating onboarding journey');

    const roleTemplate = ROLE_TEMPLATES[role] ?? ROLE_TEMPLATES.new_hire;
    if (!roleTemplate) {
      throw new Error(`Invalid role: ${role}`);
    }
    const steps: OnboardingStep[] = [];
    let stepOrder = 0;

    // Step 1: Overview (always first)
    const readmeDoc = documents.find((d) => d.path.toLowerCase().includes('readme'));
    if (readmeDoc) {
      steps.push(this.createStep({
        order: stepOrder++,
        title: 'Project Overview',
        description: 'Get familiar with what this project does and its core purpose',
        type: 'read',
        content: `Start by reading the project README to understand:\n- What problem this solves\n- Key features\n- High-level architecture`,
        resources: [{ type: 'document', title: readmeDoc.title, url: `/docs/${readmeDoc.id}`, description: readmeDoc.path }],
        estimatedMin: 10,
      }));
    }

    // Step 2: Architecture (for most roles)
    if (roleTemplate.focus.includes('architecture')) {
      const archDoc = documents.find((d) =>
        d.type === 'ARCHITECTURE' || d.path.toLowerCase().includes('architecture')
      );
      steps.push(this.createStep({
        order: stepOrder++,
        title: 'Understanding the Architecture',
        description: 'Learn how the system is structured and how components interact',
        type: 'read',
        content: archDoc
          ? 'Review the architecture documentation to understand:\n- System components\n- Data flow\n- Key design decisions'
          : 'Explore the codebase structure to understand:\n- Directory organization\n- Key modules\n- Entry points',
        resources: archDoc
          ? [{ type: 'document', title: archDoc.title, url: `/docs/${archDoc.id}`, description: 'Architecture guide' }]
          : this.generateCodeResources(codeFiles.slice(0, 5)),
        estimatedMin: 15,
      }));
    }

    // Step 3: Setup (for developers)
    if (roleTemplate.focus.includes('setup')) {
      const setupDoc = documents.find((d) =>
        d.path.toLowerCase().includes('setup') ||
        d.path.toLowerCase().includes('install') ||
        d.path.toLowerCase().includes('getting-started')
      );
      steps.push(this.createStep({
        order: stepOrder++,
        title: 'Development Setup',
        description: 'Set up your local development environment',
        type: 'practice',
        content: `Follow the setup guide to:\n1. Clone the repository\n2. Install dependencies\n3. Configure environment\n4. Run the project locally\n5. Run tests to verify setup`,
        resources: setupDoc
          ? [{ type: 'document', title: setupDoc.title, url: `/docs/${setupDoc.id}`, description: 'Setup guide' }]
          : [{ type: 'link', title: 'README Setup Section', url: '/docs/readme#setup', description: 'Setup instructions' }],
        estimatedMin: 30,
      }));
    }

    // Step 4: API/Codebase exploration
    if (roleTemplate.focus.includes('api')) {
      const apiDoc = documents.find((d) =>
        d.type === 'API_REFERENCE' || d.path.toLowerCase().includes('api')
      );
      steps.push(this.createStep({
        order: stepOrder++,
        title: 'API & Core Functionality',
        description: 'Understand the main APIs and how to use them',
        type: 'explore',
        content: 'Explore the API documentation and core modules:\n- Key endpoints/functions\n- Common patterns\n- Error handling',
        resources: apiDoc
          ? [{ type: 'document', title: apiDoc.title, url: `/docs/${apiDoc.id}`, description: 'API reference' }]
          : this.generateCodeResources(codeFiles.filter((f) => f.path.includes('api') || f.path.includes('src')).slice(0, 3)),
        estimatedMin: 20,
      }));
    }

    // Step 5: Testing
    if (roleTemplate.focus.includes('testing')) {
      const testFiles = codeFiles.filter((f) => f.path.includes('test') || f.path.includes('spec'));
      steps.push(this.createStep({
        order: stepOrder++,
        title: 'Testing Practices',
        description: 'Learn how to write and run tests',
        type: 'practice',
        content: 'Get familiar with the testing approach:\n1. Run the existing test suite\n2. Review test patterns\n3. Write a simple test\n4. Understand coverage requirements',
        resources: this.generateCodeResources(testFiles.slice(0, 3)),
        estimatedMin: 25,
        quiz: this.createTestingQuiz(),
      }));
    }

    // Step 6: Deployment (for devops)
    if (roleTemplate.focus.includes('deployment')) {
      const deployDoc = documents.find((d) =>
        d.path.toLowerCase().includes('deploy') ||
        d.path.toLowerCase().includes('infrastructure')
      );
      steps.push(this.createStep({
        order: stepOrder++,
        title: 'Deployment & Infrastructure',
        description: 'Understand how the system is deployed and monitored',
        type: 'read',
        content: 'Review deployment processes:\n- CI/CD pipeline\n- Environment configuration\n- Monitoring setup\n- Rollback procedures',
        resources: deployDoc
          ? [{ type: 'document', title: deployDoc.title, url: `/docs/${deployDoc.id}`, description: 'Deployment guide' }]
          : [],
        estimatedMin: 20,
      }));
    }

    // Step 7: Contributing (for developers)
    if (roleTemplate.focus.includes('contributing')) {
      const contribDoc = documents.find((d) =>
        d.path.toLowerCase().includes('contributing') ||
        d.path.toLowerCase().includes('contribute')
      );
      steps.push(this.createStep({
        order: stepOrder++,
        title: 'Contributing Guidelines',
        description: 'Learn how to contribute effectively',
        type: 'read',
        content: 'Understand the contribution process:\n- Code style and conventions\n- PR process\n- Review expectations\n- Communication channels',
        resources: contribDoc
          ? [{ type: 'document', title: contribDoc.title, url: `/docs/${contribDoc.id}`, description: 'Contributing guide' }]
          : [],
        estimatedMin: 10,
      }));
    }

    // Final step: Knowledge check
    steps.push(this.createStep({
      order: stepOrder++,
      title: 'Knowledge Check',
      description: 'Test your understanding of the project',
      type: 'quiz',
      content: 'Complete this quiz to verify you understand the key concepts',
      resources: [],
      estimatedMin: 10,
      quiz: this.createKnowledgeCheckQuiz(role),
    }));

    // Calculate total time
    const totalMin = steps.reduce((sum, s) => sum + s.estimatedMin, 0);

    // Generate prerequisites
    const prerequisites = this.generatePrerequisites(role, codeFiles);

    return {
      title: `${this.formatRole(role)} Onboarding Journey`,
      description: `A personalized onboarding path for ${this.formatRole(role)}s to get productive quickly`,
      estimatedMin: totalMin,
      steps,
      prerequisites,
    };
  }

  /**
   * Create a step with standard structure
   */
  private createStep(params: {
    order: number;
    title: string;
    description: string;
    type: StepType;
    content: string;
    resources: StepResource[];
    estimatedMin: number;
    quiz?: StepQuiz;
  }): OnboardingStep {
    return {
      id: `step-${params.order}`,
      order: params.order,
      title: params.title,
      description: params.description,
      type: params.type,
      content: params.content,
      resources: params.resources,
      estimatedMin: params.estimatedMin,
      quiz: params.quiz,
    };
  }

  /**
   * Generate code file resources
   */
  private generateCodeResources(files: Array<{ path: string; language?: string }>): StepResource[] {
    return files.slice(0, 5).map((f) => ({
      type: 'code' as const,
      title: f.path.split('/').pop() || f.path,
      url: `/code/${encodeURIComponent(f.path)}`,
      description: f.language || 'Source code',
    }));
  }

  /**
   * Generate prerequisites based on role and tech stack
   */
  private generatePrerequisites(role: string, codeFiles: Array<{ path: string; language: string }>): string[] {
    const prerequisites: string[] = [];
    const languages = new Set(codeFiles.map((f) => f.language));

    // Language/framework prerequisites
    if (languages.has('typescript') || languages.has('javascript')) {
      prerequisites.push('Familiarity with JavaScript/TypeScript');
    }
    if (languages.has('python')) {
      prerequisites.push('Basic Python knowledge');
    }
    if (languages.has('go')) {
      prerequisites.push('Understanding of Go fundamentals');
    }

    // Role-specific prerequisites
    if (role === 'developer' || role === 'new_hire') {
      prerequisites.push('Git version control basics');
      prerequisites.push('Command line familiarity');
    }
    if (role === 'devops') {
      prerequisites.push('Docker and containerization concepts');
      prerequisites.push('CI/CD pipeline understanding');
    }
    if (role === 'architect') {
      prerequisites.push('Software design patterns');
      prerequisites.push('Distributed systems concepts');
    }

    return prerequisites;
  }

  /**
   * Create testing-related quiz
   */
  private createTestingQuiz(): StepQuiz {
    return {
      questions: [
        {
          question: 'What command runs the test suite?',
          options: ['npm test', 'npm run build', 'npm start', 'npm install'],
          correctIndex: 0,
          explanation: 'npm test is the standard command to run tests in Node.js projects',
        },
        {
          question: 'Why is test coverage important?',
          options: [
            'It makes the code faster',
            'It helps ensure code quality and catch bugs early',
            'It reduces file size',
            'It is only for documentation',
          ],
          correctIndex: 1,
          explanation: 'Test coverage helps identify untested code paths and maintain quality',
        },
      ],
      passingScore: 50,
    };
  }

  /**
   * Create knowledge check quiz based on role
   */
  private createKnowledgeCheckQuiz(role: string): StepQuiz {
    const baseQuestions = [
      {
        question: 'What is the main purpose of this project?',
        options: ['Refer to README', 'Unknown', 'A game', 'A social network'],
        correctIndex: 0,
        explanation: 'The README contains the project purpose - make sure you read it!',
      },
      {
        question: 'Where can you find contribution guidelines?',
        options: ['CONTRIBUTING.md', 'package.json', 'node_modules', 'dist folder'],
        correctIndex: 0,
        explanation: 'CONTRIBUTING.md is the standard location for contribution guidelines',
      },
    ];

    const roleQuestions: Record<string, typeof baseQuestions> = {
      developer: [
        {
          question: 'How do you set up the development environment?',
          options: ['Follow setup guide', 'Just run npm start', 'No setup needed', 'Email admin'],
          correctIndex: 0,
          explanation: 'Always follow the official setup guide for proper configuration',
        },
      ],
      devops: [
        {
          question: 'What should you check before deployment?',
          options: ['All tests pass and builds succeed', 'File count', 'Git log', 'Nothing'],
          correctIndex: 0,
          explanation: 'Always ensure tests pass and builds succeed before deploying',
        },
      ],
    };

    return {
      questions: [...baseQuestions, ...(roleQuestions[role] || [])],
      passingScore: 60,
    };
  }

  /**
   * Format role name for display
   */
  private formatRole(role: string): string {
    return role
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

export const onboardingService = new OnboardingService();
