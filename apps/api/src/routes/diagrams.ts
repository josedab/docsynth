import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { GitHubClient } from '@docsynth/github';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import type { DiagramType } from '@docsynth/types';

const app = new Hono();

// Simple architecture analysis for API-side diagram generation
interface ModuleInfo {
  name: string;
  path: string;
  type: string;
  imports: string[];
  exports: string[];
}

function analyzeFiles(files: { path: string; content: string }[]): {
  modules: ModuleInfo[];
  layers: { name: string; modules: string[] }[];
} {
  const modules: ModuleInfo[] = files.map((file) => {
    const imports: string[] = [];
    const exports: string[] = [];

    // Extract imports
    const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(file.content)) !== null) {
      if (match[1]) imports.push(match[1]);
    }

    // Extract exports
    const exportRegex = /export\s+(?:default\s+)?(?:const|function|class|interface|type)\s+(\w+)/g;
    while ((match = exportRegex.exec(file.content)) !== null) {
      if (match[1]) exports.push(match[1]);
    }

    // Infer type from path
    const lowerPath = file.path.toLowerCase();
    let type = 'unknown';
    if (lowerPath.includes('/routes/') || lowerPath.includes('/api/')) type = 'route';
    else if (lowerPath.includes('/services/')) type = 'service';
    else if (lowerPath.includes('/middleware/')) type = 'middleware';
    else if (lowerPath.includes('/utils/') || lowerPath.includes('/lib/')) type = 'util';
    else if (lowerPath.includes('/models/') || lowerPath.includes('/types/')) type = 'model';
    else if (lowerPath.includes('/components/')) type = 'component';

    const name = file.path.split('/').pop()?.replace(/\.(ts|tsx|js|jsx)$/, '') ?? 'unknown';

    return { name, path: file.path, type, imports, exports };
  });

  // Group by type for layers
  const byType = new Map<string, string[]>();
  modules.forEach((m) => {
    const list = byType.get(m.type) || [];
    list.push(m.name);
    byType.set(m.type, list);
  });

  const layers: { name: string; modules: string[] }[] = [];
  const layerOrder = ['route', 'component', 'service', 'middleware', 'model', 'util', 'unknown'];

  for (const type of layerOrder) {
    const mods = byType.get(type);
    if (mods && mods.length > 0) {
      layers.push({
        name: type.charAt(0).toUpperCase() + type.slice(1) + 's',
        modules: mods.slice(0, 10),
      });
    }
  }

  return { modules, layers };
}

function generateArchitectureDiagram(
  analysis: { modules: ModuleInfo[]; layers: { name: string; modules: string[] }[] },
  _repoName: string
): string {
  let diagram = 'flowchart TD\n';

  for (const layer of analysis.layers) {
    const sanitizedName = layer.name.replace(/\s+/g, '_');
    diagram += `  subgraph ${sanitizedName}["${layer.name}"]\n`;
    for (const mod of layer.modules) {
      const sanitizedMod = mod.replace(/[^a-zA-Z0-9]/g, '_');
      diagram += `    ${sanitizedMod}["${mod}"]\n`;
    }
    diagram += '  end\n';
  }

  // Connect layers vertically
  for (let i = 0; i < analysis.layers.length - 1; i++) {
    const current = analysis.layers[i];
    const next = analysis.layers[i + 1];
    if (current && next && current.modules[0] && next.modules[0]) {
      const from = current.name.replace(/\s+/g, '_');
      const to = next.name.replace(/\s+/g, '_');
      diagram += `  ${from} --> ${to}\n`;
    }
  }

  return diagram;
}

function generateComponentDiagram(
  analysis: { modules: ModuleInfo[]; layers: { name: string; modules: string[] }[] }
): string {
  let diagram = 'graph TD\n';

  for (const layer of analysis.layers.slice(0, 4)) {
    const sanitizedName = layer.name.replace(/\s+/g, '_');
    diagram += `  subgraph ${sanitizedName}["${layer.name}"]\n`;
    for (const mod of layer.modules.slice(0, 6)) {
      const sanitizedMod = mod.replace(/[^a-zA-Z0-9]/g, '_');
      diagram += `    ${sanitizedMod}["${mod}"]\n`;
    }
    diagram += '  end\n';
  }

  return diagram;
}

