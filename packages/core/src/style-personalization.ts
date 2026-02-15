// ============================================================================
// Types
// ============================================================================

export type ToneLevel = 'casual' | 'neutral' | 'formal';
export type VerbosityLevel = 'concise' | 'moderate' | 'verbose';
export type TechnicalDepth = 'beginner' | 'intermediate' | 'advanced';

export interface StyleDimensions {
  formality: number;
  verbosity: number;
  exampleDensity: number;
  technicalDepth: number;
}

export interface StyleProfile {
  dimensions: StyleDimensions;
  tone: ToneLevel;
  verbosityLevel: VerbosityLevel;
  technicalDepthLevel: TechnicalDepth;
  avgSentenceLength: number;
  avgParagraphLength: number;
  codeExampleRatio: number;
  generatedAt: string;
}

export interface StyleAdjustment {
  dimension: keyof StyleDimensions;
  current: number;
  target: number;
  suggestion: string;
}

export interface ConsistencyResult {
  score: number;
  adjustments: StyleAdjustment[];
}

// ============================================================================
// Analysis helpers
// ============================================================================

function countSentences(text: string): number {
  const matches = text.match(/[.!?]+\s/g);
  return (matches?.length ?? 0) + 1;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function countCodeBlocks(text: string): number {
  const matches = text.match(/```[\s\S]*?```/g);
  return matches?.length ?? 0;
}

function countParagraphs(text: string): number {
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
}

function measureFormality(text: string): number {
  const informal = /\b(you|we|let's|gonna|wanna|stuff|things|kinda|pretty much|basically)\b/gi;
  const formal =
    /\b(shall|therefore|furthermore|consequently|hereby|pursuant|whereas|henceforth)\b/gi;

  const informalCount = (text.match(informal) ?? []).length;
  const formalCount = (text.match(formal) ?? []).length;
  const total = countWords(text);

  if (total === 0) return 50;

  const informalRatio = informalCount / total;
  const formalRatio = formalCount / total;

  return Math.round(
    Math.min(Math.max((0.5 + formalRatio * 10 - informalRatio * 10) * 100, 0), 100)
  );
}

function measureVerbosity(text: string): number {
  const words = countWords(text);
  const sentences = countSentences(text);
  const avgSentenceLen = sentences > 0 ? words / sentences : 0;

  // Normalize: 5-8 words = concise (20), 15-20 = moderate (50), 25+ = verbose (80+)
  return Math.round(Math.min((avgSentenceLen / 30) * 100, 100));
}

function measureExampleDensity(text: string): number {
  const codeBlocks = countCodeBlocks(text);
  const paragraphs = countParagraphs(text);

  if (paragraphs === 0) return 0;
  return Math.round(Math.min((codeBlocks / paragraphs) * 100, 100));
}

function measureTechnicalDepth(text: string): number {
  const technical =
    /\b(algorithm|implementation|complexity|middleware|runtime|async|polymorphism|abstraction|interface|generic|decorator|dependency injection|concurrent)\b/gi;
  const words = countWords(text);
  if (words === 0) return 50;

  const techCount = (text.match(technical) ?? []).length;
  return Math.round(Math.min((techCount / words) * 500, 100));
}

function classifyTone(formality: number): ToneLevel {
  if (formality < 35) return 'casual';
  if (formality > 65) return 'formal';
  return 'neutral';
}

function classifyVerbosity(verbosity: number): VerbosityLevel {
  if (verbosity < 35) return 'concise';
  if (verbosity > 65) return 'verbose';
  return 'moderate';
}

function classifyTechnicalDepth(depth: number): TechnicalDepth {
  if (depth < 30) return 'beginner';
  if (depth > 60) return 'advanced';
  return 'intermediate';
}

// ============================================================================
// Core functions
// ============================================================================

/**
 * Analyze a collection of documentation texts to extract a style profile.
 */
export function analyzeStyle(documents: string[]): StyleProfile {
  if (documents.length === 0) {
    return {
      dimensions: { formality: 50, verbosity: 50, exampleDensity: 0, technicalDepth: 50 },
      tone: 'neutral',
      verbosityLevel: 'moderate',
      technicalDepthLevel: 'intermediate',
      avgSentenceLength: 0,
      avgParagraphLength: 0,
      codeExampleRatio: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  let totalFormality = 0;
  let totalVerbosity = 0;
  let totalExampleDensity = 0;
  let totalTechnicalDepth = 0;
  let totalSentenceLen = 0;
  let totalParagraphLen = 0;
  let totalCodeRatio = 0;

  for (const doc of documents) {
    totalFormality += measureFormality(doc);
    totalVerbosity += measureVerbosity(doc);
    totalExampleDensity += measureExampleDensity(doc);
    totalTechnicalDepth += measureTechnicalDepth(doc);

    const words = countWords(doc);
    const sentences = countSentences(doc);
    const paragraphs = countParagraphs(doc);
    const codeBlocks = countCodeBlocks(doc);

    totalSentenceLen += sentences > 0 ? words / sentences : 0;
    totalParagraphLen += paragraphs > 0 ? words / paragraphs : 0;
    totalCodeRatio += paragraphs > 0 ? codeBlocks / paragraphs : 0;
  }

  const n = documents.length;
  const dimensions: StyleDimensions = {
    formality: Math.round(totalFormality / n),
    verbosity: Math.round(totalVerbosity / n),
    exampleDensity: Math.round(totalExampleDensity / n),
    technicalDepth: Math.round(totalTechnicalDepth / n),
  };

  return {
    dimensions,
    tone: classifyTone(dimensions.formality),
    verbosityLevel: classifyVerbosity(dimensions.verbosity),
    technicalDepthLevel: classifyTechnicalDepth(dimensions.technicalDepth),
    avgSentenceLength: Math.round((totalSentenceLen / n) * 10) / 10,
    avgParagraphLength: Math.round((totalParagraphLen / n) * 10) / 10,
    codeExampleRatio: Math.round((totalCodeRatio / n) * 100) / 100,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Score how consistently a new document matches a team's style profile.
 * Returns 0-100 where 100 is perfectly consistent.
 */
export function scoreConsistency(document: string, profile: StyleProfile): number {
  const docDimensions: StyleDimensions = {
    formality: measureFormality(document),
    verbosity: measureVerbosity(document),
    exampleDensity: measureExampleDensity(document),
    technicalDepth: measureTechnicalDepth(document),
  };

  const keys: (keyof StyleDimensions)[] = [
    'formality',
    'verbosity',
    'exampleDensity',
    'technicalDepth',
  ];

  let totalDiff = 0;
  for (const key of keys) {
    totalDiff += Math.abs(docDimensions[key] - profile.dimensions[key]);
  }

  // Max diff per dimension is 100, 4 dimensions = 400
  const avgDiff = totalDiff / keys.length;
  return Math.round(Math.max(100 - avgDiff, 0));
}

/**
 * Suggest style adjustments to align a document with the team profile.
 */
export function suggestStyleAdjustments(
  document: string,
  profile: StyleProfile
): StyleAdjustment[] {
  const docDimensions: StyleDimensions = {
    formality: measureFormality(document),
    verbosity: measureVerbosity(document),
    exampleDensity: measureExampleDensity(document),
    technicalDepth: measureTechnicalDepth(document),
  };

  const adjustments: StyleAdjustment[] = [];
  const threshold = 15;

  const suggestions: Record<keyof StyleDimensions, { low: string; high: string }> = {
    formality: {
      low: 'Use more formal language; avoid casual phrasing.',
      high: 'Use a more conversational tone to match team style.',
    },
    verbosity: {
      low: 'Add more detail and explanation to match team style.',
      high: 'Shorten sentences and reduce wordiness.',
    },
    exampleDensity: {
      low: 'Add more code examples to match team documentation.',
      high: 'Reduce code examples; focus more on prose explanations.',
    },
    technicalDepth: {
      low: 'Increase technical detail to match team documentation.',
      high: 'Simplify technical language for broader audience.',
    },
  };

  for (const key of Object.keys(suggestions) as (keyof StyleDimensions)[]) {
    const diff = docDimensions[key] - profile.dimensions[key];
    if (Math.abs(diff) > threshold) {
      adjustments.push({
        dimension: key,
        current: docDimensions[key],
        target: profile.dimensions[key],
        suggestion: diff > 0 ? suggestions[key].high : suggestions[key].low,
      });
    }
  }

  return adjustments;
}
