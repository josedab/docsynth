'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface SearchResult {
  id: string;
  type: 'document' | 'repository' | 'job';
  title: string;
  subtitle?: string;
  url: string;
  icon: string;
}

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const RECENT_SEARCHES_KEY = 'docsynth_recent_searches';
const MAX_RECENT = 5;

export function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // Load recent searches
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    } catch {
      // Ignore
    }
  }, []);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Search function
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('docsynth_token');
      if (!token) return;

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/search?q=${encodeURIComponent(searchQuery)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();

      if (data.success) {
        const mapped: SearchResult[] = [];

        // Map documents
        (data.data.documents || []).forEach((doc: { id: string; title: string; path: string; repositoryName?: string }) => {
          mapped.push({
            id: doc.id,
            type: 'document',
            title: doc.title || doc.path,
            subtitle: doc.repositoryName,
            url: `/dashboard/documents/${doc.id}`,
            icon: '📄',
          });
        });

        // Map repositories
        (data.data.repositories || []).forEach((repo: { id: string; name: string; fullName?: string }) => {
          mapped.push({
            id: repo.id,
            type: 'repository',
            title: repo.name,
            subtitle: repo.fullName,
            url: `/dashboard/repositories/${repo.id}`,
            icon: '📁',
          });
        });

        // Map jobs
        (data.data.jobs || []).forEach((job: { id: string; prTitle: string; status: string; repositoryName?: string }) => {
          mapped.push({
            id: job.id,
            type: 'job',
            title: job.prTitle,
            subtitle: `${job.status} • ${job.repositoryName || ''}`,
            url: `/dashboard/jobs/${job.id}`,
            icon: '⚡',
          });
        });

        setResults(mapped);
        setSelectedIndex(0);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          navigateToResult(results[selectedIndex]);
        }
        break;
      case 'Escape':
        onClose();
        break;
    }
  };

  // Navigate to result
  const navigateToResult = (result: SearchResult) => {
    // Save to recent searches
    const updated = [query, ...recentSearches.filter((s) => s !== query)].slice(0, MAX_RECENT);
    setRecentSearches(updated);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));

    router.push(result.url);
    onClose();
  };

  // Quick actions (suggestions when no query)
  const quickActions: SearchResult[] = [
    { id: 'qa-repos', type: 'repository', title: 'View Repositories', subtitle: 'Manage your connected repos', url: '/dashboard/repositories', icon: '📁' },
    { id: 'qa-docs', type: 'document', title: 'Browse Documents', subtitle: 'View generated documentation', url: '/dashboard/documents', icon: '📄' },
    { id: 'qa-jobs', type: 'job', title: 'Recent Jobs', subtitle: 'Check generation status', url: '/dashboard/jobs', icon: '⚡' },
    { id: 'qa-settings', type: 'repository', title: 'Settings', subtitle: 'Configure preferences', url: '/dashboard/settings', icon: '⚙️' },
  ];

  if (!isOpen) return null;

  const displayResults = query.trim() ? results : quickActions;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search documents, repositories, jobs..."
            className="flex-1 bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder-gray-500"
          />
          {loading && (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
          )}
          <kbd className="hidden sm:inline-block px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded text-gray-500">
            ESC
          </kbd>
        </div>

        {/* Recent Searches */}
        {!query.trim() && recentSearches.length > 0 && (
          <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
            <div className="text-xs text-gray-500 mb-2">Recent Searches</div>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((search, i) => (
                <button
                  key={i}
                  onClick={() => setQuery(search)}
                  className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                >
                  {search}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {displayResults.length === 0 && query.trim() && !loading ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              <span className="text-3xl block mb-2">🔍</span>
              <p>No results found for "{query}"</p>
            </div>
          ) : (
            <div className="py-2">
              {!query.trim() && (
                <div className="px-4 py-1 text-xs text-gray-500">Quick Actions</div>
              )}
              {displayResults.map((result, index) => (
                <button
                  key={result.id}
                  onClick={() => navigateToResult(result)}
                  className={`w-full px-4 py-2 flex items-center gap-3 text-left ${
                    index === selectedIndex
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="text-lg">{result.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white truncate">
                      {result.title}
                    </div>
                    {result.subtitle && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {result.subtitle}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 capitalize">{result.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-4">
            <span><kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">↑↓</kbd> Navigate</span>
            <span><kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">↵</kbd> Select</span>
          </div>
          <span>Press <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">⌘K</kbd> anywhere to search</span>
        </div>
      </div>
    </div>
  );
}

// Hook for global search keyboard shortcut
export function useGlobalSearch() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return { isSearchOpen, setIsSearchOpen };
}
