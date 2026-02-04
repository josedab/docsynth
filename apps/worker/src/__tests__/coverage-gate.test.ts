import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoverageGateService, type CoverageResult, type ExportInfo } from '../services/coverage-gate.js';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    document: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    coverageGateConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    coverageReport: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'report-1' }),
    },
  },
}));

vi.mock('@docsynth/utils', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  getAnthropicClient: vi.fn().mockReturnValue(null),
}));

vi.mock('@docsynth/github', () => ({
  createInstallationOctokit: vi.fn().mockReturnValue(null),
}));

const createMockCoverageResult = (overrides: Partial<CoverageResult> = {}): CoverageResult => ({
  coveragePercent: 75,
  totalExports: 100,
  documentedExports: 75,
  undocumented: [],
  partiallyDocumented: [],
  fullyDocumented: [],
  byFileType: { ts: { total: 80, documented: 60 }, tsx: { total: 20, documented: 15 } },
  byModule: { src: { total: 100, documented: 75 } },
  ...overrides,
});

const createMockExportInfo = (overrides: Partial<ExportInfo> = {}): ExportInfo => ({
  name: 'myFunction',
  type: 'function',
  filePath: 'src/utils.ts',
  line: 10,
  hasJSDoc: false,
  hasReadme: false,
  ...overrides,
});

