// ============================================================================
// Types
// ============================================================================

export type ChangeMagnitude = 'minor' | 'moderate' | 'major' | 'rewrite';

export interface TranslationChange {
  sectionId: string;
  oldContent: string;
  newContent: string;
  magnitude: ChangeMagnitude;
  changedLines: number;
  totalLines: number;
}

export interface StalenessInfo {
  sectionId: string;
  language: string;
  sourceUpdatedAt: Date;
  translationUpdatedAt: Date;
  staleDays: number;
  magnitude: ChangeMagnitude;
}

export interface StalenessReport {
  language: string;
  totalSections: number;
  staleSections: number;
  averageStaleDays: number;
  items: StalenessInfo[];
  generatedAt: string;
}

export interface TranslationPriority {
  sectionId: string;
  language: string;
  score: number;
  magnitude: ChangeMagnitude;
  staleDays: number;
}

interface DocumentVersion {
  sectionId: string;
  content: string;
}

interface TranslationRecord {
  sectionId: string;
  language: string;
  sourceUpdatedAt: Date;
  translationUpdatedAt: Date;
}

interface LanguageWeight {
  language: string;
  importance: number;
}

interface SectionTraffic {
  sectionId: string;
  dailyViews: number;
}

// ============================================================================
// Constants
// ============================================================================

const MAGNITUDE_THRESHOLDS = {
  minor: 0.1,
  moderate: 0.3,
  major: 0.6,
} as const;

const MAGNITUDE_WEIGHTS: Record<ChangeMagnitude, number> = {
  minor: 0.25,
  moderate: 0.5,
  major: 0.75,
  rewrite: 1.0,
};

// ============================================================================
// Functions
// ============================================================================

/** Detect changes between two versions of a document's sections. */
export function detectChanges(
  oldSections: DocumentVersion[],
  newSections: DocumentVersion[]
): TranslationChange[] {
  const oldMap = new Map(oldSections.map((s) => [s.sectionId, s.content]));
  const changes: TranslationChange[] = [];

  for (const section of newSections) {
    const oldContent = oldMap.get(section.sectionId);
    if (oldContent === undefined || oldContent === section.content) continue;

    const oldLines = oldContent.split('\n');
    const newLines = section.content.split('\n');
    const changedLines = countChangedLines(oldLines, newLines);
    const totalLines = Math.max(oldLines.length, newLines.length, 1);
    const ratio = changedLines / totalLines;
    const magnitude = classifyMagnitude(ratio);

    changes.push({
      sectionId: section.sectionId,
      oldContent,
      newContent: section.content,
      magnitude,
      changedLines,
      totalLines,
    });
  }

  return changes;
}

/** Calculate staleness for translations given source and translation timestamps. */
export function calculateStaleness(
  records: TranslationRecord[],
  changes: TranslationChange[]
): StalenessInfo[] {
  const changeMag = new Map(changes.map((c) => [c.sectionId, c.magnitude]));

  return records
    .filter((r) => r.sourceUpdatedAt > r.translationUpdatedAt)
    .map((r) => ({
      sectionId: r.sectionId,
      language: r.language,
      sourceUpdatedAt: r.sourceUpdatedAt,
      translationUpdatedAt: r.translationUpdatedAt,
      staleDays: daysBetween(r.translationUpdatedAt, r.sourceUpdatedAt),
      magnitude: changeMag.get(r.sectionId) ?? 'minor',
    }));
}

/** Prioritize translation updates by severity × traffic × language importance. */
export function prioritizeUpdates(
  staleItems: StalenessInfo[],
  traffic: SectionTraffic[],
  languageWeights: LanguageWeight[]
): TranslationPriority[] {
  const trafficMap = new Map(traffic.map((t) => [t.sectionId, t.dailyViews]));
  const langMap = new Map(languageWeights.map((l) => [l.language, l.importance]));

  const priorities: TranslationPriority[] = staleItems.map((item) => {
    const views = trafficMap.get(item.sectionId) ?? 1;
    const langWeight = langMap.get(item.language) ?? 0.5;
    const magWeight = MAGNITUDE_WEIGHTS[item.magnitude];
    const score = magWeight * normalizeTraffic(views) * langWeight;

    return {
      sectionId: item.sectionId,
      language: item.language,
      score: Math.round(score * 1000) / 1000,
      magnitude: item.magnitude,
      staleDays: item.staleDays,
    };
  });

  return priorities.sort((a, b) => b.score - a.score);
}

/** Generate a staleness report for a specific language. */
export function generateStalenessReport(
  language: string,
  staleItems: StalenessInfo[],
  totalSections: number
): StalenessReport {
  const langItems = staleItems.filter((i) => i.language === language);
  const avgDays =
    langItems.length > 0
      ? Math.round(langItems.reduce((s, i) => s + i.staleDays, 0) / langItems.length)
      : 0;

  return {
    language,
    totalSections,
    staleSections: langItems.length,
    averageStaleDays: avgDays,
    items: langItems,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function countChangedLines(oldLines: string[], newLines: string[]): number {
  const maxLen = Math.max(oldLines.length, newLines.length);
  let changed = 0;
  for (let i = 0; i < maxLen; i++) {
    if ((oldLines[i] ?? '') !== (newLines[i] ?? '')) changed++;
  }
  return changed;
}

function classifyMagnitude(ratio: number): ChangeMagnitude {
  if (ratio <= MAGNITUDE_THRESHOLDS.minor) return 'minor';
  if (ratio <= MAGNITUDE_THRESHOLDS.moderate) return 'moderate';
  if (ratio <= MAGNITUDE_THRESHOLDS.major) return 'major';
  return 'rewrite';
}

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(b.getTime() - a.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function normalizeTraffic(views: number): number {
  return Math.min(views / 1000, 1);
}
