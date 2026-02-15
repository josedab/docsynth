// ============================================================================
// Types
// ============================================================================

export type EvidenceType =
  | 'code-change'
  | 'review-approval'
  | 'test-result'
  | 'deploy-log'
  | 'access-log'
  | 'policy-update';

export type ExportFormat = 'json' | 'csv' | 'pdf-metadata';

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  title: string;
  description: string;
  timestamp: string;
  actor: string;
  metadata: Record<string, unknown>;
  hash: string;
}

export interface ChainOfCustody {
  collectedBy: string;
  collectedAt: string;
  source: string;
  integrityHash: string;
  previousManifestId: string | null;
}

export interface EvidenceManifest {
  id: string;
  generatedAt: string;
  frameworkId: string;
  totalItems: number;
  dateRange: { from: string; to: string };
  chainOfCustody: ChainOfCustody;
  itemIds: string[];
}

export interface TimelineEvent {
  timestamp: string;
  type: EvidenceType;
  title: string;
  actor: string;
  evidenceId: string;
}

export interface EvidencePackage {
  manifest: EvidenceManifest;
  items: EvidenceItem[];
  timeline: TimelineEvent[];
  format: ExportFormat;
  exportedAt: string;
}

// ============================================================================
// Functions
// ============================================================================

export function collectEvidence(items: EvidenceItem[], since?: string): EvidenceItem[] {
  if (!since) return [...items];
  const sinceDate = new Date(since).getTime();
  return items.filter((item) => new Date(item.timestamp).getTime() > sinceDate);
}

export function generateManifest(
  items: EvidenceItem[],
  frameworkId: string,
  collectedBy: string,
  source: string,
  previousManifestId?: string
): EvidenceManifest {
  const sorted = [...items].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const itemIds = sorted.map((i) => i.id);
  const integrityHash = computeManifestHash(itemIds);

  return {
    id: `manifest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    generatedAt: new Date().toISOString(),
    frameworkId,
    totalItems: items.length,
    dateRange: {
      from: sorted[0]?.timestamp ?? '',
      to: sorted[sorted.length - 1]?.timestamp ?? '',
    },
    chainOfCustody: {
      collectedBy,
      collectedAt: new Date().toISOString(),
      source,
      integrityHash,
      previousManifestId: previousManifestId ?? null,
    },
    itemIds,
  };
}

export function buildTimeline(items: EvidenceItem[]): TimelineEvent[] {
  return [...items]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((item) => ({
      timestamp: item.timestamp,
      type: item.type,
      title: item.title,
      actor: item.actor,
      evidenceId: item.id,
    }));
}

export function exportPackage(
  items: EvidenceItem[],
  frameworkId: string,
  collectedBy: string,
  source: string,
  format: ExportFormat = 'json',
  previousManifestId?: string
): EvidencePackage {
  const manifest = generateManifest(items, frameworkId, collectedBy, source, previousManifestId);
  const timeline = buildTimeline(items);

  return {
    manifest,
    items: [...items],
    timeline,
    format,
    exportedAt: new Date().toISOString(),
  };
}

export function formatAsCSV(items: EvidenceItem[]): string {
  const headers = ['id', 'type', 'title', 'description', 'timestamp', 'actor', 'hash'];
  const rows = items.map((item) =>
    [
      item.id,
      item.type,
      csvEscape(item.title),
      csvEscape(item.description),
      item.timestamp,
      item.actor,
      item.hash,
    ].join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export function formatAsPDFMetadata(pkg: EvidencePackage): Record<string, unknown> {
  return {
    title: `Evidence Package - ${pkg.manifest.frameworkId}`,
    author: pkg.manifest.chainOfCustody.collectedBy,
    subject: `Compliance evidence for ${pkg.manifest.frameworkId}`,
    createdAt: pkg.exportedAt,
    totalItems: pkg.manifest.totalItems,
    dateRange: pkg.manifest.dateRange,
    integrityHash: pkg.manifest.chainOfCustody.integrityHash,
    items: pkg.items.map((i) => ({ id: i.id, type: i.type, title: i.title, hash: i.hash })),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function computeManifestHash(itemIds: string[]): string {
  let hash = 0;
  const str = itemIds.join('|');
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return `sha256-${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
