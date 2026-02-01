'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface HealthAlert {
  id: string;
  alertType: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  repositoryId?: string;
  documentId?: string;
  createdAt: string;
  acknowledged: boolean;
}

interface HealthAlertsProps {
  token: string;
  repositoryId?: string;
  limit?: number;
  showAcknowledged?: boolean;
}

export function HealthAlerts({
  token,
  repositoryId,
  limit = 10,
  showAcknowledged = false,
}: HealthAlertsProps) {
  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const [counts, setCounts] = useState({ info: 0, warning: 0, critical: 0 });
  const [filter, setFilter] = useState<'all' | 'info' | 'warning' | 'critical'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (repositoryId) params.append('repositoryId', repositoryId);
      if (!showAcknowledged) params.append('acknowledged', 'false');
      if (filter !== 'all') params.append('severity', filter);
      params.append('limit', limit.toString());

      const response = await apiFetch<{
        success: boolean;
        data: {
          alerts: HealthAlert[];
          unacknowledgedCounts: { info: number; warning: number; critical: number };
        };
      }>(`/api/health-dashboard/alerts?${params.toString()}`, { token });

      setAlerts(response.data.alerts);
      setCounts(response.data.unacknowledgedCounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [repositoryId, filter, limit, showAcknowledged, token]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const acknowledgeAlert = async (alertId: string) => {
    try {
      await apiFetch(`/api/health-dashboard/alerts/${alertId}/acknowledge`, {
        token,
        method: 'POST',
      });
      setAlerts(alerts.filter((a) => a.id !== alertId));
      fetchAlerts(); // Refresh counts
    } catch {
      // Handle error silently or show toast
    }
  };

  const getSeverityStyles = (severity: string) => {
    switch (severity) {
      case 'critical':
        return {
          bg: 'bg-red-50 border-red-200',
          icon: '🚨',
          badge: 'bg-red-100 text-red-800',
        };
      case 'warning':
        return {
          bg: 'bg-yellow-50 border-yellow-200',
          icon: '⚠️',
          badge: 'bg-yellow-100 text-yellow-800',
        };
      default:
        return {
          bg: 'bg-blue-50 border-blue-200',
          icon: 'ℹ️',
          badge: 'bg-blue-100 text-blue-800',
        };
    }
  };

  const getAlertTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'score-drop': 'Score Drop',
      'critical-doc': 'Critical Doc',
      'drift-detected': 'Drift Detected',
      'coverage-gap': 'Coverage Gap',
      'stale-docs': 'Stale Docs',
    };
    return labels[type] || type;
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const totalUnacknowledged = counts.info + counts.warning + counts.critical;

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/4" />
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded" />
            ))}
          </div>
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

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            🔔 Health Alerts
            {totalUnacknowledged > 0 && (
              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
                {totalUnacknowledged}
              </span>
            )}
          </h3>
        </div>

        {/* Severity filter tabs */}
        <div className="flex gap-2">
          {[
            { key: 'all', label: 'All', count: totalUnacknowledged },
            { key: 'critical', label: 'Critical', count: counts.critical },
            { key: 'warning', label: 'Warning', count: counts.warning },
            { key: 'info', label: 'Info', count: counts.info },
          ].map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilter(key as typeof filter)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === key
                  ? key === 'critical'
                    ? 'bg-red-100 text-red-700'
                    : key === 'warning'
                      ? 'bg-yellow-100 text-yellow-700'
                      : key === 'info'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-200 text-gray-700'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {label} {count > 0 && `(${count})`}
            </button>
          ))}
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <span className="text-4xl">✅</span>
          <p className="mt-2">No alerts - documentation health is looking good!</p>
        </div>
      ) : (
        <div className="divide-y max-h-96 overflow-y-auto">
          {alerts.map((alert) => {
            const styles = getSeverityStyles(alert.severity);
            return (
              <div
                key={alert.id}
                className={`p-4 ${styles.bg} border-l-4 ${
                  alert.severity === 'critical'
                    ? 'border-l-red-500'
                    : alert.severity === 'warning'
                      ? 'border-l-yellow-500'
                      : 'border-l-blue-500'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="text-xl flex-shrink-0">{styles.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{alert.title}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs ${styles.badge}`}>
                          {getAlertTypeLabel(alert.alertType)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{alert.message}</p>
                      <div className="text-xs text-gray-400 mt-1">{formatTime(alert.createdAt)}</div>
                    </div>
                  </div>
                  {!alert.acknowledged && (
                    <button
                      onClick={() => acknowledgeAlert(alert.id)}
                      className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-white/50 flex-shrink-0"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
