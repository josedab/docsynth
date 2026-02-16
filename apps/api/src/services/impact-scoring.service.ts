/**
 * Impact Scoring Service
 *
 * Enhanced scoring engine that evaluates PR changes by documentation impact,
 * providing a 0-100 score with actionable recommendations.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('impact-scoring-service');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface ChangedFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export type FileChangeCategory =
  | 'new-public-api'
  | 'parameter-interface-change'
  | 'breaking-change'
  | 'config-change'
  | 'dependency-update'
  | 'test-only'
  | 'internal-refactor'
  | 'documentation'
  | 'unknown';

export interface FileClassification {
  filename: string;
  category: FileChangeCategory;
  weight: number;
  reason: string;
}

export interface ScoringResult {
  score: number;
  breakdown: {
    newPublicAPIs: number;
    parameterChanges: number;
    breakingChanges: number;
    configChanges: number;
    dependencyUpdates: number;
    testOnlyChanges: number;
    internalRefactors: number;
  };
  classifications: FileClassification[];
  summary: string;
}

export interface Recommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  action: string;
  reason: string;
  relatedFiles: string[];
}

export interface RecommendationResult {
  recommendations: Recommendation[];
  overallPriority: 'critical' | 'high' | 'medium' | 'low';
}

export interface DocDebtItem {
  repositoryId: string;
  documentPath: string;
  debtType: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  estimatedEffort: string;
  createdAt: Date;
}

export interface DocDebtResult {
  repositoryId: string;
  totalDebt: number;
  items: DocDebtItem[];
  summary: string;
}

export interface TrendDataPoint {
  date: string;
  averageScore: number;
  prCount: number;
}

export interface TrendsResult {
  repositoryId: string;
  period: string;
  dataPoints: TrendDataPoint[];
  trend: 'improving' | 'stable' | 'declining';
}

export interface AutoTriggerConfig {
  repositoryId: string;
  threshold: number;
  enabled: boolean;
  notifyOnTrigger: boolean;
}

export interface WeeklyDigestResult {
  repositoryId: string;
  weekStart: string;
  weekEnd: string;
  totalPRs: number;
  averageScore: number;
  highImpactPRs: number;
  gaps: Array<{ area: string; description: string; severity: string }>;
  summary: string;
}

// ============================================================================
// Scoring Weights
// ============================================================================

const SCORING_WEIGHTS: Record<FileChangeCategory, number> = {
  'new-public-api': 30,
  'parameter-interface-change': 20,
  'breaking-change': 25,
  'config-change': 15,
  'dependency-update': 10,
  'test-only': 0,
  'internal-refactor': 5,
  documentation: 0,
  unknown: 5,
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Score PR changes by documentation impact (0-100)
 */
export async function scoreChanges(files: ChangedFile[]): Promise<ScoringResult> {
  const classifications = files.map((file) => classifyFileChange(file.filename, file.patch));

  const breakdown = {
    newPublicAPIs: 0,
    parameterChanges: 0,
    breakingChanges: 0,
    configChanges: 0,
    dependencyUpdates: 0,
    testOnlyChanges: 0,
    internalRefactors: 0,
  };

  let totalWeight = 0;
  let weightedFileCount = 0;

  for (const classification of classifications) {
    const weight = classification.weight;

    switch (classification.category) {
      case 'new-public-api':
        breakdown.newPublicAPIs += weight;
        break;
      case 'parameter-interface-change':
        breakdown.parameterChanges += weight;
        break;
      case 'breaking-change':
        breakdown.breakingChanges += weight;
        break;
      case 'config-change':
        breakdown.configChanges += weight;
        break;
      case 'dependency-update':
        breakdown.dependencyUpdates += weight;
        break;
      case 'test-only':
        breakdown.testOnlyChanges += weight;
        break;
      case 'internal-refactor':
        breakdown.internalRefactors += weight;
        break;
    }

    if (weight > 0) {
      totalWeight += weight;
      weightedFileCount++;
    }
  }

  // Normalize score to 0-100
  const rawScore = weightedFileCount > 0 ? totalWeight / weightedFileCount : 0;
  const score = Math.min(100, Math.round(rawScore * (Math.min(weightedFileCount, 10) / 3)));

  const summary = generateScoringSummary(score, breakdown, files.length);

  log.info({ score, fileCount: files.length }, 'Scored PR changes');

  return {
    score,
    breakdown,
    classifications,
    summary,
  };
}

