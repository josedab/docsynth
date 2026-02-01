'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api';

interface DiagramResult {
  diagram: string;
  diagramType: string;
  format: 'mermaid' | 'd2' | 'plantuml';
  metadata: {
    moduleCount?: number;
    relationshipCount?: number;
    layerCount?: number;
    generatedAt: string;
  };
}

interface ArchitectureDiagramsProps {
  repositoryId: string;
  token: string;
}

type DiagramType = 'architecture' | 'dependency' | 'component' | 'er-diagram';

export function ArchitectureDiagrams({ repositoryId, token }: ArchitectureDiagramsProps) {
  const [diagramType, setDiagramType] = useState<DiagramType>('architecture');
  const [diagram, setDiagram] = useState<DiagramResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const diagramRef = useRef<HTMLDivElement>(null);

  const diagramTypes: { type: DiagramType; label: string; icon: string; description: string }[] = [
    { type: 'architecture', label: 'Architecture', icon: '🏗️', description: 'Overall architecture with layers' },
    { type: 'dependency', label: 'Dependencies', icon: '🔗', description: 'Module dependencies by type' },
    { type: 'component', label: 'Components', icon: '📦', description: 'Component relationships' },
    { type: 'er-diagram', label: 'ER Diagram', icon: '🗄️', description: 'Database schema relationships' },
  ];

  const fetchDiagram = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const endpoint = diagramType === 'er-diagram'
        ? `/api/diagrams/er-diagram?repositoryId=${repositoryId}`
        : `/api/diagrams/generate?repositoryId=${repositoryId}&type=${diagramType}`;

      const response = await apiFetch<{ success: boolean; data: DiagramResult }>(
        endpoint,
        { token }
      );
      setDiagram(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate diagram');
      setDiagram(null);
    } finally {
      setLoading(false);
    }
  }, [repositoryId, token, diagramType]);

  useEffect(() => {
    fetchDiagram();
  }, [fetchDiagram]);

  const copyToClipboard = async () => {
    if (!diagram) return;
    
    try {
      await navigator.clipboard.writeText(diagram.diagram);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const downloadDiagram = () => {
    if (!diagram) return;
    
    const blob = new Blob([diagram.diagram], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${diagramType}-diagram.${diagram.format === 'mermaid' ? 'mmd' : diagram.format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Type Selector */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-4 gap-2">
          {diagramTypes.map(({ type, label, icon, description }) => (
            <button
              key={type}
              onClick={() => setDiagramType(type)}
              className={`p-3 rounded-lg text-left transition-all ${
                diagramType === type
                  ? 'bg-blue-50 border-2 border-blue-500'
                  : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{icon}</span>
                <span className="font-medium">{label}</span>
              </div>
              <div className="text-xs text-gray-500">{description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Diagram Display */}
      <div className="bg-white rounded-lg shadow">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h3 className="font-medium">
              {diagramTypes.find(d => d.type === diagramType)?.label} Diagram
            </h3>
            {diagram && (
              <div className="text-sm text-gray-500">
                Format: {diagram.format.toUpperCase()}
                {diagram.metadata.moduleCount && ` • ${diagram.metadata.moduleCount} modules`}
                {diagram.metadata.relationshipCount && ` • ${diagram.metadata.relationshipCount} relationships`}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchDiagram}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
            >
              {loading ? '⏳' : '🔄'} Refresh
            </button>
            <button
              onClick={copyToClipboard}
              disabled={!diagram}
              className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
            >
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
            <button
              onClick={downloadDiagram}
              disabled={!diagram}
              className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
            >
              📥 Download
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2" />
                <div className="text-sm text-gray-500">Generating diagram...</div>
              </div>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error}
            </div>
          ) : diagram ? (
            <div ref={diagramRef}>
              {/* Mermaid Preview Info */}
              <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                <div className="font-medium text-blue-800 mb-1">Preview with Mermaid</div>
                <div className="text-blue-600">
                  Copy the diagram code and paste it into{' '}
                  <a
                    href="https://mermaid.live"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    mermaid.live
                  </a>{' '}
                  to see the rendered diagram.
                </div>
              </div>

              {/* Code Display */}
              <div className="relative">
                <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-sm font-mono">
                  {diagram.diagram}
                </pre>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              Select a diagram type to generate
            </div>
          )}
        </div>
      </div>

      {/* Help Section */}
      <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
        <h4 className="font-medium text-gray-700 mb-2">About Architecture Diagrams</h4>
        <ul className="space-y-1">
          <li>• <strong>Architecture:</strong> Shows overall codebase structure with layers (Presentation, Business Logic, Data, Infrastructure)</li>
          <li>• <strong>Dependencies:</strong> Visualizes module dependencies grouped by type (routes, services, utils, etc.)</li>
          <li>• <strong>Components:</strong> Displays high-level component relationships between API, Services, and Utils</li>
          <li>• <strong>ER Diagram:</strong> Generates database schema diagram from Prisma schema (if available)</li>
        </ul>
      </div>
    </div>
  );
}
