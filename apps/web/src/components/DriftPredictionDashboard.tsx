'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface DriftPrediction {
  id: string;
  documentId: string;
  documentPath: string;
  driftProbability: number;
  confidenceScore: number;
  status: 'pending' | 'reviewed' | 'dismissed' | 'actioned';
  signals: {
    codeChanges: number;
    apiChanges: number;
    dependencyChanges: number;
    timeSinceUpdate: number;
  };
  predictedAt: string;
  reviewedBy?: string;
  actionTaken?: string;
}

interface DriftPredictionStats {
  totalPredictions: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  avgConfidence: number;
  predictedDrifts: number;
  preventedDrifts: number;
}

interface DriftPredictionDashboardProps {
  repositoryId: string;
  token: string;
  onRefresh?: () => void;
}

export function DriftPredictionDashboard({ repositoryId, token, onRefresh }: DriftPredictionDashboardProps) {
  const [predictions, setPredictions] = useState<DriftPrediction[]>([]);
  const [stats, setStats] = useState<DriftPredictionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');

  const fetchPredictions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [predictionsData, statsData] = await Promise.all([
        apiFetch<{ success: boolean; data: DriftPrediction[] }>(
          `/api/drift-prediction/repositories/${repositoryId}/predictions`,
          { token }
        ),
        apiFetch<{ success: boolean; data: DriftPredictionStats }>(
          `/api/drift-prediction/repositories/${repositoryId}/stats`,
          { token }
        ),
      ]);
      setPredictions(predictionsData.data);
      setStats(statsData.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load predictions');
    } finally {
      setLoading(false);
    }
  }, [repositoryId, token]);

  const generatePredictions = async () => {
    try {
      setGenerating(true);
      setError(null);
      await apiFetch(`/api/drift-prediction/repositories/${repositoryId}/predict`, {
        method: 'POST',
        token,
      });
      onRefresh?.();
      setTimeout(fetchPredictions, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate predictions');
    } finally {
      setGenerating(false);
    }
  };

  const handleAction = async (predictionId: string, action: string) => {
    try {
      await apiFetch(`/api/drift-prediction/predictions/${predictionId}/action`, {
        method: 'POST',
        token,
        body: JSON.stringify({ action }),
      });
      fetchPredictions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update prediction');
    }
  };

  useEffect(() => {
    fetchPredictions();
  }, [fetchPredictions]);

  const getRiskLevel = (probability: number) => {
    if (probability >= 0.7) return { label: 'High', color: 'bg-red-100 text-red-800 border-red-200' };
    if (probability >= 0.4) return { label: 'Medium', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' };
    return { label: 'Low', color: 'bg-green-100 text-green-800 border-green-200' };
  };

  const filteredPredictions = predictions.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (riskFilter === 'high' && p.driftProbability < 0.7) return false;
    if (riskFilter === 'medium' && (p.driftProbability < 0.4 || p.driftProbability >= 0.7)) return false;
    if (riskFilter === 'low' && p.driftProbability >= 0.4) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              🔮 Drift Prediction Dashboard
            </h2>
            <p className="text-sm text-gray-500">
              AI-powered predictions for documentation drift before it happens
            </p>
          </div>
          <button
            onClick={generatePredictions}
            disabled={generating}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
          >
            {generating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Analyzing...
              </>
            ) : (
              <>
                <span>🧠</span>
                Generate Predictions
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-3xl font-bold text-purple-600">{stats.totalPredictions}</div>
            <div className="text-sm text-gray-500">Total Predictions</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-3xl font-bold text-red-600">{stats.highRisk}</div>
            <div className="text-sm text-gray-500">High Risk</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-3xl font-bold text-green-600">{stats.preventedDrifts}</div>
            <div className="text-sm text-gray-500">Drifts Prevented</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-3xl font-bold text-blue-600">{Math.round(stats.avgConfidence * 100)}%</div>
            <div className="text-sm text-gray-500">Avg Confidence</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending Review</option>
          <option value="reviewed">Reviewed</option>
          <option value="actioned">Actioned</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Risk Levels</option>
          <option value="high">High Risk (≥70%)</option>
          <option value="medium">Medium Risk (40-70%)</option>
          <option value="low">Low Risk (&lt;40%)</option>
        </select>
      </div>

      {/* Predictions List */}
      <div className="bg-white rounded-lg shadow divide-y">
        {filteredPredictions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="text-4xl mb-2">🎯</div>
            <div>No predictions match the selected filters</div>
          </div>
        ) : (
          filteredPredictions.map((prediction) => {
            const risk = getRiskLevel(prediction.driftProbability);

            return (
              <div key={prediction.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{prediction.documentPath}</span>
                      <span className={`px-2 py-0.5 rounded text-xs border ${risk.color}`}>
                        {risk.label} Risk ({Math.round(prediction.driftProbability * 100)}%)
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        prediction.status === 'pending' ? 'bg-blue-100 text-blue-800' :
                        prediction.status === 'actioned' ? 'bg-green-100 text-green-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {prediction.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      Confidence: {Math.round(prediction.confidenceScore * 100)}% • 
                      Predicted: {new Date(prediction.predictedAt).toLocaleDateString()}
                    </div>
                    
                    {/* Signal Breakdown */}
                    <div className="flex gap-4 mt-2 text-xs text-gray-500">
                      <span>📝 {prediction.signals.codeChanges} code changes</span>
                      <span>🔌 {prediction.signals.apiChanges} API changes</span>
                      <span>📦 {prediction.signals.dependencyChanges} deps</span>
                      <span>📅 {prediction.signals.timeSinceUpdate}d since update</span>
                    </div>
                  </div>

                  {prediction.status === 'pending' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAction(prediction.id, 'update_doc')}
                        className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                      >
                        Update Doc
                      </button>
                      <button
                        onClick={() => handleAction(prediction.id, 'dismiss')}
                        className="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
