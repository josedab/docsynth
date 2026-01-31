import { GitHubClient } from '@docsynth/github';
import { createLogger } from '@docsynth/utils';

const log = createLogger('coverage-analyzer-service');

export interface ExportedItem {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'enum';
  filePath: string;
  line: number;
  isDocumented: boolean;
  documentationQuality?: 'none' | 'minimal' | 'partial' | 'complete';
  signature?: string;
}

export interface CoverageResult {
  totalExports: number;
  documentedCount: number;
  coveragePercent: number;
  undocumented: ExportedItem[];
  partiallyDocumented: ExportedItem[];
  fullyDocumented: ExportedItem[];
  byFileType: Record<string, { total: number; documented: number }>;
  byModule: Record<string, { total: number; documented: number; items: ExportedItem[] }>;
}

export interface CoverageThresholds {
  minimum: number;
  target: number;
  exportedOnly: boolean;
}

const DEFAULT_THRESHOLDS: CoverageThresholds = {
  minimum: 50,
  target: 80,
  exportedOnly: true,
};

export class CoverageAnalyzerService {
  async analyzeRepository(
    client: GitHubClient,
    owner: string,
    repo: string,
    branch: string,
    thresholds: CoverageThresholds = DEFAULT_THRESHOLDS
  ): Promise<CoverageResult> {
    log.info({ owner, repo, branch }, 'Analyzing documentation coverage');

    // Get repository file tree by listing directories recursively
    const tree = await this.getRepositoryTree(client, owner, repo, '', branch);
    
    // Filter to source files
    const sourceFiles = tree.filter((f: { path: string; type: string }) =>
      f.path?.match(/\.(ts|tsx|js|jsx)$/) &&
      !f.path?.includes('node_modules') &&
      !f.path?.includes('.test.') &&
      !f.path?.includes('.spec.') &&
      !f.path?.includes('__tests__')
    );

    const allItems: ExportedItem[] = [];
    const byFileType: Record<string, { total: number; documented: number }> = {};
    const byModule: Record<string, { total: number; documented: number; items: ExportedItem[] }> = {};

    for (const file of sourceFiles.slice(0, 100)) { // Limit to avoid rate limits
      if (!file.path) continue;

      try {
        const content = await client.getFileContent(owner, repo, file.path, branch);
        if (!content) continue;

        const items = this.analyzeFile(file.path, content, thresholds.exportedOnly);
        allItems.push(...items);

        // Track by file type
        const ext = file.path.split('.').pop() ?? 'unknown';
        if (!byFileType[ext]) {
          byFileType[ext] = { total: 0, documented: 0 };
        }
        byFileType[ext].total += items.length;
        byFileType[ext].documented += items.filter((i) => i.isDocumented).length;

        // Track by module (directory)
        const module = file.path.split('/').slice(0, -1).join('/') || 'root';
        if (!byModule[module]) {
          byModule[module] = { total: 0, documented: 0, items: [] };
        }
        byModule[module].total += items.length;
        byModule[module].documented += items.filter((i) => i.isDocumented).length;
        byModule[module].items.push(...items);
      } catch (error) {
        log.warn({ error, path: file.path }, 'Failed to analyze file');
      }
    }

    const documentedCount = allItems.filter((i) => i.isDocumented).length;
    const coveragePercent = allItems.length > 0 ? (documentedCount / allItems.length) * 100 : 100;

    const result: CoverageResult = {
      totalExports: allItems.length,
      documentedCount,
      coveragePercent: Math.round(coveragePercent * 100) / 100,
      undocumented: allItems.filter((i) => !i.isDocumented),
      partiallyDocumented: allItems.filter((i) => i.documentationQuality === 'partial'),
      fullyDocumented: allItems.filter((i) => i.documentationQuality === 'complete'),
      byFileType,
      byModule,
    };

    log.info({
      totalExports: result.totalExports,
      documentedCount: result.documentedCount,
      coveragePercent: result.coveragePercent,
    }, 'Coverage analysis complete');

    return result;
  }

