'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '../lib/api';

interface DriftAlert {
  documentId: string;
  documentPath: string;
  repositoryName: string;
  driftScore: number;
  driftType: string;
}

interface DriftSummary {
  totalDrifts: number;
  criticalDrifts: DriftAlert[];
}

interface DriftAlertsWidgetProps {
  token: string;
  maxAlerts?: number;
}

export function DriftAlertsWidget({ token, maxAlerts = 3 }: DriftAlertsWidgetProps) {
  const [summary, setSummary] = useState<DriftSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDrifts() {
      try {
        const response = await apiFetch<{ success: boolean; data: DriftSummary }>(
          '/api/analytics/drift/summary',
          { token }
        );
        setSummary(response.data);
      } catch {
        // Silently fail - widget is optional
      } finally {
        setLoading(false);
      }
    }
    fetchDrifts();
  }, [token]);

  const getDriftTypeIcon = (type: string) => {
    switch (type) {
      case 'missing-api': return '🔌';
      case 'deprecated-reference': return '⚠️';
      case 'structural-mismatch': return '🏗️';
      case 'content-outdated': return '📝';
      case 'terminology-drift': return '📖';
      default: return '📋';
    }
  };

  const getSeverityBadge = (score: number) => {
    if (score >= 70) return { label: 'Critical', class: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' };
    if (score >= 40) return { label: 'Major', class: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' };
    return { label: 'Minor', class: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' };
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-3" />
        <div className="space-y-2">
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (!summary || summary.totalDrifts === 0) {
    return (
      <div className="bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">✨</span>
          <h3 className="font-semibold text-green-800 dark:text-green-200">All Docs In Sync</h3>
        </div>
        <p className="text-sm text-green-700 dark:text-green-300">
          No documentation drift detected. Great job keeping docs current!
        </p>
      </div>
    );
  }

  const alertsToShow = summary.criticalDrifts.slice(0, maxAlerts);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <span className="text-red-500">⚠️</span>
          Drift Alerts
          <span className="text-xs font-normal px-2 py-0.5 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 rounded-full">
            {summary.totalDrifts}
          </span>
        </h3>
      </div>

      <div className="space-y-2">
        {alertsToShow.map((alert) => {
          const severity = getSeverityBadge(alert.driftScore);
          return (
            <div
              key={alert.documentId}
              className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm"
            >
              <span>{getDriftTypeIcon(alert.driftType)}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate text-gray-900 dark:text-white">
                  {alert.documentPath}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {alert.repositoryName}
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded text-xs ${severity.class}`}>
                {severity.label}
              </span>
            </div>
          );
        })}
      </div>

      {summary.totalDrifts > maxAlerts && (
        <Link
          href="/dashboard/analytics"
          className="block mt-3 text-xs text-blue-600 hover:underline"
        >
          View all {summary.totalDrifts} drift alerts →
        </Link>
      )}
    </div>
  );
}