// Generate architecture diagram for a repository
app.post('/generate', requireAuth, requireOrgAccess, rateLimit('diagram'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    diagramType: DiagramType;
    scope?: string;
    includeTests?: boolean;
  }>();

  if (!body.repositoryId || !body.diagramType) {
    throw new ValidationError('repositoryId and diagramType are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  const [owner, repoName] = repository.githubFullName.split('/');
  if (!owner || !repoName) {
    throw new ValidationError('Invalid repository name format');
  }

  const client = GitHubClient.forInstallation(repository.installationId);

  // Get source files from the repository
  const files = await fetchSourceFiles(
    client,
    owner,
    repoName,
    body.scope || 'src',
    body.includeTests ?? false
  );

  if (files.length === 0) {
    return c.json({
      success: true,
      data: {
        type: body.diagramType,
        title: 'No files found',
        mermaidCode: 'flowchart TD\n  A[No source files found in scope]',
        description: 'No TypeScript/JavaScript files were found in the specified scope.',
        generatedAt: new Date(),
      },
    });
  }

  const analysis = analyzeFiles(files);

  let mermaidCode: string;
  let title: string;
  let description: string;

  switch (body.diagramType) {
    case 'architecture':
      mermaidCode = generateArchitectureDiagram(analysis, repository.name);
      title = `${repository.name} Architecture`;
      description = `Architecture diagram showing ${analysis.modules.length} modules across ${analysis.layers.length} layers.`;
      break;

    case 'dependency':
    case 'component':
      mermaidCode = generateComponentDiagram(analysis);
      title = `${repository.name} Components`;
      description = `Component diagram showing module organization.`;
      break;

    default:
      mermaidCode = generateArchitectureDiagram(analysis, repository.name);
      title = `${repository.name} Diagram`;
      description = `Generated diagram with ${analysis.modules.length} modules.`;
  }

  return c.json({
    success: true,
    data: {
      type: body.diagramType,
      title,
      mermaidCode,
      description,
      generatedAt: new Date(),
      metadata: {
        moduleCount: analysis.modules.length,
        layerCount: analysis.layers.length,
      },
    },
  });
});

// Get available diagram types
app.get('/types', requireAuth, async (c) => {
  const diagramTypes = [
    {
      type: 'architecture',
      name: 'Architecture Diagram',
      description: 'Shows the overall system architecture with layers and module relationships',
    },
    {
      type: 'dependency',
      name: 'Dependency Diagram',
      description: 'Shows how modules depend on each other',
    },
    {
      type: 'component',
      name: 'Component Diagram',
      description: 'Shows services, routes, and utilities as components',
    },
    {
      type: 'sequence',
      name: 'Sequence Diagram',
      description: 'Shows the flow of operations in a function or process',
    },
    {
      type: 'class',
      name: 'Class Diagram',
      description: 'Shows classes, interfaces, and their relationships',
    },
    {
      type: 'flowchart',
      name: 'Flowchart',
      description: 'Shows a process or workflow as a flowchart',
    },
    {
      type: 'entity-relationship',
      name: 'ER Diagram',
      description: 'Shows database entities and their relationships',
    },
  ];

  return c.json({
    success: true,
    data: diagramTypes,
  });
});

// Generate ER diagram from Prisma schema
app.post('/er-diagram', requireAuth, requireOrgAccess, rateLimit('diagram'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ repositoryId: string }>();

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  const [owner, repoName] = repository.githubFullName.split('/');
  if (!owner || !repoName) {
    throw new ValidationError('Invalid repository name format');
  }

  const client = GitHubClient.forInstallation(repository.installationId);

  // Try to find Prisma schema
  const schemaContent = await client.getFileContent(owner, repoName, 'prisma/schema.prisma');

  if (!schemaContent) {
    return c.json({
      success: true,
      data: {
        type: 'entity-relationship',
        title: 'No Schema Found',
        mermaidCode: 'erDiagram\n  NOTE["No Prisma schema found"]',
        description: 'No prisma/schema.prisma file was found in the repository.',
        generatedAt: new Date(),
      },
    });
  }

  // Parse Prisma schema to generate ER diagram
  const erDiagram = generateERDiagramFromPrisma(schemaContent, repository.name);

  return c.json({
    success: true,
    data: {
      type: 'entity-relationship',
      title: `${repository.name} Data Model`,
      mermaidCode: erDiagram,
      description: 'Entity-relationship diagram generated from Prisma schema.',
      generatedAt: new Date(),
    },
  });
});

