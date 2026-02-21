/**
 * Documentation A/B Testing Service
 *
 * Serve different documentation versions to users and measure outcomes
 * to determine which content resonates best. Supports multi-variant
 * experiments with statistical significance testing.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-ab-testing-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export type ExperimentStatus = 'draft' | 'running' | 'completed';

export interface Experiment {
  id: string;
  repositoryId: string;
  documentPath: string;
  variants: Variant[];
  trafficSplit: number[];
  status: ExperimentStatus;
  startedAt?: Date;
  endedAt?: Date;
  successMetric: string;
}

export interface Variant {
  id: string;
  name: string;
  content: string;
  impressions: number;
  conversions: number;
}

export interface ExperimentResult {
  experimentId: string;
  winner?: string;
  confidence: number;
  variants: VariantResult[];
  sampleSize: number;
  isSignificant: boolean;
}

export interface VariantResult {
  variantId: string;
  name: string;
  impressions: number;
  conversions: number;
  conversionRate: number;
  improvementVsControl: number;
}

interface ExperimentConfig {
  trafficSplit?: number[];
  successMetric?: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create a new A/B test experiment for a document.
 */
export async function createExperiment(
  repositoryId: string,
  documentPath: string,
  variants: Array<{ name: string; content: string }>,
  config?: ExperimentConfig
): Promise<Experiment> {
  if (variants.length < 2) {
    throw new Error('At least 2 variants are required for an experiment');
  }

  const evenSplit = variants.map(() => Math.round((100 / variants.length) * 100) / 100);
  const trafficSplit = config?.trafficSplit ?? evenSplit;

  if (trafficSplit.length !== variants.length) {
    throw new Error('Traffic split must have the same number of entries as variants');
  }

  const splitSum = trafficSplit.reduce((a, b) => a + b, 0);
  if (Math.abs(splitSum - 100) > 0.1) {
    throw new Error(`Traffic split must sum to 100, got ${splitSum}`);
  }

  const experimentVariants: Variant[] = variants.map((v, i) => ({
    id: `var-${Date.now()}-${i}`,
    name: v.name,
    content: v.content,
    impressions: 0,
    conversions: 0,
  }));

  const experiment = await db.docAbExperiment.create({
    data: {
      repositoryId,
      documentPath,
      variants: JSON.parse(JSON.stringify(experimentVariants)),
      trafficSplit,
      status: 'draft',
      successMetric: config?.successMetric ?? 'time-on-page',
      createdAt: new Date(),
    },
  });

  log.info({ experimentId: experiment.id, variantCount: variants.length }, 'Experiment created');

  return {
    id: experiment.id,
    repositoryId,
    documentPath,
    variants: experimentVariants,
    trafficSplit,
    status: 'draft',
    successMetric: config?.successMetric ?? 'time-on-page',
  };
}

/**
 * Start an experiment, enabling traffic routing.
 */
export async function startExperiment(experimentId: string): Promise<Experiment> {
  const experiment = await db.docAbExperiment.findUnique({ where: { id: experimentId } });
  if (!experiment) throw new Error(`Experiment not found: ${experimentId}`);
  if (experiment.status !== 'draft') throw new Error(`Experiment is already ${experiment.status}`);

  const now = new Date();
  await db.docAbExperiment.update({
    where: { id: experimentId },
    data: { status: 'running', startedAt: now },
  });
  log.info({ experimentId }, 'Experiment started');

  return {
    id: experiment.id,
    repositoryId: experiment.repositoryId,
    documentPath: experiment.documentPath,
    variants: experiment.variants as Variant[],
    trafficSplit: experiment.trafficSplit as number[],
    status: 'running',
    startedAt: now,
    successMetric: experiment.successMetric,
  };
}

/**
 * Assign a variant to a user based on traffic split.
 */
export async function assignVariant(experimentId: string, userId: string): Promise<Variant> {
  const experiment = await db.docAbExperiment.findUnique({ where: { id: experimentId } });

  if (!experiment || experiment.status !== 'running') {
    throw new Error(`Experiment ${experimentId} is not running`);
  }

  const variants = experiment.variants as Variant[];
  const trafficSplit = experiment.trafficSplit as number[];

  // Check for existing assignment
  const existing = await db.docAbAssignment.findUnique({
    where: { experimentId_userId: { experimentId, userId } },
  });

  if (existing) {
    const assigned = variants.find((v) => v.id === existing.variantId);
    if (assigned) return assigned;
  }

  const selected = selectVariant(variants, trafficSplit, userId);

  await db.docAbAssignment.create({
    data: { experimentId, userId, variantId: selected.id, assignedAt: new Date() },
  });

  // Increment impressions
  const updatedVariants = variants.map((v) =>
    v.id === selected.id ? { ...v, impressions: v.impressions + 1 } : v
  );
  await db.docAbExperiment.update({
    where: { id: experimentId },
    data: { variants: JSON.parse(JSON.stringify(updatedVariants)) },
  });

  log.info({ experimentId, userId, variantId: selected.id }, 'Variant assigned');
  return selected;
}

/**
 * Record a success outcome for a variant.
 */
export async function recordOutcome(
  experimentId: string,
  variantId: string,
  outcomeType: string
): Promise<void> {
  const experiment = await db.docAbExperiment.findUnique({ where: { id: experimentId } });

  if (!experiment || experiment.status !== 'running') {
    throw new Error(`Experiment ${experimentId} is not running`);
  }

  const variants = experiment.variants as Variant[];
  const updatedVariants = variants.map((v) =>
    v.id === variantId ? { ...v, conversions: v.conversions + 1 } : v
  );

  await db.docAbExperiment.update({
    where: { id: experimentId },
    data: { variants: JSON.parse(JSON.stringify(updatedVariants)) },
  });

  await db.docAbOutcome.create({
    data: { experimentId, variantId, outcomeType, recordedAt: new Date() },
  });

  log.info({ experimentId, variantId, outcomeType }, 'Outcome recorded');
}

