'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '../lib/api';

interface HealthSummary {
  overallScore: number;
  healthDistribution: {
    healthy: number;
    needsAttention: number;
    critical: number;
  };
  trend: 'improving' | 'stable' | 'declining';
}

interface HealthScoreWidgetProps {
  token: string;
}

export function HealthScoreWidget({ token }: HealthScoreWidgetProps) {
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchHealth() {
      try {
        const response = await apiFetch<{ success: boolean; data: HealthSummary }>(
          '/api/analytics/health/summary',
          { token }
        );
        setHealth(response.data);
      } catch {
        // Silently fail - widget is optional
      } finally {
        setLoading(false);
      }
    }
    fetchHealth();
  }, [token]);

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'improving': return '📈';
      case 'declining': return '📉';
      default: return '➡️';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-600';
    if (score >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getProgressColor = (score: number) => {
    if (score >= 70) return 'bg-green-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-3" />
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-2" />
        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  if (!health) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-900 dark:text-white">Documentation Health</h3>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No health data available. Enable repositories to start tracking.
        </p>
      </div>
    );
  }

  const total = health.healthDistribution.healthy + 
                health.healthDistribution.needsAttention + 
                health.healthDistribution.critical;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 dark:text-white">Documentation Health</h3>
        <span title={`Trend: ${health.trend}`}>{getTrendIcon(health.trend)}</span>
      </div>

      <div className="flex items-center gap-4 mb-3">
        <div className={`text-3xl font-bold ${getScoreColor(health.overallScore)}`}>
          {health.overallScore}
        </div>
        <div className="flex-1">
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${getProgressColor(health.overallScore)}`}
              style={{ width: `${health.overallScore}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex gap-4 text-xs">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-gray-600 dark:text-gray-400">{health.healthDistribution.healthy} healthy</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-yellow-500" />
          <span className="text-gray-600 dark:text-gray-400">{health.healthDistribution.needsAttention} attention</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-gray-600 dark:text-gray-400">{health.healthDistribution.critical} critical</span>
        </div>
      </div>

      {total > 0 && (
        <Link 
          href="/dashboard/analytics" 
          className="block mt-3 text-xs text-blue-600 hover:underline"
        >
          View detailed health report →
        </Link>
      )}
    </div>
  );
}
