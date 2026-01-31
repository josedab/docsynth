import { createLogger } from '@docsynth/utils';

const log = createLogger('architecture-analyzer');

export interface ModuleInfo {
  name: string;
  path: string;
  type: 'component' | 'service' | 'util' | 'model' | 'route' | 'middleware' | 'config' | 'test' | 'unknown';
  exports: ExportInfo[];
  imports: ImportInfo[];
  dependencies: string[];
}

export interface ExportInfo {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'default';
  isAsync?: boolean;
}

export interface ImportInfo {
  source: string;
  specifiers: string[];
  isRelative: boolean;
  isPackage: boolean;
}

export interface ArchitectureGraph {
  modules: ModuleInfo[];
  relationships: ModuleRelationship[];
  layers: ArchitectureLayer[];
  summary: {
    totalModules: number;
    totalExports: number;
    totalImports: number;
    moduleTypes: Record<string, number>;
  };
}

export interface ModuleRelationship {
  from: string;
  to: string;
  type: 'imports' | 'exports' | 'implements' | 'extends';
  weight: number;
}

export interface ArchitectureLayer {
  name: string;
  modules: string[];
  level: number;
}

class ArchitectureAnalyzerService {
  analyzeFiles(files: { path: string; content: string }[]): ArchitectureGraph {
    log.info({ fileCount: files.length }, 'Analyzing architecture');

    const modules: ModuleInfo[] = files.map((file) => this.analyzeModule(file));
    const relationships = this.buildRelationships(modules);
    const layers = this.identifyLayers(modules);

    const moduleTypes: Record<string, number> = {};
    modules.forEach((m) => {
      moduleTypes[m.type] = (moduleTypes[m.type] || 0) + 1;
    });

    return {
      modules,
      relationships,
      layers,
      summary: {
        totalModules: modules.length,
        totalExports: modules.reduce((sum, m) => sum + m.exports.length, 0),
        totalImports: modules.reduce((sum, m) => sum + m.imports.length, 0),
        moduleTypes,
      },
    };
  }

  private analyzeModule(file: { path: string; content: string }): ModuleInfo {
    const exports = this.extractExports(file.content);
    const imports = this.extractImports(file.content);
    const moduleType = this.inferModuleType(file.path, file.content);
    const name = this.extractModuleName(file.path);

    return {
      name,
      path: file.path,
      type: moduleType,
      exports,
      imports,
      dependencies: imports.map((i) => i.source),
    };
  }

  private extractExports(content: string): ExportInfo[] {
    const exports: ExportInfo[] = [];

    // Named exports: export const/function/class/interface/type/enum
    const namedExportRegex = /export\s+(async\s+)?(const|function|class|interface|type|enum)\s+(\w+)/g;
    let match;
    while ((match = namedExportRegex.exec(content)) !== null) {
      const isAsync = !!match[1];
      const kindMap: Record<string, ExportInfo['kind']> = {
        const: 'const',
        function: 'function',
        class: 'class',
        interface: 'interface',
        type: 'type',
        enum: 'enum',
      };
      exports.push({
        name: match[3] ?? 'unknown',
        kind: kindMap[match[2] ?? ''] ?? 'const',
        isAsync,
      });
    }

    // Default exports
    const defaultExportRegex = /export\s+default\s+(?:(?:async\s+)?(?:function|class)\s+)?(\w+)/g;
    while ((match = defaultExportRegex.exec(content)) !== null) {
      exports.push({
        name: match[1] ?? 'default',
        kind: 'default',
      });
    }

    // Re-exports: export { ... } from '...'
    const reExportRegex = /export\s+\{([^}]+)\}\s+from/g;
    while ((match = reExportRegex.exec(content)) !== null) {
      const specifiers = (match[1] ?? '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]?.trim() ?? '');
      specifiers.forEach((s) => {
        if (s && !exports.find((e) => e.name === s)) {
          exports.push({ name: s, kind: 'const' });
        }
      });
    }

    return exports;
  }

