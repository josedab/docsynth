import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import {
  executeInSandbox,
  validateCodeExample,
  getSandboxService,
  type SupportedLanguage,
} from '../services/sandbox.service.js';

const log = createLogger('playground-routes');

// Type assertion for new Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// Execute code using the sandbox service
async function executeCode(
  code: string,
  language: string,
  timeout: number
): Promise<{ stdout: string; stderr: string; exitCode: number; executionTime: number }> {
  const result = await executeInSandbox(code, language as SupportedLanguage, { timeout });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    executionTime: result.executionMs,
  };
}

export const playgroundRoutes = new Hono();

// Execute code in playground
playgroundRoutes.post('/execute', async (c) => {
  try {
    const body = await c.req.json();
    const { code, language, timeout = 10000, userId, exampleId } = body;

    if (!code || !language) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'code and language are required' },
      }, 400);
    }

    // Validate language support
    const supportedLanguages = ['javascript', 'typescript', 'python', 'go', 'bash'];
    if (!supportedLanguages.includes(language)) {
      return c.json({
        success: false,
        error: { code: 'UNSUPPORTED_LANGUAGE', message: `Language '${language}' is not supported` },
      }, 400);
    }

    // Execute code
    const result = await executeCode(code, language, Math.min(timeout, 30000));

    // Log execution if example ID provided
    if (exampleId) {
      await db.exampleExecution.create({
        data: {
          exampleId,
          userId,
          code,
          output: result.stdout ?? null,
          error: result.stderr ?? null,
          exitCode: result.exitCode,
          executionMs: result.executionTime,
          sandboxId: 'simulated',
        },
      });

      // Increment execution count
      await db.interactiveExample.update({
        where: { id: exampleId },
        data: { executionCount: { increment: 1 } },
      });
    }

    return c.json({
      success: true,
      data: {
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
        executionMs: result.executionTime,
        sandboxId: 'simulated',
      },
    });
  } catch (error) {
    log.error({ error }, 'Playground execution failed');
    return c.json({
      success: false,
      error: { code: 'EXECUTION_FAILED', message: 'Failed to execute code' },
    }, 500);
  }
});

// Validate code example against expected output
playgroundRoutes.post('/validate', async (c) => {
  try {
    const body = await c.req.json();
    const { code, language, expectedOutput, timeout = 10000 } = body;

    if (!code || !language) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'code and language are required' },
      }, 400);
    }

    // Use sandbox validation with comparison
    const validation = await validateCodeExample(
      code,
      language as SupportedLanguage,
      expectedOutput,
      { timeout: Math.min(timeout, 30000) }
    );

    return c.json({
      success: true,
      data: {
        isValid: validation.isValid,
        actualOutput: validation.actualOutput,
        expectedOutput: validation.expectedOutput,
        error: validation.error || null,
        executionMs: validation.executionResult.executionMs,
        timedOut: validation.executionResult.timedOut,
      },
    });
  } catch (error) {
    log.error({ error }, 'Example validation failed');
    return c.json({
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'Failed to validate example' },
    }, 500);
  }
});

// Get supported languages
playgroundRoutes.get('/languages', (c) => {
  const sandbox = getSandboxService();
  return c.json({
    success: true,
    data: {
      languages: sandbox.getSupportedLanguages(),
    },
  });
});

// Kill a running sandbox execution
playgroundRoutes.post('/kill/:sandboxId', async (c) => {
  const { sandboxId } = c.req.param();

  try {
    const sandbox = getSandboxService();
    const killed = await sandbox.kill(sandboxId);

    return c.json({
      success: true,
      data: { killed, sandboxId },
    });
  } catch (error) {
    log.error({ error, sandboxId }, 'Failed to kill sandbox');
    return c.json({
      success: false,
      error: { code: 'KILL_FAILED', message: 'Failed to kill sandbox' },
    }, 500);
  }
});

