// ============================================================================
// Core Linter Types & Engine
// ============================================================================

export interface LintRule {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  category: 'completeness' | 'accuracy' | 'style' | 'links' | 'structure';
  check: (context: LintContext) => LintIssue[];
}

export interface LintContext {
  filePath: string;
  content: string;
  sourceFiles?: SourceFileInfo[];
  config: LintConfig;
}

export interface SourceFileInfo {
  path: string;
  exports: ExportedSymbol[];
}

export interface ExportedSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'enum';
  hasJSDoc: boolean;
  parameters?: string[];
  line: number;
}

export interface LintIssue {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  fix?: { range: [number, number]; text: string };
}

export interface LintConfig {
  rules: Record<string, 'off' | 'warn' | 'error'>;
  includePaths: string[];
  excludePaths: string[];
  customRules?: LintRule[];
}

export interface LintResult {
  filePath: string;
  issues: LintIssue[];
  score: number;
  stats: { errors: number; warnings: number; infos: number };
}

import { builtInRules } from './rules/index.js';

/**
 * Get the effective severity for a rule based on config overrides.
 */
function getEffectiveSeverity(
  rule: LintRule,
  config: LintConfig
): 'error' | 'warning' | 'info' | null {
  const override = config.rules[rule.id];
  if (override === 'off') return null;
  if (override === 'error') return 'error';
  if (override === 'warn') return 'warning';
  return rule.severity;
}

/**
 * Calculate a quality score (0-100) based on issues found.
 */
function calculateScore(issues: LintIssue[], contentLength: number): number {
  if (contentLength === 0) return 0;

  let penalty = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') penalty += 10;
    else if (issue.severity === 'warning') penalty += 5;
    else penalty += 1;
  }

  return Math.max(0, Math.min(100, 100 - penalty));
}

/**
 * Lint a single documentation file.
 */
export function lint(
  filePath: string,
  content: string,
  config: LintConfig,
  sourceFiles?: SourceFileInfo[]
): LintResult {
  const allRules = [...builtInRules, ...(config.customRules ?? [])];
  const context: LintContext = { filePath, content, sourceFiles, config };

  const issues: LintIssue[] = [];

  for (const rule of allRules) {
    const severity = getEffectiveSeverity(rule, config);
    if (!severity) continue;

    const ruleIssues = rule.check(context);
    for (const issue of ruleIssues) {
      issues.push({ ...issue, severity });
    }
  }

  const stats = {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    infos: issues.filter((i) => i.severity === 'info').length,
  };

  return {
    filePath,
    issues,
    score: calculateScore(issues, content.length),
    stats,
  };
}

/**
 * Lint multiple documentation files.
 */
export function lintMultiple(
  files: { filePath: string; content: string }[],
  config: LintConfig,
  sourceFiles?: SourceFileInfo[]
): LintResult[] {
  return files.map((file) => lint(file.filePath, file.content, config, sourceFiles));
}
