/**
 * AI Doc Quality Benchmark Service
 *
 * Standardized scoring framework for evaluating generated documentation
 * across multiple quality dimensions. Supports custom suites, leaderboard
 * tracking, and external system comparisons.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-quality-benchmark-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface BenchmarkSuite {
  id: string;
  name: string;
  testCases: BenchmarkTestCase[];
  dimensions: string[];
}

export interface BenchmarkTestCase {
  id: string;
  codeSnippet: string;
  language: string;
  expectedDocQuality: number;
  humanBaseline: number;
}

export interface EvaluationResult {
  suiteId: string;
  scores: DimensionScore[];
  overallScore: number;
  comparedTo?: string;
}

export type BenchmarkDimension =
  | 'accuracy'
  | 'completeness'
  | 'readability'
  | 'examples'
  | 'structure'
  | 'tone'
  | 'depth'
  | 'freshness';

export interface DimensionScore {
  dimension: BenchmarkDimension;
  score: number;
  maxScore: number;
  details: string;
}

export interface LeaderboardEntry {
  systemName: string;
  overallScore: number;
  dimensionScores: DimensionScore[];
  evaluatedAt: Date;
  testCaseCount: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Evaluate a generated document against a benchmark suite.
 */
export async function evaluateDocument(
  repositoryId: string,
  documentId: string,
  suiteId?: string
): Promise<EvaluationResult> {
  const suite = suiteId ? await loadSuite(suiteId) : getDefaultSuite();

  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  log.info({ repositoryId, documentId, suiteId: suite.id }, 'Evaluating document quality');

  const content = document.content ?? '';

  const scores: DimensionScore[] = [];

  for (const dimension of suite.dimensions) {
    const dim = dimension as BenchmarkDimension;
    let score: DimensionScore;

    switch (dim) {
      case 'accuracy':
        score = scoreAccuracy(content, suite.testCases);
        break;
      case 'completeness':
        score = scoreCompleteness(content, suite.testCases);
        break;
      case 'readability':
        score = scoreReadability(content);
        break;
      case 'examples':
        score = scoreExamples(content);
        break;
      case 'structure':
        score = scoreStructure(content);
        break;
      case 'tone':
        score = scoreTone(content);
        break;
      case 'depth':
        score = scoreDepth(content, suite.testCases);
        break;
      case 'freshness':
        score = scoreFreshness(content);
        break;
      default:
        score = { dimension: dim, score: 0, maxScore: 10, details: 'Unknown dimension' };
    }

    scores.push(score);
  }

  const overallScore = computeOverall(scores);

  const result: EvaluationResult = {
    suiteId: suite.id,
    scores,
    overallScore,
  };

  await db.docBenchmarkResult.create({
    data: {
      repositoryId,
      documentId,
      suiteId: suite.id,
      overallScore,
      dimensionScores: JSON.parse(JSON.stringify(scores)),
      evaluatedAt: new Date(),
    },
  });

  log.info({ documentId, overallScore }, 'Document evaluation complete');
  return result;
}

/**
 * Return the built-in default benchmark suite.
 */
export function getDefaultSuite(): BenchmarkSuite {
  return {
    id: 'default-v1',
    name: 'DocSynth Default Benchmark Suite',
    testCases: [
      {
        id: 'tc-func-basic',
        codeSnippet: 'export function add(a: number, b: number): number { return a + b; }',
        language: 'typescript',
        expectedDocQuality: 8,
        humanBaseline: 9,
      },
      {
        id: 'tc-class-complex',
        codeSnippet:
          'export class UserService { async findById(id: string): Promise<User | null> { ... } }',
        language: 'typescript',
        expectedDocQuality: 7,
        humanBaseline: 8,
      },
      {
        id: 'tc-interface',
        codeSnippet: 'export interface Config { host: string; port: number; ssl?: boolean; }',
        language: 'typescript',
        expectedDocQuality: 8,
        humanBaseline: 9,
      },
    ],
    dimensions: [
      'accuracy',
      'completeness',
      'readability',
      'examples',
      'structure',
      'tone',
      'depth',
      'freshness',
    ],
  };
}

