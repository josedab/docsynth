'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface TestResult {
  id: string;
  documentId: string;
  documentPath: string;
  codeBlockIndex: number;
  language: string;
  code: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  output?: string;
  error?: string;
  duration: number;
  testedAt: string;
}

interface TestSuite {
  repositoryId: string;
  documentId?: string;
  totalTests: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  duration: number;
  results: TestResult[];
  lastRunAt: string;
}

interface CICDConfig {
  platform: 'github' | 'gitlab';
  schedule: 'on_push' | 'daily' | 'weekly';
  branches: string[];
  notifyOnFailure: boolean;
}

interface ExecutableDocsTestingProps {
  repositoryId: string;
  documentId?: string;
  token: string;
}

export function ExecutableDocsTesting({ repositoryId, documentId, token }: ExecutableDocsTestingProps) {
  const [testSuite, setTestSuite] = useState<TestSuite | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<TestResult | null>(null);
  const [showCICDModal, setShowCICDModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const fetchTestResults = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (documentId) params.append('documentId', documentId);

      const response = await apiFetch<{ success: boolean; data: TestSuite }>(
        `/api/executable-docs/repositories/${repositoryId}/results?${params}`,
        { token }
      );
      setTestSuite(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load test results');
    } finally {
      setLoading(false);
    }
  }, [repositoryId, documentId, token]);

  const runTests = async () => {
    try {
      setRunning(true);
      setError(null);

      await apiFetch(`/api/executable-docs/repositories/${repositoryId}/run`, {
        method: 'POST',
        token,
        body: JSON.stringify({ documentId }),
      });

      // Poll for results
      const pollInterval = setInterval(async () => {
        await fetchTestResults();
        // Stop polling when complete (could be smarter)
        setTimeout(() => clearInterval(pollInterval), 30000);
      }, 2000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setRunning(false);
        fetchTestResults();
      }, 30000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run tests');
      setRunning(false);
    }
  };

  useEffect(() => {
    fetchTestResults();
  }, [fetchTestResults]);

  const filteredResults = testSuite?.results.filter(r => 
    statusFilter === 'all' || r.status === statusFilter
  ) || [];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed': return '✅';
      case 'failed': return '❌';
      case 'error': return '⚠️';
      case 'skipped': return '⏭️';
      default: return '❓';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'passed': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      case 'error': return 'bg-yellow-100 text-yellow-800';
      case 'skipped': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getLanguageIcon = (lang: string) => {
    const icons: Record<string, string> = {
      javascript: '🟨',
      typescript: '🔷',
      python: '🐍',
      bash: '💻',
      shell: '💻',
      sh: '💻',
      ruby: '💎',
      go: '🐹',
      rust: '🦀',
    };
    return icons[lang.toLowerCase()] || '📝';
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
              🧪 Executable Documentation Testing
            </h2>
            <p className="text-sm text-gray-500">
              Automatically test code examples in your documentation
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCICDModal(true)}
              className="px-4 py-2 border rounded-lg hover:bg-gray-50 flex items-center gap-2"
            >
              ⚙️ CI/CD Setup
            </button>
            <button
              onClick={runTests}
              disabled={running}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              {running ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Running...
                </>
              ) : (
                <>
                  <span>▶</span>
                  Run Tests
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Stats */}
      {testSuite && (
        <div className="grid grid-cols-5 gap-4">
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-3xl font-bold text-gray-800">{testSuite.totalTests}</div>
            <div className="text-sm text-gray-500">Total Tests</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-3xl font-bold text-green-600">{testSuite.passed}</div>
            <div className="text-sm text-gray-500">Passed</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-3xl font-bold text-red-600">{testSuite.failed}</div>
            <div className="text-sm text-gray-500">Failed</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-3xl font-bold text-yellow-600">{testSuite.errors}</div>
            <div className="text-sm text-gray-500">Errors</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-3xl font-bold text-blue-600">{testSuite.duration}ms</div>
            <div className="text-sm text-gray-500">Duration</div>
          </div>
        </div>
      )}

      {/* Pass Rate Bar */}
      {testSuite && testSuite.totalTests > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">Pass Rate</span>
            <span className={`font-bold ${
              testSuite.passed / testSuite.totalTests >= 0.9 ? 'text-green-600' :
              testSuite.passed / testSuite.totalTests >= 0.7 ? 'text-yellow-600' : 'text-red-600'
            }`}>
              {Math.round((testSuite.passed / testSuite.totalTests) * 100)}%
            </span>
          </div>
          <div className="h-4 bg-gray-200 rounded-full overflow-hidden flex">
            <div
              className="bg-green-500 transition-all"
              style={{ width: `${(testSuite.passed / testSuite.totalTests) * 100}%` }}
            />
            <div
              className="bg-red-500 transition-all"
              style={{ width: `${(testSuite.failed / testSuite.totalTests) * 100}%` }}
            />
            <div
              className="bg-yellow-500 transition-all"
              style={{ width: `${(testSuite.errors / testSuite.totalTests) * 100}%` }}
            />
            <div
              className="bg-gray-400 transition-all"
              style={{ width: `${(testSuite.skipped / testSuite.totalTests) * 100}%` }}
            />
          </div>
          <div className="flex justify-center gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500 rounded" /> Passed</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500 rounded" /> Failed</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-500 rounded" /> Errors</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-gray-400 rounded" /> Skipped</span>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2">
        {['all', 'passed', 'failed', 'error', 'skipped'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize ${
              statusFilter === status
                ? 'bg-blue-600 text-white'
                : 'bg-white shadow hover:bg-gray-50'
            }`}
          >
            {status === 'all' ? 'All' : `${getStatusIcon(status)} ${status}`}
          </button>
        ))}
      </div>

      {/* Results Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Results List */}
        <div className="bg-white rounded-lg shadow divide-y max-h-[500px] overflow-auto">
          {filteredResults.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              {testSuite?.totalTests === 0 
                ? 'No code blocks found to test'
                : 'No results match the filter'}
            </div>
          ) : (
            filteredResults.map((result) => (
              <div
                key={result.id}
                onClick={() => setSelectedResult(result)}
                className={`p-3 cursor-pointer hover:bg-gray-50 ${
                  selectedResult?.id === result.id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{getStatusIcon(result.status)}</span>
                    <span>{getLanguageIcon(result.language)}</span>
                    <span className="font-mono text-sm truncate max-w-[200px]">
                      {result.documentPath}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(result.status)}`}>
                    {result.duration}ms
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-1 pl-12">
                  Block #{result.codeBlockIndex + 1} • {result.language}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Result Detail */}
        <div className="bg-white rounded-lg shadow">
          {selectedResult ? (
            <div className="h-full flex flex-col">
              <div className="p-4 border-b">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{getStatusIcon(selectedResult.status)}</span>
                    <span className="font-medium">Test Result</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(selectedResult.status)}`}>
                    {selectedResult.status}
                  </span>
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  {selectedResult.documentPath} • Block #{selectedResult.codeBlockIndex + 1}
                </div>
              </div>

              {/* Code */}
              <div className="p-4 border-b">
                <div className="text-sm font-medium mb-2 flex items-center gap-2">
                  {getLanguageIcon(selectedResult.language)} {selectedResult.language}
                </div>
                <div className="bg-gray-900 rounded-lg p-3 overflow-auto max-h-32">
                  <pre className="text-green-400 text-xs font-mono whitespace-pre-wrap">
                    {selectedResult.code}
                  </pre>
                </div>
              </div>

              {/* Output */}
              <div className="p-4 flex-1 overflow-auto">
                <div className="text-sm font-medium mb-2">
                  {selectedResult.status === 'failed' || selectedResult.status === 'error' 
                    ? '❌ Error Output' 
                    : '📤 Output'}
                </div>
                <div className={`rounded-lg p-3 overflow-auto max-h-48 ${
                  selectedResult.status === 'failed' || selectedResult.status === 'error'
                    ? 'bg-red-50 border border-red-200'
                    : 'bg-gray-100'
                }`}>
                  <pre className={`text-xs font-mono whitespace-pre-wrap ${
                    selectedResult.status === 'failed' || selectedResult.status === 'error'
                      ? 'text-red-700'
                      : 'text-gray-700'
                  }`}>
                    {selectedResult.error || selectedResult.output || 'No output'}
                  </pre>
                </div>
              </div>

              <div className="p-4 border-t text-xs text-gray-500">
                Tested: {new Date(selectedResult.testedAt).toLocaleString()} • Duration: {selectedResult.duration}ms
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500">
              Select a test result to see details
            </div>
          )}
        </div>
      </div>

      {/* CI/CD Modal */}
      {showCICDModal && (
        <CICDSetupModal
          repositoryId={repositoryId}
          token={token}
          onClose={() => setShowCICDModal(false)}
        />
      )}
    </div>
  );
}