  analyzeFile(filePath: string, content: string, exportedOnly: boolean): ExportedItem[] {
    const items: ExportedItem[] = [];
    const lines = content.split('\n');

    // Simple pattern-based analysis (faster than full AST for large repos)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // Check for exports
      const isExport = line.trimStart().startsWith('export');
      if (exportedOnly && !isExport) continue;

      // Function exports
      const funcMatch = line.match(/^(export\s+)?(async\s+)?function\s+(\w+)/);
      if (funcMatch && funcMatch[3]) {
        const hasDoc = this.hasDocumentation(lines, i);
        items.push({
          name: funcMatch[3],
          type: 'function',
          filePath,
          line: i + 1,
          isDocumented: hasDoc,
          documentationQuality: this.assessDocQuality(lines, i),
          signature: this.extractSignature(lines, i),
        });
        continue;
      }

      // Class exports
      const classMatch = line.match(/^(export\s+)?class\s+(\w+)/);
      if (classMatch && classMatch[2]) {
        const hasDoc = this.hasDocumentation(lines, i);
        items.push({
          name: classMatch[2],
          type: 'class',
          filePath,
          line: i + 1,
          isDocumented: hasDoc,
          documentationQuality: this.assessDocQuality(lines, i),
        });
        continue;
      }

      // Interface exports
      const interfaceMatch = line.match(/^(export\s+)?interface\s+(\w+)/);
      if (interfaceMatch && interfaceMatch[2]) {
        const hasDoc = this.hasDocumentation(lines, i);
        items.push({
          name: interfaceMatch[2],
          type: 'interface',
          filePath,
          line: i + 1,
          isDocumented: hasDoc,
          documentationQuality: this.assessDocQuality(lines, i),
        });
        continue;
      }

      // Type exports
      const typeMatch = line.match(/^(export\s+)?type\s+(\w+)/);
      if (typeMatch && typeMatch[2]) {
        const hasDoc = this.hasDocumentation(lines, i);
        items.push({
          name: typeMatch[2],
          type: 'type',
          filePath,
          line: i + 1,
          isDocumented: hasDoc,
          documentationQuality: this.assessDocQuality(lines, i),
        });
        continue;
      }

      // Enum exports
      const enumMatch = line.match(/^(export\s+)?enum\s+(\w+)/);
      if (enumMatch && enumMatch[2]) {
        const hasDoc = this.hasDocumentation(lines, i);
        items.push({
          name: enumMatch[2],
          type: 'enum',
          filePath,
          line: i + 1,
          isDocumented: hasDoc,
          documentationQuality: this.assessDocQuality(lines, i),
        });
        continue;
      }

      // Const function exports
      const constFuncMatch = line.match(/^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?\(/);
      if (constFuncMatch && constFuncMatch[2]) {
        const hasDoc = this.hasDocumentation(lines, i);
        items.push({
          name: constFuncMatch[2],
          type: 'function',
          filePath,
          line: i + 1,
          isDocumented: hasDoc,
          documentationQuality: this.assessDocQuality(lines, i),
          signature: this.extractSignature(lines, i),
        });
        continue;
      }
    }

    return items;
  }

  private hasDocumentation(lines: string[], lineIndex: number): boolean {
    if (lineIndex === 0) return false;

    // Look back for JSDoc or comments
    for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 10); i--) {
      const line = lines[i]?.trim() ?? '';
      
      // End of JSDoc
      if (line === '*/') return true;
      // Single-line JSDoc
      if (line.match(/^\/\*\*.*\*\/$/)) return true;
      // Comment line
      if (line.startsWith('//')) return true;
      
      // If we hit a non-comment, non-empty line, stop looking
      if (line && !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('/*')) {
        return false;
      }
    }

    return false;
  }

  private assessDocQuality(lines: string[], lineIndex: number): 'none' | 'minimal' | 'partial' | 'complete' {
    if (!this.hasDocumentation(lines, lineIndex)) {
      return 'none';
    }

    // Find the JSDoc block
    let docBlock = '';
    for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 20); i--) {
      const line = lines[i]?.trim() ?? '';
      
      if (line.startsWith('/**')) {
        break;
      }
      if (line.startsWith('*') || line.startsWith('//')) {
        docBlock = line + '\n' + docBlock;
      }
      if (!line.startsWith('*') && !line.startsWith('//') && !line.endsWith('*/') && line) {
        break;
      }
    }

    // Check for quality indicators
    const hasDescription = docBlock.length > 20;
    const hasParams = docBlock.includes('@param');
    const hasReturns = docBlock.includes('@returns') || docBlock.includes('@return');
    const hasExample = docBlock.includes('@example');

    const score = [hasDescription, hasParams, hasReturns, hasExample].filter(Boolean).length;

    if (score === 0) return 'minimal';
    if (score <= 2) return 'partial';
    return 'complete';
  }

  private extractSignature(lines: string[], lineIndex: number): string {
    let signature = '';
    let parenCount = 0;
    let started = false;

    for (let i = lineIndex; i < Math.min(lines.length, lineIndex + 5); i++) {
      const line = lines[i] ?? '';
      signature += line + '\n';

      for (const char of line) {
        if (char === '(') {
          parenCount++;
          started = true;
        } else if (char === ')') {
          parenCount--;
          if (started && parenCount === 0) {
            return signature.trim();
          }
        }
      }
    }

    return signature.trim().split('\n')[0] ?? '';
  }

  generateBadgeSvg(coverage: number, label: string = 'docs'): string {
    const color = coverage >= 80 ? '#4c1' : coverage >= 60 ? '#dfb317' : coverage >= 40 ? '#fe7d37' : '#e05d44';
    const coverageText = `${Math.round(coverage)}%`;
    const labelWidth = label.length * 6.5 + 10;
    const valueWidth = coverageText.length * 6.5 + 10;
    const totalWidth = labelWidth + valueWidth;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <path fill="#555" d="M0 0h${labelWidth}v20H0z"/>
    <path fill="${color}" d="M${labelWidth} 0h${valueWidth}v20H${labelWidth}z"/>
    <path fill="url(#b)" d="M0 0h${totalWidth}v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${coverageText}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${coverageText}</text>
  </g>
</svg>`;
  }

  private async getRepositoryTree(
    client: GitHubClient,
    owner: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<Array<{ path: string; type: string }>> {
    const items: Array<{ path: string; type: string }> = [];
    
    try {
      const contents = await client.getDirectoryContents(owner, repo, path, ref);
      
      for (const item of contents) {
        items.push({ path: item.path, type: item.type });
        
        // Recursively get contents of directories (limit depth)
        if (item.type === 'dir' && !item.path.includes('node_modules') && item.path.split('/').length < 5) {
          const subItems = await this.getRepositoryTree(client, owner, repo, item.path, ref);
          items.push(...subItems);
        }
      }
    } catch (error) {
      log.warn({ error, owner, repo, path }, 'Failed to get directory contents');
    }
    
    return items;
  }
}

export const coverageAnalyzerService = new CoverageAnalyzerService();
