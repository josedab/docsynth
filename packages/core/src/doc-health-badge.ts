import type { DocumentValidationResult } from './doc-testing.js';
import type { DocumentLinkReport } from './link-validator.js';

// ============================================================================
// Types
// ============================================================================

export interface DocHealthInput {
  /** Code block validation results */
  codeValidation?: DocumentValidationResult;
  /** Link validation report */
  linkReport?: DocumentLinkReport;
  /** Days since last documentation update */
  daysSinceUpdate?: number;
  /** Percentage of public API with docs (0-100) */
  coveragePercent?: number;
}

export interface DocHealthScore {
  overall: number;
  breakdown: {
    codeExamples: number;
    linkHealth: number;
    freshness: number;
    coverage: number;
  };
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  color: string;
}

// ============================================================================
// Score Calculation
// ============================================================================

const WEIGHTS = {
  codeExamples: 0.3,
  linkHealth: 0.25,
  freshness: 0.2,
  coverage: 0.25,
};

/**
 * Calculate a doc health score (0–100) from validation inputs.
 */
export function calculateHealthScore(input: DocHealthInput): DocHealthScore {
  const codeExamples = scoreCodeExamples(input.codeValidation);
  const linkHealth = scoreLinkHealth(input.linkReport);
  const freshness = scoreFreshness(input.daysSinceUpdate);
  const coverage = input.coveragePercent ?? 100;

  const overall = Math.round(
    codeExamples * WEIGHTS.codeExamples +
      linkHealth * WEIGHTS.linkHealth +
      freshness * WEIGHTS.freshness +
      coverage * WEIGHTS.coverage
  );

  const grade = gradeFromScore(overall);
  const color = colorFromGrade(grade);

  return {
    overall,
    breakdown: { codeExamples, linkHealth, freshness, coverage },
    grade,
    color,
  };
}

function scoreCodeExamples(result?: DocumentValidationResult): number {
  if (!result || result.codeBlocks === 0) return 100;
  return Math.round((result.validBlocks / result.codeBlocks) * 100);
}

function scoreLinkHealth(report?: DocumentLinkReport): number {
  if (!report || report.total === 0) return 100;
  return Math.round((report.valid / report.total) * 100);
}

function scoreFreshness(daysSinceUpdate?: number): number {
  if (daysSinceUpdate == null) return 100;
  if (daysSinceUpdate <= 30) return 100;
  if (daysSinceUpdate <= 90) return 80;
  if (daysSinceUpdate <= 180) return 60;
  if (daysSinceUpdate <= 365) return 40;
  return 20;
}

function gradeFromScore(score: number): DocHealthScore['grade'] {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function colorFromGrade(grade: DocHealthScore['grade']): string {
  const colors: Record<DocHealthScore['grade'], string> = {
    A: 'brightgreen',
    B: 'green',
    C: 'yellow',
    D: 'orange',
    F: 'red',
  };
  return colors[grade];
}

// ============================================================================
// Badge Generation
// ============================================================================

/**
 * Generate a shields.io compatible badge URL.
 */
export function generateBadgeUrl(score: DocHealthScore): string {
  return `https://img.shields.io/badge/doc%20health-${score.overall}%25-${score.color}`;
}

/**
 * Generate badge as an inline SVG string.
 */
export function generateBadgeSvg(score: DocHealthScore): string {
  const label = 'doc health';
  const value = `${score.overall}%`;
  const fill = svgColor(score.color);
  const labelWidth = 70;
  const valueWidth = 44;
  const totalWidth = labelWidth + valueWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${fill}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelWidth * 5}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${label}</text>
    <text x="${labelWidth * 5}" y="140" transform="scale(.1)">${label}</text>
    <text aria-hidden="true" x="${(labelWidth + valueWidth / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${value}</text>
    <text x="${(labelWidth + valueWidth / 2) * 10}" y="140" transform="scale(.1)">${value}</text>
  </g>
</svg>`;
}

/**
 * Generate a Markdown badge snippet.
 */
export function generateBadgeMarkdown(score: DocHealthScore, linkUrl?: string): string {
  const badgeUrl = generateBadgeUrl(score);
  const img = `![Doc Health](${badgeUrl})`;
  return linkUrl ? `[${img}](${linkUrl})` : img;
}

function svgColor(name: string): string {
  const colors: Record<string, string> = {
    brightgreen: '#4c1',
    green: '#97ca00',
    yellow: '#dfb317',
    orange: '#fe7d37',
    red: '#e05d44',
  };
  return colors[name] ?? '#9f9f9f';
}
