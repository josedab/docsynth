/**
 * Documentation Dependency Graph Service
 *
 * Maps documentation-to-code dependencies, computes blast radius for PRs,
 * detects broken cross-references, and exports graph data in multiple formats.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-dep-graph-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface GraphNode {
  id: string;
  type: 'code' | 'doc' | 'config';
  path: string;
  label: string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'imports' | 'references' | 'documents' | 'depends-on';
  weight: number;
}

export interface DependencyGraph {
  repositoryId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: Record<string, unknown>;
}

export interface AffectedDoc {
  path: string;
  impactType: 'direct' | 'transitive';
  reason: string;
  confidence: number;
}

export interface BlastRadius {
  prNumber?: number;
  changedFiles: string[];
  affectedDocs: AffectedDoc[];
  totalImpact: number;
}

export interface GraphExport {
  format: string;
  content: string;
  nodeCount: number;
  edgeCount: number;
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Build the full dependency graph for a repository.
 */
export async function buildGraph(repositoryId: string): Promise<DependencyGraph> {
  log.info({ repositoryId }, 'Building dependency graph');
  const documents = await db.document.findMany({
    where: { repositoryId },
    select: { id: true, filePath: true, content: true },
  });
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeMap = new Map<string, GraphNode>();

  for (const doc of documents) {
    const node: GraphNode = {
      id: doc.id,
      type: classifyFile(doc.filePath),
      path: doc.filePath,
      label: doc.filePath.split('/').pop() ?? doc.filePath,
    };
    nodes.push(node);
    nodeMap.set(doc.filePath, node);
  }

  for (const doc of documents) {
    const content = doc.content ?? '';
    for (const imp of parseImports(content, doc.filePath)) {
      const target = nodeMap.get(imp);
      if (target) edges.push({ source: doc.id, target: target.id, type: 'imports', weight: 1.0 });
    }
    for (const ref of findDocReferences(content)) {
      const target = [...nodeMap.entries()].find(([p]) => p.endsWith(ref))?.[1];
      if (target)
        edges.push({ source: doc.id, target: target.id, type: 'references', weight: 0.8 });
    }
  }

  edges.push(...buildEdgesFromImports(nodes, documents));

  try {
    await db.dependencyGraph.upsert({
      where: { repositoryId },
      create: {
        repositoryId,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        graphData: JSON.stringify({ nodes, edges }),
        builtAt: new Date(),
      },
      update: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        graphData: JSON.stringify({ nodes, edges }),
        builtAt: new Date(),
      },
    });
  } catch (error) {
    log.warn({ error }, 'Failed to persist dependency graph');
  }

  log.info({ repositoryId, nodes: nodes.length, edges: edges.length }, 'Graph built');
  return {
    repositoryId,
    nodes,
    edges,
    metadata: {
      builtAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
  };
}

/**
 * Compute the blast radius of a set of changed files.
 */
export async function computeBlastRadius(
  repositoryId: string,
  changedFiles: string[]
): Promise<BlastRadius> {
  log.info({ repositoryId, fileCount: changedFiles.length }, 'Computing blast radius');
  const graph = await buildGraph(repositoryId);

  const reverseAdj = new Map<string, Array<{ nodeId: string; edgeType: string }>>();
  for (const e of graph.edges) {
    const list = reverseAdj.get(e.target) ?? [];
    list.push({ nodeId: e.source, edgeType: e.type });
    reverseAdj.set(e.target, list);
  }

  const changedIds = new Set(
    changedFiles.map((f) => graph.nodes.find((n) => n.path === f)?.id).filter(Boolean) as string[]
  );
  const directAffected = new Map<string, AffectedDoc>();

  for (const id of changedIds) {
    for (const dep of reverseAdj.get(id) ?? []) {
      const node = graph.nodes.find((n) => n.id === dep.nodeId);
      if (node?.type === 'doc' && !changedIds.has(node.id)) {
        directAffected.set(node.id, {
          path: node.path,
          impactType: 'direct',
          reason: `Directly ${dep.edgeType} changed file`,
          confidence: 0.95,
        });
      }
    }
  }

  const transitive = computeTransitiveDeps(graph, reverseAdj, changedIds, directAffected);
  const all = [...directAffected.values(), ...transitive];

  log.info({ repositoryId, affected: all.length }, 'Blast radius computed');
  return {
    changedFiles,
    affectedDocs: all,
    totalImpact: all.reduce((s, d) => s + d.confidence, 0),
  };
}

/**
 * Detect broken cross-references in the repository.
 */
export async function detectBrokenReferences(
  repositoryId: string
): Promise<Array<{ source: string; target: string; type: string }>> {
  log.info({ repositoryId }, 'Detecting broken references');
  const documents = await db.document.findMany({
    where: { repositoryId },
    select: { filePath: true, content: true },
  });
  const paths = new Set(documents.map((d: { filePath: string }) => d.filePath));
  const broken: Array<{ source: string; target: string; type: string }> = [];

  for (const doc of documents) {
    for (const ref of findDocReferences(doc.content ?? '')) {
      if (
        (ref.startsWith('./') || ref.startsWith('../')) &&
        !paths.has(resolvePath(doc.filePath, ref))
      ) {
        broken.push({ source: doc.filePath, target: ref, type: 'doc-reference' });
      }
    }
    for (const imp of parseImports(doc.content ?? '', doc.filePath)) {
      if (!paths.has(imp)) broken.push({ source: doc.filePath, target: imp, type: 'import' });
    }
  }

  log.info({ repositoryId, brokenCount: broken.length }, 'Broken reference detection complete');
  return broken;
}

