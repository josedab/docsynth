/**
 * Documentation Quality Score Service
 *
 * AI-powered scoring system evaluating documentation on 8 dimensions:
 * completeness, clarity, accuracy, examples, tone, freshness, accessibility, searchability.
 */

import { prisma } from '@docsynth/database';
import { getAnthropicClient } from '@docsynth/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export type QualityDimension =
  | 'completeness'
  | 'clarity'
  | 'accuracy'
  | 'examples'
  | 'tone'
  | 'freshness'
  | 'accessibility'
  | 'searchability';

export interface DimensionScore {
  dimension: QualityDimension;
  score: number;
  maxScore: number;
  recommendations: string[];
}

export interface QualityRecommendation {
  dimension: QualityDimension;
  priority: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  autoFixable: boolean;
}

export interface QualityScoreResult {
  documentId: string;
  repositoryId: string;
  overallScore: number;
  dimensions: DimensionScore[];
  badge: 'bronze' | 'silver' | 'gold' | 'platinum';
  recommendations: QualityRecommendation[];
}

const ALL_DIMENSIONS: QualityDimension[] = [
  'completeness',
  'clarity',
  'accuracy',
  'examples',
  'tone',
  'freshness',
  'accessibility',
  'searchability',
];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Score a single document's quality across all 8 dimensions
 */
export async function scoreDocument(
  documentId: string,
  repositoryId: string
): Promise<QualityScoreResult> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { content: true, title: true, path: true, updatedAt: true, metadata: true },
  });

  if (!doc?.content) {
    return createEmptyScore(documentId, repositoryId);
  }

  const anthropic = getAnthropicClient();
  let dimensions: DimensionScore[];
  let recommendations: QualityRecommendation[];

  if (anthropic) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: `You are a documentation quality evaluator. Score documentation on 8 dimensions (1-10 each): completeness, clarity, accuracy, examples, tone, freshness, accessibility, searchability. Return ONLY valid JSON.`,
        messages: [
          {
            role: 'user',
            content: `Score this documentation:\n\nTitle: ${doc.title}\nPath: ${doc.path}\nLast updated: ${doc.updatedAt?.toISOString() || 'unknown'}\n\nContent:\n${doc.content.substring(0, 4000)}\n\nReturn: {"dimensions":[{"dimension":"completeness","score":7,"maxScore":10,"recommendations":["Add API reference section"]},...], "recommendations":[{"dimension":"completeness","priority":"high","title":"Missing API docs","description":"Add endpoint reference","autoFixable":false},...]}`,
          },
        ],
      });

      const text = response.content[0];
      if (text && text.type === 'text') {
        const match = (text as { type: 'text'; text: string }).text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          dimensions = parsed.dimensions || [];
          recommendations = parsed.recommendations || [];
        } else {
          ({ dimensions, recommendations } = heuristicScore(doc.content));
        }
      } else {
        ({ dimensions, recommendations } = heuristicScore(doc.content));
      }
    } catch {
      ({ dimensions, recommendations } = heuristicScore(doc.content));
    }
  } else {
    ({ dimensions, recommendations } = heuristicScore(doc.content));
  }

  // Ensure all 8 dimensions are present
  for (const dim of ALL_DIMENSIONS) {
    if (!dimensions.find((d) => d.dimension === dim)) {
      dimensions.push({ dimension: dim, score: 5, maxScore: 10, recommendations: [] });
    }
  }

  const overallScore = dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length;
  const badge = calculateBadge(overallScore);

  return { documentId, repositoryId, overallScore, dimensions, badge, recommendations };
}

/**
 * Score all documents in a repository
 */
export async function scoreRepository(repositoryId: string): Promise<QualityScoreResult[]> {
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true },
  });

  const results: QualityScoreResult[] = [];
  for (const doc of documents) {
    const score = await scoreDocument(doc.id, repositoryId);
    results.push(score);

    // Store score
    await db.docQualityScore.create({
      data: {
        documentId: doc.id,
        repositoryId,
        overallScore: score.overallScore,
        dimensions: score.dimensions,
        badge: score.badge,
        recommendations: score.recommendations,
      },
    });
  }

  return results;
}

/**
 * Get leaderboard for an organization
 */
export async function getQualityLeaderboard(organizationId: string, period: string = 'current') {
  return db.qualityLeaderboard.findMany({
    where: { organizationId, period },
    orderBy: { avgScore: 'desc' },
    take: 50,
  });
}

/**
 * Get quality history for a document
 */
export async function getDocumentQualityHistory(documentId: string, limit: number = 30) {
  return db.docQualityScore.findMany({
    where: { documentId },
    orderBy: { scoredAt: 'desc' },
    take: limit,
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

function heuristicScore(content: string): {
  dimensions: DimensionScore[];
  recommendations: QualityRecommendation[];
} {
  const lines = content.split('\n');
  const headings = lines.filter((l) => l.match(/^#{1,6}\s/));
  const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
  const links = content.match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];
  const wordCount = content.split(/\s+/).length;

  const dimensions: DimensionScore[] = [
    {
      dimension: 'completeness',
      score: Math.min(10, Math.round(wordCount / 200)),
      maxScore: 10,
      recommendations: wordCount < 200 ? ['Add more detail'] : [],
    },
    {
      dimension: 'clarity',
      score: Math.min(10, headings.length + 3),
      maxScore: 10,
      recommendations: headings.length < 3 ? ['Add section headings'] : [],
    },
    { dimension: 'accuracy', score: 7, maxScore: 10, recommendations: [] },
    {
      dimension: 'examples',
      score: Math.min(10, codeBlocks.length * 3),
      maxScore: 10,
      recommendations: codeBlocks.length === 0 ? ['Add code examples'] : [],
    },
    { dimension: 'tone', score: 7, maxScore: 10, recommendations: [] },
    {
      dimension: 'freshness',
      score: 6,
      maxScore: 10,
      recommendations: ['Verify content is up-to-date'],
    },
    {
      dimension: 'accessibility',
      score: links.length > 0 ? 7 : 4,
      maxScore: 10,
      recommendations: links.length === 0 ? ['Add cross-references'] : [],
    },
    {
      dimension: 'searchability',
      score: headings.length >= 3 ? 8 : 5,
      maxScore: 10,
      recommendations: headings.length < 3 ? ['Improve heading structure for discoverability'] : [],
    },
  ];

  const recommendations: QualityRecommendation[] = dimensions
    .filter((d) => d.recommendations.length > 0)
    .map((d) => ({
      dimension: d.dimension,
      priority:
        d.score < 4 ? ('high' as const) : d.score < 7 ? ('medium' as const) : ('low' as const),
      title: d.recommendations[0] || '',
      description: `Improve ${d.dimension} score (currently ${d.score}/10)`,
      autoFixable: false,
    }));

  return { dimensions, recommendations };
}

function calculateBadge(score: number): 'bronze' | 'silver' | 'gold' | 'platinum' {
  if (score >= 9) return 'platinum';
  if (score >= 7.5) return 'gold';
  if (score >= 5) return 'silver';
  return 'bronze';
}

function createEmptyScore(documentId: string, repositoryId: string): QualityScoreResult {
  return {
    documentId,
    repositoryId,
    overallScore: 0,
    dimensions: ALL_DIMENSIONS.map((d) => ({
      dimension: d,
      score: 0,
      maxScore: 10,
      recommendations: ['Document has no content'],
    })),
    badge: 'bronze',
    recommendations: [
      {
        dimension: 'completeness',
        priority: 'high',
        title: 'No content',
        description: 'Document has no content to evaluate',
        autoFixable: false,
      },
    ],
  };
}
