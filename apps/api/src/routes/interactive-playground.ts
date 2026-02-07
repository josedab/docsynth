/**
 * Interactive Playgrounds API Routes
 *
 * Enhanced with server-side execution, test validation, and AI-powered hints.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { playgroundService } from '../services/playground.service.js';
import { executeInSandbox, validateCodeExample, type SupportedLanguage } from '../services/sandbox.service.js';
import { createLLMClient } from '@docsynth/utils';
import { createLogger } from '@docsynth/utils';

const log = createLogger('interactive-playground-routes');
const router = new Hono();

// Create a playground
const createSchema = z.object({
  documentId: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  language: z.enum(['javascript', 'typescript', 'python', 'go', 'rust', 'html']),
  framework: z.enum(['react', 'vue', 'svelte', 'node', 'express', 'fastapi', 'none']).optional(),
  initialCode: z.string().min(1).max(100000),
  solutionCode: z.string().max(100000).optional(),
  testCode: z.string().max(100000).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  envVariables: z.record(z.string(), z.string()).optional(),
  isPublic: z.boolean().optional(),
  embedAllowed: z.boolean().optional(),
});

router.post('/create/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const body = await c.req.json();

  const parsed = createSchema.safeParse(body);
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
    const playgroundId = await playgroundService.createPlayground({
      repositoryId,
      ...parsed.data,
    });

    return c.json({
      message: 'Playground created',
      playgroundId,
    });
  } catch (error) {
    console.error('Failed to create playground:', error);
    return c.json({ error: 'Failed to create playground' }, 500);
  }
});

// Get a playground
router.get('/:playgroundId', async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';

  const playground = await playgroundService.getPlayground(playgroundId);

  if (!playground) {
    return c.json({ error: 'Playground not found' }, 404);
  }

  // Check if public or user has access
  if (!playground.isPublic) {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    // Additional org access check could go here
  }

  return c.json(playground);
});

// List playgrounds for repository
router.get('/repository/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';

  const playgrounds = await playgroundService.listPlaygrounds(repositoryId);

  return c.json({ playgrounds });
});

// List playgrounds for document
router.get('/document/:documentId', async (c) => {
  const documentId = c.req.param('documentId') ?? '';

  const playgrounds = await playgroundService.listDocumentPlaygrounds(documentId);

  return c.json({ playgrounds });
});

// Create a session to run a playground
router.post('/session/:playgroundId', async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';
  const user = c.get('user');

  const playground = await playgroundService.getPlayground(playgroundId);
  if (!playground) {
    return c.json({ error: 'Playground not found' }, 404);
  }

  if (!playground.isPublic && !user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const session = await playgroundService.createSession(playgroundId, user?.id);

    return c.json({
      sessionToken: session.sessionToken,
      code: session.code,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    console.error('Failed to create session:', error);
    return c.json({ error: 'Failed to create session' }, 500);
  }
});

// Get session by token
router.get('/session/token/:sessionToken', async (c) => {
  const { sessionToken } = c.req.param();

  const session = await playgroundService.getSession(sessionToken);

  if (!session) {
    return c.json({ error: 'Session not found or expired' }, 404);
  }

  return c.json(session);
});

// Update session code
const updateCodeSchema = z.object({
  code: z.string().max(100000),
});

router.put('/session/token/:sessionToken/code', async (c) => {
  const { sessionToken } = c.req.param();
  const body = await c.req.json();

  const parsed = updateCodeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  try {
    await playgroundService.updateSessionCode(sessionToken, parsed.data.code);
    return c.json({ message: 'Code updated' });
  } catch (error) {
    return c.json({ error: 'Failed to update code' }, 500);
  }
});

// Record execution result
const executionResultSchema = z.object({
  output: z.string().max(50000).optional(),
  error: z.string().max(50000).optional(),
});

router.post('/session/token/:sessionToken/result', async (c) => {
  const { sessionToken } = c.req.param();
  const body = await c.req.json();

  const parsed = executionResultSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  try {
    await playgroundService.recordExecutionResult(
      sessionToken,
      parsed.data.output,
      parsed.data.error
    );
    return c.json({ message: 'Result recorded' });
  } catch (error) {
    return c.json({ error: 'Failed to record result' }, 500);
  }
});

// Fork a playground
router.post('/fork/:playgroundId', requireAuth, async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  try {
    const forkedId = await playgroundService.forkPlayground(
      playgroundId,
      body.title,
      user?.id
    );

    return c.json({
      message: 'Playground forked',
      playgroundId: forkedId,
    });
  } catch (error) {
    console.error('Failed to fork playground:', error);
    return c.json({ error: 'Failed to fork playground' }, 500);
  }
});

// Get sandbox configuration
router.get('/:playgroundId/sandbox-config', async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';

  const playground = await playgroundService.getPlayground(playgroundId);
  if (!playground) {
    return c.json({ error: 'Playground not found' }, 404);
  }

  const config = playgroundService.generateSandboxConfig(playground);

  return c.json(config);
});

// Get StackBlitz URL
router.get('/:playgroundId/stackblitz-url', async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';

  const playground = await playgroundService.getPlayground(playgroundId);
  if (!playground) {
    return c.json({ error: 'Playground not found' }, 404);
  }

  const url = playgroundService.generateStackBlitzUrl(playground);

  return c.json({ url });
});

// Get embed code
router.get('/:playgroundId/embed-code', async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';
  const { height, theme } = c.req.query();

  const playground = await playgroundService.getPlayground(playgroundId);
  if (!playground) {
    return c.json({ error: 'Playground not found' }, 404);
  }

  if (!playground.embedAllowed) {
    return c.json({ error: 'Embedding not allowed for this playground' }, 403);
  }

  const embedCode = playgroundService.generateEmbedCode(playgroundId, {
    height: height ? parseInt(height) : undefined,
    theme: theme as 'light' | 'dark' | undefined,
  });

  return c.json({ embedCode });
});

// Update playground
const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  initialCode: z.string().min(1).max(100000).optional(),
  solutionCode: z.string().max(100000).optional().nullable(),
  testCode: z.string().max(100000).optional().nullable(),
  dependencies: z.record(z.string(), z.string()).optional(),
  isPublic: z.boolean().optional(),
  embedAllowed: z.boolean().optional(),
});

router.put('/:playgroundId', requireAuth, async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';
  const body = await c.req.json();

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  try {
    // Convert null values to undefined for compatibility
    const updateData: Partial<{
      title?: string;
      description?: string;
      initialCode?: string;
      solutionCode?: string;
      testCode?: string;
      dependencies?: Record<string, string>;
      isPublic?: boolean;
      embedAllowed?: boolean;
    }> = {};
    
    if (parsed.data.title) updateData.title = parsed.data.title;
    if (parsed.data.description) updateData.description = parsed.data.description;
    if (parsed.data.initialCode) updateData.initialCode = parsed.data.initialCode;
    if (parsed.data.solutionCode) updateData.solutionCode = parsed.data.solutionCode;
    if (parsed.data.testCode) updateData.testCode = parsed.data.testCode;
    if (parsed.data.dependencies) updateData.dependencies = parsed.data.dependencies;
    if (parsed.data.isPublic !== undefined) updateData.isPublic = parsed.data.isPublic;
    if (parsed.data.embedAllowed !== undefined) updateData.embedAllowed = parsed.data.embedAllowed;

    await playgroundService.updatePlayground(playgroundId, updateData);
    return c.json({ message: 'Playground updated' });
  } catch (error) {
    return c.json({ error: 'Failed to update playground' }, 500);
  }
});

// Delete playground
router.delete('/:playgroundId', requireAuth, async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';

  try {
    await playgroundService.deletePlayground(playgroundId);
    return c.json({ message: 'Playground deleted' });
  } catch (error) {
    return c.json({ error: 'Failed to delete playground' }, 500);
  }
});

// Get popular playgrounds
router.get('/discover/popular', async (c) => {
  const { limit = '10' } = c.req.query();

  const playgrounds = await playgroundService.getPopularPlaygrounds(parseInt(limit, 10));

  return c.json({ playgrounds });
});

// Extract playgrounds from markdown
const extractSchema = z.object({
  content: z.string().min(1),
  documentId: z.string(),
});

router.post('/extract/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const body = await c.req.json();

  const parsed = extractSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  const playgrounds = playgroundService.extractPlaygroundsFromMarkdown(
    parsed.data.content,
    repositoryId,
    parsed.data.documentId
  );

  return c.json({
    found: playgrounds.length,
    playgrounds: playgrounds.map((p) => ({
      title: p.title,
      language: p.language,
      framework: p.framework,
      codeLength: p.initialCode.length,
    })),
  });
});

// ============================================================================
// Server-Side Code Execution
// ============================================================================

const executeSchema = z.object({
  code: z.string().min(1).max(100000),
  language: z.enum(['javascript', 'typescript', 'python', 'go', 'rust', 'bash']),
  timeout: z.number().min(1000).max(30000).optional(),
  envVars: z.record(z.string(), z.string()).optional(),
});

/**
 * Execute code in a secure sandbox environment
 */
