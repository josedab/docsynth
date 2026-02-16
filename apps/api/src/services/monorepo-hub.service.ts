/**
 * Smart Monorepo Documentation Hub Service
 *
 * Workspace discovery, dependency graph building, navigation generation,
 * and documentation coverage analysis for monorepo projects.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId } from '@docsynth/utils';

const log = createLogger('monorepo-hub-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface WorkspacePackage {
  name: string;
  path: string;
  version: string;
  description: string;
  dependencies: string[];
  devDependencies: string[];
  internalDeps: string[];
  docFiles: string[];
  hasReadme: boolean;
  exports: string[];
}

export interface MonorepoMap {
  rootName: string;
  workspaceType: 'npm' | 'pnpm' | 'yarn' | 'cargo' | 'go';
  packages: WorkspacePackage[];
  dependencyGraph: Record<string, string[]>;
  documentationCoverage: number;
}

export interface HubConfig {
  repositoryId: string;
  enabled: boolean;
  autoDiscover: boolean;
  includePaths: string[];
  excludePaths: string[];
  generateNavigation: boolean;
}

export interface NavigationItem {
  label: string;
  path: string;
  children: NavigationItem[];
  hasDoc: boolean;
  packageName?: string;
}

// ============================================================================
// Workspace Discovery
// ============================================================================

/**
 * Parse workspace definitions from root package.json content and detect workspace type.
 */
export function discoverWorkspaces(rootPackageJson: string): MonorepoMap {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rootPackageJson);
  } catch {
    log.warn('Failed to parse root package.json');
    return {
      rootName: 'unknown',
      workspaceType: 'npm',
      packages: [],
      dependencyGraph: {},
      documentationCoverage: 0,
    };
  }

  const rootName = (parsed.name as string) ?? 'unknown';

  // Detect workspace type
  let workspaceType: MonorepoMap['workspaceType'] = 'npm';
  const workspaceGlobs: string[] = [];

  if (Array.isArray(parsed.workspaces)) {
    workspaceGlobs.push(...(parsed.workspaces as string[]));
    workspaceType = 'npm';
  } else if (parsed.workspaces && typeof parsed.workspaces === 'object') {
    const ws = parsed.workspaces as { packages?: string[] };
    if (Array.isArray(ws.packages)) {
      workspaceGlobs.push(...ws.packages);
      workspaceType = 'yarn';
    }
  }

  // Build stub packages from workspace globs
  const packages: WorkspacePackage[] = workspaceGlobs.map((glob) => ({
    name: glob.replace(/\/\*$/, '').replace(/\*/g, ''),
    path: glob,
    version: '0.0.0',
    description: '',
    dependencies: [],
    devDependencies: [],
    internalDeps: [],
    docFiles: [],
    hasReadme: false,
    exports: [],
  }));

  const dependencyGraph = buildDependencyGraph(packages);
  const documentationCoverage = calculateDocCoverage({
    rootName,
    workspaceType,
    packages,
    dependencyGraph,
    documentationCoverage: 0,
  });

  log.info(
    { rootName, workspaceType, packageCount: packages.length },
    'Discovered monorepo workspaces'
  );

  return {
    rootName,
    workspaceType,
    packages,
    dependencyGraph,
    documentationCoverage,
  };
}

// ============================================================================
// Dependency Graph
// ============================================================================

/**
 * Build an internal dependency graph mapping package names to their internal dependencies.
 */
export function buildDependencyGraph(packages: WorkspacePackage[]): Record<string, string[]> {
  const packageNames = new Set(packages.map((p) => p.name));
  const graph: Record<string, string[]> = {};

  for (const pkg of packages) {
    const internalDeps = [...pkg.dependencies, ...pkg.devDependencies].filter((dep) =>
      packageNames.has(dep)
    );

    pkg.internalDeps = internalDeps;
    graph[pkg.name] = internalDeps;
  }

  return graph;
}

// ============================================================================
// Navigation Generation
// ============================================================================

/**
 * Generate a navigation tree from the monorepo map, grouped by top-level directory.
 */
