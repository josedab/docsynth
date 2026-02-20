/**
 * Docs-as-Infrastructure (GitOps) Service
 *
 * Manages declarative .docsynth.yml configuration files with plan/apply semantics.
 * Scans repositories, compares desired state vs actual docs, and applies changes.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('docs-gitops-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface DocStructureEntry {
  path: string;
  type: 'guide' | 'reference' | 'tutorial' | 'changelog' | 'api';
  template?: string;
  autoGenerate: boolean;
  freshnessMaxDays: number;
}

export interface GitOpsConfig {
  repositoryId: string;
  structure: DocStructureEntry[];
  coverageTargets: { minPercent: number; scope: 'all' | 'public-api' | 'exported' };
  generationRules: { model?: string; tone?: string; maxLength?: number };
  outputTargets: Array<{ format: 'markdown' | 'html' | 'pdf'; outputDir: string }>;
}

export interface PlanAction {
  type: 'generate' | 'update' | 'archive' | 'skip';
  documentPath: string;
  reason: string;
  estimatedImpact: 'high' | 'medium' | 'low';
}

export interface PlanResult {
  repositoryId: string;
  actions: PlanAction[];
  summary: string;
}

export interface ApplyActionResult {
  path: string;
  action: 'generate' | 'update' | 'archive' | 'skip';
  status: 'success' | 'skipped' | 'failed';
  details?: string;
}

export interface ApplyResult {
  repositoryId: string;
  applied: number;
  skipped: number;
  failed: number;
  results: ApplyActionResult[];
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Parse and validate a YAML configuration string into a GitOpsConfig.
 */
export async function parseConfig(
  repositoryId: string,
  configContent: string
): Promise<GitOpsConfig> {
  log.info({ repositoryId }, 'Parsing .docsynth.yml config');

  const lines = configContent.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  const structure: DocStructureEntry[] = [];
  let currentEntry: Partial<DocStructureEntry> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('- path:')) {
      if (currentEntry?.path) {
        structure.push({
          path: currentEntry.path,
          type: currentEntry.type ?? 'guide',
          template: currentEntry.template,
          autoGenerate: currentEntry.autoGenerate ?? false,
          freshnessMaxDays: currentEntry.freshnessMaxDays ?? 90,
        });
      }
      currentEntry = { path: trimmed.replace('- path:', '').trim() };
    } else if (currentEntry && trimmed.startsWith('type:')) {
      currentEntry.type = trimmed.replace('type:', '').trim() as DocStructureEntry['type'];
    } else if (currentEntry && trimmed.startsWith('autoGenerate:')) {
      currentEntry.autoGenerate = trimmed.replace('autoGenerate:', '').trim() === 'true';
    } else if (currentEntry && trimmed.startsWith('freshnessMaxDays:')) {
      currentEntry.freshnessMaxDays = parseInt(trimmed.replace('freshnessMaxDays:', '').trim(), 10);
    } else if (currentEntry && trimmed.startsWith('template:')) {
      currentEntry.template = trimmed.replace('template:', '').trim();
    }
  }

  if (currentEntry?.path) {
    structure.push({
      path: currentEntry.path,
      type: currentEntry.type ?? 'guide',
      template: currentEntry.template,
      autoGenerate: currentEntry.autoGenerate ?? false,
      freshnessMaxDays: currentEntry.freshnessMaxDays ?? 90,
    });
  }

  if (structure.length === 0) {
    log.warn({ repositoryId }, 'Config parsed with no structure entries, using defaults');
    return buildDefaultConfig(repositoryId);
  }

  const config: GitOpsConfig = {
    repositoryId,
    structure,
    coverageTargets: { minPercent: 60, scope: 'public-api' },
    generationRules: { tone: 'professional', maxLength: 5000 },
    outputTargets: [{ format: 'markdown', outputDir: 'docs/' }],
  };

  await db.gitopsConfig.upsert({
    where: { repositoryId },
    create: { repositoryId, config: JSON.parse(JSON.stringify(config)), createdAt: new Date() },
    update: { config: JSON.parse(JSON.stringify(config)), updatedAt: new Date() },
  });

  log.info({ repositoryId, entries: structure.length }, 'Config parsed and stored');
  return config;
}

/**
 * Scan repo, compare desired state (config) vs actual state (docs), output a plan of actions.
 */