describe('CoverageGateService', () => {
  let service: CoverageGateService;

  beforeEach(() => {
    service = new CoverageGateService();
    vi.clearAllMocks();
  });

  describe('extractExports', () => {
    const extractExports = (content: string, filePath: string): ExportInfo[] => {
      return (service as unknown as {
        extractExports: (content: string, filePath: string) => ExportInfo[];
      }).extractExports(content, filePath);
    };

    it('should extract exported functions', () => {
      const content = `
export function myFunction() {
  return true;
}

export async function asyncFunction() {
  return Promise.resolve();
}
`;
      const exports = extractExports(content, 'src/utils.ts');

      expect(exports).toHaveLength(2);
      expect(exports[0]!.name).toBe('myFunction');
      expect(exports[0]!.type).toBe('function');
      expect(exports[1]!.name).toBe('asyncFunction');
      expect(exports[1]!.type).toBe('function');
    });

    it('should extract exported classes', () => {
      const content = `
export class MyService {
  constructor() {}
}

export default class DefaultService {
  constructor() {}
}
`;
      const exports = extractExports(content, 'src/service.ts');

      expect(exports).toHaveLength(2);
      expect(exports[0]!.name).toBe('MyService');
      expect(exports[0]!.type).toBe('class');
      expect(exports[1]!.name).toBe('DefaultService');
      expect(exports[1]!.type).toBe('class');
    });

    it('should extract exported interfaces and types', () => {
      const content = `
export interface User {
  id: string;
  name: string;
}

export type UserRole = 'admin' | 'user';
`;
      const exports = extractExports(content, 'src/types.ts');

      expect(exports).toHaveLength(2);
      expect(exports[0]!.name).toBe('User');
      expect(exports[0]!.type).toBe('interface');
      expect(exports[1]!.name).toBe('UserRole');
      expect(exports[1]!.type).toBe('type');
    });

    it('should extract exported constants and enums', () => {
      const content = `
export const MAX_RETRIES = 3;

export enum Status {
  Active,
  Inactive,
}
`;
      const exports = extractExports(content, 'src/constants.ts');

      expect(exports).toHaveLength(2);
      expect(exports[0]!.name).toBe('MAX_RETRIES');
      expect(exports[0]!.type).toBe('const');
      expect(exports[1]!.name).toBe('Status');
      expect(exports[1]!.type).toBe('enum');
    });

    it('should track line numbers correctly', () => {
      const content = `// Comment
import { something } from 'somewhere';

export function firstFunction() {}

export function secondFunction() {}
`;
      const exports = extractExports(content, 'src/funcs.ts');

      expect(exports[0]!.line).toBe(4);
      expect(exports[1]!.line).toBe(6);
    });
  });

  describe('hasJSDocComment', () => {
    const hasJSDocComment = (lines: string[], lineIndex: number): boolean => {
      return (service as unknown as {
        hasJSDocComment: (lines: string[], lineIndex: number) => boolean;
      }).hasJSDocComment(lines, lineIndex);
    };

    it('should detect JSDoc comments', () => {
      const lines = [
        '/**',
        ' * This is a JSDoc comment',
        ' * @param x - The input',
        ' */',
        'export function myFunc(x: number) {}',
      ];

      expect(hasJSDocComment(lines, 4)).toBe(true);
    });

    it('should return false when no JSDoc present', () => {
      const lines = [
        'export function myFunc(x: number) {}',
      ];

      expect(hasJSDocComment(lines, 0)).toBe(false);
    });

    it('should ignore regular comments', () => {
      const lines = [
        '// This is a regular comment',
        'export function myFunc(x: number) {}',
      ];

      expect(hasJSDocComment(lines, 1)).toBe(false);
    });

    it('should handle multi-line JSDoc', () => {
      const lines = [
        '/**',
        ' * This function does something important.',
        ' *',
        ' * It handles multiple scenarios:',
        ' * - Scenario A',
        ' * - Scenario B',
        ' *',
        ' * @param input - The input data',
        ' * @returns The processed result',
        ' */',
        'export function processData(input: Data) {}',
      ];

      expect(hasJSDocComment(lines, 10)).toBe(true);
    });
  });

  describe('buildCheckRunSummary', () => {
    const buildCheckRunSummary = (
      result: CoverageResult,
      previousPercent: number | null,
      issues: string[]
    ): string => {
      return (service as unknown as {
        buildCheckRunSummary: (result: CoverageResult, previousPercent: number | null, issues: string[]) => string;
      }).buildCheckRunSummary(result, previousPercent, issues);
    };

    it('should build summary with coverage stats', () => {
      const result = createMockCoverageResult();
      const summary = buildCheckRunSummary(result, null, []);

      expect(summary).toContain('## Documentation Coverage Report');
      expect(summary).toContain('**Coverage: 75%**');
      expect(summary).toContain('Total Exports | 100');
      expect(summary).toContain('Documented | 75');
    });

    it('should show coverage change when previous percent available', () => {
      const result = createMockCoverageResult({ coveragePercent: 80 });
      const summary = buildCheckRunSummary(result, 75, []);

      expect(summary).toContain('+5.0% from previous');
      expect(summary).toContain('📈');
    });

    it('should show decrease indicator', () => {
      const result = createMockCoverageResult({ coveragePercent: 70 });
      const summary = buildCheckRunSummary(result, 75, []);

      expect(summary).toContain('-5.0% from previous');
      expect(summary).toContain('📉');
    });

    it('should include issues when present', () => {
      const result = createMockCoverageResult({ coveragePercent: 50 });
      const summary = buildCheckRunSummary(result, null, [
        'Coverage 50% is below minimum threshold 70%',
      ]);

      expect(summary).toContain('### ⚠️ Issues');
      expect(summary).toContain('Coverage 50% is below minimum threshold 70%');
    });

    it('should list undocumented exports', () => {
      const result = createMockCoverageResult({
        undocumented: [
          createMockExportInfo({ name: 'helperFunc', filePath: 'src/helpers.ts', line: 15 }),
          createMockExportInfo({ name: 'utilFunc', filePath: 'src/utils.ts', line: 25 }),
        ],
      });
      const summary = buildCheckRunSummary(result, null, []);

      expect(summary).toContain('### Missing Documentation');
      expect(summary).toContain('`helperFunc`');
      expect(summary).toContain('`utilFunc`');
    });

    it('should include AI suggestions when available', () => {
      const result = createMockCoverageResult({
        undocumented: [
          createMockExportInfo({
            name: 'parseData',
            suggestion: 'Document the data format expected and transformation applied',
          }),
        ],
      });
      const summary = buildCheckRunSummary(result, null, []);

      expect(summary).toContain('💡 Document the data format expected');
    });
  });

  describe('buildCheckRunDetails', () => {
    const buildCheckRunDetails = (result: CoverageResult): string => {
      return (service as unknown as {
        buildCheckRunDetails: (result: CoverageResult) => string;
      }).buildCheckRunDetails(result);
    };

    it('should build details with module breakdown', () => {
      const result = createMockCoverageResult({
        byModule: {
          src: { total: 80, documented: 60 },
          lib: { total: 20, documented: 20 },
        },
      });
      const details = buildCheckRunDetails(result);

      expect(details).toContain('## Coverage by Module');
      expect(details).toContain('| src | 75% | 80 | 60 |');
      expect(details).toContain('| lib | 100% | 20 | 20 |');
    });

    it('should include file type breakdown', () => {
      const result = createMockCoverageResult({
        byFileType: {
          ts: { total: 70, documented: 50 },
          tsx: { total: 30, documented: 25 },
        },
      });
      const details = buildCheckRunDetails(result);

      expect(details).toContain('## Coverage by File Type');
      expect(details).toContain('| .ts | 71% | 70 | 50 |');
      expect(details).toContain('| .tsx | 83% | 30 | 25 |');
    });
  });

  describe('getConfig', () => {
    it('should return default config when none exists', async () => {
      const config = await service.getConfig('repo-1');

      expect(config.enabled).toBe(false);
      expect(config.minCoveragePercent).toBe(70);
      expect(config.failOnDecrease).toBe(true);
      expect(config.maxDecreasePercent).toBe(5);
      expect(config.blockMerge).toBe(false);
    });
  });
});
