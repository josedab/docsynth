'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';

interface UsageData {
  apiCalls: { used: number; limit: number };
  tokens: { used: number; limit: number };
  generations: { used: number; limit: number };
  repositories: { used: number; limit: number };
  periodEnd: string;
  estimatedCost?: number;
}

export function UsageWidget() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsage();
  }, []);

  const fetchUsage = async () => {
    try {
      const token = localStorage.getItem('docsynth_token');
      const data = await apiFetch<UsageData>('/api/analytics/usage', { token: token || '' });
      setUsage(data);
    } catch {
      // Mock data
      setUsage({
        apiCalls: { used: 12847, limit: 50000 },
        tokens: { used: 2450000, limit: 5000000 },
        generations: { used: 47, limit: 100 },
        repositories: { used: 8, limit: 20 },
        periodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
        estimatedCost: 18.50,
      });
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const getPercentage = (used: number, limit: number) => Math.min((used / limit) * 100, 100);

  const getProgressColor = (percentage: number) => {
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 75) return 'bg-yellow-500';
    return 'bg-blue-500';
  };

  const daysUntilReset = usage
    ? Math.ceil((new Date(usage.periodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 0;

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 animate-pulse">
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
        <div className="space-y-4">
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (!usage) return null;

  const metrics = [
    { label: 'API Calls', ...usage.apiCalls, icon: '📡' },
    { label: 'Tokens', ...usage.tokens, icon: '🎟️' },
    { label: 'Generations', ...usage.generations, icon: '✨' },
    { label: 'Repositories', ...usage.repositories, icon: '📦' },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Usage This Month</h3>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Resets in {daysUntilReset} days
        </span>
      </div>

      <div className="space-y-4">
        {metrics.map(metric => {
          const percentage = getPercentage(metric.used, metric.limit);
          const isNearLimit = percentage >= 75;

          return (
            <div key={metric.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                  <span>{metric.icon}</span>
                  {metric.label}
                </span>
                <span className={`text-sm font-medium ${isNearLimit ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-900 dark:text-white'}`}>
                  {formatNumber(metric.used)} / {formatNumber(metric.limit)}
                </span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full ${getProgressColor(percentage)} transition-all duration-500`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {usage.estimatedCost !== undefined && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">Estimated cost</span>
          <span className="text-lg font-semibold text-gray-900 dark:text-white">
            ${usage.estimatedCost.toFixed(2)}
          </span>
        </div>
      )}

      {/* Warning if approaching limits */}
      {metrics.some(m => getPercentage(m.used, m.limit) >= 90) && (
        <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <p className="text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
            <span>⚠️</span>
            Approaching usage limits.{' '}
            <a href="/dashboard/settings/billing" className="underline font-medium">
              Upgrade plan
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