// Fork an example (create a copy for modification)
playgroundRoutes.post('/examples/:exampleId/fork', async (c) => {
  const { exampleId } = c.req.param();
  const body = await c.req.json<{ userId?: string }>().catch(() => ({ userId: undefined }));

  try {
    const original = await db.interactiveExample.findUnique({
      where: { id: exampleId },
    });

    if (!original) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Example not found' },
      }, 404);
    }

    // Create a forked copy
    const forked = await db.interactiveExample.create({
      data: {
        documentId: original.documentId,
        repositoryId: original.repositoryId,
        title: `${original.title} (Fork)`,
        description: original.description,
        language: original.language,
        code: original.code,
        expectedOutput: original.expectedOutput,
        setupCode: original.setupCode,
        dependencies: original.dependencies,
        sandboxConfig: original.sandboxConfig,
        isRunnable: original.isRunnable,
        sourceLineStart: original.sourceLineStart,
        sourceLineEnd: original.sourceLineEnd,
        validationStatus: 'pending',
      },
    });

    log.info({ originalId: exampleId, forkedId: forked.id, userId: body.userId }, 'Example forked');

    return c.json({ success: true, data: forked }, 201);
  } catch (error) {
    log.error({ error, exampleId }, 'Failed to fork example');
    return c.json({
      success: false,
      error: { code: 'FORK_FAILED', message: 'Failed to fork example' },
    }, 500);
  }
});

// Share an example (generate shareable link)
playgroundRoutes.post('/examples/:exampleId/share', async (c) => {
  const { exampleId } = c.req.param();

  try {
    const example = await db.interactiveExample.findUnique({
      where: { id: exampleId },
    });

    if (!example) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Example not found' },
      }, 404);
    }

    // Generate share URL
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    const shareUrl = `${baseUrl}/playground/shared/${exampleId}`;
    const embedUrl = `${process.env.API_URL || 'http://localhost:3001'}/api/playground/embed/${exampleId}`;

    return c.json({
      success: true,
      data: {
        shareUrl,
        embedUrl,
        embedCode: `<iframe src="${embedUrl}" width="100%" height="400" frameborder="0"></iframe>`,
      },
    });
  } catch (error) {
    log.error({ error, exampleId }, 'Failed to generate share link');
    return c.json({
      success: false,
      error: { code: 'SHARE_FAILED', message: 'Failed to generate share link' },
    }, 500);
  }
});

// Get interactive examples for a document
playgroundRoutes.get('/examples/:documentId', async (c) => {
  const { documentId } = c.req.param();

  try {
    const examples = await db.interactiveExample.findMany({
      where: { documentId },
      orderBy: { sourceLineStart: 'asc' },
    });

    return c.json({ success: true, data: examples });
  } catch (error) {
    log.error({ error, documentId }, 'Failed to fetch examples');
    return c.json({
      success: false,
      error: { code: 'FETCH_FAILED', message: 'Failed to fetch examples' },
    }, 500);
  }
});

// Create/update an interactive example
playgroundRoutes.post('/examples', async (c) => {
  try {
    const body = await c.req.json();
    const {
      documentId,
      repositoryId,
      title,
      description,
      language,
      code,
      expectedOutput,
      setupCode,
      dependencies,
      sourceLineStart,
      sourceLineEnd,
    } = body;

    if (!documentId || !repositoryId || !title || !language || !code) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'documentId, repositoryId, title, language, and code are required' },
      }, 400);
    }

    const example = await db.interactiveExample.create({
      data: {
        documentId,
        repositoryId,
        title,
        description,
        language,
        code,
        expectedOutput,
        setupCode,
        dependencies: dependencies ?? [],
        sandboxConfig: {},
        isRunnable: true,
        sourceLineStart: sourceLineStart ?? 0,
        sourceLineEnd: sourceLineEnd ?? 0,
        validationStatus: 'pending',
      },
    });

    log.info({ exampleId: example.id, documentId }, 'Interactive example created');

    return c.json({ success: true, data: example }, 201);
  } catch (error) {
    log.error({ error }, 'Failed to create example');
    return c.json({
      success: false,
      error: { code: 'CREATE_FAILED', message: 'Failed to create example' },
    }, 500);
  }
});