export async function planDocChanges(repositoryId: string): Promise<PlanResult> {
  log.info({ repositoryId }, 'Planning doc changes');

  const config = await getConfig(repositoryId);
  const existingDocs = await prisma.document.findMany({
    where: { repositoryId, path: { endsWith: '.md' } },
    select: { path: true, updatedAt: true, content: true },
  });

  const existingPaths = new Set(existingDocs.map((d) => d.path));
  const actions: PlanAction[] = [];

  for (const entry of config.structure) {
    const action = classifyDocAction(entry, existingDocs, existingPaths);
    actions.push(action);
  }

  // Detect orphaned docs not in config
  for (const doc of existingDocs) {
    const inConfig = config.structure.some((e) => e.path === doc.path);
    if (!inConfig) {
      actions.push({
        type: 'archive',
        documentPath: doc.path,
        reason: 'Document not defined in .docsynth.yml config',
        estimatedImpact: 'low',
      });
    }
  }

  const summary =
    `Plan: ${actions.filter((a) => a.type === 'generate').length} generate, ` +
    `${actions.filter((a) => a.type === 'update').length} update, ` +
    `${actions.filter((a) => a.type === 'archive').length} archive, ` +
    `${actions.filter((a) => a.type === 'skip').length} skip`;

  log.info({ repositoryId, summary }, 'Plan generated');
  return { repositoryId, actions, summary };
}

/**
 * Execute planned actions against the repository.
 */
