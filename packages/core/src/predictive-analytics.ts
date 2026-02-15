// ============================================================================
// Types
// ============================================================================

export type UrgencyLevel = 'critical' | 'high' | 'medium' | 'low';

export interface CodeChangeRecord {
  filePath: string;
  changesLast30Days: number;
  changesLast90Days: number;
  lastChangedAt: string;
}

export interface DocRecord {
  path: string;
  lastUpdatedAt: string;
  linkedCodePaths: string[];
  monthlyPageViews: number;
}

export interface PredictionResult {
  docPath: string;
  stalenessScore: number;
  urgency: UrgencyLevel;
  predictedStaleByDate: string;
  reason: string;
}

export interface MaintenanceTask {
  docPath: string;
  urgency: UrgencyLevel;
  scheduledDate: string;
  estimatedEffortHours: number;
  reason: string;
}

export interface MaintenanceSchedule {
  tasks: MaintenanceTask[];
  totalEstimatedHours: number;
  generatedAt: string;
}

export interface DecayPoint {
  daysSinceUpdate: number;
  freshnessScore: number;
}

export interface SeasonalPattern {
  month: number;
  label: string;
  relativeTraffic: number;
}

// ============================================================================
// Staleness Prediction
// ============================================================================

const MS_PER_DAY = 86_400_000;

function daysSince(dateStr: string, now: Date = new Date()): number {
  return Math.max(0, (now.getTime() - new Date(dateStr).getTime()) / MS_PER_DAY);
}

function codeVelocity(records: CodeChangeRecord[]): number {
  if (records.length === 0) return 0;
  return records.reduce((sum, r) => sum + r.changesLast30Days, 0) / records.length;
}

function scoreUrgency(score: number): UrgencyLevel {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

export function predictStaleness(
  docs: DocRecord[],
  codeChanges: CodeChangeRecord[],
  now: Date = new Date()
): PredictionResult[] {
  const changeMap = new Map<string, CodeChangeRecord>();
  for (const c of codeChanges) {
    changeMap.set(c.filePath, c);
  }

  return docs.map((doc) => {
    const docAgeDays = daysSince(doc.lastUpdatedAt, now);

    // Find linked code changes
    const linkedChanges = doc.linkedCodePaths
      .map((p) => changeMap.get(p))
      .filter((c): c is CodeChangeRecord => c != null);

    const velocity = codeVelocity(linkedChanges);

    // Staleness factors
    const ageFactor = Math.min(40, docAgeDays / 3);
    const velocityFactor = Math.min(40, velocity * 8);
    const trafficFactor = Math.min(20, doc.monthlyPageViews / 500);

    const stalenessScore = Math.min(100, Math.round(ageFactor + velocityFactor + trafficFactor));

    // Predict when doc becomes stale (score would reach 80)
    const remainingToStale = Math.max(0, 80 - stalenessScore);
    const daysToStale = velocity > 0 ? Math.ceil(remainingToStale / (velocity * 0.5)) : 180;
    const staleDate = new Date(now.getTime() + daysToStale * MS_PER_DAY);

    const reasons: string[] = [];
    if (docAgeDays > 60) reasons.push(`doc is ${Math.round(docAgeDays)} days old`);
    if (velocity > 2) reasons.push(`linked code changes at ${velocity.toFixed(1)}/month`);
    if (doc.monthlyPageViews > 1000)
      reasons.push(`high traffic (${doc.monthlyPageViews} views/month)`);
    if (reasons.length === 0) reasons.push('low risk based on current metrics');

    return {
      docPath: doc.path,
      stalenessScore,
      urgency: scoreUrgency(stalenessScore),
      predictedStaleByDate: staleDate.toISOString().split('T')[0]!,
      reason: reasons.join('; '),
    };
  });
}

// ============================================================================
// Decay Curves
// ============================================================================

export function calculateDecayCurve(
  halfLifeDays: number = 90,
  maxDays: number = 365,
  step: number = 30
): DecayPoint[] {
  const points: DecayPoint[] = [];
  for (let day = 0; day <= maxDays; day += step) {
    const freshnessScore = Math.round(100 * Math.pow(0.5, day / halfLifeDays));
    points.push({ daysSinceUpdate: day, freshnessScore });
  }
  return points;
}

// ============================================================================
// Seasonal Patterns
// ============================================================================

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function detectSeasonalPatterns(
  monthlyViews: { month: number; views: number }[]
): SeasonalPattern[] {
  if (monthlyViews.length === 0) return [];
  const avgViews = monthlyViews.reduce((s, m) => s + m.views, 0) / monthlyViews.length;
  if (avgViews === 0)
    return monthlyViews.map((m) => ({
      month: m.month,
      label: MONTH_LABELS[m.month - 1] ?? `Month ${m.month}`,
      relativeTraffic: 0,
    }));

  return monthlyViews.map((m) => ({
    month: m.month,
    label: MONTH_LABELS[m.month - 1] ?? `Month ${m.month}`,
    relativeTraffic: Math.round((m.views / avgViews) * 100) / 100,
  }));
}

// ============================================================================
// Maintenance Schedule
// ============================================================================

function estimateEffort(urgency: UrgencyLevel): number {
  const effort: Record<UrgencyLevel, number> = {
    critical: 4,
    high: 2,
    medium: 1,
    low: 0.5,
  };
  return effort[urgency];
}

export function generateMaintenanceSchedule(
  predictions: PredictionResult[],
  windowDays: number = 90,
  now: Date = new Date()
): MaintenanceSchedule {
  const cutoff = new Date(now.getTime() + windowDays * MS_PER_DAY);

  const eligible = predictions
    .filter((p) => new Date(p.predictedStaleByDate) <= cutoff || p.urgency === 'critical')
    .sort((a, b) => {
      const urgencyOrder: Record<UrgencyLevel, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      return (
        urgencyOrder[a.urgency] - urgencyOrder[b.urgency] || a.stalenessScore - b.stalenessScore
      );
    });

  const tasks: MaintenanceTask[] = eligible.map((p, idx) => {
    // Spread tasks across the window, but critical ones go first
    const dayOffset =
      p.urgency === 'critical' ? Math.min(7, idx * 2) : Math.min(windowDays, 14 + idx * 7);
    const scheduledDate = new Date(now.getTime() + dayOffset * MS_PER_DAY);

    return {
      docPath: p.docPath,
      urgency: p.urgency,
      scheduledDate: scheduledDate.toISOString().split('T')[0]!,
      estimatedEffortHours: estimateEffort(p.urgency),
      reason: p.reason,
    };
  });

  const totalEstimatedHours = tasks.reduce((s, t) => s + t.estimatedEffortHours, 0);

  return {
    tasks,
    totalEstimatedHours,
    generatedAt: now.toISOString(),
  };
}
