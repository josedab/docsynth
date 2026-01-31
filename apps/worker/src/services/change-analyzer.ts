import { GitHubClient } from '@docsynth/github';
import type { GitHubFile, FileChange, SemanticChange, SemanticChangeType } from '@docsynth/types';
import { createLogger } from '@docsynth/utils';

const log = createLogger('change-analyzer-service');

export interface AnalysisResult {
  changes: FileChange[];
  requiresDocumentation: boolean;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'none';
  documentationImpact: {
    affectedDocs: string[];
    newDocsNeeded: string[];
    updatePriority: 'high' | 'medium' | 'low';
  };
}

// ============================================================================
// File Classification Patterns
// ============================================================================

/** Patterns for identifying test files that typically don't require documentation */
export const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,    // Jest/Vitest tests
  /\.spec\.[jt]sx?$/,    // Jasmine/Mocha specs
  /__tests__\//,         // Jest test directories
  /\.stories\.[jt]sx?$/, // Storybook stories
  /\.e2e\.[jt]sx?$/,     // End-to-end tests
];

/** Patterns for identifying generated/build files that should be ignored */
export const GENERATED_FILE_PATTERNS = [
  /generated/i,          // Generic generated files
  /\.gen\.[jt]sx?$/,     // Generated code files
  /\.d\.ts$/,            // TypeScript declaration files
  /node_modules/,        // Dependencies
  /dist\//,              // Build output
  /build\//,             // Build output
  /\.min\.[jt]s$/,       // Minified files
  /package-lock\.json$/, // npm lock file
  /yarn\.lock$/,         // Yarn lock file
  /pnpm-lock\.yaml$/,    // pnpm lock file
];

/** Patterns for identifying configuration files */
export const CONFIG_FILE_PATTERNS = [
  /^\..*rc(\.json)?$/,   // RC config files (.eslintrc, .babelrc, etc.)
  /^tsconfig.*\.json$/,  // TypeScript configs
  /^jest\.config/,       // Jest config
  /^vite\.config/,       // Vite config
  /^webpack\.config/,    // Webpack config
  /^rollup\.config/,     // Rollup config
];

export class ChangeAnalyzerService {
  async analyzeChanges(
    client: GitHubClient,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<AnalysisResult> {
    log.info({ owner, repo, prNumber }, 'Analyzing PR changes');

    // Get PR files
    const files = await client.getPullRequestFiles(owner, repo, prNumber);

    // Filter and analyze files
    const documentationWorthyFiles = files.filter((f) => this.isDocumentationWorthy(f));

    if (documentationWorthyFiles.length === 0) {
      return {
        changes: [],
        requiresDocumentation: false,
        priority: 'none',
        documentationImpact: {
          affectedDocs: [],
          newDocsNeeded: [],
          updatePriority: 'low',
        },
      };
    }

    // Analyze each file
    const changes: FileChange[] = [];

    for (const file of documentationWorthyFiles) {
      const fileChange = await this.analyzeFileChange(client, owner, repo, file, prNumber);
      changes.push(fileChange);
    }

    // Calculate priority and impact
    const priority = this.calculatePriority(changes);
    const documentationImpact = this.assessDocumentationImpact(changes);
    const requiresDocumentation = priority !== 'none' && changes.length > 0;

    log.info(
      { filesAnalyzed: changes.length, priority, requiresDocumentation },
      'Analysis complete'
    );

    return {
      changes,
      requiresDocumentation,
      priority,
      documentationImpact,
    };
  }

  private isDocumentationWorthy(file: GitHubFile): boolean {
    const filename = file.filename;

    // Skip test files
    if (TEST_FILE_PATTERNS.some((pattern) => pattern.test(filename))) {
      return false;
    }

    // Skip generated files
    if (GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(filename))) {
      return false;
    }

    // Skip config files (usually don't need docs)
    if (CONFIG_FILE_PATTERNS.some((pattern) => pattern.test(filename.split('/').pop() ?? ''))) {
      return false;
    }

    // Include source files
    const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];
    const ext = '.' + filename.split('.').pop();
    if (sourceExtensions.includes(ext)) {
      return true;
    }

    // Include markdown (might be manual docs that need updating)
    if (filename.endsWith('.md') && !filename.toLowerCase().includes('changelog')) {
      return true;
    }