export async function applyPlan(
  repositoryId: string,
  planActions: PlanAction[],
  dryRun = false
): Promise<ApplyResult> {
  log.info({ repositoryId, actionCount: planActions.length, dryRun }, 'Applying plan');

  const results: ApplyActionResult[] = [];
  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const action of planActions) {
    if (action.type === 'skip') {
      results.push({
        path: action.documentPath,
        action: action.type,
        status: 'skipped',
        details: action.reason,
      });
      skipped++;
      continue;
    }

    if (dryRun) {
      results.push({
        path: action.documentPath,
        action: action.type,
        status: 'skipped',
        details: 'Dry run — no changes applied',
      });
      skipped++;
      continue;
    }

    try {
      if (action.type === 'generate') {
        await db.document.create({
          data: {
            repositoryId,
            path: action.documentPath,
            content: `# ${action.documentPath.split('/').pop()?.replace('.md', '') ?? 'Untitled'}\n\nAuto-generated by DocSynth GitOps.\n`,
            status: 'draft',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      } else if (action.type === 'update') {
        await db.document.updateMany({
          where: { repositoryId, path: action.documentPath },
          data: { status: 'needs-review', updatedAt: new Date() },
        });
      } else if (action.type === 'archive') {
        await db.document.updateMany({
          where: { repositoryId, path: action.documentPath },
          data: { status: 'archived', updatedAt: new Date() },
        });
      }

      results.push({ path: action.documentPath, action: action.type, status: 'success' });
      applied++;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      results.push({
        path: action.documentPath,
        action: action.type,
        status: 'failed',
        details: message,
      });
      failed++;
      log.error({ path: action.documentPath, err: message }, 'Failed to apply action');
    }
  }

  await db.gitopsApply.create({
    data: { repositoryId, applied, skipped, failed, dryRun, appliedAt: new Date() },
  });

  log.info({ repositoryId, applied, skipped, failed }, 'Plan applied');
  return { repositoryId, applied, skipped, failed, results };
}

/**
 * Compare config-defined desired state vs actual state and return drift score.
 */
export async function detectDrift(
  repositoryId: string
): Promise<{ driftScore: number; driftedDocs: Array<{ path: string; reason: string }> }> {
  log.info({ repositoryId }, 'Detecting documentation drift');

  const config = await getConfig(repositoryId);
  const existingDocs = await prisma.document.findMany({
    where: { repositoryId },
    select: { path: true, updatedAt: true, status: true },
  });

  const existingPaths = new Map(existingDocs.map((d) => [d.path, d]));
  const driftedDocs: Array<{ path: string; reason: string }> = [];

  for (const entry of config.structure) {
    const doc = existingPaths.get(entry.path);
    if (!doc) {
      driftedDocs.push({
        path: entry.path,
        reason: 'Missing — defined in config but does not exist',
      });
      continue;
    }

    const daysSinceUpdate = Math.floor(
      (Date.now() - new Date(doc.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceUpdate > entry.freshnessMaxDays) {
      driftedDocs.push({
        path: entry.path,
        reason: `Stale — last updated ${daysSinceUpdate} days ago (max ${entry.freshnessMaxDays})`,
      });
    }
  }

  const totalEntries = config.structure.length;
  const driftScore =
    totalEntries > 0 ? Math.round((driftedDocs.length / totalEntries) * 100) / 100 : 0;

  log.info(
    { repositoryId, driftScore, driftedCount: driftedDocs.length },
    'Drift detection complete'
  );
  return { driftScore, driftedDocs };
}

/**
 * Get stored or default GitOps configuration for a repository.
 */
export async function getConfig(repositoryId: string): Promise<GitOpsConfig> {
  const stored = await db.gitopsConfig.findUnique({ where: { repositoryId } });
  if (stored) return stored.config as unknown as GitOpsConfig;

  return buildDefaultConfig(repositoryId);
}

/**
 * Update GitOps configuration for a repository.
 */
export async function updateConfig(
  repositoryId: string,
  config: Partial<GitOpsConfig>
): Promise<GitOpsConfig> {
  const existing = await getConfig(repositoryId);
  const merged: GitOpsConfig = {
    repositoryId,
    structure: config.structure ?? existing.structure,
    coverageTargets: config.coverageTargets ?? existing.coverageTargets,
    generationRules: { ...existing.generationRules, ...config.generationRules },
    outputTargets: config.outputTargets ?? existing.outputTargets,
  };

  await db.gitopsConfig.upsert({
    where: { repositoryId },
    create: { repositoryId, config: JSON.parse(JSON.stringify(merged)), createdAt: new Date() },
    update: { config: JSON.parse(JSON.stringify(merged)), updatedAt: new Date() },
  });

  log.info({ repositoryId }, 'GitOps config updated');
  return merged;
}

// ============================================================================
// Private Helpers
// ============================================================================

function buildDefaultConfig(repositoryId: string): GitOpsConfig {
  return {
    repositoryId,
    structure: [
      { path: 'docs/README.md', type: 'guide', autoGenerate: true, freshnessMaxDays: 90 },
      { path: 'docs/API.md', type: 'reference', autoGenerate: true, freshnessMaxDays: 60 },
      { path: 'docs/CHANGELOG.md', type: 'changelog', autoGenerate: false, freshnessMaxDays: 30 },
    ],
    coverageTargets: { minPercent: 60, scope: 'public-api' },
    generationRules: { tone: 'professional', maxLength: 5000 },
    outputTargets: [{ format: 'markdown', outputDir: 'docs/' }],
  };
}

function compareDesiredVsActual(
  desired: DocStructureEntry[],
  actualPaths: Set<string>
): { missing: string[]; orphaned: string[]; present: string[] } {
  const missing: string[] = [];
  const present: string[] = [];

  for (const entry of desired) {
    if (actualPaths.has(entry.path)) {
      present.push(entry.path);
    } else {
      missing.push(entry.path);
    }
  }

  const desiredPaths = new Set(desired.map((e) => e.path));
  const orphaned = [...actualPaths].filter((p) => !desiredPaths.has(p));

  return { missing, orphaned, present };
}

function classifyDocAction(
  entry: DocStructureEntry,
  existingDocs: Array<{ path: string; updatedAt: Date; content: string | null }>,
  existingPaths: Set<string>
): PlanAction {
  if (!existingPaths.has(entry.path)) {
    return {
      type: entry.autoGenerate ? 'generate' : 'skip',
      documentPath: entry.path,
      reason: entry.autoGenerate
        ? 'Document missing, auto-generate enabled'
        : 'Document missing, manual creation required',
      estimatedImpact: 'high',
    };
  }

  const doc = existingDocs.find((d) => d.path === entry.path);
  if (!doc)
    return {
      type: 'skip',
      documentPath: entry.path,
      reason: 'Document metadata unavailable',
      estimatedImpact: 'low',
    };

  const daysSinceUpdate = Math.floor(
    (Date.now() - new Date(doc.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysSinceUpdate > entry.freshnessMaxDays) {
    return {
      type: 'update',
      documentPath: entry.path,
      reason: `Stale: last updated ${daysSinceUpdate} days ago (max ${entry.freshnessMaxDays})`,
      estimatedImpact: daysSinceUpdate > entry.freshnessMaxDays * 2 ? 'high' : 'medium',
    };
  }

  return {
    type: 'skip',
    documentPath: entry.path,
    reason: 'Document up to date',
    estimatedImpact: 'low',
  };
}

// Re-export helpers for testing
export { compareDesiredVsActual as _compareDesiredVsActual };
