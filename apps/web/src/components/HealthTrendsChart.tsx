'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface TrendDataPoint {
  date: string;
  overallScore: number;
  freshnessScore: number;
  completenessScore: number;
  documentCount: number;
}

interface HealthTrendsChartProps {
  repositoryId?: string;
  token: string;
  days?: number;
}

export function HealthTrendsChart({ repositoryId, token, days = 30 }: HealthTrendsChartProps) {
  const [trends, setTrends] = useState<TrendDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<'overallScore' | 'freshnessScore' | 'completenessScore'>('overallScore');

  const fetchTrends = useCallback(async () => {
    try {
      setLoading(true);
      const endpoint = repositoryId
        ? `/api/health-dashboard/trends/${repositoryId}?days=${days}`
        : `/api/health-dashboard/overview?days=${days}`;

      const response = await apiFetch<{
        success: boolean;
        data: { weeklyTrend?: TrendDataPoint[]; snapshots?: TrendDataPoint[] };
      }>(endpoint, { token });

      setTrends(response.data.weeklyTrend || response.data.snapshots || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trends');
    } finally {
      setLoading(false);
    }
  }, [repositoryId, token, days]);

  useEffect(() => {
    fetchTrends();
  }, [fetchTrends]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/4" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  const maxScore = Math.max(...trends.map((t) => t[selectedMetric]), 100);
  const minScore = Math.min(...trends.map((t) => t[selectedMetric]), 0);

  const getMetricColor = (metric: string) => {
    switch (metric) {
      case 'overallScore': return 'text-blue-600 bg-blue-100';
      case 'freshnessScore': return 'text-green-600 bg-green-100';
      case 'completenessScore': return 'text-purple-600 bg-purple-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getLineColor = (metric: string) => {
    switch (metric) {
      case 'overallScore': return '#2563eb';
      case 'freshnessScore': return '#16a34a';
      case 'completenessScore': return '#9333ea';
      default: return '#6b7280';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Health Trends</h3>
        <div className="flex gap-2">
          {(['overallScore', 'freshnessScore', 'completenessScore'] as const).map((metric) => (
            <button
              key={metric}
              onClick={() => setSelectedMetric(metric)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedMetric === metric
                  ? getMetricColor(metric)
                  : 'text-gray-500 bg-gray-50 hover:bg-gray-100'
              }`}
            >
              {metric.replace('Score', '').replace(/([A-Z])/g, ' $1').trim()}
            </button>
          ))}
        </div>
      </div>

      {trends.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-500">
          No trend data available yet
        </div>
      ) : (
        <div className="relative h-48">
          {/* Y-axis labels */}
          <div className="absolute left-0 top-0 bottom-6 w-8 flex flex-col justify-between text-xs text-gray-400">
            <span>{maxScore}</span>
            <span>{Math.round((maxScore + minScore) / 2)}</span>
            <span>{minScore}</span>
          </div>

          {/* Chart area */}
          <div className="ml-10 h-full relative">
            <svg className="w-full h-full" viewBox={`0 0 ${trends.length * 30} 150`} preserveAspectRatio="none">
              {/* Grid lines */}
              <line x1="0" y1="0" x2={trends.length * 30} y2="0" stroke="#e5e7eb" strokeDasharray="4" />
              <line x1="0" y1="75" x2={trends.length * 30} y2="75" stroke="#e5e7eb" strokeDasharray="4" />
              <line x1="0" y1="150" x2={trends.length * 30} y2="150" stroke="#e5e7eb" strokeDasharray="4" />

              {/* Line chart */}
              <polyline
                fill="none"
                stroke={getLineColor(selectedMetric)}
                strokeWidth="2"
                points={trends
                  .map((t, i) => {
                    const x = i * 30 + 15;
                    const y = 150 - ((t[selectedMetric] - minScore) / (maxScore - minScore)) * 150;
                    return `${x},${y}`;
                  })
                  .join(' ')}
              />

              {/* Data points */}
              {trends.map((t, i) => {
                const x = i * 30 + 15;
                const y = 150 - ((t[selectedMetric] - minScore) / (maxScore - minScore)) * 150;
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r="4"
                    fill={getLineColor(selectedMetric)}
                    className="cursor-pointer hover:r-6"
                  >
                    <title>{`${t.date}: ${t[selectedMetric]}`}</title>
                  </circle>
                );
              })}
            </svg>
          </div>

          {/* X-axis labels */}
          <div className="ml-10 flex justify-between text-xs text-gray-400 mt-1">
            {trends.filter((_, i) => i % Math.ceil(trends.length / 5) === 0).map((t, i) => (
              <span key={i}>{new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
