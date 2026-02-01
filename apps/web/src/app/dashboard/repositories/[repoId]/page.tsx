'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Repository {
  id: string;
  name: string;
  githubFullName: string;
  defaultBranch: string;
  enabled: boolean;
  config: {
    triggers?: {
      onPRMerge?: boolean;
      branches?: string[];
    };
    filters?: {
      includePaths?: string[];
      excludePaths?: string[];
    };
    docTypes?: {
      readme?: boolean;
      apiDocs?: boolean;
      changelog?: boolean;
    };
  } | null;
  styleProfile: {
    id: string;
    tone: string;
    terminology: string[];
  } | null;
  organization: {
    id: string;
    name: string;
  };
  _count: {
    documents: number;
    prEvents: number;
  };
  createdAt: string;
  updatedAt: string;
}

interface Document {
  id: string;
  path: string;
  type: string;
  title: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const DOC_TYPE_COLORS: Record<string, string> = {
  README: 'bg-blue-100 text-blue-800',
  API_REFERENCE: 'bg-purple-100 text-purple-800',
  CHANGELOG: 'bg-green-100 text-green-800',
  GUIDE: 'bg-yellow-100 text-yellow-800',
  TUTORIAL: 'bg-orange-100 text-orange-800',
  ARCHITECTURE: 'bg-pink-100 text-pink-800',
  ADR: 'bg-indigo-100 text-indigo-800',
  INLINE_COMMENT: 'bg-gray-100 text-gray-800',
};

export default function RepositoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const repoId = params.repoId as string;

  const [repository, setRepository] = useState<Repository | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Editable config state
  const [config, setConfig] = useState({
    triggers: {
      onPRMerge: true,
      branches: ['main'],
    },
    docTypes: {
      readme: true,
      apiDocs: true,
      changelog: true,
    },
  });

  useEffect(() => {
    fetchRepository();
    fetchDocuments();
  }, [repoId]);

  async function fetchRepository() {
    const token = localStorage.getItem('docsynth_token');
    if (!token) {
      router.push('/auth/login');
      return;
    }

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/repositories/${repoId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await response.json();

      if (data.success) {
        setRepository(data.data);
        if (data.data.config) {
          setConfig({
            triggers: data.data.config.triggers ?? { onPRMerge: true, branches: ['main'] },
            docTypes: data.data.config.docTypes ?? { readme: true, apiDocs: true, changelog: true },
          });
        }
      }
    } catch (error) {
      console.error('Failed to fetch repository:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDocuments() {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/repositories/${repoId}/documents`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await response.json();

      if (data.success) {
        setDocuments(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    }
  }

  async function handleSaveConfig() {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/repositories/${repoId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ config }),
        }
      );

      if (response.ok) {
        setMessage({ type: 'success', text: 'Configuration saved!' });
      } else {
        setMessage({ type: 'error', text: 'Failed to save configuration.' });
      }
    } catch (error) {
      console.error('Failed to save config:', error);
      setMessage({ type: 'error', text: 'Failed to save configuration.' });
    } finally {
      setSaving(false);
    }
  }

  async function toggleRepository() {
    const token = localStorage.getItem('docsynth_token');
    if (!token || !repository) return;

    try {
      const endpoint = repository.enabled ? 'disable' : 'enable';
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/repositories/${repoId}/${endpoint}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      await fetchRepository();
    } catch (error) {
      console.error('Failed to toggle repository:', error);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!repository) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Repository not found.</p>
        <Link
          href="/dashboard/repositories"
          className="text-blue-600 hover:underline mt-4 inline-block"
        >
          Back to Repositories
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link
              href="/dashboard/repositories"
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              ← Repositories
            </Link>
          </div>
          <h1 className="text-2xl font-bold">{repository.name}</h1>
          <p className="text-gray-500">{repository.githubFullName}</p>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={`https://github.com/${repository.githubFullName}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
          >
            View on GitHub
          </a>
          <button
            onClick={toggleRepository}
            className={`px-4 py-2 rounded-lg ${
              repository.enabled
                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {repository.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

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

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-sm text-gray-500">Status</p>
          <p className="font-semibold">
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${
                repository.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
              }`}
            >
              {repository.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-sm text-gray-500">Default Branch</p>
          <p className="font-semibold">
            <code className="text-sm bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
              {repository.defaultBranch}
            </code>
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-sm text-gray-500">Documents</p>
          <p className="font-semibold text-2xl">{repository._count.documents}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-sm text-gray-500">PR Events</p>
          <p className="font-semibold text-2xl">{repository._count.prEvents}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Configuration */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold mb-4">Configuration</h2>

          <div className="space-y-6">
            {/* Triggers */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Triggers
              </h3>
              <label className="flex items-center gap-3 mb-2">
                <input
                  type="checkbox"
                  checked={config.triggers.onPRMerge}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      triggers: { ...config.triggers, onPRMerge: e.target.checked },
                    })
                  }
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span>Generate on PR merge</span>
              </label>
              <div className="mt-2">
                <label className="text-sm text-gray-500">Target branches (comma-separated)</label>
                <input
                  type="text"
                  value={config.triggers.branches?.join(', ') ?? ''}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      triggers: {
                        ...config.triggers,
                        branches: e.target.value.split(',').map((b) => b.trim()),
                      },
                    })
                  }
                  className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                  placeholder="main, master"
                />
              </div>
            </div>

            {/* Doc Types */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Document Types
              </h3>
              <div className="space-y-2">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={config.docTypes.readme}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        docTypes: { ...config.docTypes, readme: e.target.checked },
                      })
                    }
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span>README</span>
                </label>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={config.docTypes.apiDocs}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        docTypes: { ...config.docTypes, apiDocs: e.target.checked },
                      })
                    }
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span>API Documentation</span>
                </label>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={config.docTypes.changelog}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        docTypes: { ...config.docTypes, changelog: e.target.checked },
                      })
                    }
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span>Changelog</span>
                </label>
              </div>
            </div>

            <button
              onClick={handleSaveConfig}
              disabled={saving}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>

        {/* Documents */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Documents</h2>
            <Link
              href={`/dashboard/documents?repositoryId=${repoId}`}
              className="text-sm text-blue-600 hover:underline"
            >
              View all →
            </Link>
          </div>

          {documents.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No documents generated yet.</p>
              <p className="text-sm mt-2">
                Documents will appear here after PRs are merged.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {documents.slice(0, 5).map((doc) => (
                <Link
                  key={doc.id}
                  href={`/dashboard/documents/${doc.id}`}
                  className="block p-3 bg-gray-50 dark:bg-gray-900 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded ${
                          DOC_TYPE_COLORS[doc.type] ?? 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {doc.type}
                      </span>
                      <span className="font-medium text-sm">{doc.title ?? doc.path}</span>
                    </div>
                    <span className="text-xs text-gray-500">v{doc.version}</span>
                  </div>
                </Link>
              ))}
              {documents.length > 5 && (
                <p className="text-center text-sm text-gray-500 pt-2">
                  +{documents.length - 5} more documents
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Style Profile */}
      {repository.styleProfile && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mt-8">
          <h2 className="text-lg font-semibold mb-4">Style Profile</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Tone</p>
              <p className="font-medium">{repository.styleProfile.tone}</p>
            </div>
            {repository.styleProfile.terminology.length > 0 && (
              <div>
                <p className="text-sm text-gray-500">Custom Terminology</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {repository.styleProfile.terminology.map((term, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 rounded"
                    >
                      {term}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
