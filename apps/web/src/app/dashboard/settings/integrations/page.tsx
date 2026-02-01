'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useI18n } from '@/i18n';

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: 'connected' | 'disconnected' | 'error';
  connectedAt?: string;
  config?: Record<string, string>;
}

const INTEGRATIONS_CONFIG = [
  {
    id: 'jira',
    name: 'Jira',
    description: 'Import ticket context for better documentation',
    icon: '🎫',
    fields: [
      { key: 'baseUrl', label: 'Jira URL', placeholder: 'https://your-org.atlassian.net' },
      { key: 'email', label: 'Email', placeholder: 'your-email@company.com' },
      { key: 'apiToken', label: 'API Token', placeholder: 'Your Jira API token', sensitive: true },
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Gather context from team discussions',
    icon: '💬',
    fields: [
      { key: 'botToken', label: 'Bot Token', placeholder: 'xoxb-...', sensitive: true },
      { key: 'channels', label: 'Channels (comma-separated)', placeholder: '#dev, #engineering' },
    ],
  },
  {
    id: 'confluence',
    name: 'Confluence',
    description: 'Publish documentation to Confluence',
    icon: '📄',
    fields: [
      { key: 'baseUrl', label: 'Confluence URL', placeholder: 'https://your-org.atlassian.net/wiki' },
      { key: 'email', label: 'Email', placeholder: 'your-email@company.com' },
      { key: 'apiToken', label: 'API Token', placeholder: 'Your Confluence API token', sensitive: true },
      { key: 'spaceKey', label: 'Space Key', placeholder: 'DOCS' },
    ],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Sync documentation to Notion pages',
    icon: '📝',
    fields: [
      { key: 'apiKey', label: 'Integration Token', placeholder: 'secret_...', sensitive: true },
      { key: 'databaseId', label: 'Database ID', placeholder: 'Your Notion database ID' },
    ],
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Import issue context from Linear',
    icon: '📊',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'lin_api_...', sensitive: true },
      { key: 'teamId', label: 'Team ID (optional)', placeholder: 'Leave blank for all teams' },
    ],
  },
];

export default function IntegrationsPage() {
  const { t } = useI18n();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchIntegrations();
  }, []);

  const fetchIntegrations = async () => {
    try {
      const res = await fetch('/api/integrations');
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data.integrations || []);
      }
    } catch {
      // Use default disconnected state
      setIntegrations(
        INTEGRATIONS_CONFIG.map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          icon: i.icon,
          status: 'disconnected' as const,
        }))
      );
    } finally {
      setLoading(false);
    }
  };

  const getIntegration = (id: string): Integration => {
    const existing = integrations.find((i) => i.id === id);
    const config = INTEGRATIONS_CONFIG.find((i) => i.id === id)!;
    return (
      existing || {
        id: config.id,
        name: config.name,
        description: config.description,
        icon: config.icon,
        status: 'disconnected',
      }
    );
  };

  const openConfigModal = (integrationId: string) => {
    const integration = getIntegration(integrationId);
    setFormData(integration.config || {});
    setConfiguring(integrationId);
    setError(null);
  };

  const closeConfigModal = () => {
    setConfiguring(null);
    setFormData({});
    setError(null);
  };

  const handleSave = async () => {
    if (!configuring) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/integrations/${configuring}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: formData }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save integration');
      }

      await fetchIntegrations();
      closeConfigModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async (integrationId: string) => {
    if (!confirm('Are you sure you want to disconnect this integration?')) return;

    try {
      const res = await fetch(`/api/integrations/${integrationId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchIntegrations();
      }
    } catch {
      // Ignore errors
    }
  };

  const handleTest = async (integrationId: string) => {
    try {
      const res = await fetch(`/api/integrations/${integrationId}/test`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        alert('Connection successful!');
      } else {
        alert(`Connection failed: ${data.error}`);
      }
    } catch {
      alert('Connection test failed');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/dashboard/settings"
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ← {t.settings.title}
        </Link>
      </div>

      <h1 className="text-xl md:text-2xl font-bold mb-2">{t.settings.integrations}</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        Connect external services to enhance documentation context and publishing.
      </p>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS_CONFIG.map((config) => {
          const integration = getIntegration(config.id);
          const isConnected = integration.status === 'connected';

          return (
            <div
              key={config.id}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{config.icon}</span>
                  <div>
                    <h3 className="font-semibold">{config.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {config.description}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4">
                <span
                  className={`text-xs font-medium px-2 py-1 rounded-full ${
                    isConnected
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                  }`}
                >
                  {isConnected ? 'Connected' : 'Not connected'}
                </span>

                <div className="flex gap-2">
                  {isConnected && (
                    <>
                      <button
                        onClick={() => handleTest(config.id)}
                        className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                      >
                        Test
                      </button>
                      <button
                        onClick={() => handleDisconnect(config.id)}
                        className="text-sm text-red-600 hover:text-red-800"
                      >
                        Disconnect
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => openConfigModal(config.id)}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    {isConnected ? 'Configure' : 'Connect'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Configuration Modal */}
      {configuring && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full p-6">
            <h2 className="text-lg font-semibold mb-4">
              Configure {INTEGRATIONS_CONFIG.find((i) => i.id === configuring)?.name}
            </h2>

            {error && (
              <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
            )}

            <div className="space-y-4">
              {INTEGRATIONS_CONFIG.find((i) => i.id === configuring)?.fields.map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium mb-1">{field.label}</label>
                  <input
                    type={field.sensitive ? 'password' : 'text'}
                    value={formData[field.key] || ''}
                    onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={closeConfigModal}
                className="px-4 py-2 text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
