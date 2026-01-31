import { createLogger } from '@docsynth/utils';
import type { ExecuteExampleResponse, SandboxConfig } from '@docsynth/types';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const log = createLogger('sandbox-executor');

const EXECUTION_TIMEOUT = 30000; // 30 seconds default
const MAX_OUTPUT_LENGTH = 50000; // 50KB max output

interface ExecutionResult {
  output: string;
  error?: string;
  exitCode: number;
  executionMs: number;
}

class SandboxExecutorService {
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'docsynth-sandbox');
  }

  /**
   * Execute code in a sandboxed environment
   */
  async execute(
    code: string,
    language: string,
    config: SandboxConfig
  ): Promise<ExecuteExampleResponse> {
    const sandboxId = crypto.randomUUID();
    const workDir = path.join(this.tempDir, sandboxId);
    const startTime = Date.now();

    try {
      // Create sandbox directory
      await fs.mkdir(workDir, { recursive: true });

      // Write code to file
      const { command, args } = await this.prepareExecution(
        code,
        language,
        workDir,
        config
      );

      // Execute in sandbox
      const result = await this.runInSandbox(
        command,
        args,
        workDir,
        config.timeout || EXECUTION_TIMEOUT
      );

      const executionMs = Date.now() - startTime;

      return {
        success: result.exitCode === 0,
        output: result.output,
        error: result.error,
        exitCode: result.exitCode,
        executionMs,
        sandboxId,
      };
    } catch (error) {
      const executionMs = Date.now() - startTime;
      log.error({ error, sandboxId }, 'Sandbox execution failed');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Execution failed',
        exitCode: 1,
        executionMs,
        sandboxId,
      };
    } finally {
      // Cleanup sandbox directory
      await this.cleanup(workDir);
    }
  }

  /**
   * Prepare code for execution
   */
  private async prepareExecution(
    code: string,
    language: string,
    workDir: string,
    _config: SandboxConfig
  ): Promise<{ filePath: string; command: string; args: string[] }> {
    switch (language) {
      case 'javascript': {
        const filePath = path.join(workDir, 'script.js');
        await fs.writeFile(filePath, code);
        return { filePath, command: 'node', args: [filePath] };
      }

      case 'typescript': {
        // For TypeScript, we'll use ts-node or transpile first
        const filePath = path.join(workDir, 'script.ts');
        await fs.writeFile(filePath, code);

        // Write a simple tsconfig
        await fs.writeFile(
          path.join(workDir, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              target: 'ES2022',
              module: 'commonjs',
              strict: false,
              esModuleInterop: true,
            },
          })
        );

        // Use npx ts-node for execution
        return { filePath, command: 'npx', args: ['ts-node', filePath] };
      }

      case 'python': {
        const filePath = path.join(workDir, 'script.py');
        await fs.writeFile(filePath, code);
        return { filePath, command: 'python3', args: [filePath] };
      }

      case 'go': {
        const filePath = path.join(workDir, 'main.go');
        // Wrap code in main package if needed
        const wrappedCode = this.wrapGoCode(code);
        await fs.writeFile(filePath, wrappedCode);
        return { filePath, command: 'go', args: ['run', filePath] };
      }

      case 'bash': {
        const filePath = path.join(workDir, 'script.sh');
        await fs.writeFile(filePath, code, { mode: 0o755 });
        return { filePath, command: 'bash', args: [filePath] };
      }

      default:
        throw new Error(`Unsupported language: ${language}`);
    }
  }

  /**
   * Wrap Go code in main package if needed
   */
  private wrapGoCode(code: string): string {
    if (code.includes('package main')) {
      return code;
    }

    // Check if it has a main function
    if (code.includes('func main()')) {
      return `package main\n\n${code}`;
    }

    // Wrap in main function
    return `package main

import "fmt"

func main() {
${code.split('\n').map((line) => `\t${line}`).join('\n')}
}`;
  }

  /**
   * Run command in sandboxed environment
   */
  private runInSandbox(
    command: string,
    args: string[],
    workDir: string,
    timeout: number
  ): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let killed = false;

      // Spawn process with restricted environment
      const proc = spawn(command, args, {
        cwd: workDir,
        timeout,
        env: {
          ...this.getSafeEnv(),
          HOME: workDir,
          TMPDIR: workDir,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Set timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGKILL');
      }, timeout);

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > MAX_OUTPUT_LENGTH) {
          stdout = stdout.substring(0, MAX_OUTPUT_LENGTH) + '\n... (output truncated)';
          proc.kill('SIGKILL');
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > MAX_OUTPUT_LENGTH) {
          stderr = stderr.substring(0, MAX_OUTPUT_LENGTH) + '\n... (error output truncated)';
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        const executionMs = Date.now() - startTime;

        if (killed) {
          resolve({
            output: stdout,
            error: 'Execution timed out',
            exitCode: 124, // Standard timeout exit code
            executionMs,
          });
        } else {
          resolve({
            output: stdout,
            error: stderr || undefined,
            exitCode: code ?? 1,
            executionMs,
          });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        const executionMs = Date.now() - startTime;
        resolve({
          output: stdout,
          error: err.message,
          exitCode: 1,
          executionMs,
        });
      });
    });
  }

  /**
   * Get safe environment variables for sandbox
   */
  private getSafeEnv(): Record<string, string> {
    return {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      NODE_ENV: 'production',
      PYTHONDONTWRITEBYTECODE: '1',
    };
  }

  /**
   * Cleanup sandbox directory
   */
  private async cleanup(workDir: string): Promise<void> {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch (error) {
      log.warn({ error, workDir }, 'Failed to cleanup sandbox directory');
    }
  }

  /**
   * Validate example by running and comparing output
   */
  async validateExample(
    code: string,
    language: string,
    expectedOutput: string | undefined,
    config: SandboxConfig
  ): Promise<{
    isValid: boolean;
    actualOutput?: string;
    error?: string;
  }> {
    const result = await this.execute(code, language, config);

    if (!result.success) {
      return {
        isValid: false,
        actualOutput: result.output,
        error: result.error,
      };
    }

    // If no expected output, just check it runs without error
    if (!expectedOutput) {
      return {
        isValid: true,
        actualOutput: result.output || '',
      };
    }

    // Compare output (normalize whitespace)
    const normalizedActual = (result.output || '').trim().replace(/\s+/g, ' ');
    const normalizedExpected = expectedOutput.trim().replace(/\s+/g, ' ');

    const isValid = normalizedActual.includes(normalizedExpected) ||
      normalizedExpected.includes(normalizedActual);

    return {
      isValid,
      actualOutput: result.output || '',
      error: isValid ? undefined : `Output mismatch. Expected: "${expectedOutput}", Got: "${(result.output || '').trim()}"`,
    };
  }
}

export const sandboxExecutorService = new SandboxExecutorService();

// Re-export types and create aliases for test compatibility
export { SandboxConfig };
export const sandboxExecutor = sandboxExecutorService;
