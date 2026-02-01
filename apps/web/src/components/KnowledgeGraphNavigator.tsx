'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api';

interface GraphNode {
  id: string;
  label: string;
  type: string;
  size: number;
  color: string;
  metadata?: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  weight: number;
}

interface EntityDetails {
  entity: {
    id: string;
    name: string;
    type: string;
    description?: string;
    filePath?: string;
    lineStart?: number;
    lineEnd?: number;
  };
  connections: {
    outgoing: Array<{ relationship: string; entity: { id: string; name: string; type: string } }>;
    incoming: Array<{ relationship: string; entity: { id: string; name: string; type: string } }>;
  };
  documents: Array<{ id: string; path: string; title: string; type: string }>;
}

interface KnowledgeGraphNavigatorProps {
  repositoryId: string;
  token: string;
}

const ENTITY_COLORS: Record<string, string> = {
  document: '#3b82f6',
  concept: '#8b5cf6',
  function: '#10b981',
  class: '#f59e0b',
  interface: '#06b6d4',
  type: '#ec4899',
  module: '#6366f1',
  file: '#64748b',
};

export function KnowledgeGraphNavigator({ repositoryId, token }: KnowledgeGraphNavigatorProps) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [nodeDetails, setNodeDetails] = useState<EntityDetails | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ entity: { id: string; name: string; type: string } }>>([]);
  const [entityTypeFilter, setEntityTypeFilter] = useState<string[]>([]);
  const [graphStatus, setGraphStatus] = useState<string>('unknown');
  const [isBuilding, setIsBuilding] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Fetch graph data
  const fetchGraph = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (entityTypeFilter.length > 0) {
        params.append('entityTypes', entityTypeFilter.join(','));
      }
      params.append('maxNodes', '100');

      const response = await apiFetch<{
        success: boolean;
        data: { nodes: GraphNode[]; edges: GraphEdge[] };
      }>(`/api/knowledge-graph/${repositoryId}/visualize?${params.toString()}`, { token });

      setNodes(response.data.nodes);
      setEdges(response.data.edges);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, [repositoryId, entityTypeFilter, token]);

  // Fetch graph status
  const fetchStatus = useCallback(async () => {
    try {
      const response = await apiFetch<{
        success: boolean;
        data: { status: string; entityCount: number; relationCount: number };
      }>(`/api/knowledge-graph/${repositoryId}/status`, { token });

      setGraphStatus(response.data.status);
      if (response.data.status === 'ready') {
        fetchGraph();
      }
    } catch {
      setGraphStatus('error');
    }
  }, [repositoryId, token, fetchGraph]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Build graph
  const buildGraph = async () => {
    setIsBuilding(true);
    try {
      await apiFetch('/api/knowledge-graph/build', {
        token,
        method: 'POST',
        body: JSON.stringify({ repositoryId, fullRebuild: true }),
      });

      // Poll for completion
      const pollInterval = setInterval(async () => {
        const status = await apiFetch<{ success: boolean; data: { status: string } }>(
          `/api/knowledge-graph/${repositoryId}/status`,
          { token }
        );
        if (status.data.status === 'ready') {
          clearInterval(pollInterval);
          setIsBuilding(false);
          fetchGraph();
        } else if (status.data.status === 'error') {
          clearInterval(pollInterval);
          setIsBuilding(false);
          setError('Graph build failed');
        }
      }, 2000);
    } catch (err) {
      setIsBuilding(false);
      setError(err instanceof Error ? err.message : 'Failed to start build');
    }
  };

  // Search entities
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      const response = await apiFetch<{
        success: boolean;
        data: { results: Array<{ entity: { id: string; name: string; type: string } }> };
      }>(`/api/knowledge-graph/${repositoryId}/search?q=${encodeURIComponent(searchQuery)}`, { token });

      setSearchResults(response.data.results);
    } catch {
      setSearchResults([]);
    }
  }, [searchQuery, repositoryId, token]);

  useEffect(() => {
    const debounce = setTimeout(handleSearch, 300);
    return () => clearTimeout(debounce);
  }, [handleSearch]);

  // Fetch node details
  const fetchNodeDetails = async (nodeId: string) => {
    try {
      const response = await apiFetch<{ success: boolean; data: EntityDetails }>(
        `/api/knowledge-graph/${repositoryId}/entity/${nodeId}`,
        { token }
      );
      setNodeDetails(response.data);
    } catch {
      setNodeDetails(null);
    }
  };

  // Handle node click
  const handleNodeClick = (nodeId: string) => {
    setSelectedNode(nodeId);
    fetchNodeDetails(nodeId);
  };

  // Draw graph on canvas
  useEffect(() => {
    if (!canvasRef.current || nodes.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Simple force-directed layout positions
    const positions = new Map<string, { x: number; y: number }>();
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.35;

    // Arrange nodes in a circle (simple layout)
    nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      positions.set(node.id, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    });

    // Draw edges
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    edges.forEach((edge) => {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      if (from && to) {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    });

    // Draw nodes
    nodes.forEach((node) => {
      const pos = positions.get(node.id);
      if (!pos) return;

      const isSelected = node.id === selectedNode;

      // Node circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, node.size / 2, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Label
      ctx.fillStyle = '#374151';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(
        node.label.length > 15 ? node.label.substring(0, 15) + '...' : node.label,
        pos.x,
        pos.y + node.size / 2 + 12
      );
    });

    // Handle click events
    const handleClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      for (const node of nodes) {
        const pos = positions.get(node.id);
        if (!pos) continue;

        const dx = x - pos.x;
        const dy = y - pos.y;
        if (dx * dx + dy * dy < (node.size / 2) * (node.size / 2)) {
          handleNodeClick(node.id);
          return;
        }
      }
    };

    canvas.addEventListener('click', handleClick);
    return () => canvas.removeEventListener('click', handleClick);
  }, [nodes, edges, selectedNode]);

  const entityTypes = ['document', 'concept', 'function', 'class', 'interface', 'type'];

  if (graphStatus === 'not-built' || graphStatus === 'pending') {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <span className="text-6xl">🕸️</span>
        <h3 className="text-lg font-semibold mt-4">Knowledge Graph Not Built</h3>
        <p className="text-gray-500 mt-2 mb-6">
          Build a knowledge graph to visualize relationships between code concepts and documentation.
        </p>
        <button
          onClick={buildGraph}
          disabled={isBuilding}
          className={`px-6 py-2 rounded-lg font-medium ${
            isBuilding
              ? 'bg-gray-300 text-gray-500'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isBuilding ? '⏳ Building...' : '🔨 Build Knowledge Graph'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            🕸️ Knowledge Graph Navigator
          </h2>
          <button
            onClick={buildGraph}
            disabled={isBuilding}
            className="px-3 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200"
          >
            {isBuilding ? 'Building...' : '🔄 Rebuild'}
          </button>
        </div>

        {/* Search */}
        <div className="flex gap-4 items-center">
          <div className="flex-1 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entities..."
              className="w-full px-4 py-2 border rounded-lg pr-10"
            />
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-white border rounded-lg shadow-lg mt-1 z-10 max-h-48 overflow-y-auto">
                {searchResults.map((result) => (
                  <button
                    key={result.entity.id}
                    onClick={() => {
                      handleNodeClick(result.entity.id);
                      setSearchQuery('');
                      setSearchResults([]);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2"
                  >
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: ENTITY_COLORS[result.entity.type] || '#9ca3af' }}
                    />
                    <span>{result.entity.name}</span>
                    <span className="text-xs text-gray-400">{result.entity.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Entity type filter */}
          <div className="flex gap-1">
            {entityTypes.map((type) => (
              <button
                key={type}
                onClick={() => {
                  setEntityTypeFilter((prev) =>
                    prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
                  );
                }}
                className={`px-2 py-1 rounded text-xs ${
                  entityTypeFilter.includes(type) || entityTypeFilter.length === 0
                    ? 'bg-gray-200'
                    : 'bg-gray-50 opacity-50'
                }`}
                style={{ borderLeft: `3px solid ${ENTITY_COLORS[type]}` }}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Graph canvas */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow p-4">
          {loading ? (
            <div className="h-96 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : nodes.length === 0 ? (
            <div className="h-96 flex items-center justify-center text-gray-500">
              No entities found. Try building the graph first.
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              width={600}
              height={400}
              className="w-full h-96 cursor-pointer"
            />
          )}
          <div className="mt-2 text-xs text-gray-400 text-center">
            {nodes.length} nodes • {edges.length} edges • Click a node to see details
          </div>
        </div>

        {/* Details panel */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-4">Entity Details</h3>
          {nodeDetails ? (
            <div className="space-y-4">
              {/* Entity info */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: ENTITY_COLORS[nodeDetails.entity.type] || '#9ca3af' }}
                  />
                  <span className="font-medium">{nodeDetails.entity.name}</span>
                </div>
                <div className="text-xs text-gray-500 space-y-1">
                  <div>Type: {nodeDetails.entity.type}</div>
                  {nodeDetails.entity.description && (
                    <div>{nodeDetails.entity.description}</div>
                  )}
                  {nodeDetails.entity.filePath && (
                    <div>
                      📁 {nodeDetails.entity.filePath}
                      {nodeDetails.entity.lineStart && `:${nodeDetails.entity.lineStart}`}
                    </div>
                  )}
                </div>
              </div>

              {/* Connections */}
              {(nodeDetails.connections.outgoing.length > 0 ||
                nodeDetails.connections.incoming.length > 0) && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Connections</h4>
                  <div className="space-y-1 text-xs">
                    {nodeDetails.connections.outgoing.map((conn, i) => (
                      <button
                        key={`out-${i}`}
                        onClick={() => handleNodeClick(conn.entity.id)}
                        className="block w-full text-left px-2 py-1 rounded hover:bg-gray-50"
                      >
                        → <span className="text-gray-500">{conn.relationship}</span>{' '}
                        <span className="font-medium">{conn.entity.name}</span>
                      </button>
                    ))}
                    {nodeDetails.connections.incoming.map((conn, i) => (
                      <button
                        key={`in-${i}`}
                        onClick={() => handleNodeClick(conn.entity.id)}
                        className="block w-full text-left px-2 py-1 rounded hover:bg-gray-50"
                      >
                        ← <span className="text-gray-500">{conn.relationship}</span>{' '}
                        <span className="font-medium">{conn.entity.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Related documents */}
              {nodeDetails.documents.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Related Documents</h4>
                  <div className="space-y-1 text-xs">
                    {nodeDetails.documents.map((doc) => (
                      <div key={doc.id} className="px-2 py-1 bg-gray-50 rounded">
                        📄 {doc.title || doc.path}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-gray-400 text-sm">
              Select a node in the graph to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
