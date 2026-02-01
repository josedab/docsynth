'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Repository {
  id: string;
  name: string;
  githubFullName: string;
  defaultBranch: string;
  enabled: boolean;
  lastActivityAt: string | null;
  createdAt: string;
  _count: {
    documents: number;
    prEvents: number;
  };
}

function getFreshnessStatus(lastUpdated: string | null): { status: 'fresh' | 'stale' | 'outdated'; label: string; color: string } {
  if (!lastUpdated) {
    return { status: 'outdated', label: 'No docs', color: 'bg-gray-100 text-gray-800' };
  }

  const lastUpdate = new Date(lastUpdated);
  const now = new Date();
  const daysDiff = Math.floor((now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff <= 7) {
    return { status: 'fresh', label: 'Fresh', color: 'bg-green-100 text-green-800' };
  } else if (daysDiff <= 30) {
    return { status: 'stale', label: 'Stale', color: 'bg-yellow-100 text-yellow-800' };
  } else {
    return { status: 'outdated', label: 'Outdated', color: 'bg-red-100 text-red-800' };
  }
}

function FreshnessIndicator({ lastUpdated, docCount }: { lastUpdated: string | null; docCount: number }) {
  if (docCount === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
          No docs
        </span>
      </div>
    );
  }

  const { label, color } = getFreshnessStatus(lastUpdated);
  const daysAgo = lastUpdated
    ? Math.floor((new Date().getTime() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="flex items-center gap-2">
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${color}`}>
        {label}
      </span>
      {daysAgo !== null && (
        <span className="text-xs text-gray-500">
          {daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`}
        </span>
      )}
    </div>
  );
}

function FreshnessSummary({ repositories }: { repositories: Repository[] }) {
  const stats = repositories.reduce(
    (acc, repo) => {
      if (repo._count.documents === 0) {
        acc.noDocs++;
      } else {
        const { status } = getFreshnessStatus(repo.lastActivityAt);
        acc[status]++;
      }
      return acc;
    },
    { fresh: 0, stale: 0, outdated: 0, noDocs: 0 }
  );

  const total = repositories.length;
  if (total === 0) return null;

  const freshPercent = Math.round((stats.fresh / total) * 100);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
      <h2 className="text-lg font-semibold mb-4">Documentation Freshness</h2>
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600">{stats.fresh}</div>
          <div className="text-sm text-gray-500">Fresh</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-yellow-600">{stats.stale}</div>
          <div className="text-sm text-gray-500">Stale</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-600">{stats.outdated}</div>
          <div className="text-sm text-gray-500">Outdated</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-600">{stats.noDocs}</div>
          <div className="text-sm text-gray-500">No Docs</div>
        </div>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-green-500 h-2 rounded-full transition-all"
          style={{ width: `${freshPercent}%` }}
        />
      </div>
      <p className="text-sm text-gray-500 mt-2">
        {freshPercent}% of repositories have fresh documentation
      </p>
    </div>
  );
}

export default function RepositoriesPage() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchRepositories();
  }, []);

  async function fetchRepositories() {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/repositories?organizationId=default`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await response.json();

      if (data.success) {
        setRepositories(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch repositories:', error);
    } finally {
      setLoading(false);
    }
  }

  async function toggleRepository(repoId: string, enabled: boolean) {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    try {
      const endpoint = enabled ? 'disable' : 'enable';
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/repositories/${repoId}/${endpoint}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      // Refresh list
      fetchRepositories();
    } catch (error) {
      console.error('Failed to toggle repository:', error);
    }
  }

  async function syncRepositories() {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    setSyncing(true);
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/repositories/sync?organizationId=default`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      // Refresh list
      await fetchRepositories();
    } catch (error) {
      console.error('Failed to sync repositories:', error);
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Repositories</h1>
        <button
          onClick={syncRepositories}
          disabled={syncing}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {syncing ? 'Syncing...' : 'Sync from GitHub'}
        </button>
      </div>

      {repositories.length > 0 && <FreshnessSummary repositories={repositories} />}

      {repositories.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
          <p className="text-gray-500 mb-4">No repositories found.</p>
          <p className="text-sm text-gray-400">
            Install the DocSynth GitHub App and sync to see your repositories.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          {/* Desktop table view */}
          <table className="w-full hidden md:table">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left p-4 font-medium text-gray-600 dark:text-gray-400">
                  Repository
                </th>
                <th className="text-left p-4 font-medium text-gray-600 dark:text-gray-400">
                  Branch
                </th>
                <th className="text-left p-4 font-medium text-gray-600 dark:text-gray-400">
                  Docs
                </th>
                <th className="text-left p-4 font-medium text-gray-600 dark:text-gray-400">
                  Freshness
                </th>
                <th className="text-left p-4 font-medium text-gray-600 dark:text-gray-400">
                  Status
                </th>
                <th className="text-right p-4 font-medium text-gray-600 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {repositories.map((repo) => (
                <tr key={repo.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="p-4">
                    <Link href={`/dashboard/repositories/${repo.id}`} className="block">
                      <p className="font-medium text-blue-600 hover:underline">{repo.name}</p>
                      <p className="text-sm text-gray-500">{repo.githubFullName}</p>
                    </Link>
                  </td>
                  <td className="p-4">
                    <code className="text-sm bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                      {repo.defaultBranch}
                    </code>
                  </td>
                  <td className="p-4">{repo._count.documents}</td>
                  <td className="p-4">
                    <FreshnessIndicator
                      lastUpdated={repo.lastActivityAt}
                      docCount={repo._count.documents}
                    />
                  </td>
                  <td className="p-4">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full ${
                        repo.enabled
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {repo.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="p-4 text-right space-x-2">
                    <Link
                      href={`/dashboard/repositories/${repo.id}`}
                      className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                    >
                      Configure
                    </Link>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRepository(repo.id, repo.enabled);
                      }}
                      className={`px-3 py-1 text-sm rounded-lg ${
                        repo.enabled
                          ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {repo.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile card view */}
          <div className="md:hidden divide-y divide-gray-200 dark:divide-gray-700">
            {repositories.map((repo) => (
              <div key={repo.id} className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <Link href={`/dashboard/repositories/${repo.id}`} className="flex-1">
                    <p className="font-medium text-blue-600">{repo.name}</p>
                    <p className="text-sm text-gray-500 truncate">{repo.githubFullName}</p>
                  </Link>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded-full ${
                      repo.enabled
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {repo.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-500 mb-3">
                  <span>Branch: {repo.defaultBranch}</span>
                  <span>Docs: {repo._count.documents}</span>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/dashboard/repositories/${repo.id}`}
                    className="flex-1 text-center px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg"
                  >
                    Configure
                  </Link>
                  <button
                    onClick={() => toggleRepository(repo.id, repo.enabled)}
                    className={`flex-1 px-3 py-1.5 text-sm rounded-lg ${
                      repo.enabled
                        ? 'bg-gray-200 text-gray-700'
                        : 'bg-blue-600 text-white'
                    }`}
                  >
                    {repo.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