/**
 * List all available benchmark suites.
 */
export async function listSuites(): Promise<BenchmarkSuite[]> {
  const stored = await db.docBenchmarkSuite.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const suites: BenchmarkSuite[] = stored.map((s: any) => ({
    id: s.id,
    name: s.name,
    testCases: (s.testCases as BenchmarkTestCase[]) ?? [],
    dimensions: (s.dimensions as string[]) ?? [],
  }));

  suites.unshift(getDefaultSuite());
  return suites;
}

/**
 * Get the leaderboard of evaluated systems.
 */
export async function getLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
  const results = await db.docBenchmarkLeaderboard.findMany({
    orderBy: { overallScore: 'desc' },
    take: limit,
  });

  return results.map((r: any) => ({
    systemName: r.systemName,
    overallScore: r.overallScore,
    dimensionScores: (r.dimensionScores as DimensionScore[]) ?? [],
    evaluatedAt: r.evaluatedAt,
    testCaseCount: r.testCaseCount ?? 0,
  }));
}

/**
 * Submit results from an external documentation system for comparison.
 */
export async function submitExternalResult(
  systemName: string,
  scores: DimensionScore[]
): Promise<LeaderboardEntry> {
  const overallScore = computeOverall(scores);

  const entry: LeaderboardEntry = {
    systemName,
    overallScore,
    dimensionScores: scores,
    evaluatedAt: new Date(),
    testCaseCount: scores.length,
  };

  await db.docBenchmarkLeaderboard.upsert({
    where: { systemName },
    create: {
      systemName,
      overallScore,
      dimensionScores: JSON.parse(JSON.stringify(scores)),
      evaluatedAt: entry.evaluatedAt,
      testCaseCount: entry.testCaseCount,
    },
    update: {
      overallScore,
      dimensionScores: JSON.parse(JSON.stringify(scores)),
      evaluatedAt: entry.evaluatedAt,
      testCaseCount: entry.testCaseCount,
    },
  });

  log.info({ systemName, overallScore }, 'External result submitted to leaderboard');
  return entry;
}

// ============================================================================
// Helpers
// ============================================================================

async function loadSuite(suiteId: string): Promise<BenchmarkSuite> {
  if (suiteId === 'default-v1') {
    return getDefaultSuite();
  }

  const stored = await db.docBenchmarkSuite.findUnique({ where: { id: suiteId } });
  if (!stored) {
    throw new Error(`Benchmark suite not found: ${suiteId}`);
  }

  return {
    id: stored.id,
    name: stored.name,
    testCases: (stored.testCases as BenchmarkTestCase[]) ?? [],
    dimensions: (stored.dimensions as string[]) ?? [],
  };
}

function scoreAccuracy(content: string, testCases: BenchmarkTestCase[]): DimensionScore {
  let score = 5;
  const lower = content.toLowerCase();
  if (lower.includes('param') || lower.includes('parameter')) score += 1;
  if (lower.includes('return')) score += 1;
  if (lower.includes('throw') || lower.includes('error')) score += 1;
  if (testCases.length > 0 && lower.length > 100) score += 1;
  if (lower.includes('example') || lower.includes('usage')) score += 1;
  return {
    dimension: 'accuracy',
    score: Math.min(score, 10),
    maxScore: 10,
    details: 'Checks param/return/error mentions',
  };
}

