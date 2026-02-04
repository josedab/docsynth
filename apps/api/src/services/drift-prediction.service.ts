/**
 * Drift Prediction Service
 * 
 * Provides drift prediction analysis and utility methods for the API layer.
 * The heavy lifting is done by the worker's drift-predictor.ts service.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('drift-prediction-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface DriftSignals {
  codeChanges: number;
  apiChanges: number;
  dependencyChanges: number;
  timeSinceUpdate: number;
}

export interface DriftPrediction {
  id: string;
  documentId: string;
  documentPath: string;
  driftProbability: number;
  riskLevel: 'low' | 'medium' | 'high';
  signals: DriftSignals;
  status: string;
  predictedAt: Date;
}

// Signal weights for probability calculation
const WEIGHTS = {
  codeChanges: 0.35,
  apiChanges: 0.30,
  dependencyChanges: 0.15,
  timeSinceUpdate: 0.20,
};

// Thresholds for normalizing signals
const THRESHOLDS = {
  codeChanges: 20,      // 20+ changes = max score
  apiChanges: 10,       // 10+ API changes = max score
  dependencyChanges: 5, // 5+ dep changes = max score
  timeSinceUpdate: 60,  // 60+ days = max score
};

class DriftPredictionService {
  /**
   * Get predictions for a repository
   */
  async getPredictions(
    repositoryId: string,
    options: { status?: string; limit?: number } = {}
  ): Promise<DriftPrediction[]> {
    const { status, limit = 50 } = options;

    const where: { repositoryId: string; status?: string } = { repositoryId };
    if (status) where.status = status;

    const predictions = await db.driftPrediction.findMany({
      where,
      orderBy: { driftProbability: 'desc' },
      take: limit,
    });

    return predictions;
  }

  /**
   * Get prediction statistics for a repository
   */
  async getStats(repositoryId: string): Promise<{
    totalPredictions: number;
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    avgConfidence: number;
    predictedDrifts: number;
    preventedDrifts: number;
  }> {
    const predictions = await db.driftPrediction.findMany({
      where: { repositoryId },
      select: { driftProbability: true, riskLevel: true, status: true },
    });

    const highRisk = predictions.filter((p: { riskLevel: string }) => p.riskLevel === 'high').length;
    const mediumRisk = predictions.filter((p: { riskLevel: string }) => p.riskLevel === 'medium').length;
    const lowRisk = predictions.filter((p: { riskLevel: string }) => p.riskLevel === 'low').length;

    const avgConfidence = predictions.length > 0
      ? predictions.reduce((sum: number, p: { driftProbability: number }) => sum + p.driftProbability, 0) / predictions.length
      : 0;

    const preventedDrifts = predictions.filter((p: { status: string }) => p.status === 'resolved').length;
    const predictedDrifts = predictions.filter(
      (p: { driftProbability: number }) => p.driftProbability >= 0.7
    ).length;

    return {
      totalPredictions: predictions.length,
      highRisk,
      mediumRisk,
      lowRisk,
      avgConfidence,
      predictedDrifts,
      preventedDrifts,
    };
  }

  /**
   * Take action on a prediction
   */
  async takeAction(
    predictionId: string,
    action: 'update_doc' | 'dismiss' | 'acknowledge',
    userId: string
  ): Promise<void> {
    const statusMap: Record<string, string> = {
      update_doc: 'resolved',
      dismiss: 'dismissed',
      acknowledge: 'acknowledged',
    };

    await db.driftPrediction.update({
      where: { id: predictionId },
      data: {
        status: statusMap[action],
        reviewedAt: new Date(),
        reviewedBy: userId,
        actionTaken: action,
      },
    });

    log.info({ predictionId, action, userId }, 'Action taken on prediction');
  }

  // ============================================
  // Public utility methods (for testing/external use)
  // ============================================

  /**
   * Calculate drift probability from signals
   */
  calculateProbability(signals: DriftSignals): number {
    // Normalize each signal to 0-1 range
    const normalized = {
      codeChanges: Math.min(signals.codeChanges / THRESHOLDS.codeChanges, 1),
      apiChanges: Math.min(signals.apiChanges / THRESHOLDS.apiChanges, 1),
      dependencyChanges: Math.min(signals.dependencyChanges / THRESHOLDS.dependencyChanges, 1),
      timeSinceUpdate: Math.min(signals.timeSinceUpdate / THRESHOLDS.timeSinceUpdate, 1),
    };

    // Weighted sum
    const probability =
      normalized.codeChanges * WEIGHTS.codeChanges +
      normalized.apiChanges * WEIGHTS.apiChanges +
      normalized.dependencyChanges * WEIGHTS.dependencyChanges +
      normalized.timeSinceUpdate * WEIGHTS.timeSinceUpdate;

    return Math.min(Math.max(probability, 0), 1);
  }

  /**
   * Categorize risk level based on probability
   */
  categorizeRisk(probability: number): 'low' | 'medium' | 'high' {
    if (probability >= 0.7) return 'high';
    if (probability >= 0.4) return 'medium';
    return 'low';
  }

  /**
   * Validate signals object
   */
  validateSignals(signals: unknown): signals is DriftSignals {
    if (!signals || typeof signals !== 'object') return false;
    const s = signals as Record<string, unknown>;
    return (
      typeof s.codeChanges === 'number' &&
      typeof s.apiChanges === 'number' &&
      typeof s.dependencyChanges === 'number' &&
      typeof s.timeSinceUpdate === 'number'
    );
  }
}

export const driftPredictionService = new DriftPredictionService();