interface CICDSetupModalProps {
  repositoryId: string;
  token: string;
  onClose: () => void;
}

function CICDSetupModal({ repositoryId, token, onClose }: CICDSetupModalProps) {
  const [platform, setPlatform] = useState<'github' | 'gitlab'>('github');
  const [schedule, setSchedule] = useState('on_push');
  const [branches, setBranches] = useState('main');
  const [notifyOnFailure, setNotifyOnFailure] = useState(true);
  const [generatedConfig, setGeneratedConfig] = useState<string>('');
  const [generating, setGenerating] = useState(false);

  const generateConfig = async () => {
    try {
      setGenerating(true);
      const response = await apiFetch<{ success: boolean; data: { config: string } }>(
        `/api/executable-docs/repositories/${repositoryId}/cicd-config`,
        {
          method: 'POST',
          token,
          body: JSON.stringify({
            platform,
            schedule,
            branches: branches.split(',').map(b => b.trim()),
            notifyOnFailure,
          }),
        }
      );
      setGeneratedConfig(response.data.config);
    } catch (err) {
      console.error('Failed to generate config:', err);
    } finally {
      setGenerating(false);
    }
  };

  const copyConfig = () => {
    navigator.clipboard.writeText(generatedConfig);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-auto">
        <h3 className="text-lg font-semibold mb-4">CI/CD Setup</h3>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2">Platform</label>
            <div className="flex gap-2">
              <button
                onClick={() => setPlatform('github')}
                className={`flex-1 px-4 py-2 rounded-lg border ${
                  platform === 'github' ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'
                }`}
              >
                🐙 GitHub Actions
              </button>
              <button
                onClick={() => setPlatform('gitlab')}
                className={`flex-1 px-4 py-2 rounded-lg border ${
                  platform === 'gitlab' ? 'bg-orange-500 text-white' : 'hover:bg-gray-50'
                }`}
              >
                🦊 GitLab CI
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Schedule</label>
            <select
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="on_push">On Push</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Branches</label>
            <input
              type="text"
              value={branches}
              onChange={(e) => setBranches(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="main, develop"
            />
          </div>

          <div className="flex items-center">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyOnFailure}
                onChange={(e) => setNotifyOnFailure(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">Notify on failure</span>
            </label>
          </div>
        </div>

        <button
          onClick={generateConfig}
          disabled={generating}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 mb-4"
        >
          {generating ? 'Generating...' : 'Generate Configuration'}
        </button>

        {generatedConfig && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                {platform === 'github' ? '.github/workflows/doc-tests.yml' : '.gitlab-ci.yml'}
              </span>
              <button
                onClick={copyConfig}
                className="text-sm text-blue-600 hover:underline"
              >
                📋 Copy
              </button>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 overflow-auto max-h-64">
              <pre className="text-green-400 text-xs font-mono whitespace-pre-wrap">
                {generatedConfig}
              </pre>
            </div>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
