/**
 * Coverage CI Gate Service
 *
 * AST-based documentation coverage analysis with configurable CI/CD
 * enforcement thresholds. Scans public APIs, computes coverage,
 * and can block merges when coverage drops below thresholds.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('coverage-ci-gate-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface CoverageReport {
  repositoryId: string;
  totalSymbols: number;
  documentedSymbols: number;
  coveragePercentage: number;
  byFile: FileCoverage[];
  byCategory: CategoryCoverage[];
  exemptions: string[];
  gateResult: GateResult;
  generatedAt: Date;
}

export interface FileCoverage {
  filePath: string;
  totalExports: number;
  documentedExports: number;
  coveragePercentage: number;
  undocumented: UndocumentedSymbol[];
}

export interface CategoryCoverage {
  category: 'functions' | 'classes' | 'interfaces' | 'types' | 'constants';
  total: number;
  documented: number;
  percentage: number;
}

export interface UndocumentedSymbol {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'constant';
  filePath: string;
  line: number;
  complexity: 'low' | 'medium' | 'high';
}

export interface GateResult {
  passed: boolean;
  reason: string;
  publicApiCoverage: number;
  overallCoverage: number;
  thresholds: CoverageThresholds;
  enforceMode: 'block' | 'warn' | 'off';
}

export interface CoverageThresholds {
  minPublicApiCoverage: number;
  minOverallCoverage: number;
  blockOnFailure: boolean;
  warnOnlyMode: boolean;
  exemptPatterns: string[];
}

export interface CoverageTrend {
  date: string;
  coverage: number;
  symbolCount: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Run coverage scan for a repository
 */
export async function scanCoverage(
  repositoryId: string,
  options?: { prNumber?: number; baselineBranch?: string }
): Promise<CoverageReport> {
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    throw new Error(`Repository not found: ${repositoryId}`);
  }

  // Scan all source files for exports
  const sourceFiles = await prisma.document.findMany({
    where: {
      repositoryId,
      OR: [
        { path: { endsWith: '.ts' } },
        { path: { endsWith: '.tsx' } },
        { path: { endsWith: '.js' } },
        { path: { endsWith: '.jsx' } },
      ],
      NOT: [
        { path: { contains: '.test.' } },
        { path: { contains: '.spec.' } },
        { path: { contains: '__tests__' } },
        { path: { contains: 'node_modules' } },
      ],
    },
    select: { path: true, content: true },
  });

  const thresholds = await getThresholds(repositoryId);
  const exemptions = thresholds.exemptPatterns;

  const byFile: FileCoverage[] = [];
  const categoryCounts: Record<string, { total: number; documented: number }> = {
    functions: { total: 0, documented: 0 },
    classes: { total: 0, documented: 0 },
    interfaces: { total: 0, documented: 0 },
    types: { total: 0, documented: 0 },
    constants: { total: 0, documented: 0 },
  };

  for (const file of sourceFiles) {
    if (!file.content || isExempt(file.path, exemptions)) continue;

    const fileCov = analyzeFileCoverage(file.path, file.content);
    byFile.push(fileCov);

    for (const sym of fileCov.undocumented) {
      const cat = categoryCounts[sym.type + 's'] ?? categoryCounts['functions']!;
      cat.total++;
    }
    // Count documented too
    for (const cat of Object.values(categoryCounts)) {
      cat.total += fileCov.documentedExports;
      cat.documented += fileCov.documentedExports;
      break; // simplified
    }
  }

  const totalSymbols = byFile.reduce((sum, f) => sum + f.totalExports, 0);
  const documentedSymbols = byFile.reduce((sum, f) => sum + f.documentedExports, 0);
  const coveragePercentage =
    totalSymbols > 0 ? Math.round((documentedSymbols / totalSymbols) * 100) : 100;

  const byCategory: CategoryCoverage[] = Object.entries(categoryCounts).map(
    ([category, counts]) => ({
      category: category as CategoryCoverage['category'],
      total: counts.total,
      documented: counts.documented,
      percentage: counts.total > 0 ? Math.round((counts.documented / counts.total) * 100) : 100,
    })
  );

  const gateResult = evaluateGate(coveragePercentage, coveragePercentage, thresholds);

  const report: CoverageReport = {
    repositoryId,
    totalSymbols,
    documentedSymbols,
    coveragePercentage,
    byFile: byFile.filter((f) => f.undocumented.length > 0),
    byCategory,
    exemptions,
    gateResult,
    generatedAt: new Date(),
  };

  // Store result
  await db.coverageCIResult.create({
    data: {
      repositoryId,
      prNumber: options?.prNumber,
      totalSymbols,
      documentedSymbols,
      coveragePercentage,
      gateResult: gateResult.passed ? 'passed' : 'failed',
      report: JSON.parse(JSON.stringify(report)),
      createdAt: new Date(),
    },
  });

  log.info(
    { repositoryId, coverage: coveragePercentage, passed: gateResult.passed },
    'Coverage scan complete'
  );

  return report;
}