  private extractImports(content: string): ImportInfo[] {
    const imports: ImportInfo[] = [];

    // import ... from '...'
    const importRegex = /import\s+(?:(\*\s+as\s+\w+)|(\{[^}]+\})|(\w+))(?:\s*,\s*(?:(\{[^}]+\})|(\w+)))?\s+from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      const source = match[6] ?? '';
      const specifiers: string[] = [];

      // Star import: import * as X
      if (match[1]) {
        specifiers.push(match[1].replace(/\*\s+as\s+/, ''));
      }
      // Named imports: import { A, B }
      if (match[2]) {
        const names = match[2].replace(/[{}]/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]?.trim() ?? '');
        specifiers.push(...names.filter(Boolean));
      }
      // Default import: import X
      if (match[3]) {
        specifiers.push(match[3]);
      }
      // Second set (after comma)
      if (match[4]) {
        const names = match[4].replace(/[{}]/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]?.trim() ?? '');
        specifiers.push(...names.filter(Boolean));
      }
      if (match[5]) {
        specifiers.push(match[5]);
      }

      imports.push({
        source,
        specifiers,
        isRelative: source.startsWith('.'),
        isPackage: !source.startsWith('.') && !source.startsWith('@/'),
      });
    }

    // Side-effect imports: import '...'
    const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;
    let sideEffectMatch: RegExpExecArray | null;
    while ((sideEffectMatch = sideEffectRegex.exec(content)) !== null) {
      if (!imports.find((i) => i.source === sideEffectMatch![1])) {
        imports.push({
          source: sideEffectMatch[1] ?? '',
          specifiers: [],
          isRelative: (sideEffectMatch[1] ?? '').startsWith('.'),
          isPackage: !(sideEffectMatch[1] ?? '').startsWith('.'),
        });
      }
    }

    return imports;
  }

  private inferModuleType(
    path: string,
    content: string
  ): ModuleInfo['type'] {
    const lowerPath = path.toLowerCase();

    // Test files
    if (lowerPath.includes('.test.') || lowerPath.includes('.spec.') || lowerPath.includes('__tests__')) {
      return 'test';
    }

    // Config files
    if (lowerPath.includes('config') || lowerPath.endsWith('.config.ts') || lowerPath.endsWith('.config.js')) {
      return 'config';
    }

    // Route/controller files
    if (lowerPath.includes('/routes/') || lowerPath.includes('/controllers/') || lowerPath.includes('/api/')) {
      return 'route';
    }

    // Middleware
    if (lowerPath.includes('/middleware/') || lowerPath.includes('middleware')) {
      return 'middleware';
    }

    // Service files
    if (lowerPath.includes('/services/') || lowerPath.includes('service')) {
      return 'service';
    }

    // Model/type files
    if (lowerPath.includes('/models/') || lowerPath.includes('/types/') || lowerPath.includes('types.ts')) {
      return 'model';
    }

    // Utility files
    if (lowerPath.includes('/utils/') || lowerPath.includes('/helpers/') || lowerPath.includes('/lib/')) {
      return 'util';
    }

    // Component files (React/Vue)
    if (content.includes('React') || content.includes('Component') || lowerPath.includes('/components/')) {
      return 'component';
    }

    return 'unknown';
  }

  private extractModuleName(path: string): string {
    const parts = path.split('/');
    const filename = parts[parts.length - 1] ?? 'unknown';
    return filename.replace(/\.(ts|tsx|js|jsx)$/, '');
  }

  private buildRelationships(modules: ModuleInfo[]): ModuleRelationship[] {
    const relationships: ModuleRelationship[] = [];
    const moduleByPath = new Map(modules.map((m) => [m.path, m]));
    const moduleByName = new Map(modules.map((m) => [m.name, m]));

    for (const module of modules) {
      for (const imp of module.imports) {
        if (imp.isRelative) {
          // Try to find the target module
          const resolvedPath = this.resolveRelativePath(module.path, imp.source);
          const targetModule = moduleByPath.get(resolvedPath) ||
            moduleByPath.get(resolvedPath + '.ts') ||
            moduleByPath.get(resolvedPath + '/index.ts');

          if (targetModule) {
            relationships.push({
              from: module.name,
              to: targetModule.name,
              type: 'imports',
              weight: imp.specifiers.length || 1,
            });
          }
        } else if (!imp.isPackage && imp.source.startsWith('@')) {
          // Internal package import (monorepo)
          const packageName = imp.source.split('/')[1];
          if (packageName) {
            const targetModule = moduleByName.get(packageName) || moduleByName.get('index');
            if (targetModule) {
              relationships.push({
                from: module.name,
                to: imp.source,
                type: 'imports',
                weight: imp.specifiers.length || 1,
              });
            }
          }
        }
      }
    }

    return relationships;
  }

  private resolveRelativePath(fromPath: string, relativePath: string): string {
    const fromDir = fromPath.split('/').slice(0, -1).join('/');
    const parts = relativePath.split('/');
    const resultParts = fromDir.split('/');

    for (const part of parts) {
      if (part === '..') {
        resultParts.pop();
      } else if (part !== '.') {
        resultParts.push(part);
      }
    }

    return resultParts.join('/');
  }

  private identifyLayers(modules: ModuleInfo[]): ArchitectureLayer[] {
    const layers: ArchitectureLayer[] = [];

    const layerDefinitions: { name: string; types: ModuleInfo['type'][]; level: number }[] = [
      { name: 'Presentation', types: ['component', 'route'], level: 0 },
      { name: 'Business Logic', types: ['service', 'middleware'], level: 1 },
      { name: 'Data', types: ['model'], level: 2 },
      { name: 'Infrastructure', types: ['util', 'config'], level: 3 },
    ];

    for (const def of layerDefinitions) {
      const layerModules = modules
        .filter((m) => def.types.includes(m.type))
        .map((m) => m.name);

      if (layerModules.length > 0) {
        layers.push({
          name: def.name,
          modules: layerModules,
          level: def.level,
        });
      }
    }

    // Add unknown modules to a misc layer
    const knownModules = new Set(layers.flatMap((l) => l.modules));
    const unknownModules = modules
      .filter((m) => !knownModules.has(m.name) && m.type !== 'test')
      .map((m) => m.name);

    if (unknownModules.length > 0) {
      layers.push({
        name: 'Other',
        modules: unknownModules,
        level: 4,
      });
    }

    return layers;
  }

  generateMermaidDiagram(graph: ArchitectureGraph): string {
    let diagram = 'flowchart TD\n';

    // Add subgraphs for layers
    for (const layer of graph.layers) {
      diagram += `  subgraph ${layer.name.replace(/\s+/g, '_')}["${layer.name}"]\n`;
      for (const moduleName of layer.modules.slice(0, 10)) { // Limit modules per layer
        const sanitized = this.sanitizeMermaidId(moduleName);
        diagram += `    ${sanitized}["${moduleName}"]\n`;
      }
      diagram += '  end\n';
    }

    // Add relationships (limit to avoid clutter)
    const topRelationships = graph.relationships
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 30);

    for (const rel of topRelationships) {
      const fromId = this.sanitizeMermaidId(rel.from);
      const toId = this.sanitizeMermaidId(rel.to);
      diagram += `  ${fromId} --> ${toId}\n`;
    }

    return diagram;
  }

  generateDependencyDiagram(graph: ArchitectureGraph): string {
    let diagram = 'flowchart LR\n';

    // Group modules by type
    const byType = new Map<string, ModuleInfo[]>();
    for (const module of graph.modules) {
      const existing = byType.get(module.type) || [];
      existing.push(module);
      byType.set(module.type, existing);
    }

    // Create subgraphs for each type
    for (const [type, modules] of byType) {
      if (type === 'test') continue; // Skip test files

      diagram += `  subgraph ${type}["${type.charAt(0).toUpperCase() + type.slice(1)}s"]\n`;
      for (const mod of modules.slice(0, 8)) {
        const id = this.sanitizeMermaidId(mod.name);
        diagram += `    ${id}["${mod.name}"]\n`;
      }
      diagram += '  end\n';
    }

    return diagram;
  }

  generateComponentDiagram(modules: ModuleInfo[]): string {
    let diagram = 'graph TD\n';

    const services = modules.filter((m) => m.type === 'service');
    const routes = modules.filter((m) => m.type === 'route');
    const utils = modules.filter((m) => m.type === 'util');

    if (routes.length > 0) {
      diagram += '  subgraph API["API Layer"]\n';
      for (const route of routes.slice(0, 6)) {
        diagram += `    ${this.sanitizeMermaidId(route.name)}["${route.name}"]\n`;
      }
      diagram += '  end\n';
    }

    if (services.length > 0) {
      diagram += '  subgraph Services["Service Layer"]\n';
      for (const service of services.slice(0, 6)) {
        diagram += `    ${this.sanitizeMermaidId(service.name)}["${service.name}"]\n`;
      }
      diagram += '  end\n';
    }

    if (utils.length > 0) {
      diagram += '  subgraph Utils["Utilities"]\n';
      for (const util of utils.slice(0, 4)) {
        diagram += `    ${this.sanitizeMermaidId(util.name)}["${util.name}"]\n`;
      }
      diagram += '  end\n';
    }

    // Connect layers
    if (routes.length > 0 && services.length > 0) {
      diagram += '  API --> Services\n';
    }
    if (services.length > 0 && utils.length > 0) {
      diagram += '  Services --> Utils\n';
    }

    return diagram;
  }

  private sanitizeMermaidId(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

export const architectureAnalyzerService = new ArchitectureAnalyzerService();
