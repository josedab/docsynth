'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface DocHealthScore {
  documentId: string;
  repositoryId: string;
  path: string;
  type: string;
  scores: {
    freshness: number;
    completeness: number;
    accuracy: number;
    readability: number;
    overall: number;
  };
  factors: {
    daysSinceUpdate: number;
    daysSinceCodeChange: number;
    hasExamples: boolean;
    hasApiReference: boolean;
    wordCount: number;
    codeBlockCount: number;
  };
  status: 'healthy' | 'needs-attention' | 'critical';
  recommendations: string[];
  assessedAt: string;
}

interface RepositoryHealthSummary {
  repositoryId: string;
  repositoryName: string;
  overallScore: number;
  documentCount: number;
  healthDistribution: {
    healthy: number;
    needsAttention: number;
    critical: number;
  };
  coverageGaps: string[];
  topIssues: string[];
  trend: 'improving' | 'stable' | 'declining';
}

interface DocHealthDashboardProps {
  repositoryId: string;
  token: string;
}

export function DocHealthDashboard({ repositoryId, token }: DocHealthDashboardProps) {
  const [summary, setSummary] = useState<RepositoryHealthSummary | null>(null);
  const [documents, setDocuments] = useState<DocHealthScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [summaryData, docsData] = await Promise.all([
        apiFetch<{ success: boolean; data: RepositoryHealthSummary }>(
          `/api/analytics/health/repositories/${repositoryId}`,
          { token }
        ),
        apiFetch<{ success: boolean; data: DocHealthScore[] }>(
          `/api/analytics/health?repositoryId=${repositoryId}`,
          { token }
        ),
      ]);

      setSummary(summaryData.data);
      setDocuments(docsData.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load health data');
    } finally {
      setLoading(false);
    }
  }, [repositoryId, token]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const filteredDocs = selectedStatus === 'all'
    ? documents
    : documents.filter(d => d.status === selectedStatus);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-100 text-green-800';
      case 'needs-attention': return 'bg-yellow-100 text-yellow-800';
      case 'critical': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-600';
    if (score >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'improving': return '📈';
      case 'declining': return '📉';
      default: return '➡️';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      {summary && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Documentation Health</h2>
            <span className="text-2xl">{getTrendIcon(summary.trend)}</span>
          </div>

          {/* Overall Score */}
          <div className="flex items-center gap-4 mb-6">
            <div className={`text-4xl font-bold ${getScoreColor(summary.overallScore)}`}>
              {summary.overallScore}
            </div>
            <div className="flex-1">
              <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    summary.overallScore >= 70 ? 'bg-green-500' :
                    summary.overallScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${summary.overallScore}%` }}
                />
              </div>
            </div>
          </div>

          {/* Health Distribution */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-600">
                {summary.healthDistribution.healthy}
              </div>
              <div className="text-sm text-green-700">Healthy</div>
            </div>
            <div className="bg-yellow-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-yellow-600">
                {summary.healthDistribution.needsAttention}
              </div>
              <div className="text-sm text-yellow-700">Needs Attention</div>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-600">
                {summary.healthDistribution.critical}
              </div>
              <div className="text-sm text-red-700">Critical</div>
            </div>
          </div>

          {/* Coverage Gaps */}
          {summary.coverageGaps.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Missing Documentation</h3>
              <div className="flex flex-wrap gap-2">
                {summary.coverageGaps.map((gap) => (
                  <span key={gap} className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded">
                    {gap.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Top Issues */}
          {summary.topIssues.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Top Issues</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                {summary.topIssues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-yellow-500">⚠️</span>
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Document List */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-medium">Documents ({filteredDocs.length})</h3>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5"
          >
            <option value="all">All Status</option>
            <option value="healthy">Healthy</option>
            <option value="needs-attention">Needs Attention</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        <div className="divide-y">
          {filteredDocs.map((doc) => (
            <div key={doc.documentId} className="p-4 hover:bg-gray-50">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-medium">{doc.path}</div>
                  <div className="text-sm text-gray-500">{doc.type.replace('_', ' ')}</div>
                </div>
                <span className={`px-2 py-1 rounded text-xs ${getStatusColor(doc.status)}`}>
                  {doc.status.replace('-', ' ')}
                </span>
              </div>

              {/* Score Bars */}
              <div className="grid grid-cols-4 gap-2 mb-2 text-xs">
                {['freshness', 'completeness', 'accuracy', 'readability'].map((key) => (
                  <div key={key}>
                    <div className="flex justify-between mb-1">
                      <span className="capitalize">{key}</span>
                      <span>{doc.scores[key as keyof typeof doc.scores]}</span>
                    </div>
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${
                          doc.scores[key as keyof typeof doc.scores] >= 70 ? 'bg-green-500' :
                          doc.scores[key as keyof typeof doc.scores] >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${doc.scores[key as keyof typeof doc.scores]}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Recommendations */}
              {doc.recommendations.length > 0 && (
                <div className="text-xs text-gray-500 mt-2">
                  <span className="font-medium">Suggestions:</span>{' '}
                  {doc.recommendations.slice(0, 2).join(' • ')}
                </div>
              )}
            </div>
          ))}

          {filteredDocs.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              No documents match the selected filter
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
