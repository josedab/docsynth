'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '../lib/api';

interface Insight {
  id: string;
  type: 'undocumented-changes' | 'stale-docs' | 'missing-coverage' | 'suggested-improvement';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  affectedFiles?: string[];
  repositoryId?: string;
  repositoryName?: string;
  actionUrl?: string;
}

interface ActionableInsightsProps {
  token: string;
  maxInsights?: number;
}

export function ActionableInsights({ token, maxInsights = 4 }: ActionableInsightsProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchInsights() {
      try {
        const response = await apiFetch<{ success: boolean; data: { insights: Insight[] } }>(
          '/api/analytics/insights',
          { token }
        );
        setInsights(response.data.insights);
      } catch {
        // Silently fail - widget is optional
      } finally {
        setLoading(false);
      }
    }
    fetchInsights();
  }, [token]);

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'undocumented-changes': return '📝';
      case 'stale-docs': return '⏰';
      case 'missing-coverage': return '🔍';
      case 'suggested-improvement': return '💡';
      default: return '📋';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'border-l-red-500';
      case 'medium': return 'border-l-yellow-500';
      case 'low': return 'border-l-blue-500';
      default: return 'border-l-gray-500';
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-3" />
        <div className="space-y-2">
          <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xl">🎯</span>
          <h3 className="font-semibold text-gray-900 dark:text-white">Actionable Insights</h3>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No actionable items right now. Your documentation is in good shape!
        </p>
      </div>
    );
  }

  const insightsToShow = insights.slice(0, maxInsights);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <span>🎯</span>
          Suggested Actions
          {insights.length > 0 && (
            <span className="text-xs font-normal px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full">
              {insights.length}
            </span>
          )}
        </h3>
      </div>

      <div className="space-y-2">
        {insightsToShow.map((insight) => (
          <div
            key={insight.id}
            className={`p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border-l-4 ${getPriorityColor(insight.priority)}`}
          >
            <div className="flex items-start gap-2">
              <span className="text-lg">{getInsightIcon(insight.type)}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-gray-900 dark:text-white">
                  {insight.title}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {insight.description}
                </div>
                {insight.affectedFiles && insight.affectedFiles.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {insight.affectedFiles.slice(0, 2).map((file, i) => (
                      <span
                        key={i}
                        className="text-xs px-1.5 py-0.5 bg-gray-200 dark:bg-gray-600 rounded font-mono"
                      >
                        {file.split('/').pop()}
                      </span>
                    ))}
                    {insight.affectedFiles.length > 2 && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        +{insight.affectedFiles.length - 2} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {insights.length > maxInsights && (
        <Link
          href="/dashboard/analytics"
          className="block mt-3 text-xs text-blue-600 hover:underline"
        >
          View all {insights.length} suggestions →
        </Link>
      )}
    </div>
  );
}
