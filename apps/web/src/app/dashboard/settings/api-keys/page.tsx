'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../../lib/api';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  requestCount: number;
}

interface NewKeyResponse {
  id: string;
  key: string;
  name: string;
}

const SCOPE_OPTIONS = [
  { id: 'repos:read', label: 'Read repositories', description: 'View repository list and settings' },
  { id: 'repos:write', label: 'Write repositories', description: 'Enable/disable doc generation' },
  { id: 'docs:read', label: 'Read documents', description: 'View generated documentation' },
  { id: 'docs:write', label: 'Write documents', description: 'Edit and regenerate docs' },
  { id: 'jobs:read', label: 'Read jobs', description: 'View job status and history' },
  { id: 'jobs:write', label: 'Trigger jobs', description: 'Start doc generation jobs' },
  { id: 'analytics:read', label: 'Read analytics', description: 'View health and metrics' },
];

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<NewKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Create modal state
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['repos:read', 'docs:read']);
  const [expiryDays, setExpiryDays] = useState<number | null>(90);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchKeys();
  }, []);

  const fetchKeys = async () => {
    try {
      const token = localStorage.getItem('docsynth_token');
      const data = await apiFetch<{ keys: ApiKey[] }>('/api/api-keys', { token: token || '' });
      setKeys(data.keys || []);
    } catch {
      // Mock data for demo
      setKeys([
        {
          id: '1',
          name: 'CI/CD Pipeline',
          keyPrefix: 'ds_live_abc1',
          scopes: ['repos:read', 'docs:read', 'jobs:write'],
          createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          lastUsedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          expiresAt: null,
          requestCount: 1247,
        },
        {
          id: '2',
          name: 'Local Development',
          keyPrefix: 'ds_test_xyz9',
          scopes: ['repos:read', 'docs:read', 'docs:write'],
          createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          lastUsedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          expiresAt: new Date(Date.now() + 83 * 24 * 60 * 60 * 1000).toISOString(),
          requestCount: 89,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const createKey = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);

    try {
      const token = localStorage.getItem('docsynth_token');
      const data = await apiFetch<NewKeyResponse>('/api/api-keys', {
        token: token || '',
        method: 'POST',
        body: JSON.stringify({ name: newKeyName, scopes: selectedScopes, expiryDays }),
      });
      setNewKeyResult(data);
      fetchKeys();
    } catch {
      // Mock response
      setNewKeyResult({
        id: crypto.randomUUID(),
        key: `ds_live_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`,
        name: newKeyName,
      });
    } finally {
      setCreating(false);
    }
  };

  const deleteKey = async (id: string) => {
    if (!confirm('Are you sure you want to delete this API key? This action cannot be undone.')) return;

    try {
      const token = localStorage.getItem('docsynth_token');
      await apiFetch(`/api/api-keys/${id}`, { token: token || '', method: 'DELETE' });
    } catch {
      // Continue anyway for demo
    }
    setKeys(keys.filter(k => k.id !== id));
  };

  const rotateKey = async (id: string) => {
    if (!confirm('Rotating will invalidate the current key. Continue?')) return;

    try {
      const token = localStorage.getItem('docsynth_token');
      const data = await apiFetch<NewKeyResponse>(`/api/api-keys/${id}/rotate`, {
        token: token || '',
        method: 'POST',
      });
      setNewKeyResult(data);
      fetchKeys();
    } catch {
      const key = keys.find(k => k.id === id);
      setNewKeyResult({
        id,
        key: `ds_live_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`,
        name: key?.name || 'Rotated Key',
      });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatRelativeTime = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setNewKeyResult(null);
    setNewKeyName('');
    setSelectedScopes(['repos:read', 'docs:read']);
    setExpiryDays(90);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
            <Link href="/dashboard/settings" className="hover:text-gray-700 dark:hover:text-gray-200">
              Settings
            </Link>
            <span>/</span>
            <span>API Keys</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">API Keys</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage API keys for programmatic access to DocSynth
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create API Key
        </button>
      </div>

      {/* Security Notice */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
        <div className="flex gap-3">
          <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <h3 className="font-medium text-amber-800 dark:text-amber-200">Keep your keys secure</h3>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              API keys grant access to your account. Never share them publicly or commit them to version control.
              Use environment variables instead.
            </p>
          </div>
        </div>
      </div>

      {/* Keys List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map(i => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 animate-pulse">
              <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-4" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : keys.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
          <svg className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No API keys yet</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Create an API key to integrate DocSynth with your CI/CD pipeline or scripts.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Create your first API key
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {keys.map(key => (
            <div key={key.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{key.name}</h3>
                    {key.expiresAt && new Date(key.expiresAt) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 rounded">
                        Expiring soon
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mb-4">
                    <code className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded font-mono text-sm">
                      {key.keyPrefix}••••••••
                    </code>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {key.scopes.map(scope => (
                      <span
                        key={scope}
                        className="px-2 py-0.5 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Created</span>
                      <p className="text-gray-900 dark:text-white font-medium">{formatDate(key.createdAt)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Last used</span>
                      <p className="text-gray-900 dark:text-white font-medium">
                        {key.lastUsedAt ? formatRelativeTime(key.lastUsedAt) : 'Never'}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Expires</span>
                      <p className="text-gray-900 dark:text-white font-medium">
                        {key.expiresAt ? formatDate(key.expiresAt) : 'Never'}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Requests</span>
                      <p className="text-gray-900 dark:text-white font-medium">{key.requestCount.toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => rotateKey(key.id)}
                    className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                    title="Rotate key"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteKey(key.id)}
                    className="p-2 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                    title="Delete key"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && !newKeyResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Create API Key</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Generate a new key for programmatic access
              </p>
            </div>

            <div className="p-6 space-y-6">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Key Name
                </label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={e => setNewKeyName(e.target.value)}
                  placeholder="e.g., CI/CD Pipeline, Local Dev"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Scopes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Permissions
                </label>
                <div className="space-y-2">
                  {SCOPE_OPTIONS.map(scope => (
                    <label key={scope.id} className="flex items-start gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(scope.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedScopes([...selectedScopes, scope.id]);
                          } else {
                            setSelectedScopes(selectedScopes.filter(s => s !== scope.id));
                          }
                        }}
                        className="mt-1 h-4 w-4 text-blue-600 rounded border-gray-300 dark:border-gray-600"
                      />
                      <div>
                        <span className="font-medium text-gray-900 dark:text-white">{scope.label}</span>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{scope.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Expiry */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Expiration
                </label>
                <select
                  value={expiryDays ?? 'never'}
                  onChange={e => setExpiryDays(e.target.value === 'never' ? null : parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                  <option value="365">1 year</option>
                  <option value="never">Never expire</option>
                </select>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={createKey}
                disabled={!newKeyName.trim() || selectedScopes.length === 0 || creating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? 'Creating...' : 'Create Key'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Key Result Modal */}
      {newKeyResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">API Key Created</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{newKeyResult.name}</p>
                </div>
              </div>
            </div>

            <div className="p-6">
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-4">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  <strong>Important:</strong> Copy your API key now. You won&apos;t be able to see it again.
                </p>
              </div>

              <div className="relative">
                <code className="block w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg font-mono text-sm text-gray-900 dark:text-white break-all">
                  {newKeyResult.key}
                </code>
                <button
                  onClick={() => copyToClipboard(newKeyResult.key)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                >
                  {copied ? (
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                  )}
                </button>
              </div>

              <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Use in your environment:</p>
                <code className="text-sm text-gray-800 dark:text-gray-200">
                  export DOCSYNTH_API_KEY=&quot;{newKeyResult.key}&quot;
                </code>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={closeModal}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