function generateERDiagramFromPrisma(schema: string, _dbName: string): string {
  let diagram = 'erDiagram\n';

  // Extract model definitions
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
  let match;
  const models: { name: string; fields: string[] }[] = [];
  const relations: { from: string; to: string; type: string }[] = [];

  while ((match = modelRegex.exec(schema)) !== null) {
    const modelName = match[1] ?? '';
    const body = match[2] ?? '';

    const fields: string[] = [];
    const fieldLines = body.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('@@'));

    for (const line of fieldLines) {
      const fieldMatch = line.trim().match(/^(\w+)\s+(\w+)(\?)?/);
      if (fieldMatch) {
        const fieldName = fieldMatch[1] ?? '';
        const fieldType = fieldMatch[2] ?? '';
        const isOptional = !!fieldMatch[3];

        // Check for relations
        if (line.includes('@relation')) {
          relations.push({
            from: modelName,
            to: fieldType.replace('[]', ''),
            type: fieldType.includes('[]') ? 'o{' : '||',
          });
        } else if (!['Int', 'String', 'Boolean', 'DateTime', 'Float', 'Json', 'Decimal', 'BigInt', 'Bytes'].includes(fieldType)) {
          // Likely a relation without explicit @relation
          relations.push({
            from: modelName,
            to: fieldType.replace('[]', ''),
            type: fieldType.includes('[]') ? 'o{' : '||',
          });
        } else {
          fields.push(`${fieldType}${isOptional ? '?' : ''} ${fieldName}`);
        }
      }
    }

    models.push({ name: modelName, fields });
  }

  // Add entities
  for (const model of models) {
    diagram += `  ${model.name} {\n`;
    for (const field of model.fields.slice(0, 8)) {
      diagram += `    ${field}\n`;
    }
    diagram += '  }\n';
  }

  // Add relationships
  const addedRels = new Set<string>();
  for (const rel of relations) {
    const relKey = [rel.from, rel.to].sort().join('-');
    if (!addedRels.has(relKey)) {
      diagram += `  ${rel.from} ${rel.type}--o| ${rel.to} : has\n`;
      addedRels.add(relKey);
    }
  }

  return diagram;
}

async function fetchSourceFiles(
  client: GitHubClient,
  owner: string,
  repo: string,
  basePath: string,
  includeTests: boolean
): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  const visited = new Set<string>();

  async function crawl(path: string, depth: number): Promise<void> {
    if (depth > 5 || visited.has(path)) return;
    visited.add(path);

    try {
      const contents = await client.getDirectoryContents(owner, repo, path);

      for (const item of contents) {
        if (item.type === 'dir') {
          // Skip node_modules, dist, etc.
          if (['node_modules', 'dist', 'build', '.git', 'coverage'].includes(item.name)) {
            continue;
          }
          await crawl(item.path, depth + 1);
        } else if (item.type === 'file') {
          // Only process TypeScript/JavaScript files
          if (!/\.(ts|tsx|js|jsx)$/.test(item.name)) continue;

          // Skip test files unless requested
          if (!includeTests && /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(item.name)) continue;
          if (!includeTests && item.path.includes('__tests__')) continue;

          // Skip declaration files
          if (item.name.endsWith('.d.ts')) continue;

          try {
            const content = await client.getFileContent(owner, repo, item.path);
            if (content && files.length < 100) {
              files.push({ path: item.path, content });
            }
          } catch {
            // Skip files that can't be read
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  await crawl(basePath, 0);

  // Also try common source directories if base didn't yield results
  if (files.length === 0 && basePath === 'src') {
    for (const altPath of ['lib', 'app', 'packages', 'apps']) {
      await crawl(altPath, 0);
      if (files.length > 0) break;
    }
  }

  return files;
}

export { app as diagramRoutes };
