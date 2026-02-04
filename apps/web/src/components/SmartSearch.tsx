'use client';

import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../lib/api';

interface Citation {
  documentId: string;
  documentPath: string;
  chunkContent: string;
  relevanceScore: number;
  sourceType: 'documentation' | 'code' | 'comment';
  lineStart?: number;
  lineEnd?: number;
}

interface SearchResult {
  query: string;
  answer: string;
  citations: Citation[];
  processingTime: number;
  confidence: number;
}

interface SmartSearchProps {
  repositoryId: string;
  token: string;
  onCitationClick?: (citation: Citation) => void;
}

export function SmartSearch({ repositoryId, token, onCitationClick }: SmartSearchProps) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCitation, setExpandedCitation] = useState<string | null>(null);

  // Load recent queries from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`docsynth_recent_queries_${repositoryId}`);
    if (saved) {
      setRecentQueries(JSON.parse(saved));
    }
  }, [repositoryId]);

  const saveRecentQuery = (q: string) => {
    const updated = [q, ...recentQueries.filter(r => r !== q)].slice(0, 5);
    setRecentQueries(updated);
    localStorage.setItem(`docsynth_recent_queries_${repositoryId}`, JSON.stringify(updated));
  };

  const handleSearch = useCallback(async (searchQuery?: string) => {
    const q = searchQuery || query;
    if (!q.trim()) return;

    try {
      setSearching(true);
      setError(null);
      setResult(null);

      const response = await apiFetch<{ success: boolean; data: SearchResult }>(
        `/api/citations/repositories/${repositoryId}/search`,
        {
          method: 'POST',
          token,
          body: JSON.stringify({ query: q }),
        }
      );

      setResult(response.data);
      saveRecentQuery(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }, [query, repositoryId, token, recentQueries]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  const getSourceIcon = (type: string) => {
    switch (type) {
      case 'documentation': return '📄';
      case 'code': return '💻';
      case 'comment': return '💬';
      default: return '📋';
    }
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 0.8) return 'text-green-600';
    if (score >= 0.5) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="space-y-4">
      {/* Search Header */}
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
          🔍 Smart Search with Citations
        </h2>

        <div className="relative">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your documentation... (e.g., 'How do I authenticate with the API?')"
            className="w-full border rounded-lg px-4 py-3 pr-24 resize-none"
            rows={2}
          />
          <button
            onClick={() => handleSearch()}
            disabled={searching || !query.trim()}
            className="absolute right-2 bottom-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {searching ? (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
            ) : (
              'Search'
            )}
          </button>
        </div>

        {/* Recent Queries */}
        {recentQueries.length > 0 && !result && (
          <div className="mt-3">
            <div className="text-xs text-gray-500 mb-1">Recent searches:</div>
            <div className="flex flex-wrap gap-2">
              {recentQueries.map((q, i) => (
                <button
                  key={i}
                  onClick={() => { setQuery(q); handleSearch(q); }}
                  className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded hover:bg-gray-200"
                >
                  {q.length > 40 ? q.slice(0, 40) + '...' : q}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Search Result */}
      {result && (
        <div className="space-y-4">
          {/* Answer */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium">Answer</h3>
              <div className="flex items-center gap-2 text-sm">
                <span className={`font-medium ${getConfidenceColor(result.confidence)}`}>
                  {Math.round(result.confidence * 100)}% confident
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-gray-500">{result.processingTime}ms</span>
              </div>
            </div>
            <div className="prose prose-sm max-w-none text-gray-700">
              {result.answer.split('\n').map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
          </div>

          {/* Citations */}
          {result.citations.length > 0 && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b">
                <h3 className="font-medium">Sources ({result.citations.length})</h3>
              </div>
              <div className="divide-y">
                {result.citations.map((citation, i) => {
                  const isExpanded = expandedCitation === citation.documentId + i;

                  return (
                    <div key={i} className="p-4">
                      <button
                        onClick={() => setExpandedCitation(isExpanded ? null : citation.documentId + i)}
                        className="w-full text-left"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-2">
                            <span className="text-lg">{getSourceIcon(citation.sourceType)}</span>
                            <div>
                              <div className="font-medium text-blue-600 hover:underline">
                                {citation.documentPath}
                              </div>
                              {citation.lineStart && (
                                <div className="text-xs text-gray-500">
                                  Lines {citation.lineStart}-{citation.lineEnd || citation.lineStart}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">
                              {Math.round(citation.relevanceScore * 100)}% relevant
                            </span>
                            <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
                          </div>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="mt-3 pl-8">
                          <div className="bg-gray-50 rounded-lg p-3 text-sm font-mono text-gray-700 overflow-x-auto">
                            <pre className="whitespace-pre-wrap">{citation.chunkContent}</pre>
                          </div>
                          {onCitationClick && (
                            <button
                              onClick={() => onCitationClick(citation)}
                              className="mt-2 text-sm text-blue-600 hover:underline"
                            >
                              Open in document viewer →
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Clear Results */}
          <button
            onClick={() => { setResult(null); setQuery(''); }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Clear and search again
          </button>
        </div>
      )}
    </div>
  );
}
