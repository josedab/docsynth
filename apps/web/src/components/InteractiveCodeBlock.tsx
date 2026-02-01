'use client';

import { useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface InteractiveCodeBlockProps {
  exampleId: string;
  initialCode: string;
  language: string;
  expectedOutput?: string;
  isRunnable: boolean;
  validationStatus: string;
  token: string;
}

interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode: number;
  executionMs: number;
}

export function InteractiveCodeBlock({
  exampleId,
  initialCode,
  language,
  expectedOutput,
  isRunnable,
  validationStatus,
  token,
}: InteractiveCodeBlockProps) {
  const [code, setCode] = useState(initialCode);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [isEdited, setIsEdited] = useState(false);

  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode);
    setIsEdited(newCode !== initialCode);
  }, [initialCode]);

  const executeCode = useCallback(async () => {
    setIsExecuting(true);
    setOutput(null);
    setError(null);

    try {
      const response = await apiFetch<{ success: boolean; data: ExecutionResult }>(
        `/api/examples/${exampleId}/execute`,
        {
          token,
          method: 'POST',
          body: JSON.stringify({ code: isEdited ? code : undefined }),
        }
      );

      const result = response.data;
      setOutput(result.output || '');
      setError(result.error || null);
      setExecutionTime(result.executionMs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setIsExecuting(false);
    }
  }, [exampleId, code, isEdited, token]);

  const resetCode = useCallback(() => {
    setCode(initialCode);
    setIsEdited(false);
    setOutput(null);
    setError(null);
  }, [initialCode]);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(code);
  }, [code]);

  const getLanguageIcon = (lang: string) => {
    const icons: Record<string, string> = {
      javascript: '🟨',
      typescript: '🔷',
      python: '🐍',
      go: '🐹',
      rust: '🦀',
      bash: '💻',
    };
    return icons[lang] || '📝';
  };

  const getStatusBadge = () => {
    switch (validationStatus) {
      case 'valid':
        return <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">✓ Verified</span>;
      case 'invalid':
        return <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded">✗ Failing</span>;
      case 'pending':
        return <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded">⏳ Pending</span>;
      case 'error':
        return <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">⚠ Error</span>;
      default:
        return null;
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
        <div className="flex items-center gap-2">
          <span>{getLanguageIcon(language)}</span>
          <span className="text-sm font-medium capitalize">{language}</span>
          {getStatusBadge()}
          {isEdited && (
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">Modified</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyCode}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
            title="Copy code"
          >
            📋
          </button>
          {isEdited && (
            <button
              onClick={resetCode}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
              title="Reset to original"
            >
              ↩️
            </button>
          )}
        </div>
      </div>

      {/* Code editor */}
      <div className="relative">
        <textarea
          value={code}
          onChange={(e) => handleCodeChange(e.target.value)}
          className="w-full p-4 font-mono text-sm bg-gray-900 text-gray-100 min-h-[150px] resize-y focus:outline-none"
          spellCheck={false}
        />
        {/* Line numbers overlay could be added here */}
      </div>

      {/* Run button */}
      {isRunnable && (
        <div className="px-4 py-3 bg-gray-50 border-t flex items-center justify-between">
          <button
            onClick={executeCode}
            disabled={isExecuting}
            className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 ${
              isExecuting
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {isExecuting ? (
              <>
                <span className="animate-spin">⏳</span>
                Running...
              </>
            ) : (
              <>
                ▶️ Run Code
              </>
            )}
          </button>
          {executionTime !== null && (
            <span className="text-xs text-gray-500">
              Executed in {executionTime}ms
            </span>
          )}
        </div>
      )}

      {/* Output panel */}
      {(output !== null || error !== null) && (
        <div className="border-t">
          <div className="px-4 py-2 bg-gray-100 border-b">
            <span className="text-sm font-medium">
              {error ? '❌ Error' : '✅ Output'}
            </span>
          </div>
          <pre
            className={`p-4 text-sm font-mono overflow-x-auto max-h-48 ${
              error ? 'bg-red-50 text-red-800' : 'bg-gray-50 text-gray-800'
            }`}
          >
            {error || output || '(no output)'}
          </pre>
        </div>
      )}

      {/* Expected output comparison */}
      {expectedOutput && output && !error && (
        <div className="border-t px-4 py-2 bg-blue-50">
          <div className="text-xs text-blue-600 mb-1">Expected output:</div>
          <pre className="text-xs font-mono text-blue-800">{expectedOutput}</pre>
          {output.trim().includes(expectedOutput.trim()) ? (
            <div className="text-xs text-green-600 mt-1">✓ Output matches expected</div>
          ) : (
            <div className="text-xs text-orange-600 mt-1">⚠ Output differs from expected</div>
          )}
        </div>
      )}
    </div>
  );
}
