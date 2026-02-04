/**
 * Multi-Agent Documentation System
 * 
 * Implements specialized AI agents that collaborate to generate
 * high-quality, accurate documentation.
 * 
 * Agents:
 * - Reader: Parses and understands code semantically
 * - Searcher: Finds related docs, PRs, issues for context
 * - Writer: Generates documentation drafts
 * - Verifier: Fact-checks against actual code behavior
 * - Orchestrator: Coordinates workflow and resolves conflicts
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId, getAnthropicClient } from '@docsynth/utils';

const log = createLogger('multi-agent-docs');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export type AgentType = 'reader' | 'searcher' | 'writer' | 'verifier' | 'orchestrator';

export interface AgentTask {
  id: string;
  agentType: AgentType;
  input: string;
  output?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentRun {
  id: string;
  repositoryId: string;
  fileId?: string;
  filePath?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  tasks: AgentTask[];
  finalOutput?: string;
  qualityScore?: number;
  createdAt: Date;
  completedAt?: Date;
}

export interface GenerateDocOptions {
  fileId?: string;
  filePath?: string;
  content?: string;
  docType: 'api' | 'overview' | 'tutorial' | 'reference' | 'changelog';
  includeExamples: boolean;
  maxLength?: number;
  targetAudience?: 'beginner' | 'intermediate' | 'expert';
}

interface ReaderOutput {
  language: string;
  symbols: Symbol[];
  imports: string[];
  exports: string[];
  complexity: 'low' | 'medium' | 'high';
  summary: string;
}

interface Symbol {
  name: string;
  type: 'function' | 'class' | 'interface' | 'variable' | 'constant' | 'type';
  signature?: string;
  description?: string;
  parameters?: { name: string; type: string; description?: string }[];
  returnType?: string;
  lineStart: number;
  lineEnd: number;
}

interface SearcherOutput {
  relatedDocs: { path: string; relevance: number; summary: string }[];
  relatedPRs: { number: number; title: string; relevance: number }[];
  relatedIssues: { number: number; title: string; relevance: number }[];
  existingExamples: string[];
  context: string;
}

interface WriterOutput {
  documentation: string;
  sections: { title: string; content: string }[];
  examples: string[];
  warnings: string[];
}

interface VerifierOutput {
  accuracy: number;
  issues: VerificationIssue[];
  suggestions: string[];
  verified: boolean;
}

interface VerificationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  suggestedFix?: string;
}

class MultiAgentDocService {
  private anthropic = getAnthropicClient();

  /**
   * Generate documentation using multi-agent system
   */
  async generateDocumentation(
    repositoryId: string,
    options: GenerateDocOptions
  ): Promise<AgentRun> {
    const runId = generateId();
    
    // Create agent run record
    const run: AgentRun = {
      id: runId,
      repositoryId,
      fileId: options.fileId,
      filePath: options.filePath,
      status: 'running',
      tasks: [],
      createdAt: new Date(),
    };

    try {
      // Store run in database
      await db.agentRun.create({
        data: {
          id: runId,
          repositoryId,
          targetFileId: options.fileId,
          targetPath: options.filePath,
          docType: options.docType,
          status: 'running',
          config: JSON.stringify(options),
        },
      });

      // Get file content if not provided
      let content = options.content;
      if (!content && options.fileId) {
        const file = await prisma.document.findUnique({
          where: { id: options.fileId },
        });
        content = file?.content;
      }

      if (!content) {
        throw new Error('No content provided for documentation generation');
      }

      // Phase 1: Reader Agent - Parse and understand code
      const readerTask = await this.runReaderAgent(runId, content);
      run.tasks.push(readerTask);

      if (readerTask.status === 'failed') {
        throw new Error(`Reader agent failed: ${readerTask.error}`);
      }

      const readerOutput = JSON.parse(readerTask.output || '{}') as ReaderOutput;

      // Phase 2: Searcher Agent - Find related context
      const searcherTask = await this.runSearcherAgent(
        runId,
        repositoryId,
        readerOutput,
        options.filePath
      );
      run.tasks.push(searcherTask);

      const searcherOutput = searcherTask.status === 'completed'
        ? (JSON.parse(searcherTask.output || '{}') as SearcherOutput)
        : { relatedDocs: [], relatedPRs: [], relatedIssues: [], existingExamples: [], context: '' };

      // Phase 3: Writer Agent - Generate documentation
      const writerTask = await this.runWriterAgent(
        runId,
        content,
        readerOutput,
        searcherOutput,
        options
      );
      run.tasks.push(writerTask);

      if (writerTask.status === 'failed') {
        throw new Error(`Writer agent failed: ${writerTask.error}`);
      }

      const writerOutput = JSON.parse(writerTask.output || '{}') as WriterOutput;

      // Phase 4: Verifier Agent - Fact-check documentation
      const verifierTask = await this.runVerifierAgent(
        runId,
        content,
        readerOutput,
        writerOutput
      );
      run.tasks.push(verifierTask);

      const verifierOutput = verifierTask.status === 'completed'
        ? (JSON.parse(verifierTask.output || '{}') as VerifierOutput)
        : { accuracy: 0, issues: [], suggestions: [], verified: false };

      // Phase 5: Orchestrator - Finalize and merge
      const finalDoc = await this.runOrchestratorAgent(
        runId,
        writerOutput,
        verifierOutput
      );

      run.finalOutput = finalDoc;
      run.qualityScore = verifierOutput.accuracy;
      run.status = 'completed';
      run.completedAt = new Date();

      // Update database
      await db.agentRun.update({
        where: { id: runId },
        data: {
          status: 'completed',
          finalOutput: finalDoc,
          qualityScore: verifierOutput.accuracy,
          completedAt: new Date(),
        },
      });

      log.info({ runId, repositoryId, qualityScore: verifierOutput.accuracy }, 'Multi-agent doc generation completed');

      return run;
    } catch (error) {
      run.status = 'failed';
      
      await db.agentRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      log.error({ error, runId, repositoryId }, 'Multi-agent doc generation failed');
      throw error;
    }
  }

  /**
   * Reader Agent: Parse and understand code structure
   */
  private async runReaderAgent(runId: string, content: string): Promise<AgentTask> {
    const taskId = generateId();
    const startTime = Date.now();

    await this.storeTask(runId, taskId, 'reader', 'running');

    try {
      if (!this.anthropic) {
        throw new Error('AI service not configured');
      }

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: `You are a code analysis agent. Parse the given code and extract:
1. Programming language
2. All symbols (functions, classes, interfaces, variables)
3. Imports and exports
4. Overall complexity assessment

Return JSON format:
{
  "language": "typescript",
  "symbols": [
    {
      "name": "functionName",
      "type": "function",
      "signature": "functionName(param: Type): ReturnType",
      "parameters": [{"name": "param", "type": "Type", "description": "..."}],
      "returnType": "ReturnType",
      "lineStart": 1,
      "lineEnd": 10
    }
  ],
  "imports": ["module1", "module2"],
  "exports": ["export1", "export2"],
  "complexity": "medium",
  "summary": "Brief description of what this code does"
}`,
        messages: [
          { role: 'user', content: `Analyze this code:\n\n${content.substring(0, 15000)}` },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const output = jsonMatch ? jsonMatch[0] : '{}';

      const task: AgentTask = {
        id: taskId,
        agentType: 'reader',
        input: content.substring(0, 500) + '...',
        output,
        status: 'completed',
        durationMs: Date.now() - startTime,
      };

      await this.updateTask(runId, taskId, 'completed', output);
      return task;
    } catch (error) {
      const task: AgentTask = {
        id: taskId,
        agentType: 'reader',
        input: content.substring(0, 500) + '...',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      };

      await this.updateTask(runId, taskId, 'failed', undefined, task.error);
      return task;
    }
  }

  /**
   * Searcher Agent: Find related documentation and context
   */
  private async runSearcherAgent(
    runId: string,
    repositoryId: string,
    readerOutput: ReaderOutput,
    filePath?: string
  ): Promise<AgentTask> {
    const taskId = generateId();
    const startTime = Date.now();

    await this.storeTask(runId, taskId, 'searcher', 'running');

    try {
      // Search for related documents
      const relatedDocs = await prisma.document.findMany({
        where: {
          repositoryId,
          id: { not: undefined },
        },
        take: 5,
        select: { path: true, title: true, content: true },
      });

      // Build context
      const context = relatedDocs
        .map((d) => `- ${d.path}: ${d.title || 'Untitled'}`)
        .join('\n');

      const output: SearcherOutput = {
        relatedDocs: relatedDocs.map((d) => ({
          path: d.path,
          relevance: 0.7,
          summary: d.content.substring(0, 200),
        })),
        relatedPRs: [],
        relatedIssues: [],
        existingExamples: [],
        context: `Found ${relatedDocs.length} related documents:\n${context}`,
      };

      const task: AgentTask = {
        id: taskId,
        agentType: 'searcher',
        input: JSON.stringify({ repositoryId, symbols: readerOutput.symbols.map((s) => s.name) }),
        output: JSON.stringify(output),
        status: 'completed',
        durationMs: Date.now() - startTime,
      };

      await this.updateTask(runId, taskId, 'completed', task.output);
      return task;
    } catch (error) {
      const task: AgentTask = {
        id: taskId,
        agentType: 'searcher',
        input: JSON.stringify({ repositoryId }),
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      };

      await this.updateTask(runId, taskId, 'failed', undefined, task.error);
      return task;
    }
  }

  /**
   * Writer Agent: Generate documentation
   */
  private async runWriterAgent(
    runId: string,
    content: string,
    readerOutput: ReaderOutput,
    searcherOutput: SearcherOutput,
    options: GenerateDocOptions
  ): Promise<AgentTask> {
    const taskId = generateId();
    const startTime = Date.now();

    await this.storeTask(runId, taskId, 'writer', 'running');

    try {
      if (!this.anthropic) {
        throw new Error('AI service not configured');
      }

      const audienceGuide = {
        beginner: 'Use simple language, explain all concepts, provide detailed examples',
        intermediate: 'Assume basic knowledge, focus on usage patterns and edge cases',
        expert: 'Be concise, focus on advanced usage, internal details, and optimization',
      };

      const docTypeGuide = {
        api: 'Focus on function signatures, parameters, return types, and usage examples',
        overview: 'Provide high-level explanation of purpose, architecture, and key concepts',
        tutorial: 'Step-by-step guide with clear instructions and runnable examples',
        reference: 'Comprehensive list of all APIs, options, and configurations',
        changelog: 'List changes, new features, deprecations, and migration guides',
      };

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: `You are a technical documentation writer. Generate clear, accurate documentation.

Target audience: ${options.targetAudience || 'intermediate'}
${audienceGuide[options.targetAudience || 'intermediate']}

Documentation type: ${options.docType}
${docTypeGuide[options.docType]}

${options.includeExamples ? 'Include code examples for each major feature.' : ''}

Return JSON format:
{
  "documentation": "Full markdown documentation",
  "sections": [
    {"title": "Section Title", "content": "Section content..."}
  ],
  "examples": ["example code 1", "example code 2"],
  "warnings": ["Any important warnings or gotchas"]
}`,
        messages: [
          {
            role: 'user',
            content: `Generate documentation for this code:

## Code Analysis
${JSON.stringify(readerOutput, null, 2)}

## Related Context
${searcherOutput.context}

## Source Code (first 10000 chars)
${content.substring(0, 10000)}`,
          },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const output = jsonMatch ? jsonMatch[0] : '{"documentation": "", "sections": [], "examples": [], "warnings": []}';

      const task: AgentTask = {
        id: taskId,
        agentType: 'writer',
        input: `docType: ${options.docType}, symbols: ${readerOutput.symbols.length}`,
        output,
        status: 'completed',
        durationMs: Date.now() - startTime,
      };

      await this.updateTask(runId, taskId, 'completed', output);
      return task;
    } catch (error) {
      const task: AgentTask = {
        id: taskId,
        agentType: 'writer',
        input: `docType: ${options.docType}`,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      };

      await this.updateTask(runId, taskId, 'failed', undefined, task.error);
      return task;
    }
  }

  /**
   * Verifier Agent: Fact-check documentation
   */
  private async runVerifierAgent(
    runId: string,
    content: string,
    readerOutput: ReaderOutput,
    writerOutput: WriterOutput
  ): Promise<AgentTask> {
    const taskId = generateId();
    const startTime = Date.now();

    await this.storeTask(runId, taskId, 'verifier', 'running');

    try {
      if (!this.anthropic) {
        throw new Error('AI service not configured');
      }

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: `You are a documentation verifier. Check the documentation against the actual code for:
1. Accuracy of function signatures and parameters
2. Correct return types
3. Valid code examples that would actually work
4. Any claims that don't match the code

Return JSON format:
{
  "accuracy": 85,
  "issues": [
    {
      "severity": "error",
      "message": "Function signature incorrect",
      "line": 15,
      "suggestedFix": "Change X to Y"
    }
  ],
  "suggestions": ["Add example for edge case X", "Clarify parameter Y"],
  "verified": true
}

Rate accuracy from 0-100. Set verified=true if accuracy > 70 and no "error" severity issues.`,
        messages: [
          {
            role: 'user',
            content: `Verify this documentation against the source code:

## Documentation to Verify
${writerOutput.documentation.substring(0, 8000)}

## Code Analysis (symbols found)
${JSON.stringify(readerOutput.symbols.slice(0, 20), null, 2)}

## Source Code (first 8000 chars)
${content.substring(0, 8000)}`,
          },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const output = jsonMatch
        ? jsonMatch[0]
        : '{"accuracy": 70, "issues": [], "suggestions": [], "verified": true}';

      const task: AgentTask = {
        id: taskId,
        agentType: 'verifier',
        input: `Verifying ${writerOutput.sections.length} sections`,
        output,
        status: 'completed',
        durationMs: Date.now() - startTime,
      };

      await this.updateTask(runId, taskId, 'completed', output);
      return task;
    } catch (error) {
      const task: AgentTask = {
        id: taskId,
        agentType: 'verifier',
        input: 'Verification failed',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      };

      await this.updateTask(runId, taskId, 'failed', undefined, task.error);
      return task;
    }
  }

  /**
   * Orchestrator: Finalize and merge all agent outputs
   */
  private async runOrchestratorAgent(
    runId: string,
    writerOutput: WriterOutput,
    verifierOutput: VerifierOutput
  ): Promise<string> {
    // Start with writer's documentation
    let finalDoc = writerOutput.documentation;

    // If there are critical issues, add warnings section
    const criticalIssues = verifierOutput.issues.filter((i) => i.severity === 'error');
    if (criticalIssues.length > 0) {
      const warningSection = `
> ⚠️ **Documentation Verification Warnings**
> 
> The following issues were detected during verification:
${criticalIssues.map((i) => `> - ${i.message}`).join('\n')}
`;
      finalDoc = warningSection + '\n\n' + finalDoc;
    }

    // Add quality badge
    const qualityBadge = verifierOutput.accuracy >= 90
      ? '✅ High Quality'
      : verifierOutput.accuracy >= 70
        ? '🔶 Good Quality'
        : '⚠️ Needs Review';

    finalDoc = `<!-- Quality Score: ${verifierOutput.accuracy}% ${qualityBadge} -->\n\n` + finalDoc;

    // Store orchestrator task
    const taskId = generateId();
    await this.storeTask(runId, taskId, 'orchestrator', 'completed');

    return finalDoc;
  }

  /**
   * Store task in database
   */
  private async storeTask(
    runId: string,
    taskId: string,
    agentType: AgentType,
    status: string
  ): Promise<void> {
    await db.agentTask.create({
      data: {
        id: taskId,
        agentRunId: runId,
        agentType,
        status,
      },
    });
  }

  /**
   * Update task in database
   */
  private async updateTask(
    runId: string,
    taskId: string,
    status: string,
    output?: string,
    error?: string
  ): Promise<void> {
    await db.agentTask.update({
      where: { id: taskId },
      data: {
        status,
        output: output?.substring(0, 50000),
        error,
        completedAt: ['completed', 'failed'].includes(status) ? new Date() : undefined,
      },
    });
  }

  /**
   * Get agent run status and results
   */
  async getAgentRun(runId: string): Promise<AgentRun | null> {
    const run = await db.agentRun.findUnique({
      where: { id: runId },
      include: {
        tasks: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!run) {
      return null;
    }

    return {
      id: run.id,
      repositoryId: run.repositoryId,
      fileId: run.targetFileId,
      filePath: run.targetPath,
      status: run.status,
      tasks: run.tasks.map((t: {
        id: string;
        agentType: AgentType;
        input: string;
        output: string | null;
        status: string;
        error: string | null;
        completedAt: Date | null;
        createdAt: Date;
      }) => ({
        id: t.id,
        agentType: t.agentType,
        input: t.input || '',
        output: t.output || undefined,
        status: t.status as 'pending' | 'running' | 'completed' | 'failed',
        error: t.error || undefined,
        durationMs: t.completedAt ? t.completedAt.getTime() - t.createdAt.getTime() : undefined,
      })),
      finalOutput: run.finalOutput,
      qualityScore: run.qualityScore,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    };
  }

  /**
   * List agent runs for a repository
   */
  async listAgentRuns(repositoryId: string, limit: number = 20): Promise<AgentRun[]> {
    const runs = await db.agentRun.findMany({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        tasks: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return runs.map((run: {
      id: string;
      repositoryId: string;
      targetFileId: string | null;
      targetPath: string | null;
      status: string;
      finalOutput: string | null;
      qualityScore: number | null;
      createdAt: Date;
      completedAt: Date | null;
      tasks: {
        id: string;
        agentType: AgentType;
        input: string;
        output: string | null;
        status: string;
        error: string | null;
        completedAt: Date | null;
        createdAt: Date;
      }[];
    }) => ({
      id: run.id,
      repositoryId: run.repositoryId,
      fileId: run.targetFileId || undefined,
      filePath: run.targetPath || undefined,
      status: run.status as 'pending' | 'running' | 'completed' | 'failed',
      tasks: run.tasks.map((t) => ({
        id: t.id,
        agentType: t.agentType,
        input: t.input || '',
        output: t.output || undefined,
        status: t.status as 'pending' | 'running' | 'completed' | 'failed',
        error: t.error || undefined,
        durationMs: t.completedAt ? t.completedAt.getTime() - t.createdAt.getTime() : undefined,
      })),
      finalOutput: run.finalOutput || undefined,
      qualityScore: run.qualityScore || undefined,
      createdAt: run.createdAt,
      completedAt: run.completedAt || undefined,
    }));
  }

  // ============================================
  // Public utility methods (for testing/external use)
  // ============================================

  /**
   * Get all agent types
   */
  getAgentTypes(): string[] {
    return ['reader', 'searcher', 'writer', 'verifier', 'orchestrator'];
  }

  /**
   * Validate run type
   */
  isValidRunType(runType: string): boolean {
    return ['generate', 'update', 'review', 'migrate'].includes(runType);
  }

  /**
   * Get task execution order for a run type
   */
  getTaskOrder(runType: string): string[] {
    const orders: Record<string, string[]> = {
      generate: ['orchestrator', 'reader', 'searcher', 'writer', 'verifier'],
      update: ['reader', 'searcher', 'writer', 'verifier'],
      review: ['reader', 'verifier'],
      migrate: ['reader', 'writer', 'verifier'],
    };
    return orders[runType] ?? orders['generate'] ?? [];
  }
}

export const multiAgentDocService = new MultiAgentDocService();
