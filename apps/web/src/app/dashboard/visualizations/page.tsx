'use client';

import { useState, useEffect } from 'react';
import { KnowledgeGraphNavigator } from '../../../components/KnowledgeGraphNavigator';
import { ArchitectureDiagrams } from '../../../components/ArchitectureDiagrams';

interface Repository {
  id: string;
  name: string;
  fullName: string;
}

type TabType = 'knowledge-graph' | 'architecture';

export default function VisualizationsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('knowledge-graph');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('docsynth_token');
    setToken(storedToken);
  }, []);

  useEffect(() => {
    async function fetchRepos() {
      if (!token) return;
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/repositories`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await response.json();
        if (data.success && data.data?.length > 0) {
          setRepositories(data.data);
          setSelectedRepoId(data.data[0].id);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchRepos();
  }, [token]);

  const tabs: { id: TabType; label: string; icon: string; description: string }[] = [
    {
      id: 'knowledge-graph',
      label: 'Knowledge Graph',
      icon: '🕸️',
      description: 'Explore relationships between code concepts and documentation',
    },
    {
      id: 'architecture',
      label: 'Architecture Diagrams',
      icon: '🏗️',
      description: 'Auto-generated diagrams of your codebase structure',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (repositories.length === 0) {
    return (
      <div className="text-center py-12">
        <span className="text-6xl block mb-4">📊</span>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          No Repositories Connected
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mb-4">
          Add a repository to start exploring visualizations.
        </p>
        <a
          href="/dashboard/repositories"
          className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Add Repository
        </a>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
            Visualizations
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Explore your codebase through interactive diagrams and graphs
          </p>
        </div>

        {/* Repository Selector */}
        <select
          value={selectedRepoId ?? ''}
          onChange={(e) => setSelectedRepoId(e.target.value)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        >
          {repositories.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.fullName || repo.name}
            </option>
          ))}
        </select>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Description */}
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <p className="text-sm text-blue-700 dark:text-blue-300">
          {tabs.find((t) => t.id === activeTab)?.description}
        </p>
      </div>

      {/* Tab Content */}
      {selectedRepoId && token && (
        <div>
          {activeTab === 'knowledge-graph' && (
            <KnowledgeGraphNavigator repositoryId={selectedRepoId} token={token} />
          )}
          {activeTab === 'architecture' && (
            <ArchitectureDiagrams repositoryId={selectedRepoId} token={token} />
          )}
        </div>
      )}
    </div>
  );
}
