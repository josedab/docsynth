'use client';

import { ReactNode } from 'react';

interface TrendStatCardProps {
  title: string;
  value: number;
  previousValue?: number;
  icon?: ReactNode;
  format?: 'number' | 'percentage';
  loading?: boolean;
}

export function TrendStatCard({
  title,
  value,
  previousValue,
  icon,
  format = 'number',
  loading = false,
}: TrendStatCardProps) {
  const formatValue = (val: number) => {
    if (format === 'percentage') return `${val}%`;
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
    return val.toString();
  };

  const getTrend = () => {
    if (previousValue === undefined || previousValue === 0) return null;
    const change = ((value - previousValue) / previousValue) * 100;
    return {
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
      value: Math.abs(change).toFixed(1),
    };
  };

  const trend = getTrend();

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-lg border border-gray-200 dark:border-gray-700 animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3 mb-2" />
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 truncate">{title}</p>
        {icon && <span className="text-gray-400">{icon}</span>}
      </div>
      <div className="flex items-end gap-2">
        <p className="text-xl md:text-3xl font-bold text-gray-900 dark:text-white">
          {formatValue(value)}
        </p>
        {trend && trend.direction !== 'flat' && (
          <div
            className={`flex items-center text-xs ${
              trend.direction === 'up' ? 'text-green-600' : 'text-red-600'
            }`}
          >
            <span>{trend.direction === 'up' ? '↑' : '↓'}</span>
            <span>{trend.value}%</span>
          </div>
        )}
      </div>
      {previousValue !== undefined && (
        <p className="text-xs text-gray-400 mt-1">
          vs. {formatValue(previousValue)} previous
        </p>
      )}
    </div>
  );
}