function scoreCompleteness(content: string, testCases: BenchmarkTestCase[]): DimensionScore {
  let score = 4;
  if (/\bparam(eter)?s?\b/i.test(content)) score += 2;
  if (/\breturns?\b/i.test(content)) score += 1;
  if (content.length > 50) score += 1;
  if (/@since|@version/i.test(content)) score += 1;
  if (/example|```/i.test(content)) score += 1;
  if (testCases.length === 0) score = Math.max(score - 2, 0);
  return {
    dimension: 'completeness',
    score: Math.min(score, 10),
    maxScore: 10,
    details: 'Evaluates API surface coverage',
  };
}

function scoreReadability(content: string): DimensionScore {
  let score = 6;
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const avgWords =
    sentences.length > 0
      ? sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length
      : 0;
  if (avgWords > 5 && avgWords < 25) score += 2;
  if (sentences.length >= 2) score += 1;
  if (content.length < 5000) score += 1;
  return {
    dimension: 'readability',
    score: Math.min(score, 10),
    maxScore: 10,
    details: `Avg ${Math.round(avgWords)} words/sentence`,
  };
}

function scoreExamples(content: string): DimensionScore {
  let score = 3;
  const codeBlocks = (content.match(/```[\s\S]*?```/g) ?? []).length;
  const inlineCode = (content.match(/`[^`]+`/g) ?? []).length;
  if (codeBlocks >= 1) score += 3;
  if (codeBlocks >= 2) score += 1;
  if (inlineCode >= 3) score += 1;
  if (/output|result|returns/i.test(content)) score += 1;
  return {
    dimension: 'examples',
    score: Math.min(score, 10),
    maxScore: 10,
    details: `${codeBlocks} code blocks`,
  };
}

function scoreStructure(content: string): DimensionScore {
  let score = 4;
  const headings = (content.match(/^#{1,6}\s/gm) ?? []).length;
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0).length;
  if (headings >= 2) score += 2;
  if (paragraphs >= 3) score += 2;
  if (headings > 0 && paragraphs > headings) score += 1;
  return {
    dimension: 'structure',
    score: Math.min(score, 10),
    maxScore: 10,
    details: `${headings} headings, ${paragraphs} paragraphs`,
  };
}

function scoreTone(content: string): DimensionScore {
  let score = 7;
  const lower = content.toLowerCase();
  const casualMarkers = ['lol', 'gonna', 'wanna', 'kinda', 'btw', 'tbh'];
  const casualCount = casualMarkers.filter((m) => lower.includes(m)).length;
  if (casualCount > 0) score -= Math.min(casualCount * 2, 4);
  if (lower.includes('please') || lower.includes('note that')) score += 1;
  if (/\b(you|your)\b/.test(lower)) score += 1;
  return {
    dimension: 'tone',
    score: Math.max(Math.min(score, 10), 0),
    maxScore: 10,
    details: 'Professional tone evaluation',
  };
}

function scoreDepth(content: string, testCases: BenchmarkTestCase[]): DimensionScore {
  let score = 4;
  if (content.length > 200) score += 1;
  if (content.length > 500) score += 1;
  if (content.length > 1000) score += 1;
  if (/edge case|corner case|caveat|limitation/i.test(content)) score += 1;
  if (/performance|complexity|O\(/i.test(content)) score += 1;
  if (testCases.length > 0) score += 1;
  return {
    dimension: 'depth',
    score: Math.min(score, 10),
    maxScore: 10,
    details: `Content length: ${content.length} chars`,
  };
}

function scoreFreshness(content: string): DimensionScore {
  let score = 5;
  if (/\d{4}-\d{2}-\d{2}/.test(content)) score += 2;
  if (/@since|@version|v\d+\.\d+/i.test(content)) score += 1;
  if (/updated|last modified|changelog/i.test(content)) score += 1;
  return {
    dimension: 'freshness',
    score: Math.min(score, 10),
    maxScore: 10,
    details: 'Checks temporal markers',
  };
}

/**
 * Compute weighted overall score from individual dimension scores.
 */
function computeOverall(scores: DimensionScore[]): number {
  if (scores.length === 0) return 0;

  const weights: Record<string, number> = {
    accuracy: 2.0,
    completeness: 1.5,
    readability: 1.5,
    examples: 1.0,
    structure: 1.0,
    tone: 0.5,
    depth: 1.0,
    freshness: 0.5,
  };

  let totalWeight = 0;
  let weightedSum = 0;

  for (const s of scores) {
    const w = weights[s.dimension] ?? 1.0;
    weightedSum += (s.score / s.maxScore) * w;
    totalWeight += w;
  }

  return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : 0;
}
