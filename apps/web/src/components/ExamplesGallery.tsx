'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { InteractiveCodeBlock } from './InteractiveCodeBlock';

interface Example {
  id: string;
  documentId: string;
  title: string;
  description?: string;
  language: string;
  code: string;
  expectedOutput?: string;
  isRunnable: boolean;
  validationStatus: string;
  lastValidated?: string;
  executionCount: number;
  sourceLineStart: number;
  sourceLineEnd: number;
}

interface ExampleStats {
  valid: number;
  invalid: number;
  pending: number;
  error: number;
}

interface ExamplesGalleryProps {
  repositoryId: string;
  documentId?: string;
  token: string;
}

export function ExamplesGallery({ repositoryId, documentId, token }: ExamplesGalleryProps) {
  const [examples, setExamples] = useState<Example[]>([]);
  const [stats, setStats] = useState<ExampleStats>({ valid: 0, invalid: 0, pending: 0, error: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'valid' | 'invalid' | 'pending'>('all');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  const fetchExamples = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (documentId) params.append('documentId', documentId);
      if (filter !== 'all') params.append('status', filter);
      if (languageFilter !== 'all') params.append('language', languageFilter);

      const response = await apiFetch<{
        success: boolean;
        data: { examples: Example[]; stats: ExampleStats };
      }>(`/api/examples/repository/${repositoryId}?${params.toString()}`, { token });

      setExamples(response.data.examples);
      setStats(response.data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load examples');
    } finally {
      setLoading(false);
    }
  }, [repositoryId, documentId, filter, languageFilter, token]);

  useEffect(() => {
    fetchExamples();
  }, [fetchExamples]);

  const extractExamples = async () => {
    setIsExtracting(true);
    try {
      await apiFetch('/api/examples/extract', {
        token,
        method: 'POST',
        body: JSON.stringify({ repositoryId, documentId }),
      });
      // Refresh after a delay to allow processing
      setTimeout(fetchExamples, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setIsExtracting(false);
    }
  };

  const validateAll = async () => {
    setIsValidating(true);
    try {
      await apiFetch(`/api/examples/repository/${repositoryId}/validate-all`, {
        token,
        method: 'POST',
      });
      // Refresh after a delay
      setTimeout(fetchExamples, 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  };

  const languages = [...new Set(examples.map((e) => e.language))];
  const totalExamples = stats.valid + stats.invalid + stats.pending + stats.error;

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-48 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">Interactive Examples</h2>
            <p className="text-sm text-gray-500 mt-1">
              Runnable code examples extracted from documentation
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={extractExamples}
              disabled={isExtracting}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                isExtracting
                  ? 'bg-gray-200 text-gray-500'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {isExtracting ? '⏳ Extracting...' : '🔍 Extract Examples'}
            </button>
            <button
              onClick={validateAll}
              disabled={isValidating || totalExamples === 0}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                isValidating || totalExamples === 0
                  ? 'bg-gray-200 text-gray-500'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isValidating ? '⏳ Validating...' : '✓ Validate All'}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-600">{stats.valid}</div>
            <div className="text-xs text-green-700">Verified</div>
          </div>
          <div className="bg-red-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-600">{stats.invalid}</div>
            <div className="text-xs text-red-700">Failing</div>
          </div>
          <div className="bg-yellow-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            <div className="text-xs text-yellow-700">Pending</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-600">{stats.error}</div>
            <div className="text-xs text-gray-700">Errors</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-4 items-center">
          <div className="flex gap-2">
            {(['all', 'valid', 'invalid', 'pending'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium ${
                  filter === f
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {languages.length > 1 && (
            <select
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5"
            >
              <option value="all">All Languages</option>
              {languages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {/* Examples grid */}
      {examples.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          <span className="text-4xl">📝</span>
          <p className="mt-2">No examples found. Click "Extract Examples" to scan documentation.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {examples.map((example) => (
            <div key={example.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm">{example.title}</h3>
                <span className="text-xs text-gray-400">
                  Lines {example.sourceLineStart}-{example.sourceLineEnd}
                </span>
              </div>
              {example.description && (
                <p className="text-xs text-gray-500">{example.description}</p>
              )}
              <InteractiveCodeBlock
                exampleId={example.id}
                initialCode={example.code}
                language={example.language}
                expectedOutput={example.expectedOutput}
                isRunnable={example.isRunnable}
                validationStatus={example.validationStatus}
                token={token}
              />
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>Executed {example.executionCount} times</span>
                {example.lastValidated && (
                  <span>
                    Last validated: {new Date(example.lastValidated).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