// Update an interactive example
playgroundRoutes.put('/examples/:exampleId', async (c) => {
  const { exampleId } = c.req.param();

  try {
    const body = await c.req.json();
    const { title, description, code, expectedOutput, setupCode, dependencies, isRunnable } = body;

    const example = await db.interactiveExample.update({
      where: { id: exampleId },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(code && { code }),
        ...(expectedOutput !== undefined && { expectedOutput }),
        ...(setupCode !== undefined && { setupCode }),
        ...(dependencies && { dependencies }),
        ...(isRunnable !== undefined && { isRunnable }),
        validationStatus: 'pending', // Reset validation on update
      },
    });

    return c.json({ success: true, data: example });
  } catch (error) {
    log.error({ error, exampleId }, 'Failed to update example');
    return c.json({
      success: false,
      error: { code: 'UPDATE_FAILED', message: 'Failed to update example' },
    }, 500);
  }
});

// Validate all examples in a document
playgroundRoutes.post('/examples/:documentId/validate-all', async (c) => {
  const { documentId } = c.req.param();

  try {
    const examples = await db.interactiveExample.findMany({
      where: { documentId, isRunnable: true },
    });

    const results = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (examples as any[]).map(async (example) => {
        const result = await executeCode(example.code, example.language, 10000);
        
        const isValid = example.expectedOutput 
          ? result.stdout.trim() === example.expectedOutput.trim()
          : result.exitCode === 0;

        // Update validation status
        await db.interactiveExample.update({
          where: { id: example.id },
          data: {
            validationStatus: isValid ? 'valid' : result.stderr ? 'error' : 'invalid',
            lastValidated: new Date(),
          },
        });

        return {
          id: example.id,
          title: example.title,
          isValid,
          error: result.stderr || null,
        };
      })
    );

    const validCount = results.filter((r) => r.isValid).length;

    return c.json({
      success: true,
      data: {
        total: results.length,
        valid: validCount,
        invalid: results.length - validCount,
        results,
      },
    });
  } catch (error) {
    log.error({ error, documentId }, 'Batch validation failed');
    return c.json({
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'Failed to validate examples' },
    }, 500);
  }
});

// Get embeddable playground HTML/widget
playgroundRoutes.get('/embed/:exampleId', async (c) => {
  const { exampleId } = c.req.param();
  const { theme = 'dark' } = c.req.query();

  try {
    const example = await prisma.interactiveExample.findUnique({
      where: { id: exampleId },
    });

    if (!example) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Example not found' },
      }, 404);
    }

    // Generate embeddable widget HTML
    const html = generatePlaygroundWidget(example, theme);
    
    c.header('Content-Type', 'text/html');
    return c.body(html);
  } catch (error) {
    log.error({ error, exampleId }, 'Failed to generate embed');
    return c.json({
      success: false,
      error: { code: 'EMBED_FAILED', message: 'Failed to generate embed' },
    }, 500);
  }
});

// Get execution history for an example
playgroundRoutes.get('/examples/:exampleId/history', async (c) => {
  const { exampleId } = c.req.param();
  const { limit = '20' } = c.req.query();

  try {
    const executions = await prisma.exampleExecution.findMany({
      where: { exampleId },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
    });

    return c.json({ success: true, data: executions });
  } catch (error) {
    log.error({ error, exampleId }, 'Failed to fetch execution history');
    return c.json({
      success: false,
      error: { code: 'FETCH_FAILED', message: 'Failed to fetch history' },
    }, 500);
  }
});

