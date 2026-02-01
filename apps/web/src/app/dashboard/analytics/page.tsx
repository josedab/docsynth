'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useI18n } from '@/i18n';

interface AnalyticsData {
  overview: {
    totalDocs: number;
    freshDocs: number;
    staleDocs: number;
    totalGenerations: number;
    successRate: number;
  };
  freshnessBreakdown: {
    fresh: number;
    stale: number;
    outdated: number;
    noDocs: number;
  };
  generationTrend: Array<{
    date: string;
    count: number;
    success: number;
    failed: number;
  }>;
  topRepositories: Array<{
    id: string;
    name: string;
    docCount: number;
    lastUpdated: string;
    freshness: string;
  }>;
  recentActivity: Array<{
    id: string;
    type: string;
    repository: string;
    document?: string;
    timestamp: string;
  }>;
}

export default function AnalyticsPage() {
  const { t } = useI18n();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');

  useEffect(() => {
    fetchAnalytics();
  }, [timeRange]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('docsynth_token');
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/analytics?range=${timeRange}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );
      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch {
      // Use mock data for demo
      setData(getMockData());
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">{t.common.error}</p>
      </div>
    );
  }

  const freshnessPercent =
    data.overview.totalDocs > 0
      ? Math.round((data.overview.freshDocs / data.overview.totalDocs) * 100)
      : 0;

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">{t.analytics?.title || 'Analytics'}</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            {t.analytics?.subtitle || 'Documentation health and generation metrics'}
          </p>
        </div>
        <div className="flex gap-2">
          {(['7d', '30d', '90d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                timeRange === range
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              {range === '7d' ? '7 days' : range === '30d' ? '30 days' : '90 days'}
            </button>
          ))}
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          title={t.analytics?.totalDocs || 'Total Documents'}
          value={data.overview.totalDocs}
          icon="📄"
        />
        <StatCard
          title={t.analytics?.freshDocs || 'Fresh Documents'}
          value={data.overview.freshDocs}
          icon="✅"
          trend={freshnessPercent}
          trendLabel="of total"
        />
        <StatCard
          title={t.analytics?.generations || 'Generations'}
          value={data.overview.totalGenerations}
          icon="⚡"
        />
        <StatCard
          title={t.analytics?.successRate || 'Success Rate'}
          value={`${data.overview.successRate}%`}
          icon="📈"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Freshness Breakdown */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-4">
            {t.analytics?.freshnessBreakdown || 'Documentation Freshness'}
          </h2>
          <div className="space-y-4">
            <FreshnessBar
              label={t.repositories?.fresh || 'Fresh'}
              value={data.freshnessBreakdown.fresh}
              total={data.overview.totalDocs || 1}
              color="bg-green-500"
            />
            <FreshnessBar
              label={t.repositories?.stale || 'Stale'}
              value={data.freshnessBreakdown.stale}
              total={data.overview.totalDocs || 1}
              color="bg-yellow-500"
            />
            <FreshnessBar
              label={t.repositories?.outdated || 'Outdated'}
              value={data.freshnessBreakdown.outdated}
              total={data.overview.totalDocs || 1}
              color="bg-red-500"
            />
            <FreshnessBar
              label={t.repositories?.noDocs || 'No Docs'}
              value={data.freshnessBreakdown.noDocs}
              total={data.overview.totalDocs || 1}
              color="bg-gray-400"
            />
          </div>
        </div>

        {/* Generation Trend (Simple) */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-4">
            {t.analytics?.generationTrend || 'Generation Activity'}
          </h2>
          <div className="h-48 flex items-end gap-1">
            {data.generationTrend.slice(-14).map((day, i) => {
              const maxCount = Math.max(...data.generationTrend.map((d) => d.count), 1);
              const height = (day.count / maxCount) * 100;
              const successHeight = day.count > 0 ? (day.success / day.count) * height : 0;
              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col justify-end"
                  title={`${day.date}: ${day.count} generations (${day.success} success, ${day.failed} failed)`}
                >
                  <div
                    className="bg-red-400 rounded-t"
                    style={{ height: `${height - successHeight}%`, minHeight: height > 0 ? '2px' : '0' }}
                  />
                  <div
                    className="bg-green-500 rounded-b"
                    style={{ height: `${successHeight}%`, minHeight: successHeight > 0 ? '2px' : '0' }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>{data.generationTrend[0]?.date}</span>
            <span>{data.generationTrend[data.generationTrend.length - 1]?.date}</span>
          </div>
          <div className="flex gap-4 justify-center mt-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-green-500 rounded" /> Success
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-red-400 rounded" /> Failed
            </span>
          </div>
        </div>
      </div>

      {/* Top Repositories */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 mb-6">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">
            {t.analytics?.topRepos || 'Top Repositories by Documentation'}
          </h2>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {data.topRepositories.length === 0 ? (
            <p className="p-4 text-gray-500 text-center">No repositories yet</p>
          ) : (
            data.topRepositories.map((repo) => (
              <div key={repo.id} className="p-4 flex items-center justify-between">
                <div>
                  <Link
                    href={`/dashboard/repositories/${repo.id}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {repo.name}
                  </Link>
                  <p className="text-sm text-gray-500">
                    {repo.docCount} documents · Updated{' '}
                    {new Date(repo.lastUpdated).toLocaleDateString()}
                  </p>
                </div>
                <FreshnessBadge status={repo.freshness} />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">
            {t.analytics?.recentActivity || 'Recent Activity'}
          </h2>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {data.recentActivity.length === 0 ? (
            <p className="p-4 text-gray-500 text-center">No recent activity</p>
          ) : (
            data.recentActivity.map((activity) => (
              <div key={activity.id} className="p-4 flex items-start gap-3">
                <span className="text-lg">{getActivityIcon(activity.type)}</span>
                <div className="flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{activity.type}</span>
                    {activity.document && (
                      <>
                        {' '}
                        <span className="text-gray-500">·</span>{' '}
                        <span className="text-gray-600">{activity.document}</span>
                      </>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {activity.repository} ·{' '}
                    {new Date(activity.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  trend,
  trendLabel,
}: {
  title: string;
  value: number | string;
  icon: string;
  trend?: number;
  trendLabel?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span>{icon}</span>
        <span className="text-xs text-gray-500 truncate">{title}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {trend !== undefined && (
        <p className="text-xs text-gray-500 mt-1">
          {trend}% {trendLabel}
        </p>
      )}
    </div>
  );
}

function FreshnessBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const percent = Math.round((value / total) * 100);
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="text-gray-500">
          {value} ({percent}%)
        </span>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function FreshnessBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    fresh: 'bg-green-100 text-green-800',
    stale: 'bg-yellow-100 text-yellow-800',
    outdated: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function getActivityIcon(type: string): string {
  const icons: Record<string, string> = {
    'Doc Generated': '📄',
    'Doc Updated': '✏️',
    'Generation Started': '⚡',
    'Generation Failed': '❌',
    'PR Created': '🔀',
  };
  return icons[type] || '📌';
}

function getMockData(): AnalyticsData {
  const today = new Date();
  const trend = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (29 - i));
    const count = Math.floor(Math.random() * 10);
    const success = Math.floor(count * (0.7 + Math.random() * 0.25));
    return {
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count,
      success,
      failed: count - success,
    };
  });

  return {
    overview: {
      totalDocs: 47,
      freshDocs: 35,
      staleDocs: 8,
      totalGenerations: 156,
      successRate: 94,
    },
    freshnessBreakdown: {
      fresh: 35,
      stale: 8,
      outdated: 4,
      noDocs: 0,
    },
    generationTrend: trend,
    topRepositories: [
      { id: '1', name: 'api-gateway', docCount: 12, lastUpdated: new Date().toISOString(), freshness: 'fresh' },
      { id: '2', name: 'user-service', docCount: 8, lastUpdated: new Date(Date.now() - 86400000 * 3).toISOString(), freshness: 'fresh' },
      { id: '3', name: 'web-app', docCount: 6, lastUpdated: new Date(Date.now() - 86400000 * 10).toISOString(), freshness: 'stale' },
      { id: '4', name: 'worker-queue', docCount: 5, lastUpdated: new Date(Date.now() - 86400000 * 30).toISOString(), freshness: 'outdated' },
    ],
    recentActivity: [
      { id: '1', type: 'Doc Generated', repository: 'api-gateway', document: 'README.md', timestamp: new Date().toISOString() },
      { id: '2', type: 'PR Created', repository: 'user-service', timestamp: new Date(Date.now() - 3600000).toISOString() },
      { id: '3', type: 'Doc Updated', repository: 'web-app', document: 'API.md', timestamp: new Date(Date.now() - 7200000).toISOString() },
      { id: '4', type: 'Generation Started', repository: 'worker-queue', timestamp: new Date(Date.now() - 10800000).toISOString() },
    ],
  };
}
