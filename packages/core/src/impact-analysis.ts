// ============================================================================
// Types
// ============================================================================

export type ChangeClassification =
  | 'breaking'
  | 'deprecation'
  | 'enhancement'
  | 'bugfix'
  | 'internal';

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface CodeEntity {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable';
  filePath: string;
}

export interface DocSection {
  id: string;
  title: string;
  path: string;
  /** Average daily page views */
  traffic?: number;
}

export interface CodeDocMapping {
  entity: CodeEntity;
  sections: DocSection[];
}

export interface ChangeEntry {
  entity: CodeEntity;
  classification: ChangeClassification;
  diff?: string;
}

export interface ImpactResult {
  section: DocSection;
  score: number;
  severity: SeverityLevel;
  changes: ChangeEntry[];
}

export interface BatchImpactReport {
  results: ImpactResult[];
  totalChanges: number;
  summary: string;
  generatedAt: string;
}

// ============================================================================
// Constants
// ============================================================================

const CLASSIFICATION_WEIGHTS: Record<ChangeClassification, number> = {
  breaking: 1.0,
  deprecation: 0.8,
  enhancement: 0.5,
  bugfix: 0.3,
  internal: 0.1,
};

const SEVERITY_THRESHOLDS: { min: number; level: SeverityLevel }[] = [
  { min: 80, level: 'critical' },
  { min: 60, level: 'high' },
  { min: 30, level: 'medium' },
  { min: 0, level: 'low' },
];

const BREAKING_PATTERNS = [
  /removed?\s+(export|function|class|interface|type)\b/i,
  /\bBREAKING\b/,
  /renamed?\s+(export|function|class|interface)\b/i,
  /changed?\s+(signature|return\s+type|parameter)/i,
];

const DEPRECATION_PATTERNS = [/@deprecated/i, /\bdeprecate[ds]?\b/i];

const BUGFIX_PATTERNS = [/\bfix(es|ed)?\b/i, /\bbug\b/i, /\bpatch\b/i];

const ENHANCEMENT_PATTERNS = [
  /\badd(s|ed)?\b/i,
  /\bnew\s+(feature|export|function|method)\b/i,
  /\benhance/i,
];

// ============================================================================
// Code-to-Doc Mapping
// ============================================================================

/**
 * Create a mapping between a code entity and the doc sections it relates to.
 */
export function createCodeDocMapping(entity: CodeEntity, sections: DocSection[]): CodeDocMapping {
  return { entity, sections };
}

/**
 * Find all doc sections affected by a set of code changes using the mappings.
 */
export function findAffectedSections(
  changes: ChangeEntry[],
  mappings: CodeDocMapping[]
): DocSection[] {
  const sectionMap = new Map<string, DocSection>();

  for (const change of changes) {
    for (const mapping of mappings) {
      if (
        mapping.entity.name === change.entity.name &&
        mapping.entity.filePath === change.entity.filePath
      ) {
        for (const section of mapping.sections) {
          sectionMap.set(section.id, section);
        }
      }
    }
  }

  return Array.from(sectionMap.values());
}

// ============================================================================
// Impact Scoring
// ============================================================================

/**
 * Calculate an impact score (0–100) for a set of changes on a single doc section.
 */
export function calculateImpactScore(changes: ChangeEntry[]): number {
  if (changes.length === 0) return 0;

  const weightedSum = changes.reduce((sum, c) => sum + CLASSIFICATION_WEIGHTS[c.classification], 0);

  const maxPossible = changes.length; // all breaking = 1.0 each
  const raw = (weightedSum / maxPossible) * 100;

  return Math.min(100, Math.round(raw));
}

/**
 * Derive a severity level from an impact score.
 */
export function scoreSeverity(score: number): SeverityLevel {
  for (const threshold of SEVERITY_THRESHOLDS) {
    if (score >= threshold.min) return threshold.level;
  }
  return 'low';
}

// ============================================================================
// Change Classification
// ============================================================================

/**
 * Classify a code change based on its diff content.
 */
export function classifyChange(diff: string): ChangeClassification {
  if (BREAKING_PATTERNS.some((p) => p.test(diff))) return 'breaking';
  if (DEPRECATION_PATTERNS.some((p) => p.test(diff))) return 'deprecation';
  if (BUGFIX_PATTERNS.some((p) => p.test(diff))) return 'bugfix';
  if (ENHANCEMENT_PATTERNS.some((p) => p.test(diff))) return 'enhancement';
  return 'internal';
}

// ============================================================================
// Batch Impact Report
// ============================================================================

/**
 * Generate a batch impact report summarising multiple changes across doc sections.
 */
export function generateBatchImpactReport(
  changes: ChangeEntry[],
  mappings: CodeDocMapping[]
): BatchImpactReport {
  const sectionChanges = new Map<string, { section: DocSection; changes: ChangeEntry[] }>();

  for (const change of changes) {
    for (const mapping of mappings) {
      if (
        mapping.entity.name === change.entity.name &&
        mapping.entity.filePath === change.entity.filePath
      ) {
        for (const section of mapping.sections) {
          const existing = sectionChanges.get(section.id);
          if (existing) {
            existing.changes.push(change);
          } else {
            sectionChanges.set(section.id, { section, changes: [change] });
          }
        }
      }
    }
  }

  const results: ImpactResult[] = Array.from(sectionChanges.values()).map(
    ({ section, changes: sectionEntries }) => {
      const score = calculateImpactScore(sectionEntries);
      return {
        section,
        score,
        severity: scoreSeverity(score),
        changes: sectionEntries,
      };
    }
  );

  return {
    results,
    totalChanges: changes.length,
    summary: buildSummary(results),
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Prioritisation
// ============================================================================

/**
 * Prioritise doc sections that need updating, weighting severity and traffic.
 */
export function prioritiseSections(results: ImpactResult[]): ImpactResult[] {
  return [...results].sort((a, b) => {
    const trafficA = a.section.traffic ?? 0;
    const trafficB = b.section.traffic ?? 0;
    const priorityA = a.score + Math.min(trafficA / 100, 50);
    const priorityB = b.score + Math.min(trafficB / 100, 50);
    return priorityB - priorityA;
  });
}

// ============================================================================
// Helpers
// ============================================================================

function buildSummary(results: ImpactResult[]): string {
  if (results.length === 0) return 'No documentation impact detected.';

  const critical = results.filter((r) => r.severity === 'critical').length;
  const high = results.filter((r) => r.severity === 'high').length;
  const parts: string[] = [`${results.length} doc section(s) impacted.`];

  if (critical > 0) parts.push(`${critical} critical.`);
  if (high > 0) parts.push(`${high} high severity.`);

  return parts.join(' ');
}
