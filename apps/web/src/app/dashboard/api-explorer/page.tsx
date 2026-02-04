'use client';

import { useState } from 'react';

interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  description: string;
  params?: { name: string; type: string; required: boolean; description: string }[];
  body?: { name: string; type: string; required: boolean; description: string }[];
  response?: string;
}

const ENDPOINTS: Endpoint[] = [
  // Repositories
  { method: 'GET', path: '/api/repositories', description: 'List all repositories', params: [
    { name: 'page', type: 'number', required: false, description: 'Page number' },
    { name: 'limit', type: 'number', required: false, description: 'Results per page' },
  ]},
  { method: 'GET', path: '/api/repositories/:id', description: 'Get repository details', params: [
    { name: 'id', type: 'string', required: true, description: 'Repository ID' },
  ]},
  { method: 'POST', path: '/api/repositories/:id/enable', description: 'Enable doc generation', params: [
    { name: 'id', type: 'string', required: true, description: 'Repository ID' },
  ]},
  { method: 'POST', path: '/api/repositories/:id/disable', description: 'Disable doc generation', params: [
    { name: 'id', type: 'string', required: true, description: 'Repository ID' },
  ]},
  { method: 'POST', path: '/api/repositories/sync', description: 'Sync repositories from GitHub' },

  // Jobs
  { method: 'GET', path: '/api/jobs', description: 'List generation jobs', params: [
    { name: 'status', type: 'string', required: false, description: 'Filter by status (pending, running, completed, failed)' },
    { name: 'repo', type: 'string', required: false, description: 'Filter by repository ID' },
  ]},
  { method: 'GET', path: '/api/jobs/:id', description: 'Get job details', params: [
    { name: 'id', type: 'string', required: true, description: 'Job ID' },
  ]},
  { method: 'POST', path: '/api/jobs', description: 'Trigger new generation job', body: [
    { name: 'repositoryId', type: 'string', required: true, description: 'Repository to generate docs for' },
    { name: 'docTypes', type: 'string[]', required: false, description: 'Specific doc types to generate' },
  ]},

  // Documents
  { method: 'GET', path: '/api/documents', description: 'List generated documents', params: [
    { name: 'repo', type: 'string', required: false, description: 'Filter by repository' },
    { name: 'type', type: 'string', required: false, description: 'Filter by doc type' },
  ]},
  { method: 'GET', path: '/api/documents/:id', description: 'Get document content', params: [
    { name: 'id', type: 'string', required: true, description: 'Document ID' },
    { name: 'version', type: 'number', required: false, description: 'Specific version number' },
  ]},
  { method: 'GET', path: '/api/documents/:id/versions', description: 'List document versions' },
  { method: 'POST', path: '/api/documents/:id/regenerate', description: 'Regenerate a document' },

  // Analytics
  { method: 'GET', path: '/api/analytics/health', description: 'Get health metrics', params: [
    { name: 'repo', type: 'string', required: false, description: 'Filter by repository' },
  ]},
  { method: 'GET', path: '/api/analytics/drift', description: 'Get drift analysis' },
  { method: 'GET', path: '/api/analytics/usage', description: 'Get usage statistics' },

  // Chat
  { method: 'POST', path: '/api/chat', description: 'Send chat message (RAG)', body: [
    { name: 'message', type: 'string', required: true, description: 'User message' },
    { name: 'repositoryId', type: 'string', required: false, description: 'Context repository' },
    { name: 'conversationId', type: 'string', required: false, description: 'Conversation ID for context' },
  ]},

  // API Keys
  { method: 'GET', path: '/api/api-keys', description: 'List API keys' },
  { method: 'POST', path: '/api/api-keys', description: 'Create new API key', body: [
    { name: 'name', type: 'string', required: true, description: 'Key name' },
    { name: 'scopes', type: 'string[]', required: true, description: 'Permissions' },
    { name: 'expiryDays', type: 'number', required: false, description: 'Days until expiry' },
  ]},
  { method: 'DELETE', path: '/api/api-keys/:id', description: 'Delete API key' },
  { method: 'POST', path: '/api/api-keys/:id/rotate', description: 'Rotate API key' },
];

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  POST: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  PUT: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  PATCH: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export default function ApiExplorerPage() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [body, setBody] = useState<string>('{}');
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const executeRequest = async () => {
    if (!selectedEndpoint) return;
    setLoading(true);
    setResponse(null);

    try {
      let path = selectedEndpoint.path;
      // Replace path params
      Object.entries(params).forEach(([key, value]) => {
        path = path.replace(`:${key}`, value);
      });

      // Add query params for GET
      if (selectedEndpoint.method === 'GET' && selectedEndpoint.params) {
        const queryParams = new URLSearchParams();
        selectedEndpoint.params.filter(p => !selectedEndpoint.path.includes(`:${p.name}`)).forEach(p => {
          if (params[p.name]) queryParams.set(p.name, params[p.name]);
        });
        if (queryParams.toString()) path += `?${queryParams.toString()}`;
      }

      const token = localStorage.getItem('docsynth_token');
      const options: RequestInit = {
        method: selectedEndpoint.method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      };

      if (['POST', 'PUT', 'PATCH'].includes(selectedEndpoint.method)) {
        options.body = body;
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}${path}`, options);
      const data = await res.json();
      setResponse(JSON.stringify(data, null, 2));
    } catch (error) {
      setResponse(JSON.stringify({ error: (error as Error).message }, null, 2));
    } finally {
      setLoading(false);
    }
  };

  const generateCurl = () => {
    if (!selectedEndpoint) return '';

    let path = selectedEndpoint.path;
    Object.entries(params).forEach(([key, value]) => {
      path = path.replace(`:${key}`, value || `:${key}`);
    });

    let curl = `curl -X ${selectedEndpoint.method} \\\n  '${process.env.NEXT_PUBLIC_API_URL || 'https://api.docsynth.dev'}${path}' \\\n  -H 'Authorization: Bearer $DOCSYNTH_API_KEY' \\\n  -H 'Content-Type: application/json'`;

    if (['POST', 'PUT', 'PATCH'].includes(selectedEndpoint.method)) {
      curl += ` \\\n  -d '${body}'`;
    }

    return curl;
  };

  const copyCurl = () => {
    navigator.clipboard.writeText(generateCurl());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)]">
      {/* Endpoints List */}
      <div className="w-80 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">API Explorer</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Test endpoints interactively</p>
        </div>

        <div className="p-2">
          {ENDPOINTS.map((endpoint, i) => (
            <button
              key={i}
              onClick={() => {
                setSelectedEndpoint(endpoint);
                setParams({});
                setBody('{}');
                setResponse(null);
              }}
              className={`w-full flex items-center gap-2 p-3 rounded-lg text-left transition-colors ${
                selectedEndpoint === endpoint
                  ? 'bg-blue-50 dark:bg-blue-900/30'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <span className={`px-2 py-0.5 text-xs font-bold rounded ${METHOD_COLORS[endpoint.method]}`}>
                {endpoint.method}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono text-gray-900 dark:text-white truncate">{endpoint.path}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{endpoint.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Request Builder */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedEndpoint ? (
          <>
            {/* Endpoint Header */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <span className={`px-2 py-1 text-sm font-bold rounded ${METHOD_COLORS[selectedEndpoint.method]}`}>
                  {selectedEndpoint.method}
                </span>
                <code className="text-lg font-mono text-gray-900 dark:text-white">{selectedEndpoint.path}</code>
              </div>
              <p className="text-gray-500 dark:text-gray-400">{selectedEndpoint.description}</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Parameters */}
              {selectedEndpoint.params && selectedEndpoint.params.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Parameters</h3>
                  <div className="space-y-3">
                    {selectedEndpoint.params.map(param => (
                      <div key={param.name}>
                        <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                          <span className="font-medium">{param.name}</span>
                          {param.required && <span className="text-red-500 ml-1">*</span>}
                          <span className="text-gray-400 ml-2 text-xs">{param.type}</span>
                        </label>
                        <input
                          type="text"
                          value={params[param.name] || ''}
                          onChange={e => setParams({ ...params, [param.name]: e.target.value })}
                          placeholder={param.description}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Request Body */}
              {selectedEndpoint.body && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Request Body</h3>
                  <div className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                    {selectedEndpoint.body.map(f => (
                      <span key={f.name} className="mr-3">
                        <code>{f.name}</code>
                        {f.required && <span className="text-red-500">*</span>}
                        <span className="text-gray-400"> ({f.type})</span>
                      </span>
                    ))}
                  </div>
                  <textarea
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
                  />
                </div>
              )}

              {/* cURL */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">cURL</h3>
                  <button
                    onClick={copyCurl}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
                  {generateCurl()}
                </pre>
              </div>

              {/* Response */}
              {response && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Response</h3>
                  <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto max-h-80">
                    {response}
                  </pre>
                </div>
              )}
            </div>

            {/* Execute Button */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={executeRequest}
                disabled={loading}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {loading ? 'Sending...' : 'Send Request'}
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p>Select an endpoint to get started</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