/**
 * Classify a file change into a documentation impact category
 */
export function classifyFileChange(filename: string, patch?: string): FileClassification {
  const lowerFilename = filename.toLowerCase();

  // Test-only changes
  if (isTestFile(lowerFilename)) {
    return {
      filename,
      category: 'test-only',
      weight: SCORING_WEIGHTS['test-only'],
      reason: 'Test file changes do not require documentation updates',
    };
  }

  // Documentation changes
  if (isDocFile(lowerFilename)) {
    return {
      filename,
      category: 'documentation',
      weight: SCORING_WEIGHTS['documentation'],
      reason: 'Documentation file change',
    };
  }

  // Dependency updates
  if (isDependencyFile(lowerFilename)) {
    return {
      filename,
      category: 'dependency-update',
      weight: SCORING_WEIGHTS['dependency-update'],
      reason: 'Dependency file changed — may affect setup or compatibility docs',
    };
  }

  // Config changes
  if (isConfigFile(lowerFilename)) {
    return {
      filename,
      category: 'config-change',
      weight: SCORING_WEIGHTS['config-change'],
      reason: 'Configuration file changed — may affect deployment or setup docs',
    };
  }

  // Check patch content for more specific classifications
  if (patch) {
    // Breaking changes
    if (hasBreakingChangeSignals(patch)) {
      return {
        filename,
        category: 'breaking-change',
        weight: SCORING_WEIGHTS['breaking-change'],
        reason:
          'Patch contains breaking change signals (removed exports, renamed functions, changed signatures)',
      };
    }

    // New public API exports
    if (hasNewPublicAPISignals(patch, lowerFilename)) {
      return {
        filename,
        category: 'new-public-api',
        weight: SCORING_WEIGHTS['new-public-api'],
        reason: 'New public API exports detected',
      };
    }

    // Parameter/interface changes
    if (hasParameterOrInterfaceChanges(patch)) {
      return {
        filename,
        category: 'parameter-interface-change',
        weight: SCORING_WEIGHTS['parameter-interface-change'],
        reason: 'Interface or parameter changes detected',
      };
    }
  }

  // Default: internal refactor
  return {
    filename,
    category: 'internal-refactor',
    weight: SCORING_WEIGHTS['internal-refactor'],
    reason: 'Internal code change with minimal documentation impact',
  };
}

/**
 * Get actionable recommendations based on score and file changes
 */
