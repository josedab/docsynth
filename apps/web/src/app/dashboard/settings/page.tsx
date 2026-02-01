'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface OrganizationSettings {
  id: string;
  name: string;
  subscriptionTier: string;
  settings: {
    defaultDocTypes?: {
      readme: boolean;
      apiDocs: boolean;
      changelog: boolean;
      guides: boolean;
    };
    notifications?: {
      emailOnComplete: boolean;
      emailOnFailure: boolean;
      slackWebhook?: string;
    };
    style?: {
      tone: string;
      includeExamples: boolean;
    };
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [docTypes, setDocTypes] = useState({
    readme: true,
    apiDocs: true,
    changelog: true,
    guides: false,
  });

  const [notifications, setNotifications] = useState({
    emailOnComplete: true,
    emailOnFailure: true,
    slackWebhook: '',
  });

  const [style, setStyle] = useState({
    tone: 'technical',
    includeExamples: true,
  });

  useEffect(() => {
    async function fetchSettings() {
      const token = localStorage.getItem('docsynth_token');
      if (!token) return;

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/me`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        const data = await response.json();

        if (data.user?.organizations?.[0]) {
          const org = data.user.organizations[0];
          setSettings({
            id: org.id,
            name: org.name,
            subscriptionTier: org.subscriptionTier,
            settings: org.settings || {},
          });

          // Initialize form with existing settings
          if (org.settings?.defaultDocTypes) {
            setDocTypes(org.settings.defaultDocTypes);
          }
          if (org.settings?.notifications) {
            setNotifications(org.settings.notifications);
          }
          if (org.settings?.style) {
            setStyle(org.settings.style);
          }
        }
      } catch (error) {
        console.error('Failed to fetch settings:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
  }, []);

  const handleSave = async () => {
    if (!settings) return;

    setSaving(true);
    setMessage(null);

    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/organizations/${settings.id}/settings`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            defaultDocTypes: docTypes,
            notifications,
            style,
          }),
        }
      );

      if (response.ok) {
        setMessage({ type: 'success', text: 'Settings saved successfully!' });
      } else {
        setMessage({ type: 'error', text: 'Failed to save settings. Please try again.' });
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      setMessage({ type: 'error', text: 'Failed to save settings. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-8">Settings</h1>

      {message && (
        <div
          className={`mb-6 p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-8">
        {/* Organization Info */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-lg font-semibold">Organization</h2>
            <div className="flex gap-4">
              <Link
                href="/dashboard/settings/integrations"
                className="text-sm text-blue-600 hover:underline"
              >
                Integrations →
              </Link>
              <Link
                href="/dashboard/settings/billing"
                className="text-sm text-blue-600 hover:underline"
              >
                Manage Billing →
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400">Name</label>
              <p className="font-medium">{settings?.name ?? 'N/A'}</p>
            </div>
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400">Subscription</label>
              <p className="font-medium">
                <span
                  className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                    settings?.subscriptionTier === 'ENTERPRISE'
                      ? 'bg-purple-100 text-purple-800'
                      : settings?.subscriptionTier === 'TEAM'
                        ? 'bg-blue-100 text-blue-800'
                        : settings?.subscriptionTier === 'PRO'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {settings?.subscriptionTier ?? 'FREE'}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Default Doc Types */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold mb-4">Default Document Types</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Select which types of documentation should be generated by default for new repositories.
          </p>
          <div className="space-y-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={docTypes.readme}
                onChange={(e) => setDocTypes({ ...docTypes, readme: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded border-gray-300"
              />
              <span>README.md</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={docTypes.apiDocs}
                onChange={(e) => setDocTypes({ ...docTypes, apiDocs: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded border-gray-300"
              />
              <span>API Documentation</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={docTypes.changelog}
                onChange={(e) => setDocTypes({ ...docTypes, changelog: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded border-gray-300"
              />
              <span>Changelog</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={docTypes.guides}
                onChange={(e) => setDocTypes({ ...docTypes, guides: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded border-gray-300"
              />
              <span>Guides & Tutorials</span>
            </label>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold mb-4">Notifications</h2>
          <div className="space-y-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={notifications.emailOnComplete}
                onChange={(e) =>
                  setNotifications({ ...notifications, emailOnComplete: e.target.checked })
                }
                className="w-4 h-4 text-blue-600 rounded border-gray-300"
              />
              <span>Email me when documentation is generated</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={notifications.emailOnFailure}
                onChange={(e) =>
                  setNotifications({ ...notifications, emailOnFailure: e.target.checked })
                }
                className="w-4 h-4 text-blue-600 rounded border-gray-300"
              />
              <span>Email me when generation fails</span>
            </label>
            <div>
              <label className="block text-sm font-medium mb-2">Slack Webhook URL (optional)</label>
              <input
                type="text"
                value={notifications.slackWebhook}
                onChange={(e) =>
                  setNotifications({ ...notifications, slackWebhook: e.target.value })
                }
                placeholder="https://hooks.slack.com/services/..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              />
            </div>
          </div>
        </div>

        {/* Writing Style */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold mb-4">Writing Style</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Tone</label>
              <select
                value={style.tone}
                onChange={(e) => setStyle({ ...style, tone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              >
                <option value="technical">Technical</option>
                <option value="formal">Formal</option>
                <option value="casual">Casual</option>
              </select>
            </div>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={style.includeExamples}
                onChange={(e) => setStyle({ ...style, includeExamples: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded border-gray-300"
              />
              <span>Include code examples in documentation</span>
            </label>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
