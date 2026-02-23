/**
 * Documentation Health Badge & Status Check Service
 *
 * Computes documentation health scores, renders SVG badges,
 * posts GitHub commit status checks, and generates org-wide
 * leaderboards for documentation quality.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId } from '@docsynth/utils';

const log = createLogger('doc-health-badge-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ScoreBreakdown {
  coverage: number;
  freshness: number;
  quality: number;
  completeness: number;
}

export interface HealthScore {
  repositoryId: string;
  score: number;
  grade: Grade;
  breakdown: ScoreBreakdown;
  computedAt: Date;
}

export interface BadgeConfig {
  format: 'svg' | 'json';
  style: 'flat' | 'flat-square' | 'for-the-badge';
  label?: string;
}

export interface StatusCheckResult {
  repositoryId: string;
  prNumber: number;
  status: 'success' | 'failure' | 'pending';
  score: number;
  threshold: number;
  description: string;
}

export interface LeaderboardEntry {
  repositoryId: string;
  name: string;
  score: number;
  grade: Grade;
  rank: number;
  trend: 'up' | 'down' | 'stable';
}

export interface OrgLeaderboard {
  organizationId: string;
  entries: LeaderboardEntry[];
  computedAt: Date;
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Compute a documentation health score (0-100) for a repository.
 */
export async function computeHealthScore(repositoryId: string): Promise<HealthScore> {
  log.info({ repositoryId }, 'Computing health score');

  const [coverage, freshness, quality, completeness] = await Promise.all([
    computeCoverage(repositoryId),
    computeFreshness(repositoryId),
    computeQuality(repositoryId),
    computeCompleteness(repositoryId),
  ]);

  const breakdown: ScoreBreakdown = { coverage, freshness, quality, completeness };
  const score = Math.round(coverage * 0.3 + freshness * 0.2 + quality * 0.3 + completeness * 0.2);
  const grade = computeGrade(score);

  const healthScore: HealthScore = {
    repositoryId,
    score,
    grade,
    breakdown,
    computedAt: new Date(),
  };

  await db.docHealthScore.create({
    data: {
      id: generateId(),
      repositoryId,
      score,
      grade,
      coverage,
      freshness,
      quality,
      completeness,
      computedAt: healthScore.computedAt,
    },
  });

  log.info({ repositoryId, score, grade }, 'Health score computed');
  return healthScore;
}

/**
 * Render an SVG badge for a repository's documentation health.
 */
export async function renderBadge(
  repositoryId: string,
  config?: Partial<BadgeConfig>
): Promise<string> {
  const mergedConfig: BadgeConfig = {
    format: config?.format ?? 'svg',
    style: config?.style ?? 'flat',
    label: config?.label ?? 'docs',
  };

  const latest = await db.docHealthScore.findFirst({
    where: { repositoryId },
    orderBy: { computedAt: 'desc' },
  });

  const score = latest?.score ?? 0;
  const grade = latest?.grade ?? computeGrade(score);

  if (mergedConfig.format === 'json') {
    return JSON.stringify({
      schemaVersion: 1,
      label: mergedConfig.label,
      message: `${grade} (${score})`,
      color: gradeColor(grade),
    });
  }

  return generateSVG(score, grade as Grade, mergedConfig);
}

/**
 * Post a GitHub commit status check for a pull request.
 */
export async function postStatusCheck(
  repositoryId: string,
  prNumber: number,
  installationId: string,
  owner: string,
  repo: string
): Promise<StatusCheckResult> {
  log.info({ repositoryId, prNumber, owner, repo }, 'Posting status check');

  const healthScore = await computeHealthScore(repositoryId);
  const { threshold, enforceMode } = await getThreshold(repositoryId);

  const passed = healthScore.score >= threshold;
  const status: StatusCheckResult['status'] = passed
    ? 'success'
    : enforceMode === 'block'
      ? 'failure'
      : 'pending';
  const description = `Doc health: ${healthScore.grade} (${healthScore.score}/100) — threshold: ${threshold}`;

  const result: StatusCheckResult = {
    repositoryId,
    prNumber,
    status,
    score: healthScore.score,
    threshold,
    description,
  };

  await db.docStatusCheck.create({
    data: {
      id: generateId(),
      repositoryId,
      prNumber,
      installationId,
      owner,
      repo,
      status,
      score: healthScore.score,
      threshold,
      description,
      createdAt: new Date(),
    },
  });

  log.info({ repositoryId, prNumber, status, score: healthScore.score }, 'Status check posted');
  return result;
}

/**
 * Rank all repositories in an organization by doc health.
 */
export async function getOrgLeaderboard(organizationId: string): Promise<OrgLeaderboard> {
  log.info({ organizationId }, 'Computing org leaderboard');

  const repos = await db.repository.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  });

  const entries: LeaderboardEntry[] = [];

  for (const repo of repos) {
    const latest = await db.docHealthScore.findFirst({
      where: { repositoryId: repo.id },
      orderBy: { computedAt: 'desc' },
    });

    const previous = await db.docHealthScore.findFirst({
      where: { repositoryId: repo.id },
      orderBy: { computedAt: 'desc' },
      skip: 1,
    });

    const score = latest?.score ?? 0;
    const prevScore = previous?.score ?? score;
    const trend: LeaderboardEntry['trend'] =
      score > prevScore ? 'up' : score < prevScore ? 'down' : 'stable';

    entries.push({
      repositoryId: repo.id,
      name: repo.name,
      score,
      grade: computeGrade(score),
      rank: 0,
      trend,
    });
  }

  entries.sort((a, b) => b.score - a.score);
  entries.forEach((e, i) => {
    e.rank = i + 1;
  });

  const leaderboard: OrgLeaderboard = { organizationId, entries, computedAt: new Date() };

  await db.docLeaderboard.upsert({
    where: { organizationId },
    create: {
      organizationId,
      entries: JSON.stringify(entries),
      computedAt: leaderboard.computedAt,
    },
    update: { entries: JSON.stringify(entries), computedAt: leaderboard.computedAt },
  });

  log.info({ organizationId, repoCount: entries.length }, 'Leaderboard computed');
  return leaderboard;
}

