/**
 * Doc Linter Service
 *
 * Wraps the @docsynth/lint package and adds DB persistence and PR integration.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import {
  lint,
  loadConfig,
  builtInRules,
  type LintConfig,
  type LintResult,
  type SourceFileInfo,
} from '@docsynth/lint';

const log = createLogger('doc-linter');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

/**
 * Lint a single piece of content.
 */
export async function lintContent(
  content: string,
  filePath: string,
  configOverride?: Partial<LintConfig>,
  sourceFiles?: SourceFileInfo[]
): Promise<LintResult> {
  const config = loadConfig(configOverride);
  log.info({ filePath }, 'Linting document');
  return lint(filePath, content, config, sourceFiles);
}

/**
 * Lint all documentation files changed in a PR.
 */
export async function lintPullRequest(
  repositoryId: string,
  prNumber: number,
  _installationId: string
): Promise<{ results: LintResult[]; summary: { totalIssues: number; averageScore: number } }> {
  log.info({ repositoryId, prNumber }, 'Linting PR documentation changes');

  // In a real implementation this would fetch changed files from GitHub
  // For now, return an empty result set
  const results: LintResult[] = [];

  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const averageScore =
    results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 100;

  return { results, summary: { totalIssues, averageScore } };
}

/**
 * Get available lint rules.
 */
export function getAvailableRules() {
  return builtInRules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    severity: rule.severity,
    category: rule.category,
  }));
}

/**
 * Get lint config for a repository.
 */
export async function getRepositoryLintConfig(repositoryId: string): Promise<LintConfig> {
  log.info({ repositoryId }, 'Fetching lint config for repository');

  // Try to load from DB; fall back to defaults
  try {
    const repo = await db.repositoryLintConfig?.findUnique({
      where: { repositoryId },
    });
    if (repo?.config) {
      return loadConfig(repo.config as Partial<LintConfig>);
    }
  } catch {
    // Table may not exist yet — use defaults
  }

  return loadConfig();
}

/**
 * Update lint config for a repository.
 */
export async function updateRepositoryLintConfig(
  repositoryId: string,
  config: Partial<LintConfig>
): Promise<LintConfig> {
  log.info({ repositoryId }, 'Updating lint config for repository');

  const merged = loadConfig(config);

  try {
    await db.repositoryLintConfig?.upsert({
      where: { repositoryId },
      update: { config: merged },
      create: { repositoryId, config: merged },
    });
  } catch {
    log.warn({ repositoryId }, 'Could not persist lint config — table may not exist');
  }

  return merged;
}
