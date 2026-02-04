import { prisma } from '@docsynth/database';
import { GitHubClient } from '@docsynth/github';
import { createLogger } from '@docsynth/utils';
import type { Document, DriftPrediction } from '@docsynth/types';

const log = createLogger('drift-predictor-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface DriftPredictionInput {
  repositoryId: string;
  installationId: number;
  owner: string;
  repo: string;
}

export interface DriftPredictionResult {
  documentPath: string;
  documentId: string | null;
  driftProbability: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  predictedDriftDate: Date | null;
  signals: {
    prActivityScore: number;
    changeVelocityScore: number;
    staleDaysScore: number;
    relatedIssuesScore: number;
  };
  relatedPRs: Array<{ number: number; title: string; mergedAt: Date }>;
  affectedFiles: string[];
  suggestedActions: string[];
  estimatedEffort: 'quick' | 'moderate' | 'substantial';
}

export interface PredictionSummary {
  repositoryId: string;
  totalDocuments: number;
  predictions: DriftPredictionResult[];
  riskDistribution: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  analyzedAt: Date;
}

class DriftPredictorService {
  private readonly PREDICTION_WINDOW_DAYS = 30; // Look ahead window
  private readonly LOOKBACK_DAYS = 14; // Days to analyze past activity

  async predictDrift(input: DriftPredictionInput): Promise<PredictionSummary> {
    const { repositoryId, installationId, owner, repo } = input;
    log.info({ repositoryId, owner, repo }, 'Starting drift prediction analysis');

    const client = GitHubClient.forInstallation(installationId);

    // Get repository with documents
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      include: {
        documents: true,
      },
    });

    if (!repository) {
      throw new Error(`Repository not found: ${repositoryId}`);
    }

    // Get recent PR activity
    const lookbackDate = new Date(Date.now() - this.LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const recentPRs = await prisma.pREvent.findMany({
      where: {
        repositoryId,
        mergedAt: { gte: lookbackDate },
      },
      orderBy: { mergedAt: 'desc' },
    });

    // Get file changes from recent PRs
    const fileChangeMap = await this.buildFileChangeMap(client, owner, repo, recentPRs);

    // Get related issues/tickets (if any mention documentation)
    const docRelatedSignals = await this.getDocRelatedSignals(repositoryId, recentPRs);

    // Analyze each document for drift probability
    const predictions: DriftPredictionResult[] = [];

    for (const doc of repository.documents) {
      const prediction = await this.analyzeDocument(
        doc,
        fileChangeMap,
        recentPRs,
        docRelatedSignals
      );
      predictions.push(prediction);
    }

    // Sort by probability descending
    predictions.sort((a, b) => b.driftProbability - a.driftProbability);

    // Calculate risk distribution
    const riskDistribution = {
      critical: predictions.filter(p => p.riskLevel === 'critical').length,
      high: predictions.filter(p => p.riskLevel === 'high').length,
      medium: predictions.filter(p => p.riskLevel === 'medium').length,
      low: predictions.filter(p => p.riskLevel === 'low').length,
    };

    // Store predictions in database
    await this.storePredictions(repositoryId, predictions);

    log.info(
      { repositoryId, totalDocs: repository.documents.length, predictions: predictions.length },
      'Drift prediction completed'
    );

    return {
      repositoryId,
      totalDocuments: repository.documents.length,
      predictions,
      riskDistribution,
      analyzedAt: new Date(),
    };
  }

  private async buildFileChangeMap(
    client: GitHubClient,
    owner: string,
    repo: string,
    recentPRs: Array<{ prNumber: number; title: string; mergedAt: Date | null }>
  ): Promise<Map<string, Array<{ prNumber: number; title: string; mergedAt: Date; changeType: string }>>> {
    const fileChangeMap = new Map<string, Array<{ prNumber: number; title: string; mergedAt: Date; changeType: string }>>();

    for (const pr of recentPRs.slice(0, 20)) {
      if (!pr.mergedAt) continue;

      try {
        const files = await client.getPullRequestFiles(owner, repo, pr.prNumber);

        for (const file of files) {
          const existing = fileChangeMap.get(file.filename) || [];
          existing.push({
            prNumber: pr.prNumber,
            title: pr.title,
            mergedAt: pr.mergedAt,
            changeType: file.status,
          });
          fileChangeMap.set(file.filename, existing);
        }
      } catch (error) {
        log.warn({ prNumber: pr.prNumber, error }, 'Failed to get PR files');
      }
    }

    return fileChangeMap;
  }

  private async getDocRelatedSignals(
    repositoryId: string,
    recentPRs: Array<{ title: string; body: string | null }>
  ): Promise<{ mentionsCount: number; keywords: string[] }> {
    const docKeywords = ['doc', 'documentation', 'readme', 'docs', 'document'];
    let mentionsCount = 0;
    const foundKeywords: string[] = [];

    for (const pr of recentPRs) {
      const text = `${pr.title} ${pr.body || ''}`.toLowerCase();
      for (const keyword of docKeywords) {
        if (text.includes(keyword)) {
          mentionsCount++;
          if (!foundKeywords.includes(keyword)) {
            foundKeywords.push(keyword);
          }
          break;
        }
      }
    }

    return { mentionsCount, keywords: foundKeywords };
  }

  private async analyzeDocument(
    doc: Document,
    fileChangeMap: Map<string, Array<{ prNumber: number; title: string; mergedAt: Date; changeType: string }>>,
    recentPRs: Array<{ prNumber: number; title: string; mergedAt: Date | null }>,
    docSignals: { mentionsCount: number; keywords: string[] }
  ): Promise<DriftPredictionResult> {
    const now = new Date();
    const daysSinceUpdate = Math.floor((now.getTime() - doc.updatedAt.getTime()) / (24 * 60 * 60 * 1000));

    // Calculate individual signal scores (0-100 each)
    const staleDaysScore = this.calculateStaleDaysScore(daysSinceUpdate);
    const prActivityScore = this.calculatePRActivityScore(doc, fileChangeMap, recentPRs);
    const changeVelocityScore = this.calculateChangeVelocityScore(fileChangeMap);
    const relatedIssuesScore = docSignals.mentionsCount * 10; // 10 points per mention

    // Weighted combination for drift probability
    const weights = {
      stale: 0.25,
      prActivity: 0.35,
      velocity: 0.25,
      issues: 0.15,
    };

    const driftProbability = Math.min(100, Math.round(
      staleDaysScore * weights.stale +
      prActivityScore * weights.prActivity +
      changeVelocityScore * weights.velocity +
      relatedIssuesScore * weights.issues
    ));

    // Determine risk level
    const riskLevel = this.determineRiskLevel(driftProbability);

    // Find related PRs that might affect this document
    const relatedPRs = this.findRelatedPRs(doc, fileChangeMap, recentPRs);

    // Get affected files
    const affectedFiles = this.getAffectedFiles(doc, fileChangeMap);

    // Generate suggested actions
    const suggestedActions = this.generateSuggestedActions(
      doc,
      driftProbability,
      relatedPRs,
      affectedFiles
    );

    // Estimate effort
    const estimatedEffort = this.estimateEffort(driftProbability, affectedFiles.length);

    // Predict drift date (when probability might reach critical)
    const predictedDriftDate = this.predictDriftDate(driftProbability, daysSinceUpdate);

    return {
      documentPath: doc.path,
      documentId: doc.id,
      driftProbability,
      riskLevel,
      predictedDriftDate,
      signals: {
        prActivityScore,
        changeVelocityScore,
        staleDaysScore,
        relatedIssuesScore,
      },
      relatedPRs,
      affectedFiles,
      suggestedActions,
      estimatedEffort,
    };
  }

  private calculateStaleDaysScore(daysSinceUpdate: number): number {
    // Score increases with staleness
    if (daysSinceUpdate > 90) return 100;
    if (daysSinceUpdate > 60) return 80;
    if (daysSinceUpdate > 45) return 60;
    if (daysSinceUpdate > 30) return 40;
    if (daysSinceUpdate > 14) return 20;
    return 5;
  }

  private calculatePRActivityScore(
    doc: Document,
    fileChangeMap: Map<string, Array<{ prNumber: number; title: string; mergedAt: Date; changeType: string }>>,
    recentPRs: Array<{ prNumber: number; title: string; mergedAt: Date | null }>
  ): number {
    // Find code changes that happened after document was last updated
    let relevantChanges = 0;
    const docDir = doc.path.split('/').slice(0, -1).join('/');

    for (const [filePath, changes] of fileChangeMap.entries()) {
      // Check if file is in related directory
      const isRelated = this.isFileRelatedToDoc(filePath, doc);
      
      if (isRelated) {
        const changesAfterDoc = changes.filter(c => c.mergedAt > doc.updatedAt);
        relevantChanges += changesAfterDoc.length;
      }
    }

    // Score based on number of relevant changes
    return Math.min(100, relevantChanges * 15);
  }

  private calculateChangeVelocityScore(
    fileChangeMap: Map<string, Array<{ prNumber: number; title: string; mergedAt: Date; changeType: string }>>
  ): number {
    // Calculate overall code change velocity
    let totalChanges = 0;
    for (const changes of fileChangeMap.values()) {
      totalChanges += changes.length;
    }

    // Normalize to 0-100 scale
    return Math.min(100, totalChanges * 5);
  }

  private isFileRelatedToDoc(filePath: string, doc: Document): boolean {
    const docDir = doc.path.split('/').slice(0, -1).join('/');
    const fileDir = filePath.split('/').slice(0, -1).join('/');

    // Same directory
    if (docDir === fileDir) return true;

    // Related by naming (e.g., auth.ts related to auth.md)
    const docBaseName = doc.path.split('/').pop()?.replace(/\.(md|mdx)$/, '') || '';
    const fileBaseName = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || '';

    if (docBaseName && fileBaseName && docBaseName.includes(fileBaseName)) return true;
    if (docBaseName && fileBaseName && fileBaseName.includes(docBaseName)) return true;

    // API doc related to routes/api files
    if (doc.type === 'API_REFERENCE' && (filePath.includes('/api/') || filePath.includes('/routes/'))) {
      return true;
    }

    // Architecture doc related to core files
    if (doc.type === 'ARCHITECTURE' && (filePath.includes('/src/') || filePath.includes('/lib/'))) {
      return true;
    }

    return false;
  }

  private determineRiskLevel(probability: number): 'low' | 'medium' | 'high' | 'critical' {
    if (probability >= 80) return 'critical';
    if (probability >= 60) return 'high';
    if (probability >= 40) return 'medium';
    return 'low';
  }

  private findRelatedPRs(
    doc: Document,
    fileChangeMap: Map<string, Array<{ prNumber: number; title: string; mergedAt: Date; changeType: string }>>,
    recentPRs: Array<{ prNumber: number; title: string; mergedAt: Date | null }>
  ): Array<{ number: number; title: string; mergedAt: Date }> {
    const relatedPRNumbers = new Set<number>();

    for (const [filePath, changes] of fileChangeMap.entries()) {
      if (this.isFileRelatedToDoc(filePath, doc)) {
        for (const change of changes) {
          if (change.mergedAt > doc.updatedAt) {
            relatedPRNumbers.add(change.prNumber);
          }
        }
      }
    }

    return recentPRs
      .filter(pr => pr.mergedAt && relatedPRNumbers.has(pr.prNumber))
      .map(pr => ({
        number: pr.prNumber,
        title: pr.title,
        mergedAt: pr.mergedAt!,
      }))
      .slice(0, 10);
  }

  private getAffectedFiles(
    doc: Document,
    fileChangeMap: Map<string, Array<{ prNumber: number; title: string; mergedAt: Date; changeType: string }>>
  ): string[] {
    const affectedFiles: string[] = [];

    for (const [filePath, changes] of fileChangeMap.entries()) {
      if (this.isFileRelatedToDoc(filePath, doc)) {
        const recentChanges = changes.filter(c => c.mergedAt > doc.updatedAt);
        if (recentChanges.length > 0) {
          affectedFiles.push(filePath);
        }
      }
    }

    return affectedFiles.slice(0, 20);
  }

  private generateSuggestedActions(
    doc: Document,
    probability: number,
    relatedPRs: Array<{ number: number; title: string }>,
    affectedFiles: string[]
  ): string[] {
    const actions: string[] = [];

    if (probability >= 80) {
      actions.push('⚠️ URGENT: Review and update this documentation immediately');
    }

    if (relatedPRs.length > 0) {
      actions.push(`Review ${relatedPRs.length} related PR(s) for content that may need documenting`);
      const firstPR = relatedPRs[0];
      if (firstPR) {
        actions.push(`Check PR #${firstPR.number}: "${firstPR.title}"`);
      }
    }

    if (affectedFiles.length > 0) {
      if (affectedFiles.some(f => f.includes('/api/') || f.includes('/routes/'))) {
        actions.push('Update API endpoint documentation');
      }
      if (affectedFiles.some(f => f.includes('schema') || f.includes('model'))) {
        actions.push('Review data model documentation');
      }
      actions.push(`Verify code examples against ${affectedFiles.length} changed file(s)`);
    }

    if (doc.type === 'README') {
      actions.push('Verify installation and getting started instructions');
    }

    if (doc.type === 'API_REFERENCE') {
      actions.push('Regenerate OpenAPI documentation if available');
      actions.push('Test documented API examples');
    }

    return actions.slice(0, 5);
  }

  private estimateEffort(probability: number, affectedFilesCount: number): 'quick' | 'moderate' | 'substantial' {
    const totalScore = probability + (affectedFilesCount * 5);
    
    if (totalScore > 100) return 'substantial';
    if (totalScore > 50) return 'moderate';
    return 'quick';
  }

  private predictDriftDate(currentProbability: number, daysSinceUpdate: number): Date | null {
    if (currentProbability >= 80) {
      // Already critical - drift may have occurred
      return new Date();
    }

    // Estimate days until critical based on current trajectory
    const dailyIncrease = daysSinceUpdate > 0 ? currentProbability / daysSinceUpdate : 2;
    const daysUntilCritical = Math.ceil((80 - currentProbability) / Math.max(dailyIncrease, 0.5));

    const predictedDate = new Date();
    predictedDate.setDate(predictedDate.getDate() + Math.min(daysUntilCritical, this.PREDICTION_WINDOW_DAYS));

    return predictedDate;
  }

  private async storePredictions(repositoryId: string, predictions: DriftPredictionResult[]): Promise<void> {
    // Only store predictions with medium or higher risk
    const significantPredictions = predictions.filter(p => p.driftProbability >= 40);

    for (const prediction of significantPredictions) {
      try {
        const predictionId = `${repositoryId}-${prediction.documentPath}`.substring(0, 25);
        
        await db.driftPrediction.upsert({
          where: { id: predictionId },
          update: {
            driftProbability: prediction.driftProbability,
            riskLevel: prediction.riskLevel,
            predictedDriftDate: prediction.predictedDriftDate,
            prActivityScore: prediction.signals.prActivityScore,
            changeVelocityScore: prediction.signals.changeVelocityScore,
            staleDaysScore: prediction.signals.staleDaysScore,
            relatedIssuesScore: prediction.signals.relatedIssuesScore,
            relatedPRs: prediction.relatedPRs,
            affectedFiles: prediction.affectedFiles,
            suggestedActions: prediction.suggestedActions,
            estimatedEffort: prediction.estimatedEffort,
            updatedAt: new Date(),
          },
          create: {
            id: predictionId,
            repositoryId,
            documentId: prediction.documentId,
            documentPath: prediction.documentPath,
            driftProbability: prediction.driftProbability,
            riskLevel: prediction.riskLevel,
            predictedDriftDate: prediction.predictedDriftDate,
            prActivityScore: prediction.signals.prActivityScore,
            changeVelocityScore: prediction.signals.changeVelocityScore,
            staleDaysScore: prediction.signals.staleDaysScore,
            relatedIssuesScore: prediction.signals.relatedIssuesScore,
            relatedPRs: prediction.relatedPRs,
            affectedFiles: prediction.affectedFiles,
            suggestedActions: prediction.suggestedActions,
            estimatedEffort: prediction.estimatedEffort,
          },
        });
      } catch (error) {
        log.warn({ error, documentPath: prediction.documentPath }, 'Failed to store prediction');
      }
    }
  }

  async getRepositoryPredictions(repositoryId: string): Promise<DriftPrediction[]> {
    return db.driftPrediction.findMany({
      where: {
        repositoryId,
        status: 'active',
      },
      orderBy: { driftProbability: 'desc' },
    });
  }

  async acknowledgePrediction(predictionId: string, userId: string): Promise<void> {
    await db.driftPrediction.update({
      where: { id: predictionId },
      data: {
        status: 'acknowledged',
        acknowledgedBy: userId,
        acknowledgedAt: new Date(),
      },
    });
  }

  async resolvePrediction(predictionId: string): Promise<void> {
    await db.driftPrediction.update({
      where: { id: predictionId },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
      },
    });
  }

  async markAsFalsePositive(predictionId: string, userId: string): Promise<void> {
    await db.driftPrediction.update({
      where: { id: predictionId },
      data: {
        status: 'false_positive',
        acknowledgedBy: userId,
        acknowledgedAt: new Date(),
      },
    });
  }
}

export const driftPredictorService = new DriftPredictorService();
