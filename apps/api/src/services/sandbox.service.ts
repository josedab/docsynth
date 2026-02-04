/**
 * Sandbox Execution Service
 *
 * Provides secure code execution in isolated environments.
 * Supports multiple runtimes: Node.js (TypeScript/JavaScript), Python, Go, Bash.
 *
 * In production, this would use Docker containers or WebContainers.
 * This implementation uses child_process with strict timeouts and resource limits.
 */

import { spawn, type ChildProcess } from 'child_process';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';
import { createLogger } from '@docsynth/utils';

const log = createLogger('sandbox-service');

// Sandbox configuration
const SANDBOX_BASE_DIR = process.env.SANDBOX_DIR || '/tmp/docsynth-sandbox';
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 30000;
const MAX_OUTPUT_SIZE = 1024 * 100; // 100KB

export type SupportedLanguage = 'javascript' | 'typescript' | 'python' | 'go' | 'bash' | 'rust';

export interface SandboxConfig {
  timeout?: number;
  memoryLimit?: number;
  networkAccess?: boolean;
  envVars?: Record<string, string>;
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionMs: number;
  sandboxId: string;
  timedOut: boolean;
  memoryExceeded: boolean;
}

interface RuntimeConfig {
  command: string;
  args: string[];
  fileExtension: string;
  setupCode?: string;
  wrapperTemplate?: (code: string) => string;
}

const RUNTIME_CONFIGS: Record<SupportedLanguage, RuntimeConfig> = {
  javascript: {
    command: 'node',
    args: ['--no-warnings'],
    fileExtension: '.js',
  },
  typescript: {
    command: 'npx',
    args: ['tsx'],
    fileExtension: '.ts',
  },
  python: {
    command: 'python3',
    args: ['-u'], // Unbuffered output
    fileExtension: '.py',
  },
  go: {
    command: 'go',
    args: ['run'],
    fileExtension: '.go',
    wrapperTemplate: (code: string) => {
      // Ensure package main and main function exist
      if (!code.includes('package main')) {
        return `package main\n\nimport "fmt"\n\nfunc main() {\n${code}\n_ = fmt.Sprint // suppress unused import\n}`;
      }
      return code;
    },
  },
  bash: {
    command: 'bash',
    args: [],
    fileExtension: '.sh',
  },
  rust: {
    command: 'cargo',
    args: ['script'],
    fileExtension: '.rs',
    wrapperTemplate: (code: string) => {
      if (!code.includes('fn main')) {
        return `fn main() {\n${code}\n}`;
      }
      return code;
    },
  },
};

export class SandboxService {
  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor() {
    this.ensureSandboxDir();
  }