/**
 * Export the dependency graph in the requested format.
 */
export async function exportGraph(repositoryId: string, format: string): Promise<GraphExport> {
  log.info({ repositoryId, format }, 'Exporting dependency graph');
  const graph = await buildGraph(repositoryId);
  let content: string;

  if (format === 'dot') {
    const lines = ['digraph DocDeps {', '  rankdir=LR;'];
    for (const n of graph.nodes)
      lines.push(`  "${n.id}" [label="${n.label}" shape=${n.type === 'code' ? 'box' : 'note'}];`);
    for (const e of graph.edges)
      lines.push(`  "${e.source}" -> "${e.target}" [label="${e.type}"];`);
    lines.push('}');
    content = lines.join('\n');
  } else if (format === 'cytoscape') {
    content = JSON.stringify(
      {
        nodes: graph.nodes.map((n) => ({ data: { id: n.id, label: n.label, type: n.type } })),
        edges: graph.edges.map((e, i) => ({
          data: { id: `e${i}`, source: e.source, target: e.target, type: e.type },
        })),
      },
      null,
      2
    );
  } else {
    content = JSON.stringify(graph, null, 2);
  }

  return { format, content, nodeCount: graph.nodes.length, edgeCount: graph.edges.length };
}

/**
 * Get all dependencies and dependents for a specific node.
 */
export async function getNodeDependencies(
  repositoryId: string,
  nodePath: string
): Promise<{ dependsOn: GraphNode[]; dependedBy: GraphNode[] }> {
  log.info({ repositoryId, nodePath }, 'Getting node dependencies');
  const graph = await buildGraph(repositoryId);
  const target = graph.nodes.find((n) => n.path === nodePath);
  if (!target) return { dependsOn: [], dependedBy: [] };

  return {
    dependsOn: graph.edges
      .filter((e) => e.source === target.id)
      .map((e) => graph.nodes.find((n) => n.id === e.target))
      .filter((n): n is GraphNode => !!n),
    dependedBy: graph.edges
      .filter((e) => e.target === target.id)
      .map((e) => graph.nodes.find((n) => n.id === e.source))
      .filter((n): n is GraphNode => !!n),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function parseImports(content: string, filePath: string): string[] {
  const imports: string[] = [];
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  let m: RegExpExecArray | null;
  const esPattern = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = esPattern.exec(content)) !== null) {
    if (m[1]!.startsWith('.')) imports.push(resolvePath(dir + '/', m[1]!));
  }
  const cjsPattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = cjsPattern.exec(content)) !== null) {
    if (m[1]!.startsWith('.')) imports.push(resolvePath(dir + '/', m[1]!));
  }
  return imports;
}

function findDocReferences(content: string): string[] {
  const refs: string[] = [];
  let m: RegExpExecArray | null;
  const lp = /\[([^\]]*)\]\(([^)]+)\)/g;
  while ((m = lp.exec(content)) !== null) {
    const href = m[2]!;
    if (!href.startsWith('http') && !href.startsWith('#')) refs.push(href.split('#')[0]!);
  }
  const sp = /@(?:see|link)\s+(\S+)/g;
  while ((m = sp.exec(content)) !== null) refs.push(m[1]!);
  return [...new Set(refs)];
}

function buildEdgesFromImports(
  nodes: GraphNode[],
  documents: Array<{ id: string; filePath: string; content: string }>
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const pathToId = new Map(nodes.map((n) => [n.path, n.id]));
  for (const doc of documents) {
    const p = /(?:documents|describes|covers)\s+`([^`]+)`/gi;
    let m: RegExpExecArray | null;
    while ((m = p.exec(doc.content ?? '')) !== null) {
      const tid = pathToId.get(m[1]!);
      if (tid) edges.push({ source: doc.id, target: tid, type: 'documents', weight: 0.9 });
    }
  }
  return edges;
}

function computeTransitiveDeps(
  graph: DependencyGraph,
  reverseAdj: Map<string, Array<{ nodeId: string; edgeType: string }>>,
  changedIds: Set<string>,
  direct: Map<string, AffectedDoc>
): AffectedDoc[] {
  const transitive: AffectedDoc[] = [];
  const visited = new Set([...changedIds, ...direct.keys()]);
  let queue = [...direct.keys()];
  for (let depth = 1; depth <= 4 && queue.length > 0; depth++) {
    const next: string[] = [];
    for (const id of queue) {
      for (const dep of reverseAdj.get(id) ?? []) {
        if (visited.has(dep.nodeId)) continue;
        visited.add(dep.nodeId);
        const node = graph.nodes.find((n) => n.id === dep.nodeId);
        if (node?.type === 'doc') {
          transitive.push({
            path: node.path,
            impactType: 'transitive',
            reason: `Transitively affected (depth ${depth})`,
            confidence: Math.max(0.3, 0.9 - depth * 0.15),
          });
          next.push(dep.nodeId);
        }
      }
    }
    queue = next;
  }
  return transitive;
}

function classifyFile(path: string): 'code' | 'doc' | 'config' {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['md', 'mdx', 'rst', 'txt', 'adoc'].includes(ext)) return 'doc';
  if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return 'config';
  return 'code';
}

function resolvePath(base: string, rel: string): string {
  const parts = base.split('/').filter(Boolean);
  if (parts.length > 0 && parts[parts.length - 1]!.includes('.')) parts.pop();
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
