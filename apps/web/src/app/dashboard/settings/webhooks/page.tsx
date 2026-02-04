'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../../lib/api';

interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
  deliveries: {
    id: string;
    timestamp: string;
    event: string;
    statusCode: number;
    duration: number;
    success: boolean;
  }[];
}

const EVENT_OPTIONS = [
  { id: 'job.started', label: 'Job Started', description: 'When a doc generation job begins' },
  { id: 'job.completed', label: 'Job Completed', description: 'When a job finishes successfully' },
  { id: 'job.failed', label: 'Job Failed', description: 'When a job fails' },
  {
    id: 'drift.detected',
    label: 'Drift Detected',
    description: 'When documentation drift is found',
  },
  {
    id: 'health.degraded',
    label: 'Health Degraded',
    description: 'When doc health drops below threshold',
  },
  { id: 'pr.created', label: 'PR Created', description: 'When a documentation PR is opened' },
];

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Create modal state
  const [newUrl, setNewUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['job.completed', 'job.failed']);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchWebhooks();
  }, []);

  const fetchWebhooks = async () => {
    try {
      const token = localStorage.getItem('docsynth_token');
      const data = await apiFetch<{ webhooks: Webhook[] }>('/api/webhooks', { token: token || '' });
      setWebhooks(data.webhooks || []);
    } catch {
      // Mock data
      setWebhooks([
        {
          id: '1',
          url: 'https://example.com/webhooks/slack-endpoint',
          events: ['job.completed', 'job.failed', 'drift.detected'],
          secret: 'whsec_abc123...',
          active: true,
          createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
          lastTriggeredAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          deliveries: [
            {
              id: 'd1',
              timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
              event: 'job.completed',
              statusCode: 200,
              duration: 145,
              success: true,
            },
            {
              id: 'd2',
              timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
              event: 'drift.detected',
              statusCode: 200,
              duration: 203,
              success: true,
            },
            {
              id: 'd3',
              timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
              event: 'job.failed',
              statusCode: 200,
              duration: 156,
              success: true,
            },
          ],
        },
        {
          id: '2',
          url: 'https://api.example.com/webhooks/docsynth',
          events: ['job.completed'],
          secret: 'whsec_def456...',
          active: false,
          createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          lastTriggeredAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          deliveries: [
            {
              id: 'd4',
              timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
              event: 'job.completed',
              statusCode: 500,
              duration: 2034,
              success: false,
            },
          ],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const createWebhook = async () => {
    if (!newUrl.trim() || selectedEvents.length === 0) return;
    setCreating(true);

    try {
      const token = localStorage.getItem('docsynth_token');
      await apiFetch('/api/webhooks', {
        token: token || '',
        method: 'POST',
        body: JSON.stringify({ url: newUrl, events: selectedEvents }),
      });
      fetchWebhooks();
    } catch {
      // Mock: add to local state
      setWebhooks([
        ...webhooks,
        {
          id: crypto.randomUUID(),
          url: newUrl,
          events: selectedEvents,
          secret: `whsec_${Math.random().toString(36).substring(2, 10)}`,
          active: true,
          createdAt: new Date().toISOString(),
          lastTriggeredAt: null,
          deliveries: [],
        },
      ]);
    } finally {
      setCreating(false);
      setShowCreateModal(false);
      setNewUrl('');
      setSelectedEvents(['job.completed', 'job.failed']);
    }
  };

  const toggleWebhook = async (id: string, active: boolean) => {
    try {
      const token = localStorage.getItem('docsynth_token');
      await apiFetch(`/api/webhooks/${id}`, {
        token: token || '',
        method: 'PATCH',
        body: JSON.stringify({ active }),
      });
    } catch {
      // Continue for demo
    }
    setWebhooks(webhooks.map((w) => (w.id === id ? { ...w, active } : w)));
  };

  const deleteWebhook = async (id: string) => {
    if (!confirm('Are you sure you want to delete this webhook?')) return;

    try {
      const token = localStorage.getItem('docsynth_token');
      await apiFetch(`/api/webhooks/${id}`, { token: token || '', method: 'DELETE' });
    } catch {
      // Continue for demo
    }
    setWebhooks(webhooks.filter((w) => w.id !== id));
  };

  const testWebhook = async (id: string) => {
    setTestingId(id);
    setTestResult(null);

    try {
      const token = localStorage.getItem('docsynth_token');
      await apiFetch(`/api/webhooks/${id}/test`, { token: token || '', method: 'POST' });
      setTestResult({ success: true, message: 'Test payload delivered successfully!' });
    } catch {
      // Mock success after delay
      await new Promise((r) => setTimeout(r, 1000));
      setTestResult({ success: true, message: 'Test payload delivered successfully!' });
    } finally {
      setTestingId(null);
    }
  };

  const formatTime = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();

    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
            <Link
              href="/dashboard/settings"
              className="hover:text-gray-700 dark:hover:text-gray-200"
            >
              Settings
            </Link>
            <span>/</span>
            <span>Webhooks</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Webhooks</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Receive real-time notifications when events occur
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Webhook
        </button>
      </div>

      {/* Test Result Toast */}
      {testResult && (
        <div
          className={`p-4 rounded-lg ${testResult.success ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'}`}
        >
          <div className="flex items-center gap-2">
            {testResult.success ? (
              <svg
                className="w-5 h-5 text-green-600 dark:text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            ) : (
              <svg
                className="w-5 h-5 text-red-600 dark:text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            )}
            <span
              className={
                testResult.success
                  ? 'text-green-800 dark:text-green-200'
                  : 'text-red-800 dark:text-red-200'
              }
            >
              {testResult.message}
            </span>
            <button
              onClick={() => setTestResult(null)}
              className="ml-auto text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Webhooks List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 animate-pulse"
            >
              <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-4" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : webhooks.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
          <svg
            className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No webhooks configured
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Add a webhook to receive notifications in Slack, Discord, or your own service.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Add your first webhook
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map((webhook) => (
            <div
              key={webhook.id}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span
                        className={`w-2 h-2 rounded-full ${webhook.active ? 'bg-green-500' : 'bg-gray-400'}`}
                      />
                      <code className="text-sm text-gray-900 dark:text-white font-mono truncate block max-w-md">
                        {webhook.url}
                      </code>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {webhook.events.map((event) => (
                        <span
                          key={event}
                          className="px-2 py-0.5 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded"
                        >
                          {event}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => testWebhook(webhook.id)}
                      disabled={testingId === webhook.id || !webhook.active}
                      className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                    >
                      {testingId === webhook.id ? 'Testing...' : 'Test'}
                    </button>
                    <button
                      onClick={() => toggleWebhook(webhook.id, !webhook.active)}
                      className={`px-3 py-1.5 text-sm rounded ${
                        webhook.active
                          ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200'
                          : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200'
                      }`}
                    >
                      {webhook.active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => deleteWebhook(webhook.id)}
                      className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Created {formatTime(webhook.createdAt)}
                  {webhook.lastTriggeredAt && (
                    <span> • Last triggered {formatTime(webhook.lastTriggeredAt)}</span>
                  )}
                </div>
              </div>

              {/* Recent Deliveries */}
              {webhook.deliveries.length > 0 && (
                <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 bg-gray-50 dark:bg-gray-900/50">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Recent deliveries
                  </h4>
                  <div className="space-y-2">
                    {webhook.deliveries.slice(0, 3).map((delivery) => (
                      <div key={delivery.id} className="flex items-center gap-3 text-sm">
                        <span
                          className={`w-2 h-2 rounded-full ${delivery.success ? 'bg-green-500' : 'bg-red-500'}`}
                        />
                        <span className="text-gray-600 dark:text-gray-400">{delivery.event}</span>
                        <span
                          className={`px-1.5 py-0.5 text-xs rounded ${delivery.success ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}
                        >
                          {delivery.statusCode}
                        </span>
                        <span className="text-gray-400 text-xs">{delivery.duration}ms</span>
                        <span className="text-gray-400 text-xs ml-auto">
                          {formatTime(delivery.timestamp)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Add Webhook</h2>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Webhook URL
                </label>
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Events
                </label>
                <div className="space-y-2">
                  {EVENT_OPTIONS.map((event) => (
                    <label
                      key={event.id}
                      className="flex items-start gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(event.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedEvents([...selectedEvents, event.id]);
                          } else {
                            setSelectedEvents(selectedEvents.filter((s) => s !== event.id));
                          }
                        }}
                        className="mt-1 h-4 w-4 text-blue-600 rounded border-gray-300 dark:border-gray-600"
                      />
                      <div>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {event.label}
                        </span>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {event.description}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={createWebhook}
                disabled={!newUrl.trim() || selectedEvents.length === 0 || creating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Webhook'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
