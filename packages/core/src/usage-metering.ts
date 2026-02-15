// ============================================================================
// Types
// ============================================================================

export type AggregationPeriod = 'hourly' | 'daily' | 'monthly';

export interface ApiCallRecord {
  apiKey: string;
  endpoint: string;
  timestamp: number;
  latencyMs: number;
  statusCode: number;
}

export interface UsageMetrics {
  apiKey: string;
  totalCalls: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorCount: number;
  errorRate: number;
}

export interface UsageSummary {
  apiKey: string;
  period: AggregationPeriod;
  periodStart: string;
  periodEnd: string;
  totalCalls: number;
  avgLatencyMs: number;
  errorRate: number;
  endpointBreakdown: EndpointBreakdown[];
}

export interface EndpointBreakdown {
  endpoint: string;
  calls: number;
  avgLatencyMs: number;
  errorCount: number;
}

export interface CostEstimate {
  apiKey: string;
  period: AggregationPeriod;
  totalCalls: number;
  estimatedCost: number;
  costPerCall: number;
}

export interface AnomalyResult {
  detected: boolean;
  type?: 'spike' | 'drop' | 'error-surge';
  message?: string;
  currentValue: number;
  baselineValue: number;
  deviationFactor: number;
}

export interface UsageReport {
  apiKey: string;
  generatedAt: string;
  period: AggregationPeriod;
  summary: UsageSummary;
  costEstimate: CostEstimate;
  anomalies: AnomalyResult[];
}

// ============================================================================
// Functions
// ============================================================================

export function computeMetrics(records: ApiCallRecord[], apiKey: string): UsageMetrics {
  const filtered = records.filter((r) => r.apiKey === apiKey);
  if (filtered.length === 0) {
    return { apiKey, totalCalls: 0, avgLatencyMs: 0, p95LatencyMs: 0, errorCount: 0, errorRate: 0 };
  }

  const latencies = filtered.map((r) => r.latencyMs).sort((a, b) => a - b);
  const errorCount = filtered.filter((r) => r.statusCode >= 400).length;
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95Index = Math.min(Math.ceil(latencies.length * 0.95) - 1, latencies.length - 1);

  return {
    apiKey,
    totalCalls: filtered.length,
    avgLatencyMs: Math.round(avgLatency * 100) / 100,
    p95LatencyMs: latencies[p95Index]!,
    errorCount,
    errorRate: Math.round((errorCount / filtered.length) * 10000) / 10000,
  };
}

export function aggregateUsage(
  records: ApiCallRecord[],
  apiKey: string,
  period: AggregationPeriod,
  periodStart: string,
  periodEnd: string
): UsageSummary {
  const filtered = records.filter((r) => r.apiKey === apiKey);
  const endpointMap = new Map<string, { calls: number; totalLatency: number; errors: number }>();

  for (const r of filtered) {
    const entry = endpointMap.get(r.endpoint) ?? { calls: 0, totalLatency: 0, errors: 0 };
    entry.calls++;
    entry.totalLatency += r.latencyMs;
    if (r.statusCode >= 400) entry.errors++;
    endpointMap.set(r.endpoint, entry);
  }

  const endpointBreakdown: EndpointBreakdown[] = [];
  for (const [endpoint, data] of endpointMap) {
    endpointBreakdown.push({
      endpoint,
      calls: data.calls,
      avgLatencyMs: Math.round((data.totalLatency / data.calls) * 100) / 100,
      errorCount: data.errors,
    });
  }

  const metrics = computeMetrics(records, apiKey);

  return {
    apiKey,
    period,
    periodStart,
    periodEnd,
    totalCalls: metrics.totalCalls,
    avgLatencyMs: metrics.avgLatencyMs,
    errorRate: metrics.errorRate,
    endpointBreakdown,
  };
}

export function estimateCost(
  totalCalls: number,
  costPerCall: number,
  period: AggregationPeriod,
  apiKey: string
): CostEstimate {
  return {
    apiKey,
    period,
    totalCalls,
    estimatedCost: Math.round(totalCalls * costPerCall * 100) / 100,
    costPerCall,
  };
}

export function detectAnomalies(
  currentValue: number,
  baselineValue: number,
  thresholdFactor: number = 2.0
): AnomalyResult {
  if (baselineValue === 0) {
    return { detected: false, currentValue, baselineValue, deviationFactor: 0 };
  }

  const factor = currentValue / baselineValue;

  if (factor >= thresholdFactor) {
    return {
      detected: true,
      type: 'spike',
      message: `Usage spike: ${factor.toFixed(1)}x above baseline`,
      currentValue,
      baselineValue,
      deviationFactor: Math.round(factor * 100) / 100,
    };
  }

  if (factor <= 1 / thresholdFactor) {
    return {
      detected: true,
      type: 'drop',
      message: `Usage drop: ${factor.toFixed(2)}x of baseline`,
      currentValue,
      baselineValue,
      deviationFactor: Math.round(factor * 100) / 100,
    };
  }

  return {
    detected: false,
    currentValue,
    baselineValue,
    deviationFactor: Math.round(factor * 100) / 100,
  };
}

export function detectErrorSurge(
  currentErrorRate: number,
  baselineErrorRate: number,
  thresholdFactor: number = 3.0
): AnomalyResult {
  if (baselineErrorRate === 0 && currentErrorRate > 0) {
    return {
      detected: true,
      type: 'error-surge',
      message: `Error surge: rate jumped from 0 to ${(currentErrorRate * 100).toFixed(1)}%`,
      currentValue: currentErrorRate,
      baselineValue: baselineErrorRate,
      deviationFactor: Infinity,
    };
  }

  return detectAnomalies(currentErrorRate, baselineErrorRate, thresholdFactor);
}

export function generateUsageReport(
  records: ApiCallRecord[],
  apiKey: string,
  period: AggregationPeriod,
  periodStart: string,
  periodEnd: string,
  costPerCall: number,
  baselineCalls: number,
  baselineErrorRate: number
): UsageReport {
  const summary = aggregateUsage(records, apiKey, period, periodStart, periodEnd);
  const costEst = estimateCost(summary.totalCalls, costPerCall, period, apiKey);
  const anomalies: AnomalyResult[] = [];

  const callAnomaly = detectAnomalies(summary.totalCalls, baselineCalls);
  if (callAnomaly.detected) anomalies.push(callAnomaly);

  const errorAnomaly = detectErrorSurge(summary.errorRate, baselineErrorRate);
  if (errorAnomaly.detected) anomalies.push(errorAnomaly);

  return {
    apiKey,
    generatedAt: new Date().toISOString(),
    period,
    summary,
    costEstimate: costEst,
    anomalies,
  };
}
