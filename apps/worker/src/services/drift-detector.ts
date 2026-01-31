import { prisma } from '@docsynth/database';
import { GitHubClient } from '@docsynth/github';
import { createLogger } from '@docsynth/utils';
import type { DriftDetectionResult, DriftType, Document } from '@docsynth/types';

const log = createLogger('drift-detector-service');

export interface DriftScanResult {
  repositoryId: string;
  repositoryName: string;
  scannedAt: Date;
  documentsScanned: number;
  driftsDetected: DriftDetectionResult[];
  summary: {
    healthy: number;
    minorDrift: number;
    majorDrift: number;
    criticalDrift: number;
  };
}

class DriftDetectorService {
  async scanRepository(
    repositoryId: string,
    installationId: number,
    owner: string,
    repo: string
  ): Promise<DriftScanResult> {
    log.info({ repositoryId, owner, repo }, 'Starting drift scan');

    const client = GitHubClient.forInstallation(installationId);

    // Get repository and documents
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      include: {
        documents: true,
      },
    });

    if (!repository) {
      throw new Error(`Repository not found: ${repositoryId}`);
    }

    // Get recent commits to understand code changes
    const recentPRs = await prisma.pREvent.findMany({
      where: {
        repositoryId,
        mergedAt: { not: null },
      },
      orderBy: { mergedAt: 'desc' },
      take: 50,
    });

    // Get file changes from recent PRs
    const recentCodeChanges = await this.getRecentCodeChanges(
      client,
      owner,
      repo,
      recentPRs.slice(0, 10)
    );

    // Analyze each document for drift
    const drifts: DriftDetectionResult[] = [];

    for (const doc of repository.documents) {
      const drift = await this.analyzeDocumentDrift(
        doc,
        recentCodeChanges,
        recentPRs.map(pr => pr.mergedAt!).filter(Boolean)
      );

      if (drift.driftScore > 20) {
        drifts.push(drift);
      }
    }

    // Calculate summary
    const summary = {
      healthy: repository.documents.length - drifts.length,
      minorDrift: drifts.filter(d => d.driftScore >= 20 && d.driftScore < 40).length,
      majorDrift: drifts.filter(d => d.driftScore >= 40 && d.driftScore < 70).length,
      criticalDrift: drifts.filter(d => d.driftScore >= 70).length,
    };

    log.info(
      { repositoryId, documentsScanned: repository.documents.length, driftsFound: drifts.length },
      'Drift scan complete'
    );

    return {
      repositoryId,
      repositoryName: repository.name,
      scannedAt: new Date(),
      documentsScanned: repository.documents.length,
      driftsDetected: drifts.sort((a, b) => b.driftScore - a.driftScore),
      summary,
    };
  }

  private async getRecentCodeChanges(
    client: GitHubClient,
    owner: string,
    repo: string,
    recentPRs: { prNumber: number; title: string; mergedAt: Date | null }[]
  ): Promise<Map<string, { file: string; changeType: string; date: Date }[]>> {
    const changesByFile = new Map<string, { file: string; changeType: string; date: Date }[]>();

    for (const pr of recentPRs) {
      if (!pr.mergedAt) continue;

      try {
        const files = await client.getPullRequestFiles(owner, repo, pr.prNumber);

        for (const file of files) {
          const existing = changesByFile.get(file.filename) || [];
          existing.push({
            file: file.filename,
            changeType: file.status,
            date: pr.mergedAt,
          });
          changesByFile.set(file.filename, existing);
        }
      } catch (error) {
        log.warn({ prNumber: pr.prNumber, error }, 'Failed to get PR files');
      }
    }

    return changesByFile;
  }

  private async analyzeDocumentDrift(
    doc: Document,
    codeChanges: Map<string, { file: string; changeType: string; date: Date }[]>,
    _codeChangeDates: Date[]
  ): Promise<DriftDetectionResult> {
    const now = new Date();
    const docAge = now.getTime() - doc.updatedAt.getTime();
    const daysSinceDocUpdate = Math.floor(docAge / (24 * 60 * 60 * 1000));

    // Find code changes that happened after doc was last updated
    const changesAfterDoc = Array.from(codeChanges.entries())
      .flatMap(([, changes]) => changes)
      .filter(change => change.date.getTime() > doc.updatedAt.getTime());

    // Determine drift type based on analysis
    const driftAnalysis = this.analyzeDriftType(doc, changesAfterDoc, daysSinceDocUpdate);

    // Calculate drift score
    const driftScore = this.calculateDriftScore(
      daysSinceDocUpdate,
      changesAfterDoc.length,
      driftAnalysis.type
    );

    // Generate suggested actions
    const suggestedActions = this.generateSuggestedActions(
      driftAnalysis.type,
      driftScore,
      changesAfterDoc.length
    );

    return {
      documentId: doc.id,
      documentPath: doc.path,
      repositoryId: doc.repositoryId,
      driftScore,
      driftType: driftAnalysis.type,
      affectedSections: driftAnalysis.affectedSections,
      relatedCodeChanges: changesAfterDoc.slice(0, 10),
      suggestedActions,
      detectedAt: now,
    };
  }

  private analyzeDriftType(
    doc: Document,
    changesAfterDoc: { file: string; changeType: string; date: Date }[],
    daysSinceDocUpdate: number
  ): { type: DriftType; affectedSections: string[] } {
    const affectedSections: string[] = [];

    // Check for new API files that might need documentation
    const newApiFiles = changesAfterDoc.filter(
      c => c.changeType === 'added' &&
        (c.file.includes('/api/') || c.file.includes('/routes/') || c.file.endsWith('.ts'))
    );

    if (newApiFiles.length > 0 && doc.type === 'API_REFERENCE') {
      affectedSections.push('API Reference', 'Endpoints');
      return { type: 'missing-api', affectedSections };
    }

    // Check for removed files (potential deprecated references)
    const removedFiles = changesAfterDoc.filter(c => c.changeType === 'removed');
    if (removedFiles.length > 0) {
      const docContent = doc.content.toLowerCase();
      const hasReferences = removedFiles.some(f => 
        docContent.includes(f.file.split('/').pop()?.toLowerCase() ?? '')
      );
      if (hasReferences) {
        affectedSections.push('References to deleted files');
        return { type: 'deprecated-reference', affectedSections };
      }
    }

    // Check for structural changes
    const significantChanges = changesAfterDoc.filter(
      c => c.file.includes('/src/') || c.file.includes('/lib/')
    );
    if (significantChanges.length > 5 && doc.type === 'ARCHITECTURE') {
      affectedSections.push('Architecture Overview', 'Component Structure');
      return { type: 'structural-mismatch', affectedSections };
    }

    // Default: content outdated
    if (daysSinceDocUpdate > 30 && changesAfterDoc.length > 0) {
      affectedSections.push('General content');
      return { type: 'content-outdated', affectedSections };
    }

    return { type: 'content-outdated', affectedSections: [] };
  }

  private calculateDriftScore(
    daysSinceDocUpdate: number,
    changesAfterDoc: number,
    driftType: DriftType
  ): number {
    let score = 0;

    // Time-based scoring
    if (daysSinceDocUpdate > 90) score += 40;
    else if (daysSinceDocUpdate > 60) score += 30;
    else if (daysSinceDocUpdate > 30) score += 20;
    else if (daysSinceDocUpdate > 14) score += 10;

    // Change-based scoring
    score += Math.min(40, changesAfterDoc * 4);

    // Drift type severity
    const typeScores: Record<DriftType, number> = {
      'missing-api': 20,
      'deprecated-reference': 25,
      'structural-mismatch': 15,
      'content-outdated': 10,
      'terminology-drift': 5,
    };
    score += typeScores[driftType] || 0;

    return Math.min(100, score);
  }

  private generateSuggestedActions(
    driftType: DriftType,
    driftScore: number,
    changeCount: number
  ): string[] {
    const actions: string[] = [];

    switch (driftType) {
      case 'missing-api':
        actions.push('Add documentation for new API endpoints');
        actions.push('Update API reference with new functions/methods');
        break;
      case 'deprecated-reference':
        actions.push('Remove references to deleted files/functions');
        actions.push('Update examples that use deprecated code');
        break;
      case 'structural-mismatch':
        actions.push('Update architecture diagrams');
        actions.push('Review and update component descriptions');
        break;
      case 'content-outdated':
        actions.push('Review content for accuracy');
        actions.push('Update examples to match current code');
        break;
      case 'terminology-drift':
        actions.push('Standardize terminology across documentation');
        actions.push('Create or update glossary');
        break;
    }

    if (driftScore >= 70) {
      actions.unshift('⚠️ PRIORITY: This documentation needs immediate attention');
    }

    if (changeCount > 10) {
      actions.push('Consider a comprehensive documentation review');
    }

    return actions;
  }

  async scanAllRepositories(organizationId: string): Promise<DriftScanResult[]> {
    const repositories = await prisma.repository.findMany({
      where: {
        organizationId,
        enabled: true,
      },
    });

    const results: DriftScanResult[] = [];

    for (const repo of repositories) {
      try {
        // Parse owner/repo from fullName
        const [owner, repoName] = repo.githubFullName.split('/');
        if (!owner || !repoName) continue;

        const result = await this.scanRepository(
          repo.id,
          repo.installationId,
          owner,
          repoName
        );
        results.push(result);
      } catch (error) {
        log.error({ repositoryId: repo.id, error }, 'Failed to scan repository');
      }
    }

    return results;
  }
}

export const driftDetectorService = new DriftDetectorService();