export function generateHubNavigation(map: MonorepoMap): NavigationItem[] {
  const groups = new Map<string, NavigationItem[]>();

  for (const pkg of map.packages) {
    const parts = pkg.path.split('/');
    const group = parts[0] ?? 'root';

    if (!groups.has(group)) {
      groups.set(group, []);
    }

    groups.get(group)!.push({
      label: pkg.name,
      path: pkg.path,
      children: pkg.docFiles.map((doc) => ({
        label: doc,
        path: `${pkg.path}/${doc}`,
        children: [],
        hasDoc: true,
      })),
      hasDoc: pkg.hasReadme,
      packageName: pkg.name,
    });
  }

  const navigation: NavigationItem[] = [];
  for (const [group, items] of groups) {
    navigation.push({
      label: group,
      path: `/${group}`,
      children: items,
      hasDoc: items.some((i) => i.hasDoc),
    });
  }

  return navigation;
}

// ============================================================================
// Documentation Coverage
// ============================================================================

/**
 * Calculate the percentage of packages that have a README file.
 */
export function calculateDocCoverage(map: MonorepoMap): number {
  if (map.packages.length === 0) return 0;
  const documented = map.packages.filter((p) => p.hasReadme).length;
  return Math.round((documented / map.packages.length) * 100);
}

// ============================================================================
// Change Detection
// ============================================================================

/**
 * Detect added or removed packages between two monorepo maps.
 */
export function detectWorkspaceChanges(oldMap: MonorepoMap, newMap: MonorepoMap): string[] {
  const oldNames = new Set(oldMap.packages.map((p) => p.name));
  const newNames = new Set(newMap.packages.map((p) => p.name));
  const changes: string[] = [];

  for (const name of newNames) {
    if (!oldNames.has(name)) {
      changes.push(`added:${name}`);
    }
  }

  for (const name of oldNames) {
    if (!newNames.has(name)) {
      changes.push(`removed:${name}`);
    }
  }

  return changes;
}

// ============================================================================
// Stub Doc Generation
// ============================================================================

/**
 * Generate a stub README for an undocumented package.
 */
export function generatePackageDocs(pkg: WorkspacePackage): string {
  const lines: string[] = [
    `# ${pkg.name}`,
    '',
    pkg.description || '> TODO: Add a description for this package.',
    '',
    '## Installation',
    '',
    '```bash',
    `npm install ${pkg.name}`,
    '```',
    '',
  ];

  if (pkg.exports.length > 0) {
    lines.push('## Exports', '');
    for (const exp of pkg.exports) {
      lines.push(`- \`${exp}\``);
    }
    lines.push('');
  }

  if (pkg.internalDeps.length > 0) {
    lines.push('## Internal Dependencies', '');
    for (const dep of pkg.internalDeps) {
      lines.push(`- \`${dep}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Persistence helpers
// ============================================================================

/**
 * Persist a monorepo map and return the stored record.
 */
export async function saveMonorepoMap(repositoryId: string, map: MonorepoMap) {
  const id = generateId();

  const record = await db.monorepoHub.upsert({
    where: { repositoryId },
    update: {
      rootName: map.rootName,
      workspaceType: map.workspaceType,
      packages: map.packages,
      dependencyGraph: map.dependencyGraph,
      documentationCoverage: map.documentationCoverage,
      updatedAt: new Date(),
    },
    create: {
      id,
      repositoryId,
      rootName: map.rootName,
      workspaceType: map.workspaceType,
      packages: map.packages,
      dependencyGraph: map.dependencyGraph,
      documentationCoverage: map.documentationCoverage,
    },
  });

  log.info({ repositoryId, rootName: map.rootName }, 'Saved monorepo map');
  return record;
}

/**
 * Retrieve the stored monorepo map for a repository.
 */
export async function getMonorepoMap(repositoryId: string) {
  return db.monorepoHub.findUnique({ where: { repositoryId } });
}

/**
 * Retrieve or create the hub configuration for a repository.
 */
export async function getHubConfig(repositoryId: string): Promise<HubConfig> {
  const existing = await db.monorepoHubConfig.findUnique({ where: { repositoryId } });
  if (existing) return existing as HubConfig;

  return {
    repositoryId,
    enabled: true,
    autoDiscover: true,
    includePaths: ['packages/*', 'apps/*', 'libs/*'],
    excludePaths: ['node_modules', '.git'],
    generateNavigation: true,
  };
}

/**
 * Update the hub configuration for a repository.
 */
export async function updateHubConfig(repositoryId: string, config: Partial<HubConfig>) {
  const id = generateId();

  const record = await db.monorepoHubConfig.upsert({
    where: { repositoryId },
    update: { ...config, updatedAt: new Date() },
    create: { id, repositoryId, ...config },
  });

  log.info({ repositoryId }, 'Updated monorepo hub config');
  return record;
}