router.post('/execute', async (c) => {
  const body = await c.req.json();

  const parsed = executeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  const { code, language, timeout, envVars } = parsed.data;

  try {
    const result = await executeInSandbox(code, language as SupportedLanguage, {
      timeout,
      envVars,
      networkAccess: false,
    });

    log.info(
      { language, success: result.success, executionMs: result.executionMs },
      'Code executed in sandbox'
    );

    return c.json({
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      executionMs: result.executionMs,
      timedOut: result.timedOut,
      memoryExceeded: result.memoryExceeded,
    });
  } catch (error) {
    log.error({ error }, 'Sandbox execution failed');
    return c.json({ error: 'Execution failed' }, 500);
  }
});

/**
 * Execute code from a playground session
 */
router.post('/session/token/:sessionToken/execute', async (c) => {
  const { sessionToken } = c.req.param();

  const session = await playgroundService.getSession(sessionToken);
  if (!session) {
    return c.json({ error: 'Session not found or expired' }, 404);
  }

  const playground = await playgroundService.getPlayground(session.playgroundId);
  if (!playground) {
    return c.json({ error: 'Playground not found' }, 404);
  }

  // Map playground language to sandbox language
  const languageMap: Record<string, SupportedLanguage> = {
    javascript: 'javascript',
    typescript: 'typescript',
    python: 'python',
    go: 'go',
    rust: 'rust',
    html: 'bash', // HTML doesn't execute, fall back
  };

  const sandboxLanguage = languageMap[playground.language] || 'javascript';

  try {
    const result = await executeInSandbox(session.code, sandboxLanguage, {
      timeout: 10000,
      envVars: playground.envVariables,
      networkAccess: false,
    });

    // Record the result
    await playgroundService.recordExecutionResult(
      sessionToken,
      result.stdout,
      result.stderr || undefined
    );

    return c.json({
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      executionMs: result.executionMs,
      timedOut: result.timedOut,
    });
  } catch (error) {
    log.error({ error, sessionToken }, 'Session execution failed');
    return c.json({ error: 'Execution failed' }, 500);
  }
});

