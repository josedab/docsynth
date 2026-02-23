/**
 * Documentation Change Forecasting Service
 *
 * Predicts which documentation will become stale based on code
 * velocity patterns, historical drift rates, contributor activity,
 * and dependency changes. Generates actionable digests.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId } from '@docsynth/utils';

const log = createLogger('doc-forecast-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export type SignalType =
  | 'code-velocity'
  | 'time-decay'
  | 'historical-drift'
  | 'dependency-change'
  | 'contributor-activity';

export type RecommendedAction = 'update-now' | 'schedule-update' | 'monitor' | 'no-action';

export interface PredictionSignal {
  type: SignalType;
  value: number;
  weight: number;
  description: string;
}

export interface DocPrediction {
  documentPath: string;
  stalenessProbability: number;
  predictedStaleDate: string;
  signals: PredictionSignal[];
  recommendedAction: RecommendedAction;
}

export interface ForecastResult {
  repositoryId: string;
  predictions: DocPrediction[];
  generatedAt: Date;
  modelConfidence: number;
  period: string;
}

export interface ForecastDigest {
  repositoryId: string;
  period: string;
  urgentDocs: DocPrediction[];
  scheduledDocs: DocPrediction[];
  monitorDocs: DocPrediction[];
  summary: string;
}

export interface HistoricalDataPoint {
  documentPath: string;
  date: string;
  driftScore: number;
  codeChangesNearby: number;
  wasUpdated: boolean;
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Gather historical patterns for model input.
 */
export async function collectSignals(repositoryId: string): Promise<HistoricalDataPoint[]> {
  log.info({ repositoryId }, 'Collecting historical signals');

  const docs = await db.document.findMany({
    where: { repositoryId },
    select: { path: true, updatedAt: true, createdAt: true },
  });

  const commits = await db.repositoryCommit.findMany({
    where: { repositoryId },
    select: { filePath: true, committedAt: true },
    orderBy: { committedAt: 'desc' },
    take: 1000,
  });

  const dataPoints: HistoricalDataPoint[] = [];
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  for (const doc of docs) {
    const docDir = doc.path.split('/').slice(0, -1).join('/');

    // Count code changes near this doc in the last 30 days
    const nearbyChanges = commits.filter((c: any) => {
      const commitDate = new Date(c.committedAt);
      return commitDate >= thirtyDaysAgo && c.filePath.startsWith(docDir);
    }).length;

    const daysSinceUpdate = Math.floor(
      (now.getTime() - new Date(doc.updatedAt).getTime()) / (24 * 60 * 60 * 1000)
    );
    const driftScore = Math.min(daysSinceUpdate / 180, 1.0);

    const wasUpdated = new Date(doc.updatedAt) >= thirtyDaysAgo;

    dataPoints.push({
      documentPath: doc.path,
      date: now.toISOString().split('T')[0],
      driftScore,
      codeChangesNearby: nearbyChanges,
      wasUpdated,
    });
  }

  log.info({ repositoryId, dataPointCount: dataPoints.length }, 'Signals collected');
  return dataPoints;
}

/**
 * Predict which docs will need updates within the given period.
 */
