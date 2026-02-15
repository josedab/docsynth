// ============================================================================
// Types
// ============================================================================

export type CascadeStrategy = 'immediate' | 'batched' | 'manual';

export type CascadeItemStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface CascadeConfig {
  strategy: CascadeStrategy;
  priorityLanguages: string[];
  batchIntervalHours: number;
  partialUpdates: boolean;
}

export interface CascadeItem {
  sectionId: string;
  language: string;
  status: CascadeItemStatus;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface CascadeStatus {
  cascadeId: string;
  sourceDocumentId: string;
  config: CascadeConfig;
  items: CascadeItem[];
  createdAt: Date;
}

export interface CascadeLanguageReport {
  language: string;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  total: number;
}

export interface CascadeReport {
  cascadeId: string;
  strategy: CascadeStrategy;
  languages: CascadeLanguageReport[];
  overallProgress: number;
  generatedAt: string;
}

interface ChangedSection {
  sectionId: string;
  content: string;
}

// ============================================================================
// State
// ============================================================================

const cascades = new Map<string, CascadeStatus>();
let nextId = 1;

// ============================================================================
// Functions
// ============================================================================

/** Trigger a translation cascade for changed sections across target languages. */
export function triggerCascade(
  sourceDocumentId: string,
  changedSections: ChangedSection[],
  targetLanguages: string[],
  config: CascadeConfig
): CascadeStatus {
  const cascadeId = `cascade-${nextId++}`;

  // Order languages: priority first, then the rest
  const prioritySet = new Set(config.priorityLanguages);
  const ordered = [
    ...targetLanguages.filter((l) => prioritySet.has(l)),
    ...targetLanguages.filter((l) => !prioritySet.has(l)),
  ];

  const items: CascadeItem[] = [];
  for (const language of ordered) {
    for (const section of changedSections) {
      const status: CascadeItemStatus =
        config.strategy === 'manual'
          ? 'pending'
          : resolveInitialStatus(config, language, prioritySet);
      items.push({
        sectionId: section.sectionId,
        language,
        status,
        startedAt: status === 'in_progress' ? new Date() : undefined,
      });
    }
  }

  const cascade: CascadeStatus = {
    cascadeId,
    sourceDocumentId,
    config,
    items,
    createdAt: new Date(),
  };

  cascades.set(cascadeId, cascade);
  return cascade;
}

/** Get the current status of a cascade by ID. */
export function getCascadeStatus(cascadeId: string): CascadeStatus | undefined {
  return cascades.get(cascadeId);
}

/** Update the status of a specific cascade item. */
export function updateCascadeItem(
  cascadeId: string,
  sectionId: string,
  language: string,
  status: CascadeItemStatus,
  error?: string
): boolean {
  const cascade = cascades.get(cascadeId);
  if (!cascade) return false;

  const item = cascade.items.find((i) => i.sectionId === sectionId && i.language === language);
  if (!item) return false;

  item.status = status;
  if (status === 'in_progress') item.startedAt = new Date();
  if (status === 'completed' || status === 'failed') item.completedAt = new Date();
  if (error) item.error = error;

  return true;
}

/** Generate a cascade report grouped by language. */
export function generateCascadeReport(cascadeId: string): CascadeReport | undefined {
  const cascade = cascades.get(cascadeId);
  if (!cascade) return undefined;

  const langGroups = new Map<string, CascadeItem[]>();
  for (const item of cascade.items) {
    const group = langGroups.get(item.language) ?? [];
    group.push(item);
    langGroups.set(item.language, group);
  }

  const languages: CascadeLanguageReport[] = [];
  for (const [language, items] of langGroups) {
    languages.push({
      language,
      pending: items.filter((i) => i.status === 'pending').length,
      inProgress: items.filter((i) => i.status === 'in_progress').length,
      completed: items.filter((i) => i.status === 'completed').length,
      failed: items.filter((i) => i.status === 'failed').length,
      total: items.length,
    });
  }

  const totalItems = cascade.items.length;
  const completedItems = cascade.items.filter((i) => i.status === 'completed').length;
  const overallProgress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  return {
    cascadeId,
    strategy: cascade.config.strategy,
    languages,
    overallProgress,
    generatedAt: new Date().toISOString(),
  };
}

/** Clear all stored cascades (for testing). */
export function clearCascades(): void {
  cascades.clear();
  nextId = 1;
}

// ============================================================================
// Helpers
// ============================================================================

function resolveInitialStatus(
  config: CascadeConfig,
  language: string,
  prioritySet: Set<string>
): CascadeItemStatus {
  if (config.strategy === 'immediate') {
    return 'in_progress';
  }
  // Batched: priority languages start in_progress, others pending
  if (config.strategy === 'batched' && prioritySet.has(language)) {
    return 'in_progress';
  }
  return 'pending';
}