// ============================================================================
// Test Validation
// ============================================================================

const validateTestSchema = z.object({
  code: z.string().min(1).max(100000),
  testCode: z.string().min(1).max(100000),
  language: z.enum(['javascript', 'typescript', 'python']),
  expectedOutput: z.string().optional(),
});

/**
 * Validate code against test cases
 */
router.post('/validate-tests', async (c) => {
  const body = await c.req.json();

  const parsed = validateTestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  const { code, testCode, language, expectedOutput } = parsed.data;

  // Combine code and test code for validation
  let combinedCode = code;
  if (language === 'javascript' || language === 'typescript') {
    combinedCode = `${code}\n\n// Tests\n${testCode}`;
  } else if (language === 'python') {
    combinedCode = `${code}\n\n# Tests\n${testCode}`;
  }

  try {
    const result = await validateCodeExample(
      combinedCode,
      language as SupportedLanguage,
      expectedOutput
    );

    return c.json({
      passed: result.isValid,
      actualOutput: result.actualOutput,
      expectedOutput: result.expectedOutput,
      error: result.error,
      executionMs: result.executionResult.executionMs,
    });
  } catch (error) {
    log.error({ error }, 'Test validation failed');
    return c.json({ error: 'Validation failed' }, 500);
  }
});

/**
 * Validate playground solution against test code
 */
