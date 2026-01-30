import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    generatedTest: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    document: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    repository: {
      findUnique: vi.fn(),
    },
    testRun: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@docsynth/utils', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
  generateId: () => 'test-id-123',
}));

describe('Test Runner Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CI Config Generation', () => {
    it('should generate valid GitHub Actions config', async () => {
      const { generateCIConfig } = await import('../../services/test-runner.js');
      
      const config = generateCIConfig('repo-1', 'jest', 'github-actions');

      expect(config).toContain('name:');
      expect(config).toContain('on:');
      expect(config).toContain('jobs:');
    });

    it('should generate valid GitLab CI config', async () => {
      const { generateCIConfig } = await import('../../services/test-runner.js');
      
      const config = generateCIConfig('repo-1', 'jest', 'gitlab-ci');

      expect(config).toContain('stage:');
      expect(config).toContain('script:');
    });

    it('should generate valid CircleCI config', async () => {
      const { generateCIConfig } = await import('../../services/test-runner.js');
      
      const config = generateCIConfig('repo-1', 'jest', 'circleci');

      expect(config).toContain('version:');
      expect(config).toContain('jobs:');
    });

    it('should generate valid Jenkins config', async () => {
      const { generateCIConfig } = await import('../../services/test-runner.js');
      
      const config = generateCIConfig('repo-1', 'jest', 'jenkins');

      expect(config).toContain('pipeline');
      expect(config).toContain('stages');
    });
  });

  describe('Test Framework Detection Logic', () => {
    it('should detect Jest framework from package.json', () => {
      const detectFramework = (pkg: { devDependencies?: Record<string, string>; scripts?: Record<string, string> }) => {
        if (pkg.devDependencies?.jest || pkg.scripts?.test?.includes('jest')) return 'jest';
        if (pkg.devDependencies?.vitest || pkg.scripts?.test?.includes('vitest')) return 'vitest';
        if (pkg.devDependencies?.mocha || pkg.scripts?.test?.includes('mocha')) return 'mocha';
        return null;
      };

      expect(detectFramework({ devDependencies: { jest: '^29.0.0' }, scripts: { test: 'jest' } })).toBe('jest');
    });

    it('should detect Vitest framework', () => {
      const detectFramework = (pkg: { devDependencies?: Record<string, string>; scripts?: Record<string, string> }) => {
        if (pkg.devDependencies?.jest || pkg.scripts?.test?.includes('jest')) return 'jest';
        if (pkg.devDependencies?.vitest || pkg.scripts?.test?.includes('vitest')) return 'vitest';
        if (pkg.devDependencies?.mocha || pkg.scripts?.test?.includes('mocha')) return 'mocha';
        return null;
      };

      expect(detectFramework({ devDependencies: { vitest: '^1.0.0' }, scripts: { test: 'vitest run' } })).toBe('vitest');
    });

    it('should detect Mocha framework', () => {
      const detectFramework = (pkg: { devDependencies?: Record<string, string>; scripts?: Record<string, string> }) => {
        if (pkg.devDependencies?.jest || pkg.scripts?.test?.includes('jest')) return 'jest';
        if (pkg.devDependencies?.vitest || pkg.scripts?.test?.includes('vitest')) return 'vitest';
        if (pkg.devDependencies?.mocha || pkg.scripts?.test?.includes('mocha')) return 'mocha';
        return null;
      };

      expect(detectFramework({ devDependencies: { mocha: '^10.0.0' }, scripts: { test: 'mocha' } })).toBe('mocha');
    });

    it('should return null for unknown framework', () => {
      const detectFramework = (pkg: { devDependencies?: Record<string, string>; scripts?: Record<string, string> }) => {
        if (pkg.devDependencies?.jest || pkg.scripts?.test?.includes('jest')) return 'jest';
        if (pkg.devDependencies?.vitest || pkg.scripts?.test?.includes('vitest')) return 'vitest';
        if (pkg.devDependencies?.mocha || pkg.scripts?.test?.includes('mocha')) return 'mocha';
        return null;
      };

      expect(detectFramework({ devDependencies: {}, scripts: {} })).toBeNull();
    });
  });

  describe('Test Result Parsing Logic', () => {
    it('should parse Jest-style output correctly', () => {
      const parseJestOutput = (output: string) => {
        const testsMatch = output.match(/Tests:\s+(\d+)\s+passed[^,]*,\s+(\d+)\s+total/);
        const timeMatch = output.match(/Time:\s+([\d.]+)s/);
        
        return {
          passed: testsMatch ? parseInt(testsMatch[1] ?? '0', 10) : 0,
          total: testsMatch ? parseInt(testsMatch[2] ?? '0', 10) : 0,
          failed: 0,
          duration: timeMatch ? parseFloat(timeMatch[1] ?? '0') * 1000 : 0,
        };
      };

      const jestOutput = `
Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
Snapshots:   0 total
Time:        1.234s
`;

      const result = parseJestOutput(jestOutput);
      
      expect(result.passed).toBe(2);
      expect(result.total).toBe(2);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should parse Vitest-style output correctly', () => {
      const parseVitestOutput = (output: string) => {
        const testsMatch = output.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/);
        
        return {
          passed: testsMatch ? parseInt(testsMatch[1] ?? '0', 10) : 0,
          total: testsMatch ? parseInt(testsMatch[2] ?? '0', 10) : 0,
        };
      };

      const vitestOutput = `
 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  10:00:00
   Duration  500ms
`;

      const result = parseVitestOutput(vitestOutput);
      
      expect(result.passed).toBe(2);
      expect(result.total).toBe(2);
    });

    it('should handle test failures in output', () => {
      const parseOutput = (output: string) => {
        const testsMatch = output.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
        
        return {
          failed: testsMatch ? parseInt(testsMatch[1] ?? '0', 10) : 0,
          passed: testsMatch ? parseInt(testsMatch[2] ?? '0', 10) : 0,
          total: testsMatch ? parseInt(testsMatch[3] ?? '0', 10) : 0,
        };
      };

      const output = `
Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 passed, 2 total
`;

      const result = parseOutput(output);
      
      expect(result.failed).toBe(1);
      expect(result.passed).toBe(1);
      expect(result.total).toBe(2);
    });
  });
});
