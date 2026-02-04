'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

interface ActivityEvent {
  id: string;
  type: 'job_started' | 'job_completed' | 'job_failed' | 'doc_generated' | 'drift_detected' | 'pr_created';
  title: string;
  description: string;
  repositoryName?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface ActivityFeedProps {
  token: string;
  maxEvents?: number;
}

export function ActivityFeed({ token, maxEvents = 8 }: ActivityFeedProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch initial events
  useEffect(() => {
    async function fetchEvents() {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/activity?limit=${maxEvents}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await response.json();
        if (data.success) {
          setEvents(data.data.events || []);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchEvents();
  }, [token, maxEvents]);

  // Handle real-time updates
  const handleWsMessage = useCallback((message: { type: string; data: unknown }) => {
    if (message.type === 'activity:new') {
      const newEvent = message.data as ActivityEvent;
      setEvents((prev) => [newEvent, ...prev].slice(0, maxEvents));
    }
  }, [maxEvents]);

  const { connected } = useWebSocket({
    onMessage: handleWsMessage,
  });

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'job_started': return '🚀';
      case 'job_completed': return '✅';
      case 'job_failed': return '❌';
      case 'doc_generated': return '📄';
      case 'drift_detected': return '⚠️';
      case 'pr_created': return '🔀';
      default: return '📌';
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case 'job_completed': return 'border-l-green-500';
      case 'job_failed': return 'border-l-red-500';
      case 'drift_detected': return 'border-l-yellow-500';
      case 'pr_created': return 'border-l-purple-500';
      default: return 'border-l-blue-500';
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/3 animate-pulse" />
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="p-3 animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Activity Feed</h3>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'}`}
            title={connected ? 'Live updates active' : 'Reconnecting...'}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          <span className="text-3xl block mb-2">📭</span>
          <p className="text-sm">No recent activity</p>
          <p className="text-xs mt-1">Events will appear here when PRs are merged</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-80 overflow-y-auto">
          {events.map((event) => (
            <div
              key={event.id}
              className={`p-3 border-l-4 ${getEventColor(event.type)} hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors`}
            >
              <div className="flex items-start gap-2">
                <span className="text-lg">{getEventIcon(event.type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
                      {event.title}
                    </span>
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {formatTime(event.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {event.description}
                  </p>
                  {event.repositoryName && (
                    <span className="inline-block mt-1 text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-600 rounded">
                      {event.repositoryName}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