export async function predict(
  repositoryId: string,
  period = '30d',
  topN = 20
): Promise<ForecastResult> {
  log.info({ repositoryId, period, topN }, 'Generating predictions');

  const docs = await db.document.findMany({
    where: { repositoryId },
    select: { path: true, updatedAt: true },
  });

  const predictions: DocPrediction[] = [];

  for (const doc of docs) {
    const signals: PredictionSignal[] = [];

    const velocity = await computeCodeVelocity(repositoryId, doc.path);
    signals.push({
      type: 'code-velocity',
      value: velocity,
      weight: 0.35,
      description: `${velocity.toFixed(2)} code changes/week near this doc`,
    });

    const decay = computeTimeDecay(doc.updatedAt);
    signals.push({
      type: 'time-decay',
      value: decay,
      weight: 0.25,
      description: `Time decay factor: ${decay.toFixed(2)}`,
    });

    const driftRate = await computeHistoricalDriftRate(repositoryId, doc.path);
    signals.push({
      type: 'historical-drift',
      value: driftRate,
      weight: 0.2,
      description: `Historical drift rate: ${driftRate.toFixed(2)}`,
    });

    const depChange = await computeDependencyChangeSignal(repositoryId, doc.path);
    signals.push({
      type: 'dependency-change',
      value: depChange,
      weight: 0.1,
      description: `Dependency change signal: ${depChange.toFixed(2)}`,
    });

    const activity = await computeContributorActivity(repositoryId, doc.path);
    signals.push({
      type: 'contributor-activity',
      value: activity,
      weight: 0.1,
      description: `Contributor activity: ${activity.toFixed(2)}`,
    });

    const probability = weightedProbability(signals);
    const daysUntilStale = Math.max(1, Math.round((1 - probability) * parsePeriodDays(period) * 2));
    const staleDate = new Date(Date.now() + daysUntilStale * 24 * 60 * 60 * 1000);

    predictions.push({
      documentPath: doc.path,
      stalenessProbability: probability,
      predictedStaleDate: staleDate.toISOString().split('T')[0],
      signals,
      recommendedAction: classifyUrgency(probability),
    });
  }

  predictions.sort((a, b) => b.stalenessProbability - a.stalenessProbability);
  const topPredictions = predictions.slice(0, topN);

  const modelConfidence = computeModelConfidence(topPredictions);

  const result: ForecastResult = {
    repositoryId,
    predictions: topPredictions,
    generatedAt: new Date(),
    modelConfidence,
    period,
  };

  await db.docForecast.create({
    data: {
      id: generateId(),
      repositoryId,
      predictions: JSON.stringify(topPredictions),
      generatedAt: result.generatedAt,
      modelConfidence,
      period,
    },
  });

  log.info(
    { repositoryId, predictionCount: topPredictions.length, modelConfidence },
    'Predictions generated'
  );
  return result;
}

/**
 * Generate an actionable digest grouping docs by urgency.
 */
export async function generateDigest(
  repositoryId: string,
  period = '30d'
): Promise<ForecastDigest> {
  log.info({ repositoryId, period }, 'Generating forecast digest');

  const forecast = await predict(repositoryId, period);

  const urgentDocs = forecast.predictions.filter((p) => p.recommendedAction === 'update-now');
  const scheduledDocs = forecast.predictions.filter(
    (p) => p.recommendedAction === 'schedule-update'
  );
  const monitorDocs = forecast.predictions.filter((p) => p.recommendedAction === 'monitor');

  const summary = [
    `Forecast for ${period}: ${forecast.predictions.length} documents analyzed.`,
    `${urgentDocs.length} need immediate updates,`,
    `${scheduledDocs.length} should be scheduled,`,
    `${monitorDocs.length} should be monitored.`,
    `Model confidence: ${(forecast.modelConfidence * 100).toFixed(0)}%.`,
  ].join(' ');

  const digest: ForecastDigest = {
    repositoryId,
    period,
    urgentDocs,
    scheduledDocs,
    monitorDocs,
    summary,
  };

  log.info(
    { repositoryId, urgent: urgentDocs.length, scheduled: scheduledDocs.length },
    'Digest generated'
  );
  return digest;
}

/**
 * Retrieve past forecast results.
 */
export async function getForecastHistory(
  repositoryId: string,
  limit = 10
): Promise<ForecastResult[]> {
  const rows = await db.docForecast.findMany({
    where: { repositoryId },
    orderBy: { generatedAt: 'desc' },
    take: limit,
  });

  return rows.map((r: any) => ({
    repositoryId: r.repositoryId,
    predictions: typeof r.predictions === 'string' ? JSON.parse(r.predictions) : r.predictions,
    generatedAt: r.generatedAt,
    modelConfidence: r.modelConfidence,
    period: r.period,
  }));
}

/**
 * Evaluate how accurate past predictions were.
 */