/**
 * Get score history over time for a repository.
 */
export async function getScoreHistory(
  repositoryId: string,
  days = 30
): Promise<Array<{ date: string; score: number }>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db.docHealthScore.findMany({
    where: { repositoryId, computedAt: { gte: since } },
    orderBy: { computedAt: 'asc' },
    select: { computedAt: true, score: true },
  });

  const byDate = new Map<string, number>();
  for (const row of rows) {
    const date = new Date(row.computedAt).toISOString().split('T')[0];
    byDate.set(date, row.score);
  }

  return Array.from(byDate.entries()).map(([date, score]) => ({ date, score }));
}

/**
 * Get the pass/fail threshold and enforcement mode for a repository.
 */
export async function getThreshold(
  repositoryId: string
): Promise<{ threshold: number; enforceMode: 'block' | 'warn' | 'off' }> {
  const config = await db.docHealthConfig.findFirst({ where: { repositoryId } });

  return {
    threshold: config?.threshold ?? 60,
    enforceMode: config?.enforceMode ?? 'warn',
  };
}

// ============================================================================
// Helpers
// ============================================================================

function computeGrade(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function gradeColor(grade: Grade): string {
  const colors: Record<Grade, string> = {
    A: 'brightgreen',
    B: 'green',
    C: 'yellow',
    D: 'orange',
    F: 'red',
  };
  return colors[grade];
}

function generateSVG(score: number, grade: Grade, config: BadgeConfig): string {
  const label = config.label ?? 'docs';
  const message = `${grade} (${score})`;
  const color = gradeColor(grade);
  const colorHex = svgColorHex(color);
  const labelWidth = label.length * 7 + 10;
  const messageWidth = message.length * 7 + 10;
  const totalWidth = labelWidth + messageWidth;

  if (config.style === 'for-the-badge') {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="28">`,
      `  <rect width="${labelWidth}" height="28" fill="#555"/>`,
      `  <rect x="${labelWidth}" width="${messageWidth}" height="28" fill="${colorHex}"/>`,
      `  <text x="${labelWidth / 2}" y="18" fill="#fff" text-anchor="middle" font-family="Verdana" font-size="11" text-transform="uppercase">${label}</text>`,
      `  <text x="${labelWidth + messageWidth / 2}" y="18" fill="#fff" text-anchor="middle" font-family="Verdana" font-size="11">${message}</text>`,
      `</svg>`,
    ].join('\n');
  }

  const height = config.style === 'flat-square' ? 20 : 20;
  const rx = config.style === 'flat-square' ? 0 : 3;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}">`,
    `  <rect rx="${rx}" width="${totalWidth}" height="${height}" fill="#555"/>`,
    `  <rect rx="${rx}" x="${labelWidth}" width="${messageWidth}" height="${height}" fill="${colorHex}"/>`,
    `  <text x="${labelWidth / 2}" y="14" fill="#fff" text-anchor="middle" font-family="Verdana" font-size="11">${label}</text>`,
    `  <text x="${labelWidth + messageWidth / 2}" y="14" fill="#fff" text-anchor="middle" font-family="Verdana" font-size="11">${message}</text>`,
    `</svg>`,
  ].join('\n');
}

function svgColorHex(color: string): string {
  const map: Record<string, string> = {
    brightgreen: '#4c1',
    green: '#97ca00',
    yellow: '#dfb317',
    orange: '#fe7d37',
    red: '#e05d44',
  };
  return map[color] ?? '#9f9f9f';
}

async function computeCoverage(repositoryId: string): Promise<number> {
  const totalSymbols = await db.codeSymbol.count({ where: { repositoryId } });
  if (totalSymbols === 0) return 100;

  const documented = await db.codeSymbol.count({ where: { repositoryId, documented: true } });
  return Math.round((documented / totalSymbols) * 100);
}

async function computeFreshness(repositoryId: string): Promise<number> {
  const docs = await db.document.findMany({
    where: { repositoryId },
    select: { updatedAt: true },
  });

  if (docs.length === 0) return 100;

  const now = Date.now();
  const maxAge = 180 * 24 * 60 * 60 * 1000; // 180 days
  let totalFreshness = 0;

  for (const doc of docs) {
    const age = now - new Date(doc.updatedAt).getTime();
    totalFreshness += Math.max(0, 1 - age / maxAge);
  }

  return Math.round((totalFreshness / docs.length) * 100);
}

async function computeQuality(repositoryId: string): Promise<number> {
  const results = await db.docBenchmarkResult.findMany({
    where: { repositoryId },
    select: { overallScore: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  if (results.length === 0) return 50;

  const avg =
    results.reduce((sum: number, r: any) => sum + (r.overallScore ?? 0), 0) / results.length;
  return Math.round(avg * 100);
}

async function computeCompleteness(repositoryId: string): Promise<number> {
  const docs = await db.document.findMany({
    where: { repositoryId },
    select: { content: true },
  });

  if (docs.length === 0) return 0;

  let totalScore = 0;
  for (const doc of docs) {
    const content = doc.content ?? '';
    let score = 0;
    if (content.match(/^#\s/m)) score += 25; // has title
    if (content.length > 200) score += 25; // has substantial content
    if (content.match(/```/)) score += 25; // has code examples
    if (content.match(/^##\s/m)) score += 25; // has sections
    totalScore += score;
  }

  return Math.round(totalScore / docs.length);
}