export function getRecommendations(score: number, files: ChangedFile[]): RecommendationResult {
  const recommendations: Recommendation[] = [];
  const classifications = files.map((f) => classifyFileChange(f.filename, f.patch));

  // Critical: breaking changes
  const breakingChanges = classifications.filter((c) => c.category === 'breaking-change');
  if (breakingChanges.length > 0) {
    recommendations.push({
      priority: 'critical',
      action: 'Update migration guide and changelog for breaking changes',
      reason: `${breakingChanges.length} file(s) contain breaking changes that must be documented`,
      relatedFiles: breakingChanges.map((c) => c.filename),
    });
  }

  // High: new public APIs
  const newAPIs = classifications.filter((c) => c.category === 'new-public-api');
  if (newAPIs.length > 0) {
    recommendations.push({
      priority: 'high',
      action: 'Add API documentation for new public exports',
      reason: `${newAPIs.length} file(s) introduce new public APIs that need documentation`,
      relatedFiles: newAPIs.map((c) => c.filename),
    });
  }

  // Medium: parameter/interface changes
  const paramChanges = classifications.filter((c) => c.category === 'parameter-interface-change');
  if (paramChanges.length > 0) {
    recommendations.push({
      priority: 'medium',
      action: 'Review and update interface/parameter documentation',
      reason: `${paramChanges.length} file(s) have parameter or interface changes`,
      relatedFiles: paramChanges.map((c) => c.filename),
    });
  }

  // Medium: config changes
  const configChanges = classifications.filter((c) => c.category === 'config-change');
  if (configChanges.length > 0) {
    recommendations.push({
      priority: 'medium',
      action: 'Update configuration and setup documentation',
      reason: `${configChanges.length} configuration file(s) changed`,
      relatedFiles: configChanges.map((c) => c.filename),
    });
  }

  // Low: dependency updates
  const depUpdates = classifications.filter((c) => c.category === 'dependency-update');
  if (depUpdates.length > 0) {
    recommendations.push({
      priority: 'low',
      action: 'Verify dependency compatibility notes are up to date',
      reason: `${depUpdates.length} dependency file(s) changed`,
      relatedFiles: depUpdates.map((c) => c.filename),
    });
  }

  // Overall score-based recommendation
  if (score >= 70) {
    recommendations.push({
      priority: 'critical',
      action: 'This PR has high documentation impact — documentation updates should block merge',
      reason: `Impact score of ${score}/100 indicates significant documentation needs`,
      relatedFiles: [],
    });
  } else if (score >= 40) {
    recommendations.push({
      priority: 'medium',
      action: 'Review documentation before merging this PR',
      reason: `Impact score of ${score}/100 indicates moderate documentation needs`,
      relatedFiles: [],
    });
  }

  const overallPriority = determineOverallPriority(recommendations);

  return { recommendations, overallPriority };
}

/**
 * Calculate documentation debt backlog for a repository
 */
