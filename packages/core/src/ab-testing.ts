// ============================================================================
// Types
// ============================================================================

export interface Variant {
  id: string;
  name: string;
  trafficPercent: number;
}

export interface Experiment {
  id: string;
  name: string;
  variants: Variant[];
  startDate: string;
  endDate?: string;
}

export interface ConversionEvent {
  experimentId: string;
  variantId: string;
  userId: string;
  metric: 'time-on-page' | 'feedback-rating' | 'copy-event';
  value: number;
  timestamp: string;
}

export interface VariantResult {
  variantId: string;
  sampleSize: number;
  conversionRate: number;
  meanValue: number;
}

export interface ExperimentResults {
  experimentId: string;
  variants: VariantResult[];
  chiSquare: number;
  pValue: number;
  significant: boolean;
  winningVariantId: string | null;
  confidenceLevel: number;
}

// ============================================================================
// Experiment Creation
// ============================================================================

export function createExperiment(id: string, name: string, variants: Variant[]): Experiment {
  const totalTraffic = variants.reduce((sum, v) => sum + v.trafficPercent, 0);
  if (Math.abs(totalTraffic - 100) > 0.01) {
    throw new Error(`Variant traffic must sum to 100%, got ${totalTraffic}%`);
  }
  if (variants.length < 2) {
    throw new Error('Experiment must have at least 2 variants');
  }
  return { id, name, variants, startDate: new Date().toISOString() };
}

// ============================================================================
// Deterministic Variant Assignment (hash-based)
// ============================================================================

function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function assignVariant(experiment: Experiment, userId: string): Variant {
  const hash = hashString(`${experiment.id}:${userId}`);
  const bucket = hash % 10000;
  const normalized = bucket / 100; // 0–99.99

  let cumulative = 0;
  for (const variant of experiment.variants) {
    cumulative += variant.trafficPercent;
    if (normalized < cumulative) return variant;
  }
  return experiment.variants[experiment.variants.length - 1]!;
}

// ============================================================================
// Statistical Analysis
// ============================================================================

function groupByVariant(events: ConversionEvent[]): Map<string, ConversionEvent[]> {
  const groups = new Map<string, ConversionEvent[]>();
  for (const e of events) {
    const list = groups.get(e.variantId) ?? [];
    list.push(e);
    groups.set(e.variantId, list);
  }
  return groups;
}

function computeVariantResult(variantId: string, events: ConversionEvent[]): VariantResult {
  const uniqueUsers = new Set(events.map((e) => e.userId)).size;
  const totalValue = events.reduce((sum, e) => sum + e.value, 0);
  const convertedUsers = new Set(events.filter((e) => e.value > 0).map((e) => e.userId)).size;

  return {
    variantId,
    sampleSize: uniqueUsers,
    conversionRate: uniqueUsers > 0 ? convertedUsers / uniqueUsers : 0,
    meanValue: events.length > 0 ? totalValue / events.length : 0,
  };
}

export function chiSquareTest(observed: number[], expected: number[]): number {
  let chi2 = 0;
  for (let i = 0; i < observed.length; i++) {
    if (expected[i]! > 0) {
      chi2 += Math.pow(observed[i]! - expected[i]!, 2) / expected[i]!;
    }
  }
  return chi2;
}

// Approximate p-value from chi-square with 1 degree of freedom
function pValueFromChiSquare(chi2: number): number {
  if (chi2 <= 0) return 1;
  // Approximation using the complementary error function
  return Math.exp(-chi2 / 2);
}

export function calculateResults(
  experiment: Experiment,
  events: ConversionEvent[]
): ExperimentResults {
  const grouped = groupByVariant(events);
  const variantResults = experiment.variants.map((v) =>
    computeVariantResult(v.id, grouped.get(v.id) ?? [])
  );

  const totalSample = variantResults.reduce((s, v) => s + v.sampleSize, 0);
  const totalConversions = variantResults.reduce(
    (s, v) => s + Math.round(v.conversionRate * v.sampleSize),
    0
  );
  const overallRate = totalSample > 0 ? totalConversions / totalSample : 0;

  const observed = variantResults.map((v) => Math.round(v.conversionRate * v.sampleSize));
  const expected = variantResults.map((v) => Math.round(overallRate * v.sampleSize));

  const chi2 = chiSquareTest(observed, expected);
  const pValue = pValueFromChiSquare(chi2);
  const significant = pValue < 0.05;
  const confidenceLevel = Math.round((1 - pValue) * 100);

  let winningVariantId: string | null = null;
  if (significant && variantResults.length > 0) {
    const best = variantResults.reduce((a, b) => (b.conversionRate > a.conversionRate ? b : a));
    winningVariantId = best.variantId;
  }

  return {
    experimentId: experiment.id,
    variants: variantResults,
    chiSquare: chi2,
    pValue,
    significant,
    winningVariantId,
    confidenceLevel,
  };
}
