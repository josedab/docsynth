import type {
  DocHealthScore,
  RepositoryHealthSummary,
  DocumentType,
  Document,
} from '@docsynth/types';

export interface DocHealthInput {
  document: Document;
  repositoryLastActivity: Date | null;
  codeChangeDates: Date[];
  existingDocTypes: DocumentType[];
}

class DocHealthScorerService {
  calculateHealthScore(input: DocHealthInput): DocHealthScore {
    const { document, repositoryLastActivity, codeChangeDates } = input;

    const now = new Date();
    const docAge = now.getTime() - document.updatedAt.getTime();
    const daysSinceUpdate = Math.floor(docAge / (24 * 60 * 60 * 1000));

    // Calculate days since last code change
    const lastCodeChange = codeChangeDates.length > 0
      ? Math.max(...codeChangeDates.map(d => d.getTime()))
      : (repositoryLastActivity?.getTime() ?? now.getTime());
    const daysSinceCodeChange = Math.floor((now.getTime() - lastCodeChange) / (24 * 60 * 60 * 1000));

    // Analyze document content
    const contentAnalysis = this.analyzeContent(document.content);

    // Calculate individual scores
    const freshness = this.calculateFreshnessScore(daysSinceUpdate, daysSinceCodeChange);
    const completeness = this.calculateCompletenessScore(document, contentAnalysis);
    const accuracy = this.calculateAccuracyScore(daysSinceUpdate, daysSinceCodeChange);
    const readability = this.calculateReadabilityScore(contentAnalysis);

    // Weighted overall score
    const overall = Math.round(
      freshness * 0.30 +
      completeness * 0.25 +
      accuracy * 0.30 +
      readability * 0.15
    );

    // Determine status
    const status = overall >= 70 ? 'healthy' : overall >= 40 ? 'needs-attention' : 'critical';

    // Generate recommendations
    const recommendations = this.generateRecommendations({
      freshness,
      completeness,
      accuracy,
      readability,
      contentAnalysis,
      daysSinceUpdate,
    });

    return {
      documentId: document.id,
      repositoryId: document.repositoryId,
      path: document.path,
      type: document.type,
      scores: {
        freshness,
        completeness,
        accuracy,
        readability,
        overall,
      },
      factors: {
        daysSinceUpdate,
        daysSinceCodeChange,
        hasExamples: contentAnalysis.hasCodeBlocks,
        hasApiReference: contentAnalysis.hasApiSection,
        wordCount: contentAnalysis.wordCount,
        codeBlockCount: contentAnalysis.codeBlockCount,
      },
      status,
      recommendations,
      assessedAt: now,
    };
  }

  calculateRepositoryHealth(
    repositoryId: string,
    repositoryName: string,
    docScores: DocHealthScore[],
    existingDocTypes: DocumentType[]
  ): RepositoryHealthSummary {
    const documentCount = docScores.length;

    // Calculate overall score
    const overallScore = documentCount > 0
      ? Math.round(docScores.reduce((sum, d) => sum + d.scores.overall, 0) / documentCount)
      : 0;

    // Health distribution
    const healthDistribution = {
      healthy: docScores.filter(d => d.status === 'healthy').length,
      needsAttention: docScores.filter(d => d.status === 'needs-attention').length,
      critical: docScores.filter(d => d.status === 'critical').length,
    };

    // Coverage gaps
    const expectedDocTypes: DocumentType[] = ['README', 'API_REFERENCE', 'CHANGELOG', 'ARCHITECTURE'];
    const coverageGaps = expectedDocTypes.filter(t => !existingDocTypes.includes(t));

    // Top issues
    const topIssues: string[] = [];
    const avgFreshness = documentCount > 0
      ? docScores.reduce((sum, d) => sum + d.scores.freshness, 0) / documentCount
      : 100;

    if (avgFreshness < 50) {
      topIssues.push('Documentation is significantly outdated');
    }
    if (healthDistribution.critical > 0) {
      topIssues.push(`${healthDistribution.critical} document(s) need immediate attention`);
    }
    if (coverageGaps.length > 0) {
      topIssues.push(`Missing: ${coverageGaps.join(', ')}`);
    }

    // Trend (simplified - would need historical data for real implementation)
    const trend: 'improving' | 'stable' | 'declining' =
      avgFreshness >= 70 ? 'stable' : avgFreshness >= 40 ? 'stable' : 'declining';

    return {
      repositoryId,
      repositoryName,
      overallScore,
      documentCount,
      healthDistribution,
      coverageGaps,
      topIssues,
      trend,
    };
  }

  private analyzeContent(content: string): ContentAnalysis {
    const lines = content.split('\n');
    const words = content.split(/\s+/).filter(w => w.length > 0);

    // Count code blocks
    const codeBlockMatches = content.match(/```[\s\S]*?```/g) || [];
    const codeBlockCount = codeBlockMatches.length;

    // Check for sections
    const headings = lines.filter(l => l.startsWith('#'));
    const hasApiSection = headings.some(h =>
      /api|reference|endpoint|method|function/i.test(h)
    );
    const hasExamplesSection = headings.some(h =>
      /example|usage|getting started|quick start/i.test(h)
    );

    // Sentence count for readability
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);

