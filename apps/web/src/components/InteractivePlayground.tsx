'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api';

interface Playground {
  id: string;
  title: string;
  description?: string;
  runtime: 'javascript' | 'typescript' | 'python' | 'html';
  template: string;
  files: Record<string, string>;
  dependencies: Record<string, string>;
  isPublic: boolean;
  createdAt: string;
}

interface PlaygroundSession {
  id: string;
  playgroundId: string;
  state: Record<string, string>;
  lastOutput?: string;
  lastRunAt?: string;
}

interface InteractivePlaygroundProps {
  repositoryId: string;
  documentId?: string;
  token: string;
  onCodeExtract?: (code: string, language: string) => void;
}

export function InteractivePlayground({ repositoryId, documentId, token, onCodeExtract }: InteractivePlaygroundProps) {
  const [playgrounds, setPlaygrounds] = useState<Playground[]>([]);
  const [selectedPlayground, setSelectedPlayground] = useState<Playground | null>(null);
  const [activeFile, setActiveFile] = useState<string>('');
  const [files, setFiles] = useState<Record<string, string>>({});
  const [output, setOutput] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const fetchPlaygrounds = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ repositoryId });
      if (documentId) params.append('documentId', documentId);

      const response = await apiFetch<{ success: boolean; data: Playground[] }>(
        `/api/playgrounds?${params}`,
        { token }
      );
      setPlaygrounds(response.data);

      // Auto-select first playground
      if (response.data.length > 0 && !selectedPlayground) {
        selectPlayground(response.data[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load playgrounds');
    } finally {
      setLoading(false);
    }
  }, [repositoryId, documentId, token]);

  const selectPlayground = (playground: Playground) => {
    setSelectedPlayground(playground);
    setFiles(playground.files);
    const firstFile = Object.keys(playground.files)[0] || '';
    setActiveFile(firstFile);
    setOutput('');
  };

  const handleRunCode = async () => {
    if (!selectedPlayground) return;

    try {
      setRunning(true);
      setError(null);

      const response = await apiFetch<{ success: boolean; data: { output: string; error?: string } }>(
        `/api/playgrounds/${selectedPlayground.id}/run`,
        {
          method: 'POST',
          token,
          body: JSON.stringify({ files }),
        }
      );

      setOutput(response.data.output || response.data.error || 'No output');
    } catch (err) {
      setOutput(`Error: ${err instanceof Error ? err.message : 'Execution failed'}`);
    } finally {
      setRunning(false);
    }
  };

  const handleSavePlayground = async () => {
    if (!selectedPlayground) return;

    try {
      await apiFetch(`/api/playgrounds/${selectedPlayground.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ files }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const handleResetPlayground = () => {
    if (selectedPlayground) {
      setFiles(selectedPlayground.files);
      setOutput('');
    }
  };

  const handleFileChange = (content: string) => {
    setFiles(prev => ({ ...prev, [activeFile]: content }));
  };

  const handleAddFile = (filename: string) => {
    if (!filename.trim() || files[filename]) return;
    setFiles(prev => ({ ...prev, [filename]: '' }));
    setActiveFile(filename);
  };

  const handleDeleteFile = (filename: string) => {
    const newFiles = { ...files };
    delete newFiles[filename];
    setFiles(newFiles);
    if (activeFile === filename) {
      setActiveFile(Object.keys(newFiles)[0] || '');
    }
  };

  useEffect(() => {
    fetchPlaygrounds();
  }, [fetchPlaygrounds]);

  const getRuntimeIcon = (runtime: string) => {
    switch (runtime) {
      case 'javascript': return '🟨';
      case 'typescript': return '🔷';
      case 'python': return '🐍';
      case 'html': return '🌐';
      default: return '📄';
    }
  };

  const getLanguageFromFile = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js': return 'javascript';
      case 'ts': case 'tsx': return 'typescript';
      case 'py': return 'python';
      case 'html': return 'html';
      case 'css': return 'css';
      case 'json': return 'json';
      default: return 'text';
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
              🎮 Interactive Playgrounds
            </h2>
            <p className="text-sm text-gray-500">
              Run and experiment with code examples in your browser
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            + New Playground
          </button>
        </div>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Playground selector */}
      {playgrounds.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {playgrounds.map((pg) => (
            <button
              key={pg.id}
              onClick={() => selectPlayground(pg)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
                selectedPlayground?.id === pg.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-white shadow hover:bg-gray-50'
              }`}
            >
              <span>{getRuntimeIcon(pg.runtime)}</span>
              <span>{pg.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* Main Editor Area */}
      {selectedPlayground ? (
        <div className="grid grid-cols-2 gap-4 h-[600px]">
          {/* Editor Panel */}
          <div className="bg-white rounded-lg shadow flex flex-col overflow-hidden">
            {/* File tabs */}
            <div className="flex items-center border-b bg-gray-50 px-2">
              <div className="flex items-center gap-1 overflow-x-auto flex-1">
                {Object.keys(files).map((filename) => (
                  <div
                    key={filename}
                    className={`flex items-center gap-1 px-3 py-2 cursor-pointer text-sm ${
                      activeFile === filename
                        ? 'bg-white border-t-2 border-blue-500 -mb-px'
                        : 'hover:bg-gray-100'
                    }`}
                    onClick={() => setActiveFile(filename)}
                  >
                    <span>{filename}</span>
                    {Object.keys(files).length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteFile(filename); }}
                        className="text-gray-400 hover:text-red-500 ml-1"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  const name = prompt('File name:');
                  if (name) handleAddFile(name);
                }}
                className="px-2 py-1 text-gray-500 hover:text-gray-700"
                title="Add file"
              >
                +
              </button>
            </div>

            {/* Code editor */}
            <div className="flex-1 relative">
              <textarea
                ref={editorRef}
                value={files[activeFile] || ''}
                onChange={(e) => handleFileChange(e.target.value)}
                className="w-full h-full p-4 font-mono text-sm resize-none focus:outline-none"
                spellCheck={false}
                placeholder={`// Write your ${getLanguageFromFile(activeFile)} code here...`}
              />
            </div>

            {/* Editor toolbar */}
            <div className="flex items-center justify-between p-2 border-t bg-gray-50">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRunCode}
                  disabled={running}
                  className="px-4 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {running ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      Running...
                    </>
                  ) : (
                    <>
                      <span>▶</span>
                      Run
                    </>
                  )}
                </button>
                <button
                  onClick={handleResetPlayground}
                  className="px-3 py-1.5 text-gray-600 hover:bg-gray-200 rounded"
                >
                  ↺ Reset
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSavePlayground}
                  className="px-3 py-1.5 text-gray-600 hover:bg-gray-200 rounded"
                >
                  💾 Save
                </button>
                {onCodeExtract && (
                  <button
                    onClick={() => onCodeExtract(files[activeFile] || '', getLanguageFromFile(activeFile))}
                    className="px-3 py-1.5 text-gray-600 hover:bg-gray-200 rounded"
                  >
                    📋 Copy
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Output Panel */}
          <div className="bg-gray-900 rounded-lg shadow flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
              <span className="text-gray-400 text-sm font-medium">Output</span>
              <button
                onClick={() => setOutput('')}
                className="text-gray-500 hover:text-gray-300 text-sm"
              >
                Clear
              </button>
            </div>
            <div className="flex-1 p-4 overflow-auto">
              {output ? (
                <pre className="text-green-400 font-mono text-sm whitespace-pre-wrap">
                  {output}
                </pre>
              ) : (
                <div className="text-gray-500 text-sm">
                  Click "Run" to execute your code...
                </div>
              )}
            </div>

            {/* Preview for HTML */}
            {selectedPlayground.runtime === 'html' && files['index.html'] && (
              <div className="border-t border-gray-700">
                <div className="px-4 py-2 text-gray-400 text-sm border-b border-gray-700">
                  Preview
                </div>
                <iframe
                  srcDoc={files['index.html']}
                  className="w-full h-64 bg-white"
                  sandbox="allow-scripts"
                  title="HTML Preview"
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-4xl mb-4">🎮</div>
          <h3 className="text-lg font-medium mb-2">No playgrounds yet</h3>
          <p className="text-gray-500 mb-4">
            Create an interactive playground to experiment with code examples
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Create First Playground
          </button>
        </div>
      )}

      {/* Keyboard shortcuts hint */}
      {selectedPlayground && (
        <div className="text-center text-xs text-gray-400">
          Tip: Press <kbd className="px-1 py-0.5 bg-gray-100 rounded">Ctrl</kbd> + <kbd className="px-1 py-0.5 bg-gray-100 rounded">Enter</kbd> to run code
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreatePlaygroundModal
          repositoryId={repositoryId}
          documentId={documentId}
          token={token}
          onClose={() => setShowCreateModal(false)}
          onCreated={(pg) => {
            setShowCreateModal(false);
            fetchPlaygrounds();
            selectPlayground(pg);
          }}
        />
      )}
    </div>
  );
}

