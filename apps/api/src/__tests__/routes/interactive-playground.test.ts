import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    playground: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    playgroundSession: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    repository: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@docsynth/utils', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  createLLMClient: vi.fn(() => ({
    generate: vi.fn().mockResolvedValue({ content: 'Hint: Try using a loop' }),
  })),
}));

describe('Interactive Playgrounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Playground Creation', () => {
    it('should validate playground configuration', () => {
      interface PlaygroundConfig {
        language: string;
        framework?: string;
        dependencies: Record<string, string>;
        envVariables: Record<string, string>;
      }

      const supportedLanguages = ['javascript', 'typescript', 'python', 'go', 'rust', 'html'];
      const supportedFrameworks = ['react', 'vue', 'svelte', 'node', 'express', 'fastapi', 'none'];

      const isValidConfig = (config: PlaygroundConfig): boolean => {
        if (!supportedLanguages.includes(config.language)) return false;
        if (config.framework && !supportedFrameworks.includes(config.framework)) return false;
        return true;
      };

      expect(isValidConfig({ language: 'typescript', framework: 'react', dependencies: {}, envVariables: {} })).toBe(true);
      expect(isValidConfig({ language: 'invalid', dependencies: {}, envVariables: {} })).toBe(false);
      expect(isValidConfig({ language: 'python', framework: 'invalid', dependencies: {}, envVariables: {} })).toBe(false);
    });

    it('should generate unique session tokens', () => {
      const generateSessionToken = (): string => {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 15);
        return `pg_${timestamp}_${random}`;
      };

      const token1 = generateSessionToken();
      const token2 = generateSessionToken();

      expect(token1).toMatch(/^pg_[a-z0-9]+_[a-z0-9]+$/);
      expect(token1).not.toBe(token2);
    });
  });

  describe('Code Execution', () => {
    it('should validate code before execution', () => {
      const dangerousPatterns = [
        /require\(['"]child_process['"]\)/,
        /import.*child_process/,
        /process\.exit/,
        /eval\(/,
        /Function\(/,
        /require\(['"]fs['"]\)/,
        /import.*fs/,
      ];

      const isSafeCode = (code: string): boolean => {
        return !dangerousPatterns.some((pattern) => pattern.test(code));
      };

      expect(isSafeCode('console.log("Hello")')).toBe(true);
      expect(isSafeCode('const x = 1 + 2')).toBe(true);
      expect(isSafeCode('require("child_process")')).toBe(false);
      expect(isSafeCode('eval("malicious code")')).toBe(false);
      expect(isSafeCode('import fs from "fs"')).toBe(false);
    });

    it('should enforce execution timeout', async () => {
      const executeWithTimeout = async <T>(
        fn: () => Promise<T>,
        timeoutMs: number
      ): Promise<T> => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('Execution timeout'));
          }, timeoutMs);

          fn()
            .then((result) => {
              clearTimeout(timer);
              resolve(result);
            })
            .catch((error) => {
              clearTimeout(timer);
              reject(error);
            });
        });
      };

      // Test successful execution
      const quickResult = await executeWithTimeout(
        () => Promise.resolve('done'),
        1000
      );
      expect(quickResult).toBe('done');

      // Test timeout
      await expect(
        executeWithTimeout(
          () => new Promise((resolve) => setTimeout(resolve, 100)),
          10
        )
      ).rejects.toThrow('Execution timeout');
    });

    it('should track execution metrics', () => {
      interface ExecutionMetrics {
        startTime: number;
        endTime: number;
        memoryUsed: number;
        exitCode: number;
      }

      const calculateMetrics = (metrics: ExecutionMetrics) => {
        return {
          durationMs: metrics.endTime - metrics.startTime,
          memoryMB: (metrics.memoryUsed / 1024 / 1024).toFixed(2),
          success: metrics.exitCode === 0,
        };
      };

      const metrics: ExecutionMetrics = {
        startTime: 1000,
        endTime: 1250,
        memoryUsed: 52428800, // 50MB
        exitCode: 0,
      };

      const result = calculateMetrics(metrics);
      expect(result.durationMs).toBe(250);
      expect(result.memoryMB).toBe('50.00');
      expect(result.success).toBe(true);
    });
  });

  describe('Test Validation', () => {
    it('should parse test results', () => {
      interface TestResult {
        name: string;
        passed: boolean;
        duration: number;
        error?: string;
      }

      const parseTestOutput = (output: string): TestResult[] => {
        const results: TestResult[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
          if (line.includes('PASS')) {
            const match = line.match(/PASS:\s+(.+?)\s+\((\d+)ms\)/);
            if (match) {
              results.push({ name: match[1]!, passed: true, duration: parseInt(match[2]!) });
            }
          } else if (line.includes('FAIL')) {
            const match = line.match(/FAIL:\s+(.+?)\s+-\s+(.+)/);
            if (match) {
              results.push({ name: match[1]!, passed: false, duration: 0, error: match[2] });
            }
          }
        }

        return results;
      };

      const output = `
PASS: should add two numbers (5ms)
PASS: should handle negative numbers (3ms)
FAIL: should handle division by zero - Expected error to be thrown
      `;

      const results = parseTestOutput(output);
      expect(results).toHaveLength(3);
      expect(results.filter((r) => r.passed)).toHaveLength(2);
      expect(results.find((r) => !r.passed)?.error).toBe('Expected error to be thrown');
    });

    it('should calculate test coverage', () => {
      interface CoverageData {
        totalLines: number;
        coveredLines: number;
        totalBranches: number;
        coveredBranches: number;
      }

      const calculateCoveragePercent = (coverage: CoverageData): number => {
        const linesCoverage = coverage.coveredLines / coverage.totalLines;
        const branchesCoverage = coverage.totalBranches > 0
          ? coverage.coveredBranches / coverage.totalBranches
          : 1;
        return ((linesCoverage + branchesCoverage) / 2) * 100;
      };

      const coverage: CoverageData = {
        totalLines: 100,
        coveredLines: 85,
        totalBranches: 20,
        coveredBranches: 16,
      };

      const percent = calculateCoveragePercent(coverage);
      expect(percent).toBe(82.5); // (85% + 80%) / 2
    });
  });

  describe('AI-Powered Hints', () => {
    it('should generate context-aware hints', () => {
      interface HintContext {
        exerciseTitle: string;
        language: string;
        userCode: string;
        errorMessage?: string;
      }

      const buildHintPrompt = (context: HintContext): string => {
        let prompt = `Help a student with a ${context.language} exercise: ${context.exerciseTitle}\n`;
        prompt += `Their current code:\n\`\`\`${context.language}\n${context.userCode}\n\`\`\`\n`;

        if (context.errorMessage) {
          prompt += `They encountered this error: ${context.errorMessage}\n`;
        }

        prompt += 'Provide a helpful hint without giving away the solution.';
        return prompt;
      };

      const context: HintContext = {
        exerciseTitle: 'FizzBuzz',
        language: 'javascript',
        userCode: 'function fizzBuzz(n) { return n; }',
        errorMessage: 'Expected "Fizz" but got 3',
      };

      const prompt = buildHintPrompt(context);
      expect(prompt).toContain('FizzBuzz');
      expect(prompt).toContain('javascript');
      expect(prompt).toContain('Expected "Fizz"');
      expect(prompt).toContain('without giving away the solution');
    });

    it('should limit hint frequency', () => {
      interface HintTracker {
        userId: string;
        hints: { timestamp: number; playgroundId: string }[];
      }

      const canRequestHint = (
        tracker: HintTracker,
        playgroundId: string,
        windowMs: number = 60000,
        maxHints: number = 5
      ): boolean => {
        const now = Date.now();
        const recentHints = tracker.hints.filter(
          (h) => h.playgroundId === playgroundId && now - h.timestamp < windowMs
        );
        return recentHints.length < maxHints;
      };

      const tracker: HintTracker = {
        userId: 'user-1',
        hints: [
          { timestamp: Date.now() - 10000, playgroundId: 'pg-1' },
          { timestamp: Date.now() - 20000, playgroundId: 'pg-1' },
          { timestamp: Date.now() - 30000, playgroundId: 'pg-1' },
        ],
      };

      expect(canRequestHint(tracker, 'pg-1', 60000, 5)).toBe(true);
      expect(canRequestHint(tracker, 'pg-1', 60000, 3)).toBe(false);
      expect(canRequestHint(tracker, 'pg-2', 60000, 3)).toBe(true);
    });
  });

  describe('Session Management', () => {
    it('should calculate session expiration', () => {
      const getExpirationDate = (durationHours: number = 24): Date => {
        const now = new Date();
        return new Date(now.getTime() + durationHours * 60 * 60 * 1000);
      };

      const expiration = getExpirationDate(24);
      const expectedTime = Date.now() + 24 * 60 * 60 * 1000;

      expect(expiration.getTime()).toBeGreaterThan(Date.now());
      expect(Math.abs(expiration.getTime() - expectedTime)).toBeLessThan(1000);
    });

    it('should track session state', () => {
      interface SessionState {
        code: string;
        lastOutput: string | null;
        lastError: string | null;
        runCount: number;
        lastRunAt: Date | null;
      }

      const updateSessionState = (
        current: SessionState,
        code: string,
        output: string | null,
        error: string | null
      ): SessionState => {
        return {
          code,
          lastOutput: output,
          lastError: error,
          runCount: current.runCount + 1,
          lastRunAt: new Date(),
        };
      };

      const initial: SessionState = {
        code: '',
        lastOutput: null,
        lastError: null,
        runCount: 0,
        lastRunAt: null,
      };

      const updated = updateSessionState(initial, 'console.log("test")', 'test', null);
      expect(updated.code).toBe('console.log("test")');
      expect(updated.lastOutput).toBe('test');
      expect(updated.runCount).toBe(1);
      expect(updated.lastRunAt).toBeInstanceOf(Date);
    });
  });
});