    return {
      wordCount: words.length,
      sentenceCount: sentences.length,
      headingCount: headings.length,
      codeBlockCount,
      hasCodeBlocks: codeBlockCount > 0,
      hasApiSection,
      hasExamplesSection,
      averageWordsPerSentence: sentences.length > 0 ? words.length / sentences.length : 0,
    };
  }

  private calculateFreshnessScore(daysSinceUpdate: number, daysSinceCodeChange: number): number {
    // If doc is newer than code, it's fresh
    if (daysSinceUpdate <= daysSinceCodeChange) {
      return 100;
    }

    // Calculate staleness
    const driftDays = daysSinceUpdate - daysSinceCodeChange;

    if (driftDays <= 7) return 90;
    if (driftDays <= 14) return 75;
    if (driftDays <= 30) return 60;
    if (driftDays <= 60) return 40;
    if (driftDays <= 90) return 25;
    return 10;
  }

  private calculateCompletenessScore(document: Document, analysis: ContentAnalysis): number {
    let score = 50; // Base score

    // Word count scoring
    if (analysis.wordCount >= 500) score += 15;
    else if (analysis.wordCount >= 200) score += 10;
    else if (analysis.wordCount >= 100) score += 5;

    // Structure scoring
    if (analysis.headingCount >= 3) score += 10;
    else if (analysis.headingCount >= 1) score += 5;

    // Examples scoring
    if (analysis.hasCodeBlocks) score += 15;

    // Type-specific requirements
    if (document.type === 'API_REFERENCE' && analysis.hasApiSection) {
      score += 10;
    }
    if (document.type === 'TUTORIAL' && analysis.hasExamplesSection) {
      score += 10;
    }

    return Math.min(100, score);
  }

  private calculateAccuracyScore(daysSinceUpdate: number, daysSinceCodeChange: number): number {
    // Similar to freshness but weighted differently
    // Accuracy degrades faster when code changes happen
    const codeChangedAfterDoc = daysSinceCodeChange < daysSinceUpdate;

    if (!codeChangedAfterDoc) {
      return 95; // Code hasn't changed since doc was updated
    }

    const driftDays = daysSinceUpdate - daysSinceCodeChange;

    if (driftDays <= 3) return 85;
    if (driftDays <= 7) return 70;
    if (driftDays <= 14) return 55;
    if (driftDays <= 30) return 40;
    return 25;
  }

  private calculateReadabilityScore(analysis: ContentAnalysis): number {
    // Simplified Flesch-like scoring
    const avgWordsPerSentence = analysis.averageWordsPerSentence;

    let score = 70; // Base score

    // Optimal sentence length is 15-20 words
    if (avgWordsPerSentence >= 10 && avgWordsPerSentence <= 25) {
      score += 20;
    } else if (avgWordsPerSentence > 30) {
      score -= 20; // Too complex
    }

    // Good structure improves readability
    if (analysis.headingCount >= 3) score += 10;

    // Code examples help understanding
    if (analysis.hasCodeBlocks) score += 10;

    return Math.max(0, Math.min(100, score));
  }

  private generateRecommendations(params: {
    freshness: number;
    completeness: number;
    accuracy: number;
    readability: number;
    contentAnalysis: ContentAnalysis;
    daysSinceUpdate: number;
  }): string[] {
    const recommendations: string[] = [];

    if (params.freshness < 50) {
      recommendations.push('Update documentation to reflect recent code changes');
    }

    if (params.completeness < 60) {
      if (!params.contentAnalysis.hasCodeBlocks) {
        recommendations.push('Add code examples to improve clarity');
      }
      if (params.contentAnalysis.headingCount < 3) {
        recommendations.push('Add more section headings for better organization');
      }
      if (params.contentAnalysis.wordCount < 200) {
        recommendations.push('Expand documentation with more detail');
      }
    }

    if (params.accuracy < 50) {
      recommendations.push('Review documentation against current codebase for accuracy');
    }

    if (params.readability < 60) {
      if (params.contentAnalysis.averageWordsPerSentence > 25) {
        recommendations.push('Break long sentences into shorter ones for clarity');
      }
    }

    if (params.daysSinceUpdate > 90) {
      recommendations.push('Consider a comprehensive documentation review');
    }

    return recommendations;
  }
}

interface ContentAnalysis {
  wordCount: number;
  sentenceCount: number;
  headingCount: number;
  codeBlockCount: number;
  hasCodeBlocks: boolean;
  hasApiSection: boolean;
  hasExamplesSection: boolean;
  averageWordsPerSentence: number;
}

export const docHealthScorerService = new DocHealthScorerService();