export async function evaluateAccuracy(
  repositoryId: string
): Promise<{ predicted: number; actuallyStale: number; accuracy: number }> {
  log.info({ repositoryId }, 'Evaluating forecast accuracy');

  const pastForecasts = await db.docForecast.findMany({
    where: { repositoryId },
    orderBy: { generatedAt: 'desc' },
    take: 5,
  });

  if (pastForecasts.length === 0) {
    return { predicted: 0, actuallyStale: 0, accuracy: 0 };
  }

  let predicted = 0;
  let actuallyStale = 0;

  for (const forecast of pastForecasts) {
    const predictions: DocPrediction[] =
      typeof forecast.predictions === 'string'
        ? JSON.parse(forecast.predictions)
        : forecast.predictions;

    const highProbDocs = predictions.filter((p) => p.stalenessProbability >= 0.6);
    predicted += highProbDocs.length;

    for (const pred of highProbDocs) {
      const doc = await db.document.findFirst({
        where: { repositoryId, path: pred.documentPath },
        select: { updatedAt: true },
      });

      if (doc) {
        const docUpdated = new Date(doc.updatedAt);
        const forecastDate = new Date(forecast.generatedAt);
        if (docUpdated > forecastDate) actuallyStale++;
      }
    }
  }

  const accuracy = predicted > 0 ? actuallyStale / predicted : 0;
  log.info({ repositoryId, predicted, actuallyStale, accuracy }, 'Accuracy evaluated');
  return { predicted, actuallyStale, accuracy };
}

// ============================================================================
// Helpers
// ============================================================================

async function computeCodeVelocity(repositoryId: string, docPath: string): Promise<number> {
  const docDir = docPath.split('/').slice(0, -1).join('/');
  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);

  const changeCount = await db.repositoryCommit.count({
    where: {
      repositoryId,
      filePath: { startsWith: docDir },
      committedAt: { gte: fourWeeksAgo },
    },
  });

  return changeCount / 4; // changes per week
}

function computeTimeDecay(lastUpdated: Date | string): number {
  const daysSince = (Date.now() - new Date(lastUpdated).getTime()) / (24 * 60 * 60 * 1000);
  // Exponential decay: approaches 1.0 as doc gets older
  return 1 - Math.exp(-daysSince / 90);
}

async function computeHistoricalDriftRate(repositoryId: string, docPath: string): Promise<number> {
  const driftRecords = await db.driftDetectionResult.findMany({
    where: { repositoryId, documentPath: docPath },
    select: { driftScore: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  if (driftRecords.length === 0) return 0.3; // default moderate drift

  const avgDrift =
    driftRecords.reduce((sum: number, r: any) => sum + (r.driftScore ?? 0), 0) /
    driftRecords.length;
  return Math.min(avgDrift, 1.0);
}

async function computeDependencyChangeSignal(
  repositoryId: string,
  _docPath: string
): Promise<number> {
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const depChanges = await db.repositoryCommit.count({
    where: {
      repositoryId,
      filePath: { in: ['package.json', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pom.xml'] },
      committedAt: { gte: twoWeeksAgo },
    },
  });

  return Math.min(depChanges / 5, 1.0);
}

async function computeContributorActivity(repositoryId: string, docPath: string): Promise<number> {
  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const docDir = docPath.split('/').slice(0, -1).join('/');

  const contributors = await db.repositoryCommit.findMany({
    where: {
      repositoryId,
      filePath: { startsWith: docDir },
      committedAt: { gte: oneMonthAgo },
    },
    select: { authorEmail: true },
    distinct: ['authorEmail'],
  });

  // High contributor activity = lower staleness risk (inverse)
  return Math.max(0, 1 - contributors.length * 0.2);
}

function weightedProbability(signals: PredictionSignal[]): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const signal of signals) {
    weightedSum += signal.value * signal.weight;
    totalWeight += signal.weight;
  }

  const probability = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  return Math.max(0, Math.min(1, probability));
}

function classifyUrgency(probability: number): RecommendedAction {
  if (probability >= 0.8) return 'update-now';
  if (probability >= 0.6) return 'schedule-update';
  if (probability >= 0.3) return 'monitor';
  return 'no-action';
}

function parsePeriodDays(period: string): number {
  const match = period.match(/^(\d+)([dwmy])$/);
  if (!match) return 30;

  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 'd':
      return value;
    case 'w':
      return value * 7;
    case 'm':
      return value * 30;
    case 'y':
      return value * 365;
    default:
      return 30;
  }
}

function computeModelConfidence(predictions: DocPrediction[]): number {
  if (predictions.length === 0) return 0;

  // Model confidence is higher when signals agree
  let totalAgreement = 0;
  for (const pred of predictions) {
    const values = pred.signals.map((s) => s.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    totalAgreement += 1 - Math.sqrt(variance);
  }

  return Math.max(0.1, Math.min(0.95, totalAgreement / predictions.length));
}
