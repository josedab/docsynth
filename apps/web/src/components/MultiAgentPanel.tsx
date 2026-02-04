'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface AgentTask {
  id: string;
  agentType: 'reader' | 'searcher' | 'writer' | 'verifier' | 'orchestrator';
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

interface AgentRun {
  id: string;
  runType: 'generate' | 'update' | 'review' | 'migrate';
  status: 'pending' | 'running' | 'completed' | 'failed';
  config: {
    scope?: string;
    focusAreas?: string[];
    style?: string;
  };
  result?: {
    generatedDocs: string[];
    suggestedChanges: { path: string; change: string }[];
    verificationScore: number;
    factualErrors: string[];
  };
  error?: string;
  tasks: AgentTask[];
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

interface MultiAgentPanelProps {
  repositoryId: string;
  documentId?: string;
  token: string;
  onDocGenerated?: (content: string) => void;
}

const AGENT_INFO: Record<string, { icon: string; name: string; description: string }> = {
  reader: { icon: '📖', name: 'Reader Agent', description: 'Analyzes code structure and extracts information' },
  searcher: { icon: '🔍', name: 'Searcher Agent', description: 'Finds context from existing docs and web' },
  writer: { icon: '✍️', name: 'Writer Agent', description: 'Generates documentation content' },
  verifier: { icon: '✅', name: 'Verifier Agent', description: 'Fact-checks and validates accuracy' },
  orchestrator: { icon: '🎯', name: 'Orchestrator', description: 'Coordinates all agents' },
};

export function MultiAgentPanel({ repositoryId, documentId, token, onDocGenerated }: MultiAgentPanelProps) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);

  const fetchRuns = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ repositoryId });
      if (documentId) params.append('documentId', documentId);

      const response = await apiFetch<{ success: boolean; data: AgentRun[] }>(
        `/api/multi-agent-doc/runs?${params}`,
        { token }
      );
      setRuns(response.data);

      // Auto-select running or most recent run
      const active = response.data.find(r => r.status === 'running');
      if (active) setSelectedRun(active);
      else if (response.data.length > 0 && !selectedRun) {
        setSelectedRun(response.data[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent runs');
    } finally {
      setLoading(false);
    }
  }, [repositoryId, documentId, token]);

  const startNewRun = async (config: { runType: string; scope: string; focusAreas: string[]; style: string }) => {
    try {
      setStarting(true);
      setError(null);

      const response = await apiFetch<{ success: boolean; data: AgentRun }>(
        `/api/multi-agent-doc/repositories/${repositoryId}/run`,
        {
          method: 'POST',
          token,
          body: JSON.stringify({
            documentId,
            ...config,
          }),
        }
      );

      setSelectedRun(response.data);
      setShowConfigModal(false);

      // Start polling for updates
      pollRunStatus(response.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start agent run');
    } finally {
      setStarting(false);
    }
  };

  const pollRunStatus = async (runId: string) => {
    const poll = async () => {
      try {
        const response = await apiFetch<{ success: boolean; data: AgentRun }>(
          `/api/multi-agent-doc/runs/${runId}`,
          { token }
        );

        setSelectedRun(response.data);
        setRuns(prev => prev.map(r => r.id === runId ? response.data : r));

        if (response.data.status === 'running') {
          setTimeout(poll, 2000);
        } else if (response.data.status === 'completed' && response.data.result?.generatedDocs?.length) {
          onDocGenerated?.(response.data.result.generatedDocs[0]);
        }
      } catch (err) {
        console.error('Failed to poll run status:', err);
      }
    };

    poll();
  };

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'running': return 'bg-blue-100 text-blue-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
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
            <h2 className="text-lg font-semibold flex items-center gap-2">
              🤖 Multi-Agent Documentation
            </h2>
            <p className="text-sm text-gray-500">
              5 specialized AI agents working together to generate accurate documentation
            </p>
          </div>
          <button
            onClick={() => setShowConfigModal(true)}
            disabled={starting}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
          >
            {starting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Starting...
              </>
            ) : (
              <>
                <span>🚀</span>
                Start Agent Run
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

      {/* Agent Overview */}
      <div className="grid grid-cols-5 gap-3">
        {Object.entries(AGENT_INFO).map(([key, info]) => {
          const task = selectedRun?.tasks.find(t => t.agentType === key);
          return (
            <div
              key={key}
              className={`bg-white rounded-lg shadow p-3 ${
                task?.status === 'running' ? 'ring-2 ring-blue-500 animate-pulse' : ''
              }`}
            >
              <div className="text-2xl mb-1">{info.icon}</div>
              <div className="font-medium text-sm">{info.name}</div>
              <div className="text-xs text-gray-500 mb-2">{info.description}</div>
              {task && (
                <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(task.status)}`}>
                  {task.status}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Run History */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-3 border-b font-medium">Run History</div>
          <div className="divide-y max-h-96 overflow-auto">
            {runs.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                No runs yet. Start an agent run to generate documentation.
              </div>
            ) : (
              runs.map((run) => (
                <div
                  key={run.id}
                  onClick={() => setSelectedRun(run)}
                  className={`p-3 cursor-pointer hover:bg-gray-50 ${
                    selectedRun?.id === run.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm capitalize">{run.runType}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(run.status)}`}>
                      {run.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {new Date(run.createdAt).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Run Details */}
        <div className="col-span-2 bg-white rounded-lg shadow">
          {selectedRun ? (
            <div className="h-full flex flex-col">
              <div className="p-4 border-b">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium capitalize">{selectedRun.runType} Run</h3>
                  <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(selectedRun.status)}`}>
                    {selectedRun.status}
                  </span>
                </div>
                {selectedRun.config.scope && (
                  <div className="text-sm text-gray-500 mt-1">
                    Scope: {selectedRun.config.scope}
                  </div>
                )}
              </div>

              {/* Task Timeline */}
              <div className="p-4 border-b">
                <h4 className="text-sm font-medium mb-3">Agent Progress</h4>
                <div className="space-y-2">
                  {selectedRun.tasks.map((task, i) => {
                    const info = AGENT_INFO[task.agentType];
                    return (
                      <div key={task.id} className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm ${
                          task.status === 'completed' ? 'bg-green-500 text-white' :
                          task.status === 'running' ? 'bg-blue-500 text-white animate-pulse' :
                          task.status === 'failed' ? 'bg-red-500 text-white' : 'bg-gray-200'
                        }`}>
                          {task.status === 'completed' ? '✓' :
                           task.status === 'running' ? '⋯' :
                           task.status === 'failed' ? '✗' : i + 1}
                        </span>
                        <div className="flex-1">
                          <div className="text-sm">{info?.name || task.agentType}</div>
                          {task.durationMs && (
                            <div className="text-xs text-gray-400">{task.durationMs}ms</div>
                          )}
                        </div>
                        {task.error && (
                          <span className="text-xs text-red-500" title={task.error}>Error</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Results */}
              {selectedRun.result && (
                <div className="p-4 flex-1 overflow-auto">
                  <h4 className="text-sm font-medium mb-3">Results</h4>

                  {selectedRun.result.verificationScore !== undefined && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span>Verification Score</span>
                        <span className={selectedRun.result.verificationScore >= 0.8 ? 'text-green-600' : 'text-yellow-600'}>
                          {Math.round(selectedRun.result.verificationScore * 100)}%
                        </span>
                      </div>
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            selectedRun.result.verificationScore >= 0.8 ? 'bg-green-500' : 'bg-yellow-500'
                          }`}
                          style={{ width: `${selectedRun.result.verificationScore * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {selectedRun.result.generatedDocs?.length > 0 && (
                    <div className="mb-4">
                      <div className="text-sm font-medium mb-2">Generated Documents</div>
                      <div className="bg-gray-50 rounded-lg p-3 max-h-48 overflow-auto">
                        <pre className="text-xs whitespace-pre-wrap">
                          {selectedRun.result.generatedDocs[0]?.slice(0, 500)}...
                        </pre>
                      </div>
                      {onDocGenerated && (
                        <button
                          onClick={() => onDocGenerated(selectedRun.result?.generatedDocs[0] || '')}
                          className="mt-2 text-sm text-blue-600 hover:underline"
                        >
                          Insert into editor →
                        </button>
                      )}
                    </div>
                  )}

                  {selectedRun.result.factualErrors?.length > 0 && (
                    <div className="mb-4">
                      <div className="text-sm font-medium mb-2 text-red-600">
                        ⚠️ Factual Issues Found ({selectedRun.result.factualErrors.length})
                      </div>
                      <ul className="text-xs text-red-700 space-y-1">
                        {selectedRun.result.factualErrors.map((err, i) => (
                          <li key={i}>• {err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selectedRun.result.suggestedChanges?.length > 0 && (
                    <div>
                      <div className="text-sm font-medium mb-2">Suggested Changes</div>
                      <div className="space-y-2">
                        {selectedRun.result.suggestedChanges.map((change, i) => (
                          <div key={i} className="bg-yellow-50 rounded p-2 text-xs">
                            <div className="font-mono text-gray-600">{change.path}</div>
                            <div className="text-gray-700">{change.change}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selectedRun.error && (
                <div className="p-4">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                    {selectedRun.error}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500">
              Select a run to see details
            </div>
          )}
        </div>
      </div>

      {/* Config Modal */}
      {showConfigModal && (
        <AgentConfigModal
          onClose={() => setShowConfigModal(false)}
          onStart={startNewRun}
        />
      )}
    </div>
  );
}

interface AgentConfigModalProps {
  onClose: () => void;
  onStart: (config: { runType: string; scope: string; focusAreas: string[]; style: string }) => void;
}

function AgentConfigModal({ onClose, onStart }: AgentConfigModalProps) {
  const [runType, setRunType] = useState('generate');
  const [scope, setScope] = useState('full');
  const [focusAreas, setFocusAreas] = useState<string[]>(['api', 'setup']);
  const [style, setStyle] = useState('concise');

  const handleFocusToggle = (area: string) => {
    setFocusAreas(prev =>
      prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold mb-4">Configure Agent Run</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Run Type</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'generate', label: '✨ Generate', desc: 'Create new docs' },
                { value: 'update', label: '🔄 Update', desc: 'Refresh existing' },
                { value: 'review', label: '👀 Review', desc: 'Check accuracy' },
                { value: 'migrate', label: '📦 Migrate', desc: 'Convert format' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRunType(opt.value)}
                  className={`p-2 rounded-lg border text-left ${
                    runType === opt.value
                      ? 'bg-blue-50 border-blue-500'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium text-sm">{opt.label}</div>
                  <div className="text-xs text-gray-500">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Scope</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="full">Full Repository</option>
              <option value="changed">Changed Files Only</option>
              <option value="module">Specific Module</option>
              <option value="api">API Endpoints</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Focus Areas</label>
            <div className="flex flex-wrap gap-2">
              {['api', 'setup', 'examples', 'architecture', 'security', 'testing'].map((area) => (
                <button
                  key={area}
                  type="button"
                  onClick={() => handleFocusToggle(area)}
                  className={`px-3 py-1 rounded-full text-sm ${
                    focusAreas.includes(area)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                >
                  {area}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Writing Style</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="concise">Concise & Technical</option>
              <option value="detailed">Detailed & Explanatory</option>
              <option value="tutorial">Tutorial Style</option>
              <option value="reference">API Reference</option>
            </select>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onStart({ runType, scope, focusAreas, style })}
            className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            🚀 Start Agents
          </button>
        </div>
      </div>
    </div>
  );
}