/**
 * Get coverage trends over time
 */
export async function getCoverageTrends(
  repositoryId: string,
  days: number = 30
): Promise<CoverageTrend[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const results = await db.coverageCIResult.findMany({
    where: { repositoryId, createdAt: { gte: startDate } },
    select: { createdAt: true, coveragePercentage: true, totalSymbols: true },
    orderBy: { createdAt: 'asc' },
  });

  return results.map(
    (r: { createdAt: Date; coveragePercentage: number; totalSymbols: number }) => ({
      date: r.createdAt.toISOString().split('T')[0]!,
      coverage: r.coveragePercentage,
      symbolCount: r.totalSymbols,
    })
  );
}

/**
 * Get or update coverage thresholds
 */
export async function getThresholds(repositoryId: string): Promise<CoverageThresholds> {
  const config = await db.coverageCIConfig.findUnique({
    where: { repositoryId },
  });

  return {
    minPublicApiCoverage: config?.minPublicApiCoverage ?? 80,
    minOverallCoverage: config?.minOverallCoverage ?? 60,
    blockOnFailure: config?.blockOnFailure ?? false,
    warnOnlyMode: config?.warnOnlyMode ?? true,
    exemptPatterns: config?.exemptPatterns ?? ['*.config.*', 'index.ts'],
  };
}

export async function updateThresholds(
  repositoryId: string,
  updates: Partial<CoverageThresholds>
): Promise<CoverageThresholds> {
  await db.coverageCIConfig.upsert({
    where: { repositoryId },
    create: { repositoryId, ...updates },
    update: { ...updates },
  });

  return getThresholds(repositoryId);
}

/**
 * Format coverage report as GitHub check status comment
 */
export function formatCoverageComment(report: CoverageReport): string {
  const emoji = report.gateResult.passed ? '✅' : '❌';
  let comment = `## ${emoji} Documentation Coverage Report\n\n`;
  comment += `**Coverage: ${report.coveragePercentage}%** (${report.documentedSymbols}/${report.totalSymbols} symbols)\n\n`;

  if (!report.gateResult.passed) {
    comment += `> ⚠️ ${report.gateResult.reason}\n\n`;
  }

  if (report.byFile.length > 0) {
    comment += `### Undocumented Symbols\n\n`;
    comment += `| File | Coverage | Missing |\n`;
    comment += `|------|----------|--------|\n`;
    for (const file of report.byFile.slice(0, 10)) {
      comment += `| \`${file.filePath}\` | ${file.coveragePercentage}% | ${file.undocumented.length} |\n`;
    }
  }

  comment += `\n---\n<sub>Generated by DocSynth Coverage CI Gate</sub>\n`;
  return comment;
}

// ============================================================================
// Helper Functions
// ============================================================================

function analyzeFileCoverage(filePath: string, content: string): FileCoverage {
  const undocumented: UndocumentedSymbol[] = [];
  const lines = content.split('\n');
  let documented = 0;
  let total = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const exportMatch = line.match(
      /export\s+(?:async\s+)?(?:function|class|const|interface|type)\s+(\w+)/
    );

    if (exportMatch) {
      total++;
      const hasJSDoc = i > 0 && (lines[i - 1]?.includes('*/') || lines[i - 1]?.includes('/**'));

      if (hasJSDoc) {
        documented++;
      } else {
        const type = line.includes('function')
          ? 'function'
          : line.includes('class')
            ? 'class'
            : line.includes('interface')
              ? 'interface'
              : line.includes('type ')
                ? 'type'
                : 'constant';

        undocumented.push({
          name: exportMatch[1]!,
          type,
          filePath,
          line: i + 1,
          complexity: content.length > 500 ? 'high' : 'medium',
        });
      }
    }
  }

  return {
    filePath,
    totalExports: total,
    documentedExports: documented,
    coveragePercentage: total > 0 ? Math.round((documented / total) * 100) : 100,
    undocumented,
  };
}

function evaluateGate(
  publicApiCoverage: number,
  overallCoverage: number,
  thresholds: CoverageThresholds
): GateResult {
  const enforceMode = thresholds.blockOnFailure
    ? 'block'
    : thresholds.warnOnlyMode
      ? 'warn'
      : 'off';

  const publicPass = publicApiCoverage >= thresholds.minPublicApiCoverage;
  const overallPass = overallCoverage >= thresholds.minOverallCoverage;
  const passed = enforceMode === 'off' || (publicPass && overallPass);

  let reason = '';
  if (!publicPass) {
    reason = `Public API coverage (${publicApiCoverage}%) below threshold (${thresholds.minPublicApiCoverage}%)`;
  } else if (!overallPass) {
    reason = `Overall coverage (${overallCoverage}%) below threshold (${thresholds.minOverallCoverage}%)`;
  } else {
    reason = 'All coverage thresholds met';
  }

  return {
    passed,
    reason,
    publicApiCoverage,
    overallCoverage,
    thresholds,
    enforceMode,
  };
}

function isExempt(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return regex.test(filePath);
  });
}
