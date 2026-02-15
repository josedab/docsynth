// ============================================================================
// Types
// ============================================================================

export type SuggestionType =
  | 'docstring'
  | 'readme'
  | 'changelog'
  | 'api-reference'
  | 'tutorial'
  | 'example';

export type FeedbackAction = 'accepted' | 'rejected' | 'modified';

export interface SuggestionFeedback {
  id: string;
  suggestionType: SuggestionType;
  action: FeedbackAction;
  originalText: string;
  modifiedText?: string;
  userId: string;
  timestamp: string;
}

export interface TypeAcceptanceRate {
  type: SuggestionType;
  total: number;
  accepted: number;
  rejected: number;
  modified: number;
  rate: number;
}

export interface CommonModification {
  pattern: string;
  frequency: number;
  exampleOriginal: string;
  exampleModified: string;
}

export interface SuggestionProfile {
  userId: string;
  acceptanceRates: TypeAcceptanceRate[];
  preferredTypes: SuggestionType[];
  commonModifications: CommonModification[];
  overallAcceptanceRate: number;
  totalFeedback: number;
  generatedAt: string;
}

// ============================================================================
// Feedback storage (in-memory)
// ============================================================================

const feedbackStore: SuggestionFeedback[] = [];

// ============================================================================
// Core functions
// ============================================================================

export function recordFeedback(feedback: SuggestionFeedback): void {
  feedbackStore.push({ ...feedback });
}

export function getFeedbackStore(): readonly SuggestionFeedback[] {
  return feedbackStore;
}

export function clearFeedbackStore(): void {
  feedbackStore.length = 0;
}

/**
 * Calculate acceptance rate for each suggestion type from a list of feedback.
 */
export function calculateAcceptanceRates(
  feedback: readonly SuggestionFeedback[]
): TypeAcceptanceRate[] {
  const grouped = new Map<SuggestionType, SuggestionFeedback[]>();

  for (const fb of feedback) {
    const list = grouped.get(fb.suggestionType) ?? [];
    list.push(fb);
    grouped.set(fb.suggestionType, list);
  }

  const rates: TypeAcceptanceRate[] = [];
  for (const [type, items] of grouped) {
    const accepted = items.filter((f) => f.action === 'accepted').length;
    const rejected = items.filter((f) => f.action === 'rejected').length;
    const modified = items.filter((f) => f.action === 'modified').length;
    const total = items.length;

    rates.push({
      type,
      total,
      accepted,
      rejected,
      modified,
      rate: total > 0 ? (accepted + modified) / total : 0,
    });
  }

  return rates.sort((a, b) => b.rate - a.rate);
}

/**
 * Identify common modification patterns across feedback entries.
 */
export function identifyCommonModifications(
  feedback: readonly SuggestionFeedback[]
): CommonModification[] {
  const modified = feedback.filter((f) => f.action === 'modified' && f.modifiedText);

  const patterns = new Map<string, { count: number; original: string; modified: string }>();

  for (const fb of modified) {
    const original = fb.originalText;
    const mod = fb.modifiedText!;
    const pattern = detectModificationPattern(original, mod);

    const existing = patterns.get(pattern);
    if (existing) {
      existing.count++;
    } else {
      patterns.set(pattern, { count: 1, original, modified: mod });
    }
  }

  return Array.from(patterns.entries())
    .map(([pattern, data]) => ({
      pattern,
      frequency: data.count,
      exampleOriginal: data.original,
      exampleModified: data.modified,
    }))
    .sort((a, b) => b.frequency - a.frequency);
}

function detectModificationPattern(original: string, modified: string): string {
  const origLen = original.length;
  const modLen = modified.length;

  if (modLen < origLen * 0.7) return 'shortened';
  if (modLen > origLen * 1.3) return 'expanded';

  const origLower = original.toLowerCase();
  const modLower = modified.toLowerCase();
  if (origLower === modLower && original !== modified) return 'case-adjusted';

  if (modified.includes('```') && !original.includes('```')) return 'added-code-example';
  if (modified.includes('@param') && !original.includes('@param')) return 'added-params';
  if (modified.includes('@returns') && !original.includes('@returns')) return 'added-returns';

  return 'rephrased';
}

/**
 * Build a preference profile for a user based on their feedback history.
 */
export function buildProfile(
  userId: string,
  feedback: readonly SuggestionFeedback[]
): SuggestionProfile {
  const userFeedback = feedback.filter((f) => f.userId === userId);
  const acceptanceRates = calculateAcceptanceRates(userFeedback);
  const commonModifications = identifyCommonModifications(userFeedback);

  const totalAccepted = userFeedback.filter((f) => f.action === 'accepted').length;
  const totalModified = userFeedback.filter((f) => f.action === 'modified').length;
  const total = userFeedback.length;

  const preferredTypes = acceptanceRates.filter((r) => r.rate >= 0.6).map((r) => r.type);

  return {
    userId,
    acceptanceRates,
    preferredTypes,
    commonModifications,
    overallAcceptanceRate: total > 0 ? (totalAccepted + totalModified) / total : 0,
    totalFeedback: total,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Score a suggestion based on historical acceptance rates for its type.
 */
export function scoreSuggestion(
  suggestionType: SuggestionType,
  feedback: readonly SuggestionFeedback[]
): number {
  const rates = calculateAcceptanceRates(feedback);
  const typeRate = rates.find((r) => r.type === suggestionType);

  if (!typeRate || typeRate.total === 0) return 50;

  const baseScore = typeRate.rate * 100;
  const confidenceBonus = Math.min(typeRate.total / 20, 1) * 10;

  return Math.round(Math.min(baseScore + confidenceBonus, 100));
}