function generatePlaygroundWidget(
  example: {
    id: string;
    title: string;
    description: string | null;
    language: string;
    code: string;
    expectedOutput: string | null;
  },
  theme: string
): string {
  const bgColor = theme === 'dark' ? '#1e1e1e' : '#ffffff';
  const textColor = theme === 'dark' ? '#d4d4d4' : '#333333';
  const borderColor = theme === 'dark' ? '#3c3c3c' : '#e1e1e1';
  const buttonBg = '#0066cc';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${example.title} - DocSynth Playground</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${bgColor};
      color: ${textColor};
      padding: 16px;
    }
    .playground {
      border: 1px solid ${borderColor};
      border-radius: 8px;
      overflow: hidden;
    }
    .header {
      padding: 12px 16px;
      border-bottom: 1px solid ${borderColor};
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .title { font-weight: 600; }
    .language { 
      font-size: 12px;
      background: ${borderColor};
      padding: 2px 8px;
      border-radius: 4px;
    }
    .editor {
      padding: 16px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
      background: ${theme === 'dark' ? '#252526' : '#f5f5f5'};
    }
    textarea {
      width: 100%;
      min-height: 200px;
      padding: 12px;
      font-family: inherit;
      font-size: inherit;
      background: transparent;
      color: inherit;
      border: none;
      resize: vertical;
      outline: none;
    }
    .actions {
      padding: 12px 16px;
      border-top: 1px solid ${borderColor};
      display: flex;
      gap: 8px;
    }
    button {
      padding: 8px 16px;
      background: ${buttonBg};
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .output {
      padding: 16px;
      border-top: 1px solid ${borderColor};
      background: ${theme === 'dark' ? '#1a1a1a' : '#fafafa'};
      font-family: monospace;
      font-size: 13px;
      white-space: pre-wrap;
      max-height: 200px;
      overflow-y: auto;
    }
    .output.error { color: #f14c4c; }
    .output.success { color: #4ec9b0; }
    .hidden { display: none; }
    .loading { opacity: 0.7; }
  </style>
</head>
<body>
  <div class="playground">
    <div class="header">
      <span class="title">${example.title}</span>
      <span class="language">${example.language}</span>
    </div>
    <div class="editor">
      <textarea id="code">${escapeHtml(example.code)}</textarea>
    </div>
    <div class="actions">
      <button id="run">▶ Run</button>
      <button id="reset">↺ Reset</button>
    </div>
    <div id="output" class="output hidden"></div>
  </div>
  <script>
    const apiUrl = '${process.env.API_URL ?? 'http://localhost:3001'}';
    const originalCode = ${JSON.stringify(example.code)};
    const language = ${JSON.stringify(example.language)};
    
    const codeEl = document.getElementById('code');
    const outputEl = document.getElementById('output');
    const runBtn = document.getElementById('run');
    const resetBtn = document.getElementById('reset');
    
    async function run() {
      runBtn.disabled = true;
      runBtn.textContent = '⏳ Running...';
      outputEl.className = 'output loading';
      outputEl.textContent = 'Executing...';
      
      try {
        const res = await fetch(apiUrl + '/api/playground/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: codeEl.value,
            language,
            exampleId: ${JSON.stringify(example.id)}
          })
        });
        
        const data = await res.json();
        
        if (data.success) {
          outputEl.className = data.data.error ? 'output error' : 'output success';
          outputEl.textContent = data.data.error || data.data.output || '(no output)';
        } else {
          outputEl.className = 'output error';
          outputEl.textContent = data.error?.message || 'Execution failed';
        }
      } catch (e) {
        outputEl.className = 'output error';
        outputEl.textContent = 'Network error: ' + e.message;
      }
      
      runBtn.disabled = false;
      runBtn.textContent = '▶ Run';
    }
    
    runBtn.addEventListener('click', run);
    resetBtn.addEventListener('click', () => {
      codeEl.value = originalCode;
      outputEl.className = 'output hidden';
    });
    
    codeEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        run();
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