router.post('/:playgroundId/validate', async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';
  const body = await c.req.json<{ code?: string }>();

  const playground = await playgroundService.getPlayground(playgroundId);
  if (!playground) {
    return c.json({ error: 'Playground not found' }, 404);
  }

  if (!playground.testCode) {
    return c.json({ error: 'Playground has no test code' }, 400);
  }

  const codeToValidate = body.code || playground.initialCode;

  // Map language for sandbox
  const languageMap: Record<string, SupportedLanguage> = {
    javascript: 'javascript',
    typescript: 'typescript',
    python: 'python',
  };

  const sandboxLanguage = languageMap[playground.language];
  if (!sandboxLanguage) {
    return c.json({ error: 'Language not supported for validation' }, 400);
  }

  // Combine code and test code
  let combinedCode = codeToValidate;
  if (playground.language === 'javascript' || playground.language === 'typescript') {
    combinedCode = `${codeToValidate}\n\n// Tests\n${playground.testCode}`;
  } else if (playground.language === 'python') {
    combinedCode = `${codeToValidate}\n\n# Tests\n${playground.testCode}`;
  }

  try {
    const result = await executeInSandbox(combinedCode, sandboxLanguage, {
      timeout: 15000,
      networkAccess: false,
    });

    const passed = result.success && result.exitCode === 0;

    return c.json({
      passed,
      output: result.stdout,
      error: result.stderr || (result.timedOut ? 'Execution timed out' : undefined),
      executionMs: result.executionMs,
      matchesSolution: playground.solutionCode
        ? codeToValidate.trim() === playground.solutionCode.trim()
        : undefined,
    });
  } catch (error) {
    log.error({ error, playgroundId }, 'Playground validation failed');
    return c.json({ error: 'Validation failed' }, 500);
  }
});

// ============================================================================
// AI-Powered Hints and Assistance
// ============================================================================

const hintSchema = z.object({
  code: z.string().min(1).max(100000),
  error: z.string().optional(),
  context: z.string().optional(),
});

/**
 * Get AI-powered hint for a playground exercise
 */
router.post('/:playgroundId/hint', rateLimit('ai'), async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';
  const body = await c.req.json();

  const parsed = hintSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  const playground = await playgroundService.getPlayground(playgroundId);
  if (!playground) {
    return c.json({ error: 'Playground not found' }, 404);
  }

  const { code, error, context } = parsed.data;

  try {
    const llm = createLLMClient();

    const prompt = `You are a helpful coding tutor. Provide hints to help the user solve the exercise without giving away the complete solution.
Be encouraging and guide them toward the correct approach.
Focus on one specific issue at a time.
Keep hints concise (2-3 sentences max).

Exercise: ${playground.title}
${playground.description ? `Description: ${playground.description}` : ''}
Language: ${playground.language}

User's current code:
\`\`\`${playground.language}
${code}
\`\`\`

${error ? `Error encountered:\n${error}` : ''}
${context ? `Additional context: ${context}` : ''}

Provide a helpful hint without giving away the complete solution.`;

    const response = await llm.generate(prompt, { maxTokens: 300 });

    const hint = response.content?.trim() || 'Keep trying! Review the exercise description for clues.';

    return c.json({
      hint,
      playgroundTitle: playground.title,
    });
  } catch (error) {
    log.error({ error, playgroundId }, 'Failed to generate hint');
    return c.json({ error: 'Failed to generate hint' }, 500);
  }
});

/**
 * Get AI-powered code completion suggestion
 */