export async function calculateDocDebt(repositoryId: string): Promise<DocDebtResult> {
  const items: DocDebtItem[] = [];

  // Check for documents that haven't been updated in a long time
  const staleDocThreshold = new Date();
  staleDocThreshold.setDate(staleDocThreshold.getDate() - 90);

  const staleDocs = await prisma.document.findMany({
    where: {
      repositoryId,
      updatedAt: { lt: staleDocThreshold },
    },
    select: {
      path: true,
      title: true,
      updatedAt: true,
    },
  });

  for (const doc of staleDocs) {
    const daysSinceUpdate = Math.floor(
      (Date.now() - new Date(doc.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    items.push({
      repositoryId,
      documentPath: doc.path,
      debtType: 'stale-document',
      severity: daysSinceUpdate > 180 ? 'critical' : daysSinceUpdate > 120 ? 'high' : 'medium',
      description: `"${doc.title}" has not been updated in ${daysSinceUpdate} days`,
      estimatedEffort: daysSinceUpdate > 180 ? '2-4 hours' : '1-2 hours',
      createdAt: doc.updatedAt,
    });
  }

  // Check for high-impact PRs that were merged without doc updates
  const recentAnalyses = await db.docImpactAnalysis.findMany({
    where: {
      repositoryId,
      overallRisk: { in: ['high', 'medium'] },
      approved: false,
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    select: {
      prNumber: true,
      overallRisk: true,
      summary: true,
      createdAt: true,
    },
  });

  for (const analysis of recentAnalyses) {
    items.push({
      repositoryId,
      documentPath: `PR #${analysis.prNumber}`,
      debtType: 'unaddressed-impact',
      severity: analysis.overallRisk === 'high' ? 'high' : 'medium',
      description: `PR #${analysis.prNumber} had ${analysis.overallRisk} doc impact but was not addressed: ${analysis.summary}`,
      estimatedEffort: analysis.overallRisk === 'high' ? '2-3 hours' : '1-2 hours',
      createdAt: analysis.createdAt,
    });
  }

  // Sort by severity
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  items.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

  const summary = generateDebtSummary(items);

  log.info({ repositoryId, debtItems: items.length }, 'Calculated documentation debt');

  return {
    repositoryId,
    totalDebt: items.length,
    items,
    summary,
  };
}

/**
 * Get impact score trends over time for a repository
 */
export async function getScoreTrends(
  repositoryId: string,
  days: number = 30
): Promise<TrendsResult> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const analyses = await db.docImpactAnalysis.findMany({
    where: {
      repositoryId,
      createdAt: { gte: startDate },
    },
    select: {
      createdAt: true,
      overallRisk: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Group by week
  const weeklyData = new Map<string, { scores: number[]; count: number }>();

  for (const analysis of analyses) {
    const date = new Date(analysis.createdAt);
    const weekStart = getWeekStart(date);
    const key = weekStart.toISOString().split('T')[0]!;

    if (!weeklyData.has(key)) {
      weeklyData.set(key, { scores: [], count: 0 });
    }

    const entry = weeklyData.get(key)!;
    entry.scores.push(riskToScore(analysis.overallRisk));
    entry.count++;
  }

  const dataPoints: TrendDataPoint[] = Array.from(weeklyData.entries()).map(([date, data]) => ({
    date,
    averageScore: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
    prCount: data.count,
  }));

  const trend = calculateTrend(dataPoints);

  return {
    repositoryId,
    period: `${days} days`,
    dataPoints,
    trend,
  };
}

/**
 * Get or update auto-trigger configuration
 */
export async function getAutoTriggerConfig(repositoryId: string): Promise<AutoTriggerConfig> {
  const config = await db.docImpactConfig.findUnique({
    where: { repositoryId },
  });

  return {
    repositoryId,
    threshold: config?.autoTriggerThreshold ?? 50,
    enabled: config?.autoTriggerEnabled ?? false,
    notifyOnTrigger: config?.notifyOnAutoTrigger ?? true,
  };
}

/**
 * Update auto-trigger configuration
 */
export async function updateAutoTriggerConfig(
  repositoryId: string,
  config: Partial<AutoTriggerConfig>
): Promise<AutoTriggerConfig> {
  const updated = await db.docImpactConfig.upsert({
    where: { repositoryId },
    create: {
      repositoryId,
      enabled: true,
      confidenceThreshold: 0.5,
      autoComment: true,
      riskThreshold: 'low',
      includePaths: [],
      excludePaths: [],
      autoTriggerThreshold: config.threshold ?? 50,
      autoTriggerEnabled: config.enabled ?? false,
      notifyOnAutoTrigger: config.notifyOnTrigger ?? true,
    },
    update: {
      autoTriggerThreshold: config.threshold,
      autoTriggerEnabled: config.enabled,
      notifyOnAutoTrigger: config.notifyOnTrigger,
    },
  });

  return {
    repositoryId,
    threshold: updated.autoTriggerThreshold ?? 50,
    enabled: updated.autoTriggerEnabled ?? false,
    notifyOnTrigger: updated.notifyOnAutoTrigger ?? true,
  };
}

/**
 * Get weekly digest of documentation gaps
 */
export async function getWeeklyDigest(repositoryId: string): Promise<WeeklyDigestResult> {
  const weekEnd = new Date();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);

  const analyses = await db.docImpactAnalysis.findMany({
    where: {
      repositoryId,
      createdAt: {
        gte: weekStart,
        lte: weekEnd,
      },
    },
    select: {
      prNumber: true,
      overallRisk: true,
      summary: true,
      impactedDocs: true,
      approved: true,
    },
  });

  const totalPRs = analyses.length;
  const riskScores = analyses.map((a: { overallRisk: string }) => riskToScore(a.overallRisk));
  const averageScore =
    totalPRs > 0 ? Math.round(riskScores.reduce((a: number, b: number) => a + b, 0) / totalPRs) : 0;
  const highImpactPRs = analyses.filter(
    (a: { overallRisk: string }) => a.overallRisk === 'high'
  ).length;

  // Identify documentation gaps
  const gaps: Array<{ area: string; description: string; severity: string }> = [];

  const unapprovedHighRisk = analyses.filter(
    (a: { overallRisk: string; approved: boolean }) => a.overallRisk === 'high' && !a.approved
  );
  if (unapprovedHighRisk.length > 0) {
    gaps.push({
      area: 'Unaddressed High-Impact PRs',
      description: `${unapprovedHighRisk.length} high-impact PR(s) merged without documentation updates`,
      severity: 'critical',
    });
  }

  const unapprovedMedium = analyses.filter(
    (a: { overallRisk: string; approved: boolean }) => a.overallRisk === 'medium' && !a.approved
  );
  if (unapprovedMedium.length > 0) {
    gaps.push({
      area: 'Pending Medium-Impact PRs',
      description: `${unapprovedMedium.length} medium-impact PR(s) need documentation review`,
      severity: 'medium',
    });
  }

  if (totalPRs === 0) {
    gaps.push({
      area: 'No Analysis Data',
      description: 'No PRs were analyzed this week — consider enabling auto-analysis',
      severity: 'low',
    });
  }

  const summary = `Weekly digest: ${totalPRs} PR(s) analyzed, ${highImpactPRs} high-impact. Average score: ${averageScore}/100. ${gaps.length} gap(s) identified.`;

  return {
    repositoryId,
    weekStart: weekStart.toISOString().split('T')[0]!,
    weekEnd: weekEnd.toISOString().split('T')[0]!,
    totalPRs,
    averageScore,
    highImpactPRs,
    gaps,
    summary,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function isTestFile(filename: string): boolean {
  return (
    filename.includes('.test.') ||
    filename.includes('.spec.') ||
    filename.includes('__tests__') ||
    filename.includes('__mocks__') ||
    filename.startsWith('test/') ||
    filename.startsWith('tests/')
  );
}

function isDocFile(filename: string): boolean {
  return (
    filename.endsWith('.md') ||
    filename.endsWith('.mdx') ||
    filename.endsWith('.rst') ||
    filename.startsWith('docs/') ||
    filename.includes('/docs/')
  );
}

function isDependencyFile(filename: string): boolean {
  return (
    filename === 'package.json' ||
    filename === 'package-lock.json' ||
    filename === 'yarn.lock' ||
    filename === 'pnpm-lock.yaml' ||
    filename === 'go.mod' ||
    filename === 'go.sum' ||
    filename === 'Cargo.toml' ||
    filename === 'Cargo.lock' ||
    filename === 'requirements.txt' ||
    filename === 'Pipfile' ||
    filename === 'Pipfile.lock' ||
    filename === 'Gemfile' ||
    filename === 'Gemfile.lock'
  );
}

function isConfigFile(filename: string): boolean {
  return (
    filename.endsWith('.config.js') ||
    filename.endsWith('.config.ts') ||
    filename.endsWith('.config.json') ||
    filename.endsWith('.env') ||
    filename.endsWith('.env.example') ||
    filename === 'Dockerfile' ||
    filename.startsWith('Dockerfile.') ||
    filename.endsWith('.yaml') ||
    filename.endsWith('.yml') ||
    filename.endsWith('.toml') ||
    filename === 'Makefile'
  );
}

function hasBreakingChangeSignals(patch: string): boolean {
  const breakingPatterns = [
    /^-\s*export\s+(function|class|const|interface|type)\s/m,
    /^-\s*export\s+default/m,
    /BREAKING[\s_-]?CHANGE/i,
    /^-.*\bpublic\b.*\(.*\)/m,
    /^-\s*(async\s+)?function\s+\w+\s*\([^)]*\)/m,
  ];

  return breakingPatterns.some((pattern) => pattern.test(patch));
}

function hasNewPublicAPISignals(patch: string, filename: string): boolean {
  // Only consider source files (not tests, configs, etc.)
  const isSourceFile =
    filename.endsWith('.ts') ||
    filename.endsWith('.tsx') ||
    filename.endsWith('.js') ||
    filename.endsWith('.jsx');

  if (!isSourceFile) return false;

  const newAPIPatterns = [
    /^\+\s*export\s+(function|class|const|interface|type)\s/m,
    /^\+\s*export\s+default/m,
    /^\+\s*export\s*\{/m,
    /^\+\s*module\.exports/m,
  ];

  return newAPIPatterns.some((pattern) => pattern.test(patch));
}

function hasParameterOrInterfaceChanges(patch: string): boolean {
  const paramPatterns = [
    /^\+\s*interface\s+\w+/m,
    /^[-+]\s*\w+\s*[?:].*;\s*$/m,
    /^[-+].*\(\s*\w+\s*:\s*\w+/m,
    /^[-+]\s*type\s+\w+\s*=/m,
  ];

  return paramPatterns.some((pattern) => pattern.test(patch));
}

function generateScoringSummary(
  score: number,
  breakdown: ScoringResult['breakdown'],
  fileCount: number
): string {
  if (score === 0) {
    return `No documentation impact detected across ${fileCount} changed file(s).`;
  }

  const parts: string[] = [];
  if (breakdown.breakingChanges > 0) parts.push('breaking changes');
  if (breakdown.newPublicAPIs > 0) parts.push('new public APIs');
  if (breakdown.parameterChanges > 0) parts.push('interface changes');
  if (breakdown.configChanges > 0) parts.push('config updates');
  if (breakdown.dependencyUpdates > 0) parts.push('dependency updates');

  const level = score >= 70 ? 'High' : score >= 40 ? 'Moderate' : 'Low';

  return `${level} documentation impact (${score}/100) across ${fileCount} file(s). Key areas: ${parts.join(', ') || 'minor changes'}.`;
}

function generateDebtSummary(items: DocDebtItem[]): string {
  if (items.length === 0) {
    return 'No documentation debt detected. Documentation is up to date.';
  }

  const critical = items.filter((i) => i.severity === 'critical').length;
  const high = items.filter((i) => i.severity === 'high').length;
  const medium = items.filter((i) => i.severity === 'medium').length;

  return `Documentation debt: ${items.length} item(s) — ${critical} critical, ${high} high, ${medium} medium priority.`;
}

function determineOverallPriority(
  recommendations: Recommendation[]
): 'critical' | 'high' | 'medium' | 'low' {
  if (recommendations.some((r) => r.priority === 'critical')) return 'critical';
  if (recommendations.some((r) => r.priority === 'high')) return 'high';
  if (recommendations.some((r) => r.priority === 'medium')) return 'medium';
  return 'low';
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function riskToScore(risk: string): number {
  switch (risk) {
    case 'high':
      return 80;
    case 'medium':
      return 50;
    case 'low':
      return 20;
    default:
      return 0;
  }
}

function calculateTrend(dataPoints: TrendDataPoint[]): 'improving' | 'stable' | 'declining' {
  if (dataPoints.length < 2) return 'stable';

  const recentHalf = dataPoints.slice(Math.floor(dataPoints.length / 2));
  const olderHalf = dataPoints.slice(0, Math.floor(dataPoints.length / 2));

  const recentAvg = recentHalf.reduce((sum, dp) => sum + dp.averageScore, 0) / recentHalf.length;
  const olderAvg = olderHalf.reduce((sum, dp) => sum + dp.averageScore, 0) / olderHalf.length;

  const diff = recentAvg - olderAvg;

  if (diff > 10) return 'declining';
  if (diff < -10) return 'improving';
  return 'stable';
}
