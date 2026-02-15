// ============================================================================
// Types
// ============================================================================

export type EntityKind = 'function' | 'class' | 'interface' | 'type' | 'constant';

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface UndocumentedEntity {
  name: string;
  kind: EntityKind;
  filePath: string;
  line: number;
  isExported: boolean;
  complexity: number;
  usageCount: number;
}

export interface SuggestionPriority {
  entity: UndocumentedEntity;
  score: number;
  severity: SeverityLevel;
  reason: string;
}

export interface BatchReportSummary {
  totalFiles: number;
  totalEntities: number;
  undocumentedCount: number;
  coveragePercent: number;
  bySeverity: Record<SeverityLevel, number>;
  byKind: Partial<Record<EntityKind, number>>;
}

export interface BatchReport {
  suggestions: SuggestionPriority[];
  summary: BatchReportSummary;
  generatedAt: string;
}

export interface ScanOptions {
  filePattern?: string;
  severityFilter?: SeverityLevel;
  includePrivate?: boolean;
}

// ============================================================================
// Export detection patterns
// ============================================================================

const EXPORT_PATTERNS: { kind: EntityKind; pattern: RegExp }[] = [
  { kind: 'function', pattern: /^export\s+(?:async\s+)?function\s+(\w+)/m },
  { kind: 'class', pattern: /^export\s+class\s+(\w+)/m },
  { kind: 'interface', pattern: /^export\s+interface\s+(\w+)/m },
  { kind: 'type', pattern: /^export\s+type\s+(\w+)/m },
  { kind: 'constant', pattern: /^export\s+const\s+(\w+)/m },
];

const DOC_COMMENT_PATTERN = /\/\*\*[\s\S]*?\*\/\s*$/;

// ============================================================================
// Core functions
// ============================================================================

/**
 * Scan file content lines for undocumented exported entities.
 */
export function scanForUndocumented(
  files: { path: string; content: string }[],
  options: ScanOptions = {}
): UndocumentedEntity[] {
  const { filePattern, includePrivate = false } = options;
  const entities: UndocumentedEntity[] = [];

  for (const file of files) {
    if (filePattern && !matchesPattern(file.path, filePattern)) continue;

    const lines = file.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      for (const { kind, pattern } of EXPORT_PATTERNS) {
        const match = line.match(pattern);
        if (!match) continue;

        const name = match[1] ?? '';
        const isExported = line.trimStart().startsWith('export');

        if (!isExported && !includePrivate) continue;

        const precedingBlock = lines.slice(Math.max(0, i - 10), i).join('\n');
        const hasDoc = DOC_COMMENT_PATTERN.test(precedingBlock);

        if (!hasDoc) {
          entities.push({
            name,
            kind,
            filePath: file.path,
            line: i + 1,
            isExported,
            complexity: estimateComplexity(lines, i),
            usageCount: countUsages(files, name),
          });
        }
        break;
      }
    }
  }

  return entities;
}

function matchesPattern(filePath: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(escaped).test(filePath);
}

function estimateComplexity(lines: string[], startLine: number): number {
  let depth = 0;
  let maxDepth = 0;
  let branches = 0;

  for (let i = startLine; i < Math.min(startLine + 50, lines.length); i++) {
    const line = lines[i] ?? '';
    depth += (line.match(/\{/g) ?? []).length;
    depth -= (line.match(/\}/g) ?? []).length;
    maxDepth = Math.max(maxDepth, depth);

    if (/\b(if|else|switch|case|for|while|catch|&&|\|\||\?)\b/.test(line)) {
      branches++;
    }

    if (depth <= 0 && i > startLine) break;
  }

  return Math.min(maxDepth + branches, 20);
}

function countUsages(files: { path: string; content: string }[], name: string): number {
  let count = 0;
  const pattern = new RegExp(`\\b${name}\\b`, 'g');
  for (const file of files) {
    const matches = file.content.match(pattern);
    if (matches) count += matches.length;
  }
  // Subtract the definition itself
  return Math.max(count - 1, 0);
}

// ============================================================================
// Prioritization
// ============================================================================

/**
 * Prioritize undocumented entities by public API status, complexity, and usage.
 */
export function prioritizeSuggestions(entities: UndocumentedEntity[]): SuggestionPriority[] {
  return entities
    .map((entity) => {
      let score = 0;
      const reasons: string[] = [];

      if (entity.isExported) {
        score += 40;
        reasons.push('public API');
      }

      const complexityScore = Math.min(entity.complexity * 3, 30);
      score += complexityScore;
      if (entity.complexity > 5) reasons.push('high complexity');

      const usageScore = Math.min(entity.usageCount * 2, 30);
      score += usageScore;
      if (entity.usageCount > 5) reasons.push('frequently used');

      const severity = scoreSeverity(score);

      return {
        entity,
        score: Math.min(score, 100),
        severity,
        reason: reasons.join(', ') || 'undocumented',
      };
    })
    .sort((a, b) => b.score - a.score);
}

function scoreSeverity(score: number): SeverityLevel {
  if (score >= 70) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

// ============================================================================
// Report generation
// ============================================================================

/**
 * Generate a batch report with summary statistics.
 */
export function generateBatchReport(
  files: { path: string; content: string }[],
  options: ScanOptions = {}
): BatchReport {
  const undocumented = scanForUndocumented(files, options);
  let suggestions = prioritizeSuggestions(undocumented);

  if (options.severityFilter) {
    const severityOrder: SeverityLevel[] = ['critical', 'high', 'medium', 'low'];
    const filterIdx = severityOrder.indexOf(options.severityFilter);
    suggestions = suggestions.filter((s) => severityOrder.indexOf(s.severity) <= filterIdx);
  }

  const totalEntities = countTotalEntities(files);

  const bySeverity: Record<SeverityLevel, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  const byKind: Partial<Record<EntityKind, number>> = {};

  for (const s of suggestions) {
    bySeverity[s.severity]++;
    byKind[s.entity.kind] = (byKind[s.entity.kind] ?? 0) + 1;
  }

  return {
    suggestions,
    summary: {
      totalFiles: files.length,
      totalEntities,
      undocumentedCount: suggestions.length,
      coveragePercent:
        totalEntities > 0
          ? Math.round(((totalEntities - suggestions.length) / totalEntities) * 100)
          : 100,
      bySeverity,
      byKind,
    },
    generatedAt: new Date().toISOString(),
  };
}

function countTotalEntities(files: { path: string; content: string }[]): number {
  let count = 0;
  for (const file of files) {
    for (const { pattern } of EXPORT_PATTERNS) {
      const globalPattern = new RegExp(pattern.source, 'gm');
      const matches = file.content.match(globalPattern);
      if (matches) count += matches.length;
    }
  }
  return count;
}