/**
 * Compute statistical results for an experiment.
 */
export async function computeResults(experimentId: string): Promise<ExperimentResult> {
  const experiment = await db.docAbExperiment.findUnique({ where: { id: experimentId } });

  if (!experiment) {
    throw new Error(`Experiment not found: ${experimentId}`);
  }

  const variants = experiment.variants as Variant[];
  const control = variants[0];
  const controlRate = control.impressions > 0 ? control.conversions / control.impressions : 0;

  const variantResults: VariantResult[] = variants.map((v) => {
    const conversionRate = v.impressions > 0 ? v.conversions / v.impressions : 0;
    const improvement = controlRate > 0 ? ((conversionRate - controlRate) / controlRate) * 100 : 0;

    return {
      variantId: v.id,
      name: v.name,
      impressions: v.impressions,
      conversions: v.conversions,
      conversionRate: Math.round(conversionRate * 10000) / 100,
      improvementVsControl: Math.round(improvement * 100) / 100,
    };
  });

  const sampleSize = variants.reduce((sum, v) => sum + v.impressions, 0);
  const { confidence, isSignificant } = calculateSignificance(variants);

  let winner: string | undefined;
  if (isSignificant && variantResults.length > 1) {
    const best = variantResults.reduce((a, b) => (a.conversionRate > b.conversionRate ? a : b));
    winner = best.name;
  }

  const result: ExperimentResult = {
    experimentId,
    winner,
    confidence: Math.round(confidence * 10000) / 100,
    variants: variantResults,
    sampleSize,
    isSignificant,
  };

  // Auto-complete experiment if significance is reached
  if (isSignificant && experiment.status === 'running') {
    await db.docAbExperiment.update({
      where: { id: experimentId },
      data: { status: 'completed', endedAt: new Date() },
    });
    log.info({ experimentId, winner }, 'Experiment auto-completed with significance');
  }

  return result;
}

/**
 * Get all experiments for a repository.
 */
export async function getExperiments(repositoryId: string): Promise<Experiment[]> {
  const experiments = await db.docAbExperiment.findMany({
    where: { repositoryId },
    orderBy: { createdAt: 'desc' },
  });

  return experiments.map((e: any) => ({
    id: e.id,
    repositoryId: e.repositoryId,
    documentPath: e.documentPath,
    variants: (e.variants as Variant[]) ?? [],
    trafficSplit: (e.trafficSplit as number[]) ?? [],
    status: e.status as ExperimentStatus,
    startedAt: e.startedAt ?? undefined,
    endedAt: e.endedAt ?? undefined,
    successMetric: e.successMetric,
  }));
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Calculate statistical significance using a z-test for proportions.
 */
function calculateSignificance(variants: Variant[]): {
  confidence: number;
  isSignificant: boolean;
} {
  if (variants.length < 2) {
    return { confidence: 0, isSignificant: false };
  }

  const control = variants[0];
  const treatment = variants[1];

  if (control.impressions < 30 || treatment.impressions < 30) {
    return { confidence: 0, isSignificant: false };
  }

  const p1 = control.impressions > 0 ? control.conversions / control.impressions : 0;
  const p2 = treatment.impressions > 0 ? treatment.conversions / treatment.impressions : 0;
  const n1 = control.impressions;
  const n2 = treatment.impressions;

  const pooledP = (control.conversions + treatment.conversions) / (n1 + n2);
  const se = Math.sqrt(pooledP * (1 - pooledP) * (1 / n1 + 1 / n2));

  if (se === 0) {
    return { confidence: 0, isSignificant: false };
  }

  const zScore = Math.abs(p1 - p2) / se;

  // Approximate p-value from z-score using normal distribution
  const confidence = 1 - 2 * normalCDF(-zScore);

  return {
    confidence: Math.max(0, Math.min(1, confidence)),
    isSignificant: confidence >= 0.95,
  };
}

function normalCDF(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + 0.3275911 * absX);
  const y =
    1.0 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Select a variant for a user based on traffic split (deterministic by userId).
 */
function selectVariant(variants: Variant[], trafficSplit: number[], userId: string): Variant {
  // Deterministic hash of userId for consistent assignment
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  const bucket = Math.abs(hash) % 100;

  let cumulative = 0;
  for (let i = 0; i < variants.length; i++) {
    cumulative += trafficSplit[i];
    if (bucket < cumulative) {
      return variants[i];
    }
  }

  return variants[variants.length - 1];
}

function computeConfidenceInterval(
  conversions: number,
  impressions: number,
  confidenceLevel = 0.95
): { lower: number; upper: number } {
  if (impressions === 0) return { lower: 0, upper: 0 };
  const p = conversions / impressions;
  const zScores: Record<number, number> = { 0.9: 1.645, 0.95: 1.96, 0.99: 2.576 };
  const z = zScores[confidenceLevel] ?? 1.96;
  const margin = z * Math.sqrt((p * (1 - p)) / impressions);
  return {
    lower: Math.max(0, Math.round((p - margin) * 10000) / 100),
    upper: Math.min(100, Math.round((p + margin) * 10000) / 100),
  };
}

export const _internal = { calculateSignificance, selectVariant, computeConfidenceInterval };
