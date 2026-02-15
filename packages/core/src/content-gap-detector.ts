// ============================================================================
// Types
// ============================================================================

export type GapSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface SearchQuery {
  query: string;
  count: number;
  resultsReturned: number;
}

export interface PageBounce {
  path: string;
  visits: number;
  avgTimeOnPageMs: number;
}

export interface CodePath {
  filePath: string;
  exportedSymbols: string[];
  hasDocumentation: boolean;
}

export interface ContentGap {
  type: 'no-results' | 'low-results' | 'high-bounce' | 'undocumented-code';
  subject: string;
  severity: GapSeverity;
  trafficImpact: number;
  details: string;
}

export interface GapReport {
  gaps: ContentGap[];
  totalTrafficImpact: number;
  criticalCount: number;
  recommendations: string[];
  generatedAt: string;
}

// ============================================================================
// Gap Detection
// ============================================================================

const BOUNCE_THRESHOLD_MS = 10_000;
const LOW_RESULTS_THRESHOLD = 3;

export function detectSearchGaps(queries: SearchQuery[]): ContentGap[] {
  return queries
    .filter((q) => q.count > 0)
    .flatMap((q) => {
      const gaps: ContentGap[] = [];
      if (q.resultsReturned === 0) {
        gaps.push({
          type: 'no-results',
          subject: q.query,
          severity: 'critical',
          trafficImpact: q.count,
          details: `Search "${q.query}" returned 0 results (${q.count} searches)`,
        });
      } else if (q.resultsReturned <= LOW_RESULTS_THRESHOLD) {
        gaps.push({
          type: 'low-results',
          subject: q.query,
          severity: 'high',
          trafficImpact: q.count,
          details: `Search "${q.query}" returned only ${q.resultsReturned} results (${q.count} searches)`,
        });
      }
      return gaps;
    });
}

export function detectBounceGaps(pages: PageBounce[]): ContentGap[] {
  return pages
    .filter((p) => p.visits > 0 && p.avgTimeOnPageMs < BOUNCE_THRESHOLD_MS)
    .map((p) => ({
      type: 'high-bounce' as const,
      subject: p.path,
      severity: scoreSeverityFromTraffic(p.visits),
      trafficImpact: p.visits,
      details: `Page "${p.path}" has avg time ${Math.round(p.avgTimeOnPageMs / 1000)}s across ${p.visits} visits`,
    }));
}

export function detectUndocumentedCode(codePaths: CodePath[]): ContentGap[] {
  return codePaths
    .filter((c) => !c.hasDocumentation && c.exportedSymbols.length > 0)
    .map((c) => ({
      type: 'undocumented-code' as const,
      subject: c.filePath,
      severity: c.exportedSymbols.length >= 5 ? ('high' as const) : ('medium' as const),
      trafficImpact: c.exportedSymbols.length * 10,
      details: `${c.filePath} exports ${c.exportedSymbols.length} symbols without documentation`,
    }));
}

export function detectGaps(
  queries: SearchQuery[],
  pages: PageBounce[],
  codePaths: CodePath[]
): ContentGap[] {
  return [
    ...detectSearchGaps(queries),
    ...detectBounceGaps(pages),
    ...detectUndocumentedCode(codePaths),
  ];
}

// ============================================================================
// Ranking
// ============================================================================

function scoreSeverityFromTraffic(traffic: number): GapSeverity {
  if (traffic >= 1000) return 'critical';
  if (traffic >= 500) return 'high';
  if (traffic >= 100) return 'medium';
  return 'low';
}

const SEVERITY_WEIGHT: Record<GapSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function rankGaps(gaps: ContentGap[]): ContentGap[] {
  return [...gaps].sort((a, b) => {
    const weightDiff = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
    if (weightDiff !== 0) return weightDiff;
    return b.trafficImpact - a.trafficImpact;
  });
}

// ============================================================================
// Report Generation
// ============================================================================

export function generateGapReport(gaps: ContentGap[]): GapReport {
  const ranked = rankGaps(gaps);
  const criticalCount = ranked.filter((g) => g.severity === 'critical').length;
  const totalTrafficImpact = ranked.reduce((sum, g) => sum + g.trafficImpact, 0);

  const recommendations: string[] = [];

  const noResults = ranked.filter((g) => g.type === 'no-results');
  if (noResults.length > 0) {
    recommendations.push(
      `Create documentation for ${noResults.length} search term(s) with no results`
    );
  }

  const bouncers = ranked.filter((g) => g.type === 'high-bounce');
  if (bouncers.length > 0) {
    recommendations.push(`Improve content quality on ${bouncers.length} high-bounce page(s)`);
  }

  const undoc = ranked.filter((g) => g.type === 'undocumented-code');
  if (undoc.length > 0) {
    recommendations.push(`Add documentation for ${undoc.length} undocumented code path(s)`);
  }

  if (criticalCount > 0) {
    recommendations.push(`Address ${criticalCount} critical gap(s) as highest priority`);
  }

  return {
    gaps: ranked,
    totalTrafficImpact,
    criticalCount,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}