    return false;
  }

  private async analyzeFileChange(
    client: GitHubClient,
    owner: string,
    repo: string,
    file: GitHubFile,
    _prNumber: number
  ): Promise<FileChange> {
    const semanticChanges: SemanticChange[] = [];

    // Parse the patch to identify semantic changes
    if (file.patch) {
      const changes = this.parseSemanticChanges(file.filename, file.patch);
      semanticChanges.push(...changes);
    }

    return {
      path: file.filename,
      changeType: file.status as FileChange['changeType'],
      oldPath: file.previousFilename,
      additions: file.additions,
      deletions: file.deletions,
      semanticChanges,
    };
  }

  private parseSemanticChanges(filename: string, patch: string): SemanticChange[] {
    const changes: SemanticChange[] = [];
    const lines = patch.split('\n');

    let currentLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // Track line numbers from diff headers
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[1] ?? '0', 10);
        continue;
      }

      if (line.startsWith('+') && !line.startsWith('+++')) {
        const content = line.slice(1);

        // Detect new exports
        const exportMatch = content.match(/^export\s+(const|function|class|interface|type|enum)\s+(\w+)/);
        if (exportMatch) {
          changes.push({
            type: this.mapExportType(exportMatch[1] ?? ''),
            name: exportMatch[2] ?? '',
            location: { file: filename, startLine: currentLine, endLine: currentLine },
            description: `New ${exportMatch[1]} export: ${exportMatch[2]}`,
            breaking: false,
          });
        }

        // Detect function definitions
        const funcMatch = content.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
        if (funcMatch && !exportMatch) {
          changes.push({
            type: 'new-function',
            name: funcMatch[1] ?? '',
            location: { file: filename, startLine: currentLine, endLine: currentLine },
            description: `New function: ${funcMatch[1]}`,
            breaking: false,
          });
        }

        // Detect class definitions
        const classMatch = content.match(/^(?:export\s+)?class\s+(\w+)/);
        if (classMatch && !exportMatch) {
          changes.push({
            type: 'new-class',
            name: classMatch[1] ?? '',
            location: { file: filename, startLine: currentLine, endLine: currentLine },
            description: `New class: ${classMatch[1]}`,
            breaking: false,
          });
        }

        // Detect interface definitions
        const interfaceMatch = content.match(/^(?:export\s+)?interface\s+(\w+)/);
        if (interfaceMatch && !exportMatch) {
          changes.push({
            type: 'new-interface',
            name: interfaceMatch[1] ?? '',
            location: { file: filename, startLine: currentLine, endLine: currentLine },
            description: `New interface: ${interfaceMatch[1]}`,
            breaking: false,
          });
        }

        // Detect deprecation comments
        if (content.includes('@deprecated')) {
          changes.push({
            type: 'deprecation',
            name: 'deprecation',
            location: { file: filename, startLine: currentLine, endLine: currentLine },
            description: 'Deprecation added',
            breaking: false,
          });
        }

        currentLine++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // Track removals for breaking changes
        const content = line.slice(1);

        const exportMatch = content.match(/^export\s+(const|function|class|interface|type|enum)\s+(\w+)/);
        if (exportMatch) {
          changes.push({
            type: 'removal',
            name: exportMatch[2] ?? '',
            location: { file: filename, startLine: currentLine, endLine: currentLine },
            description: `Removed ${exportMatch[1]} export: ${exportMatch[2]}`,
            breaking: true,
          });
        }
      } else if (!line.startsWith('-')) {
        currentLine++;
      }
    }

    return changes;
  }

  private mapExportType(type: string): SemanticChangeType {
    switch (type) {
      case 'function':
        return 'new-function';
      case 'class':
        return 'new-class';
      case 'interface':
        return 'new-interface';
      case 'type':
        return 'new-type';
      default:
        return 'new-export';
    }
  }

  private calculatePriority(changes: FileChange[]): 'critical' | 'high' | 'medium' | 'low' | 'none' {
    if (changes.length === 0) return 'none';

    const hasBreaking = changes.some((c) => c.semanticChanges.some((sc) => sc.breaking));
    if (hasBreaking) return 'critical';

    const hasNewExports = changes.some((c) =>
      c.semanticChanges.some((sc) =>
        ['new-export', 'new-function', 'new-class', 'new-interface'].includes(sc.type)
      )
    );
    if (hasNewExports) return 'high';

    const hasApiChanges = changes.some((c) =>
      c.semanticChanges.some((sc) => sc.type === 'api-change' || sc.type === 'signature-change')
    );
    if (hasApiChanges) return 'high';

    const totalChanges = changes.reduce((sum, c) => sum + c.additions + c.deletions, 0);
    if (totalChanges > 500) return 'medium';
    if (totalChanges > 100) return 'low';

    return 'low';
  }

  private assessDocumentationImpact(changes: FileChange[]): {
    affectedDocs: string[];
    newDocsNeeded: string[];
    updatePriority: 'high' | 'medium' | 'low';
  } {
    const affectedDocs: Set<string> = new Set();
    const newDocsNeeded: Set<string> = new Set();

    for (const change of changes) {
      // README affected if main entry points change
      if (change.path.includes('index') || change.path.includes('main')) {
        affectedDocs.add('README.md');
      }

      // API docs affected if there are new exports
      const hasApiChanges = change.semanticChanges.some((sc) =>
        ['new-export', 'new-function', 'new-class', 'api-change'].includes(sc.type)
      );
      if (hasApiChanges) {
        affectedDocs.add('api-reference');
        newDocsNeeded.add('api-reference');
      }

      // Changelog always needs update
      affectedDocs.add('CHANGELOG.md');
    }

    // Determine priority
    const hasBreaking = changes.some((c) => c.semanticChanges.some((sc) => sc.breaking));
    const hasNewFeatures = changes.some((c) =>
      c.semanticChanges.some((sc) =>
        ['new-export', 'new-function', 'new-class'].includes(sc.type)
      )
    );

    let updatePriority: 'high' | 'medium' | 'low' = 'low';
    if (hasBreaking) updatePriority = 'high';
    else if (hasNewFeatures) updatePriority = 'medium';

    return {
      affectedDocs: Array.from(affectedDocs),
      newDocsNeeded: Array.from(newDocsNeeded),
      updatePriority,
    };
  }
}

export const changeAnalyzerService = new ChangeAnalyzerService();
