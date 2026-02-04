/**
 * Interactive Playgrounds Service
 * 
 * Provides functionality for creating and managing interactive code playgrounds
 * that can be embedded in documentation. Integrates with WebContainer/StackBlitz
 * for browser-based code execution.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId } from '@docsynth/utils';
import * as crypto from 'crypto';

const log = createLogger('playground-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export type PlaygroundLanguage = 'javascript' | 'typescript' | 'python' | 'go' | 'rust' | 'html';
export type PlaygroundFramework = 'react' | 'vue' | 'svelte' | 'node' | 'express' | 'fastapi' | 'none';

export interface CreatePlaygroundInput {
  repositoryId: string;
  documentId?: string;
  title: string;
  description?: string;
  language: PlaygroundLanguage;
  framework?: PlaygroundFramework;
  initialCode: string;
  solutionCode?: string;
  testCode?: string;
  dependencies?: Record<string, string>;
  envVariables?: Record<string, string>;
  isPublic?: boolean;
  embedAllowed?: boolean;
}

export interface Playground {
  id: string;
  repositoryId: string;
  documentId?: string;
  title: string;
  description?: string;
  language: PlaygroundLanguage;
  framework?: PlaygroundFramework;
  initialCode: string;
  solutionCode?: string;
  testCode?: string;
  dependencies: Record<string, string>;
  envVariables: Record<string, string>;
  isPublic: boolean;
  embedAllowed: boolean;
  forkCount: number;
  runCount: number;
  createdAt: Date;
}

export interface PlaygroundSession {
  id: string;
  playgroundId: string;
  userId?: string;
  sessionToken: string;
  code: string;
  lastOutput?: string;
  lastError?: string;
  sandboxUrl?: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface SandboxConfig {
  template: string;
  files: Record<string, string>;
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
  env: Record<string, string>;
}

class PlaygroundService {
  private readonly SESSION_DURATION_HOURS = 24;

  /**
   * Create a new playground
   */
  async createPlayground(input: CreatePlaygroundInput): Promise<string> {
    const id = generateId();

    await db.playground.create({
      data: {
        id,
        repositoryId: input.repositoryId,
        documentId: input.documentId,
        title: input.title,
        description: input.description,
        language: input.language,
        framework: input.framework || 'none',
        initialCode: input.initialCode,
        solutionCode: input.solutionCode,
        testCode: input.testCode,
        dependencies: input.dependencies || {},
        envVariables: input.envVariables || {},
        isPublic: input.isPublic ?? true,
        embedAllowed: input.embedAllowed ?? true,
        forkCount: 0,
        runCount: 0,
      },
    });

    log.info({ playgroundId: id, language: input.language }, 'Playground created');
    return id;
  }

  /**
   * Get a playground by ID
   */
  async getPlayground(playgroundId: string): Promise<Playground | null> {
    const playground = await db.playground.findUnique({
      where: { id: playgroundId },
    });

    if (!playground) return null;

    return this.mapPlayground(playground);
  }

  /**
   * List playgrounds for a repository
   */
  async listPlaygrounds(repositoryId: string): Promise<Playground[]> {
    const playgrounds = await db.playground.findMany({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
    });

    return playgrounds.map(this.mapPlayground);
  }

  /**
   * List playgrounds for a document
   */
  async listDocumentPlaygrounds(documentId: string): Promise<Playground[]> {
    const playgrounds = await db.playground.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    });

    return playgrounds.map(this.mapPlayground);
  }

  /**
   * Create a playground session for a user
   */
  async createSession(
    playgroundId: string,
    userId?: string
  ): Promise<PlaygroundSession> {
    const playground = await this.getPlayground(playgroundId);
    if (!playground) {
      throw new Error('Playground not found');
    }

    const sessionId = generateId();
    const sessionToken = this.generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.SESSION_DURATION_HOURS);

    await db.playgroundSession.create({
      data: {
        id: sessionId,
        playgroundId,
        userId,
        sessionToken,
        code: playground.initialCode,
        expiresAt,
      },
    });

    // Increment run count
    await db.playground.update({
      where: { id: playgroundId },
      data: { runCount: { increment: 1 } },
    });

    return {
      id: sessionId,
      playgroundId,
      userId,
      sessionToken,
      code: playground.initialCode,
      expiresAt,
      createdAt: new Date(),
    };
  }

  /**
   * Get session by token
   */
  async getSession(sessionToken: string): Promise<PlaygroundSession | null> {
    const session = await db.playgroundSession.findUnique({
      where: { sessionToken },
    });

    if (!session) return null;

    // Check if expired
    if (new Date() > session.expiresAt) {
      await db.playgroundSession.delete({ where: { id: session.id } });
      return null;
    }

    return {
      id: session.id,
      playgroundId: session.playgroundId,
      userId: session.userId || undefined,
      sessionToken: session.sessionToken,
      code: session.code,
      lastOutput: session.lastOutput || undefined,
      lastError: session.lastError || undefined,
      sandboxUrl: session.sandboxUrl || undefined,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    };
  }

  /**
   * Update session code
   */
  async updateSessionCode(sessionToken: string, code: string): Promise<void> {
    await db.playgroundSession.update({
      where: { sessionToken },
      data: { code, updatedAt: new Date() },
    });
  }

  /**
   * Record execution result
   */
  async recordExecutionResult(
    sessionToken: string,
    output?: string,
    error?: string
  ): Promise<void> {
    await db.playgroundSession.update({
      where: { sessionToken },
      data: {
        lastOutput: output,
        lastError: error,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Fork a playground (create a copy)
   */
  async forkPlayground(
    playgroundId: string,
    newTitle?: string,
    userId?: string
  ): Promise<string> {
    const original = await this.getPlayground(playgroundId);
    if (!original) {
      throw new Error('Playground not found');
    }

    const forkedId = await this.createPlayground({
      repositoryId: original.repositoryId,
      documentId: original.documentId,
      title: newTitle || `${original.title} (Fork)`,
      description: original.description,
      language: original.language,
      framework: original.framework,
      initialCode: original.initialCode,
      solutionCode: original.solutionCode,
      testCode: original.testCode,
      dependencies: original.dependencies,
      envVariables: {},
      isPublic: true,
      embedAllowed: true,
    });

    // Increment fork count on original
    await db.playground.update({
      where: { id: playgroundId },
      data: { forkCount: { increment: 1 } },
    });

    log.info({ originalId: playgroundId, forkedId }, 'Playground forked');
    return forkedId;
  }

  /**
   * Generate sandbox configuration for WebContainer/StackBlitz
   */
  generateSandboxConfig(playground: Playground): SandboxConfig {
    switch (playground.language) {
      case 'javascript':
      case 'typescript':
        return this.generateNodeSandboxConfig(playground);
      case 'python':
        return this.generatePythonSandboxConfig(playground);
      case 'html':
        return this.generateHTMLSandboxConfig(playground);
      default:
        return this.generateBasicSandboxConfig(playground);
    }
  }

  /**
   * Generate Node.js sandbox configuration
   */
  private generateNodeSandboxConfig(playground: Playground): SandboxConfig {
    const isTypeScript = playground.language === 'typescript';
    const mainFile = isTypeScript ? 'index.ts' : 'index.js';

    const packageJson: {
      name: string;
      version: string;
      type: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    } = {
      name: playground.title.toLowerCase().replace(/\s+/g, '-'),
      version: '1.0.0',
      type: 'module',
      scripts: {
        start: isTypeScript ? 'tsx index.ts' : 'node index.js',
        test: playground.testCode ? 'vitest run' : 'echo "No tests"',
      },
      dependencies: {
        ...playground.dependencies,
      },
      devDependencies: isTypeScript
        ? { typescript: '^5.0.0', tsx: '^4.0.0' }
        : {},
    };

    if (playground.testCode) {
      packageJson.devDependencies = {
        ...packageJson.devDependencies,
        vitest: '^1.0.0',
      };
    }

    const files: Record<string, string> = {
      [mainFile]: playground.initialCode,
      'package.json': JSON.stringify(packageJson, null, 2),
    };

    if (playground.testCode) {
      files['test.spec.ts'] = playground.testCode;
    }

    // Handle React/Vue frameworks
    if (playground.framework === 'react') {
      files['index.html'] = `<!DOCTYPE html>
<html>
<head><title>${playground.title}</title></head>
<body>
  <div id="root"></div>
  <script type="module" src="/${mainFile}"></script>
</body>
</html>`;
      packageJson.dependencies = {
        ...packageJson.dependencies,
        react: '^18.0.0',
        'react-dom': '^18.0.0',
      };
    }

    return {
      template: isTypeScript ? 'node-typescript' : 'node',
      files,
      dependencies: packageJson.dependencies,
      scripts: packageJson.scripts,
      env: playground.envVariables,
    };
  }

  /**
   * Generate Python sandbox configuration
   */
  private generatePythonSandboxConfig(playground: Playground): SandboxConfig {
    const requirements = Object.entries(playground.dependencies)
      .map(([pkg, version]) => `${pkg}${version ? `==${version}` : ''}`)
      .join('\n');

    return {
      template: 'python',
      files: {
        'main.py': playground.initialCode,
        'requirements.txt': requirements,
        ...(playground.testCode && { 'test_main.py': playground.testCode }),
      },
      dependencies: playground.dependencies,
      scripts: {
        start: 'python main.py',
        test: 'pytest test_main.py',
      },
      env: playground.envVariables,
    };
  }

  /**
   * Generate HTML sandbox configuration
   */
  private generateHTMLSandboxConfig(playground: Playground): SandboxConfig {
    return {
      template: 'static',
      files: {
        'index.html': playground.initialCode,
      },
      dependencies: {},
      scripts: {},
      env: {},
    };
  }

  /**
   * Generate basic sandbox configuration
   */
  private generateBasicSandboxConfig(playground: Playground): SandboxConfig {
    return {
      template: 'node',
      files: {
        'main.txt': playground.initialCode,
      },
      dependencies: {},
      scripts: {
        start: 'cat main.txt',
      },
      env: {},
    };
  }

  /**
   * Generate StackBlitz URL for a playground
   */
  generateStackBlitzUrl(playground: Playground): string {
    const config = this.generateSandboxConfig(playground);
    const project = {
      title: playground.title,
      description: playground.description || '',
      template: config.template,
      files: config.files,
      dependencies: config.dependencies,
    };

    // StackBlitz uses base64-encoded project config
    const encoded = Buffer.from(JSON.stringify(project)).toString('base64url');
    return `https://stackblitz.com/fork?embed=1&project=${encoded}`;
  }

  /**
   * Generate embed code for a playground
   */
  generateEmbedCode(playgroundId: string, options?: { height?: number; theme?: 'light' | 'dark' }): string {
    const height = options?.height || 500;
    const theme = options?.theme || 'light';

    return `<iframe
  src="/playground/embed/${playgroundId}?theme=${theme}"
  width="100%"
  height="${height}px"
  frameborder="0"
  sandbox="allow-scripts allow-same-origin"
  title="Interactive Playground"
></iframe>`;
  }

  /**
   * Extract playgrounds from markdown content
   */
  extractPlaygroundsFromMarkdown(
    content: string,
    repositoryId: string,
    documentId: string
  ): CreatePlaygroundInput[] {
    const playgrounds: CreatePlaygroundInput[] = [];
    
    // Match code blocks with playground directive
    // ```typescript playground
    // or ```javascript playground title="My Playground"
    const playgroundRegex = /```(\w+)\s+playground(?:\s+title="([^"]+)")?(?:\s+framework="([^"]+)")?\n([\s\S]*?)```/g;
    
    let match;
    let index = 0;

    while ((match = playgroundRegex.exec(content)) !== null) {
      const [, language, title, framework, code] = match;
      
      playgrounds.push({
        repositoryId,
        documentId,
        title: title || `Playground ${++index}`,
        language: this.normalizeLanguage(language || 'javascript'),
        framework: (framework as PlaygroundFramework) || 'none',
        initialCode: code?.trim() || '',
        isPublic: true,
        embedAllowed: true,
      });
    }

    return playgrounds;
  }

  /**
   * Normalize language string
   */
  private normalizeLanguage(lang: string): PlaygroundLanguage {
    const normalized = lang.toLowerCase();
    const mapping: Record<string, PlaygroundLanguage> = {
      js: 'javascript',
      javascript: 'javascript',
      ts: 'typescript',
      typescript: 'typescript',
      py: 'python',
      python: 'python',
      go: 'go',
      golang: 'go',
      rs: 'rust',
      rust: 'rust',
      html: 'html',
    };
    return mapping[normalized] || 'javascript';
  }

  /**
   * Generate session token
   */
  private generateSessionToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Map database playground to typed interface
   */
  private mapPlayground(p: {
    id: string;
    repositoryId: string;
    documentId: string | null;
    title: string;
    description: string | null;
    language: string;
    framework: string | null;
    initialCode: string;
    solutionCode: string | null;
    testCode: string | null;
    dependencies: Record<string, string>;
    envVariables: Record<string, string>;
    isPublic: boolean;
    embedAllowed: boolean;
    forkCount: number;
    runCount: number;
    createdAt: Date;
  }): Playground {
    return {
      id: p.id,
      repositoryId: p.repositoryId,
      documentId: p.documentId || undefined,
      title: p.title,
      description: p.description || undefined,
      language: p.language as PlaygroundLanguage,
      framework: (p.framework || undefined) as PlaygroundFramework | undefined,
      initialCode: p.initialCode,
      solutionCode: p.solutionCode || undefined,
      testCode: p.testCode || undefined,
      dependencies: p.dependencies,
      envVariables: p.envVariables,
      isPublic: p.isPublic,
      embedAllowed: p.embedAllowed,
      forkCount: p.forkCount,
      runCount: p.runCount,
      createdAt: p.createdAt,
    };
  }

  /**
   * Delete a playground
   */
  async deletePlayground(playgroundId: string): Promise<void> {
    await db.playground.delete({
      where: { id: playgroundId },
    });
  }

  /**
   * Update a playground
   */
  async updatePlayground(
    playgroundId: string,
    updates: Partial<CreatePlaygroundInput>
  ): Promise<void> {
    await db.playground.update({
      where: { id: playgroundId },
      data: {
        ...(updates.title && { title: updates.title }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.initialCode && { initialCode: updates.initialCode }),
        ...(updates.solutionCode !== undefined && { solutionCode: updates.solutionCode }),
        ...(updates.testCode !== undefined && { testCode: updates.testCode }),
        ...(updates.dependencies && { dependencies: updates.dependencies }),
        ...(updates.isPublic !== undefined && { isPublic: updates.isPublic }),
        ...(updates.embedAllowed !== undefined && { embedAllowed: updates.embedAllowed }),
      },
    });
  }

  /**
   * Get popular playgrounds
   */
  async getPopularPlaygrounds(limit: number = 10): Promise<Playground[]> {
    const playgrounds = await db.playground.findMany({
      where: { isPublic: true },
      orderBy: [{ runCount: 'desc' }, { forkCount: 'desc' }],
      take: limit,
    });

    return playgrounds.map(this.mapPlayground);
  }

  // ============================================
  // Public utility methods (for testing/external use)
  // ============================================

  /**
   * Get default files for a runtime and template
   */
  getDefaultFiles(runtime: string, template: string): Record<string, string> {
    const templates: Record<string, Record<string, Record<string, string>>> = {
      javascript: {
        blank: { 'index.js': '// Your JavaScript code here\nconsole.log("Hello, World!");' },
        node: { 'index.js': 'const http = require("http");\n// Node.js server code' },
      },
      typescript: {
        blank: { 'index.ts': '// Your TypeScript code here\nconst greeting: string = "Hello, World!";\nconsole.log(greeting);' },
      },
      python: {
        blank: { 'main.py': '# Your Python code here\nprint("Hello, World!")' },
        flask: { 'app.py': 'from flask import Flask\napp = Flask(__name__)\n\n@app.route("/")\ndef hello():\n    return "Hello, World!"' },
      },
      html: {
        blank: { 
          'index.html': '<!DOCTYPE html>\n<html>\n<head>\n  <title>Playground</title>\n</head>\n<body>\n  <h1>Hello, World!</h1>\n</body>\n</html>' 
        },
      },
    };

    return templates[runtime]?.[template] ?? templates[runtime]?.['blank'] ?? { 'main.txt': '// Code here' };
  }

  /**
   * Validate runtime
   */
  isValidRuntime(runtime: string): boolean {
    return ['javascript', 'typescript', 'python', 'html'].includes(runtime);
  }

  /**
   * Validate template for runtime
   */
  isValidTemplate(runtime: string, template: string): boolean {
    const validTemplates: Record<string, string[]> = {
      javascript: ['blank', 'node', 'react', 'express'],
      typescript: ['blank', 'node', 'react'],
      python: ['blank', 'flask', 'django'],
      html: ['blank', 'landing'],
    };
    return validTemplates[runtime]?.includes(template) ?? false;
  }
}

export const playgroundService = new PlaygroundService();
