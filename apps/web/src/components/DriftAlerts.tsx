'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface DriftDetectionResult {
  documentId: string;
  documentPath: string;
  repositoryId: string;
  driftScore: number;
  driftType: 'missing-api' | 'deprecated-reference' | 'structural-mismatch' | 'content-outdated' | 'terminology-drift';
  affectedSections: string[];
  relatedCodeChanges: { file: string; changeType: string; date: string }[];
  suggestedActions: string[];
  detectedAt: string;
}

interface DriftScanResult {
  repositoryId: string;
  repositoryName: string;
  scannedAt: string;
  documentsScanned: number;
  driftsDetected: DriftDetectionResult[];
  summary: {
    healthy: number;
    minorDrift: number;
    majorDrift: number;
    criticalDrift: number;
  };
}

interface DriftAlertsProps {
  repositoryId: string;
  token: string;
  onTriggerScan?: () => void;
}

export function DriftAlerts({ repositoryId, token, onTriggerScan }: DriftAlertsProps) {
  const [scanResult, setScanResult] = useState<DriftScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDrift, setExpandedDrift] = useState<string | null>(null);

  const fetchDriftStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiFetch<{ success: boolean; data: DriftScanResult }>(
        `/api/repositories/${repositoryId}/drift`,
        { token }
      );
      setScanResult(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drift data');
    } finally {
      setLoading(false);
    }
  }, [repositoryId, token]);

  const triggerScan = async () => {
    try {
      setScanning(true);
      setError(null);
      await apiFetch(`/api/repositories/${repositoryId}/drift-scan`, {
        method: 'POST',
        token,
      });
      onTriggerScan?.();
      // Refresh after a delay to allow scan to complete
      setTimeout(fetchDriftStatus, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger scan');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    fetchDriftStatus();
  }, [fetchDriftStatus]);

  const getDriftTypeIcon = (type: string) => {
    switch (type) {
      case 'missing-api': return '🔌';
      case 'deprecated-reference': return '⚠️';
      case 'structural-mismatch': return '🏗️';
      case 'content-outdated': return '📝';
      case 'terminology-drift': return '📖';
      default: return '📋';
    }
  };

  const getDriftSeverity = (score: number) => {
    if (score >= 70) return { label: 'Critical', color: 'bg-red-100 text-red-800 border-red-200' };
    if (score >= 40) return { label: 'Major', color: 'bg-orange-100 text-orange-800 border-orange-200' };
    if (score >= 20) return { label: 'Minor', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' };
    return { label: 'Low', color: 'bg-gray-100 text-gray-800 border-gray-200' };
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Documentation Drift</h2>
            {scanResult && (
              <p className="text-sm text-gray-500">
                Last scanned: {formatDate(scanResult.scannedAt)}
              </p>
            )}
          </div>
          <button
            onClick={triggerScan}
            disabled={scanning}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {scanning ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Scanning...
              </>
            ) : (
              <>
                <span>🔍</span>
                Scan Now
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

      {/* Summary */}
      {scanResult && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="grid grid-cols-4 gap-4 text-center">
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-green-600">{scanResult.summary.healthy}</div>
              <div className="text-sm text-green-700">Healthy</div>
            </div>
            <div className="bg-yellow-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-yellow-600">{scanResult.summary.minorDrift}</div>
              <div className="text-sm text-yellow-700">Minor Drift</div>
            </div>
            <div className="bg-orange-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-orange-600">{scanResult.summary.majorDrift}</div>
              <div className="text-sm text-orange-700">Major Drift</div>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-red-600">{scanResult.summary.criticalDrift}</div>
              <div className="text-sm text-red-700">Critical</div>
            </div>
          </div>
        </div>
      )}

      {/* Drift Alerts List */}
      {scanResult && scanResult.driftsDetected.length > 0 && (
        <div className="bg-white rounded-lg shadow divide-y">
          {scanResult.driftsDetected.map((drift) => {
            const severity = getDriftSeverity(drift.driftScore);
            const isExpanded = expandedDrift === drift.documentId;

            return (
              <div key={drift.documentId} className="p-4">
                <button
                  onClick={() => setExpandedDrift(isExpanded ? null : drift.documentId)}
                  className="w-full text-left"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <span className="text-xl">{getDriftTypeIcon(drift.driftType)}</span>
                      <div>
                        <div className="font-medium">{drift.documentPath}</div>
                        <div className="text-sm text-gray-500 capitalize">
                          {drift.driftType.replace(/-/g, ' ')}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs border ${severity.color}`}>
                        {severity.label} ({drift.driftScore})
                      </span>
                      <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="mt-4 pl-10 space-y-3">
                    {/* Affected Sections */}
                    {drift.affectedSections.length > 0 && (
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-1">Affected Sections</div>
                        <div className="flex flex-wrap gap-1">
                          {drift.affectedSections.map((section, i) => (
                            <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">
                              {section}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Related Code Changes */}
                    {drift.relatedCodeChanges.length > 0 && (
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-1">Related Code Changes</div>
                        <div className="text-sm text-gray-600 space-y-1">
                          {drift.relatedCodeChanges.slice(0, 5).map((change, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${
                                change.changeType === 'added' ? 'bg-green-500' :
                                change.changeType === 'removed' ? 'bg-red-500' : 'bg-yellow-500'
                              }`} />
                              <span className="font-mono text-xs">{change.file}</span>
                              <span className="text-gray-400 text-xs">{formatDate(change.date)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Suggested Actions */}
                    {drift.suggestedActions.length > 0 && (
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-1">Suggested Actions</div>
                        <ul className="text-sm text-gray-600 space-y-1">
                          {drift.suggestedActions.map((action, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-blue-500">→</span>
                              {action}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {scanResult && scanResult.driftsDetected.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
          <div className="text-4xl mb-2">✨</div>
          <div className="text-lg font-medium text-green-800">All documentation is up to date!</div>
          <div className="text-sm text-green-600">
            No drift detected in {scanResult.documentsScanned} documents
          </div>
        </div>
      )}
    </div>
  );
}
