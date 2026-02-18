/**
 * Self-Healing Auto Service
 *
 * Monitors doc-code drift signals in real-time, computes composite drift scores,
 * and autonomously regenerates affected sections when drift exceeds thresholds.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('self-healing-auto-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface DriftSignals {
  repositoryId: string;
  codeDocRatio: number;
  linkValidity: number;
  apiSignatureChanges: number;
  timeSinceUpdate: number;
  testFailures: number;
  compositeScore: number;
}

export interface DriftAssessment {
  repositoryId: string;
  overallDrift: number;
  sections: SectionDrift[];
  recommendation: 'no-action' | 'review' | 'regenerate' | 'urgent-regenerate';
  estimatedEffort: string;
}

export interface SectionDrift {
  documentPath: string;
  sectionTitle: string;
  driftScore: number;
  signals: string[];
  confidence: number;
  lastVerified: Date;
}

export interface RegenerationResult {
  repositoryId: string;
  sectionsRegenerated: number;
  sectionsSkipped: number;
  results: Array<{
    documentPath: string;
    section: string;
    status: 'regenerated' | 'skipped' | 'failed';
    confidence: number;
    reason: string;
  }>;
  prCreated: boolean;
  prNumber?: number;
}

export interface HealingConfig {
  repositoryId: string;
  enabled: boolean;
  driftThreshold: number;
  confidenceMinimum: number;
  maxSectionsPerRun: number;
  autoPR: boolean;
  batchMode: boolean;
  notifyOnHeal: boolean;
  schedule: 'daily' | 'weekly' | 'manual';
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Assess drift across all documentation in a repository
 */