router.post('/:playgroundId/suggest', rateLimit('ai'), async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';
  const body = await c.req.json<{ code: string; cursorPosition?: number }>();

  if (!body.code) {
    return c.json({ error: 'Code is required' }, 400);
  }

  const playground = await playgroundService.getPlayground(playgroundId);
  if (!playground) {
    return c.json({ error: 'Playground not found' }, 404);
  }

  try {
    const llm = createLLMClient();

    const codeContext = body.cursorPosition !== undefined
      ? body.code.slice(0, body.cursorPosition)
      : body.code;

    const prompt = `You are an intelligent code completion assistant.
Given the exercise context and partial code, suggest a small, helpful completion.
Only suggest the next few tokens or one line, not the entire solution.
Return ONLY the code to insert, no explanations.

Exercise: ${playground.title}
Language: ${playground.language}
${playground.description ? `Description: ${playground.description}` : ''}

Current code (cursor at end):
\`\`\`${playground.language}
${codeContext}
\`\`\`

Suggest a small completion (1 line max):`;

    const response = await llm.generate(prompt, { maxTokens: 100 });

    const suggestion = response.content?.trim() || '';

    return c.json({
      suggestion,
      cursorPosition: body.cursorPosition,
    });
  } catch (error) {
    log.error({ error, playgroundId }, 'Failed to generate suggestion');
    return c.json({ error: 'Failed to generate suggestion' }, 500);
  }
});

/**
 * Explain the error in user's code
 */
router.post('/:playgroundId/explain-error', rateLimit('ai'), async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';
  const body = await c.req.json<{ code: string; error: string }>();

  if (!body.code || !body.error) {
    return c.json({ error: 'Code and error are required' }, 400);
  }

  const playground = await playgroundService.getPlayground(playgroundId);
  if (!playground) {
    return c.json({ error: 'Playground not found' }, 404);
  }

  try {
    const llm = createLLMClient();

    const prompt = `You are a helpful coding tutor explaining errors to beginners.
Explain what the error means in simple terms.
Suggest what might be causing it without giving away the complete solution.
Be encouraging and helpful.
Keep the explanation concise (3-4 sentences).

Language: ${playground.language}
Exercise: ${playground.title}

Code:
\`\`\`${playground.language}
${body.code}
\`\`\`

Error:
${body.error}

Explain this error in simple terms:`;

    const response = await llm.generate(prompt, { maxTokens: 400 });

    const explanation = response.content?.trim() || 'There was an issue with your code. Try reviewing it carefully.';

    return c.json({
      explanation,
      errorSnippet: body.error.slice(0, 200),
    });
  } catch (error) {
    log.error({ error, playgroundId }, 'Failed to explain error');
    return c.json({ error: 'Failed to explain error' }, 500);
  }
});

// ============================================================================
// Analytics for Playgrounds
// ============================================================================

/**
 * Track playground interaction analytics
 */
router.post('/:playgroundId/analytics', async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';
  const body = await c.req.json<{
    event: 'view' | 'run' | 'fork' | 'complete' | 'hint_request';
    sessionToken?: string;
    metadata?: Record<string, unknown>;
  }>();

  if (!body.event) {
    return c.json({ error: 'Event is required' }, 400);
  }

  const playground = await playgroundService.getPlayground(playgroundId);
  if (!playground) {
    return c.json({ error: 'Playground not found' }, 404);
  }

  // In a full implementation, store this in an analytics table
  log.info(
    {
      playgroundId,
      event: body.event,
      sessionToken: body.sessionToken,
      metadata: body.metadata,
    },
    'Playground analytics event'
  );

  return c.json({ success: true });
});

/**
 * Get playground statistics
 */
router.get('/:playgroundId/stats', async (c) => {
  const playgroundId = c.req.param('playgroundId') ?? '';

  const playground = await playgroundService.getPlayground(playgroundId);
  if (!playground) {
    return c.json({ error: 'Playground not found' }, 404);
  }

  return c.json({
    playgroundId,
    title: playground.title,
    runCount: playground.runCount,
    forkCount: playground.forkCount,
    language: playground.language,
    framework: playground.framework,
    createdAt: playground.createdAt,
  });
});

export default router;