  private async ensureSandboxDir(): Promise<void> {
    try {
      await mkdir(SANDBOX_BASE_DIR, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  async execute(
    code: string,
    language: SupportedLanguage,
    config: SandboxConfig = {}
  ): Promise<ExecutionResult> {
    const sandboxId = randomUUID();
    const startTime = Date.now();
    const timeout = Math.min(config.timeout || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

    const runtimeConfig = RUNTIME_CONFIGS[language];
    if (!runtimeConfig) {
      return {
        success: false,
        stdout: '',
        stderr: `Unsupported language: ${language}`,
        exitCode: 1,
        executionMs: Date.now() - startTime,
        sandboxId,
        timedOut: false,
        memoryExceeded: false,
      };
    }

    // Apply wrapper template if defined
    const processedCode = runtimeConfig.wrapperTemplate
      ? runtimeConfig.wrapperTemplate(code)
      : code;

    // Create temporary file
    const sandboxDir = path.join(SANDBOX_BASE_DIR, sandboxId);
    await mkdir(sandboxDir, { recursive: true });
    const filePath = path.join(sandboxDir, `code${runtimeConfig.fileExtension}`);

    try {
      await writeFile(filePath, processedCode, 'utf-8');

      const result = await this.runProcess(
        runtimeConfig.command,
        [...runtimeConfig.args, filePath],
        {
          timeout,
          cwd: sandboxDir,
          env: {
            ...process.env,
            ...config.envVars,
            NODE_ENV: 'sandbox',
            // Disable network access if specified
            ...(config.networkAccess === false && { NO_PROXY: '*', HTTP_PROXY: 'http://invalid', HTTPS_PROXY: 'http://invalid' }),
          },
        },
        sandboxId
      );

      return {
        ...result,
        sandboxId,
        executionMs: Date.now() - startTime,
      };
    } catch (error) {
      log.error({ error, sandboxId }, 'Sandbox execution failed');
      return {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Unknown error',
        exitCode: 1,
        executionMs: Date.now() - startTime,
        sandboxId,
        timedOut: false,
        memoryExceeded: false,
      };
    } finally {
      // Cleanup
      await this.cleanup(sandboxDir);
    }
  }

  private async runProcess(
    command: string,
    args: string[],
    options: { timeout: number; cwd: string; env: NodeJS.ProcessEnv },
    sandboxId: string
  ): Promise<Omit<ExecutionResult, 'sandboxId' | 'executionMs'>> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let memoryExceeded = false;

      const proc = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.activeProcesses.set(sandboxId, proc);

      // Set timeout
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, options.timeout);

      proc.stdout?.on('data', (data: Buffer) => {
        if (stdout.length < MAX_OUTPUT_SIZE) {
          stdout += data.toString();
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        if (stderr.length < MAX_OUTPUT_SIZE) {
          stderr += data.toString();
          // Check for memory errors
          if (data.toString().includes('out of memory') || data.toString().includes('MemoryError')) {
            memoryExceeded = true;
          }
        }
      });

      proc.on('close', (exitCode) => {
        clearTimeout(timeoutHandle);
        this.activeProcesses.delete(sandboxId);

        resolve({
          success: exitCode === 0 && !timedOut && !memoryExceeded,
          stdout: stdout.slice(0, MAX_OUTPUT_SIZE),
          stderr: stderr.slice(0, MAX_OUTPUT_SIZE),
          exitCode: exitCode ?? 1,
          timedOut,
          memoryExceeded,
        });
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutHandle);
        this.activeProcesses.delete(sandboxId);

        resolve({
          success: false,
          stdout: '',
          stderr: error.message,
          exitCode: 1,
          timedOut: false,
          memoryExceeded: false,
        });
      });
    });
  }

  async kill(sandboxId: string): Promise<boolean> {
    const proc = this.activeProcesses.get(sandboxId);
    if (proc) {
      proc.kill('SIGKILL');
      this.activeProcesses.delete(sandboxId);
      return true;
    }
    return false;
  }

  private async cleanup(sandboxDir: string): Promise<void> {
    try {
      // Remove files in directory
      const { readdir } = await import('fs/promises');
      const files = await readdir(sandboxDir);
      await Promise.all(files.map((f) => unlink(path.join(sandboxDir, f)).catch(() => {})));
      // Remove directory
      const { rmdir } = await import('fs/promises');
      await rmdir(sandboxDir).catch(() => {});
    } catch {
      // Cleanup errors are non-fatal
    }
  }

  getSupportedLanguages(): SupportedLanguage[] {
    return Object.keys(RUNTIME_CONFIGS) as SupportedLanguage[];
  }
}

// Singleton instance
let sandboxServiceInstance: SandboxService | null = null;

export function getSandboxService(): SandboxService {
  if (!sandboxServiceInstance) {
    sandboxServiceInstance = new SandboxService();
  }
  return sandboxServiceInstance;
}

/**
 * Execute code in sandbox (convenience function)
 */
export async function executeInSandbox(
  code: string,
  language: SupportedLanguage,
  config?: SandboxConfig
): Promise<ExecutionResult> {
  return getSandboxService().execute(code, language, config);
}

/**
 * Validate that code executes successfully and optionally matches expected output
 */
export async function validateCodeExample(
  code: string,
  language: SupportedLanguage,
  expectedOutput?: string,
  config?: SandboxConfig
): Promise<{
  isValid: boolean;
  actualOutput: string;
  expectedOutput?: string;
  error?: string;
  executionResult: ExecutionResult;
}> {
  const result = await executeInSandbox(code, language, config);

  let isValid = result.success;

  if (isValid && expectedOutput) {
    // Compare outputs (trimmed)
    const actualTrimmed = result.stdout.trim();
    const expectedTrimmed = expectedOutput.trim();
    isValid = actualTrimmed === expectedTrimmed;
  }

  return {
    isValid,
    actualOutput: result.stdout,
    expectedOutput,
    error: result.stderr || (result.timedOut ? 'Execution timed out' : undefined),
    executionResult: result,
  };
}