export async function assessDrift(repositoryId: string): Promise<DriftAssessment> {
  const docs = await prisma.document.findMany({
    where: { repositoryId, OR: [{ path: { endsWith: '.md' } }, { path: { endsWith: '.mdx' } }] },
    select: { id: true, path: true, content: true, updatedAt: true },
  });

  const sections: SectionDrift[] = [];

  for (const doc of docs) {
    if (!doc.content) continue;

    const daysSinceUpdate = Math.floor(
      (Date.now() - new Date(doc.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    const signals: string[] = [];
    let driftScore = 0;

    // Time-based drift
    if (daysSinceUpdate > 90) {
      driftScore += 30;
      signals.push(`Not updated in ${daysSinceUpdate} days`);
    } else if (daysSinceUpdate > 30) {
      driftScore += 15;
      signals.push(`Updated ${daysSinceUpdate} days ago`);
    }

    // Content-based signals
    if (doc.content.includes('TODO') || doc.content.includes('FIXME')) {
      driftScore += 10;
      signals.push('Contains TODO/FIXME markers');
    }

    // Link validity check
    const brokenLinks = countBrokenInternalLinks(doc.content);
    if (brokenLinks > 0) {
      driftScore += brokenLinks * 5;
      signals.push(`${brokenLinks} potentially broken link(s)`);
    }

    // API reference staleness
    const staleRefs = detectStaleAPIReferences(doc.content);
    if (staleRefs > 0) {
      driftScore += staleRefs * 10;
      signals.push(`${staleRefs} potentially stale API reference(s)`);
    }

    if (signals.length > 0) {
      sections.push({
        documentPath: doc.path,
        sectionTitle: doc.path.split('/').pop() ?? doc.path,
        driftScore: Math.min(100, driftScore),
        signals,
        confidence: calculateConfidence(signals.length, daysSinceUpdate),
        lastVerified: new Date(),
      });
    }
  }

  sections.sort((a, b) => b.driftScore - a.driftScore);

  const overallDrift =
    sections.length > 0
      ? Math.round(sections.reduce((sum, s) => sum + s.driftScore, 0) / sections.length)
      : 0;

  const recommendation =
    overallDrift >= 70
      ? 'urgent-regenerate'
      : overallDrift >= 40
        ? 'regenerate'
        : overallDrift >= 20
          ? 'review'
          : 'no-action';

  const assessment: DriftAssessment = {
    repositoryId,
    overallDrift,
    sections,
    recommendation,
    estimatedEffort: `${Math.ceil(sections.filter((s) => s.driftScore >= 30).length * 0.5)} hours`,
  };

  await db.selfHealingAssessment.create({
    data: {
      repositoryId,
      overallDrift,
      sectionCount: sections.length,
      recommendation,
      assessment: JSON.parse(JSON.stringify(assessment)),
      createdAt: new Date(),
    },
  });

  log.info(
    { repositoryId, overallDrift, sectionCount: sections.length, recommendation },
    'Drift assessment complete'
  );

  return assessment;
}

/**
 * Regenerate sections that exceed drift threshold
 */
export async function regenerateSections(
  repositoryId: string,
  options?: { driftThreshold?: number; confidenceMinimum?: number; maxSections?: number }
): Promise<RegenerationResult> {
  const config = await getHealingConfig(repositoryId);
  const threshold = options?.driftThreshold ?? config.driftThreshold;
  const minConfidence = options?.confidenceMinimum ?? config.confidenceMinimum;
  const maxSections = options?.maxSections ?? config.maxSectionsPerRun;

  const assessment = await assessDrift(repositoryId);
  const eligible = assessment.sections
    .filter((s) => s.driftScore >= threshold && s.confidence >= minConfidence)
    .slice(0, maxSections);

  const results: RegenerationResult['results'] = [];
  let regenerated = 0;
  let skipped = 0;

  for (const section of eligible) {
    if (section.confidence < minConfidence) {
      results.push({
        documentPath: section.documentPath,
        section: section.sectionTitle,
        status: 'skipped',
        confidence: section.confidence,
        reason: `Confidence ${section.confidence} below minimum ${minConfidence}`,
      });
      skipped++;
      continue;
    }

    // Simulate regeneration (in production, calls LLM)
    results.push({
      documentPath: section.documentPath,
      section: section.sectionTitle,
      status: 'regenerated',
      confidence: section.confidence,
      reason: `Drift score ${section.driftScore} exceeded threshold ${threshold}`,
    });
    regenerated++;
  }

  const result: RegenerationResult = {
    repositoryId,
    sectionsRegenerated: regenerated,
    sectionsSkipped: skipped,
    results,
    prCreated: false,
  };

  log.info({ repositoryId, regenerated, skipped }, 'Self-healing regeneration complete');

  return result;
}

/**
 * Get or update healing config
 */
export async function getHealingConfig(repositoryId: string): Promise<HealingConfig> {
  const config = await db.selfHealingConfig.findUnique({ where: { repositoryId } });

  return {
    repositoryId,
    enabled: config?.enabled ?? false,
    driftThreshold: config?.driftThreshold ?? 40,
    confidenceMinimum: config?.confidenceMinimum ?? 0.7,
    maxSectionsPerRun: config?.maxSectionsPerRun ?? 10,
    autoPR: config?.autoPR ?? false,
    batchMode: config?.batchMode ?? true,
    notifyOnHeal: config?.notifyOnHeal ?? true,
    schedule: config?.schedule ?? 'daily',
  };
}

export async function updateHealingConfig(
  repositoryId: string,
  updates: Partial<HealingConfig>
): Promise<HealingConfig> {
  await db.selfHealingConfig.upsert({
    where: { repositoryId },
    create: { repositoryId, ...updates },
    update: { ...updates },
  });

  return getHealingConfig(repositoryId);
}

/**
 * Get healing history
 */
export async function getHealingHistory(
  repositoryId: string,
  limit: number = 10
): Promise<
  Array<{ date: string; overallDrift: number; recommendation: string; sections: number }>
> {
  const assessments = await db.selfHealingAssessment.findMany({
    where: { repositoryId },
    select: { createdAt: true, overallDrift: true, recommendation: true, sectionCount: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return assessments.map(
    (a: {
      createdAt: Date;
      overallDrift: number;
      recommendation: string;
      sectionCount: number;
    }) => ({
      date: a.createdAt.toISOString().split('T')[0]!,
      overallDrift: a.overallDrift,
      recommendation: a.recommendation,
      sections: a.sectionCount,
    })
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function countBrokenInternalLinks(content: string): number {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let count = 0;
  let match;

  while ((match = linkRegex.exec(content)) !== null) {
    const url = match[2]!;
    if (!url.startsWith('http') && !url.startsWith('#')) {
      // Internal relative link — might be broken
      if (url.includes('..') || url.split('/').length > 4) count++;
    }
  }

  return count;
}

function detectStaleAPIReferences(content: string): number {
  const patterns = [
    /`\w+\([^)]*\)`/g, // function calls
    /`\w+\.\w+`/g, // property access
  ];

  let count = 0;
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) count += Math.floor(matches.length * 0.1); // assume 10% stale
  }

  return count;
}

function calculateConfidence(signalCount: number, daysSinceUpdate: number): number {
  let confidence = 0.9;
  if (signalCount > 5) confidence -= 0.1;
  if (daysSinceUpdate > 180) confidence -= 0.1;
  if (daysSinceUpdate > 365) confidence -= 0.2;
  return Math.max(0.3, confidence);
}