interface CreatePlaygroundModalProps {
  repositoryId: string;
  documentId?: string;
  token: string;
  onClose: () => void;
  onCreated: (playground: Playground) => void;
}

function CreatePlaygroundModal({ repositoryId, documentId, token, onClose, onCreated }: CreatePlaygroundModalProps) {
  const [title, setTitle] = useState('');
  const [runtime, setRuntime] = useState<'javascript' | 'typescript' | 'python' | 'html'>('javascript');
  const [template, setTemplate] = useState('blank');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templates: Record<string, { name: string; runtimes: string[] }> = {
    blank: { name: 'Blank', runtimes: ['javascript', 'typescript', 'python', 'html'] },
    react: { name: 'React Component', runtimes: ['javascript', 'typescript'] },
    express: { name: 'Express Server', runtimes: ['javascript', 'typescript'] },
    flask: { name: 'Flask API', runtimes: ['python'] },
    landing: { name: 'Landing Page', runtimes: ['html'] },
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      setSubmitting(true);
      setError(null);

      const response = await apiFetch<{ success: boolean; data: Playground }>(
        `/api/playgrounds`,
        {
          method: 'POST',
          token,
          body: JSON.stringify({
            repositoryId,
            documentId,
            title,
            runtime,
            template,
          }),
        }
      );

      onCreated(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create playground');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold mb-4">Create Playground</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="My Playground"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Runtime</label>
            <div className="grid grid-cols-4 gap-2">
              {(['javascript', 'typescript', 'python', 'html'] as const).map((rt) => (
                <button
                  key={rt}
                  type="button"
                  onClick={() => setRuntime(rt)}
                  className={`px-3 py-2 rounded-lg border text-sm capitalize ${
                    runtime === rt
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  {rt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Template</label>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            >
              {Object.entries(templates)
                .filter(([, t]) => t.runtimes.includes(runtime))
                .map(([key, t]) => (
                  <option key={key} value={key}>{t.name}</option>
                ))}
            </select>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
