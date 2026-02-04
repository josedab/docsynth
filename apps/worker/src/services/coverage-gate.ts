/**
 * Coverage Gate Service
 *
 * Analyzes documentation coverage and enforces thresholds
 * through GitHub Check Runs.
 */

import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';
import { createInstallationOctokit } from '@docsynth/github';

const log = createLogger('coverage-gate-service');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface CoverageResult {
  coveragePercent: number;
  totalExports: number;
  documentedExports: number;
  undocumented: ExportInfo[];
  partiallyDocumented: ExportInfo[];
  fullyDocumented: ExportInfo[];
  byFileType: Record<string, { total: number; documented: number }>;
  byModule: Record<string, { total: number; documented: number }>;
}

export interface ExportInfo {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum';
  filePath: string;
  line: number;
  hasJSDoc: boolean;
  hasReadme: boolean;
  suggestion?: string;
}

export interface CheckRunResult {
  checkRunId: number;
  conclusion: 'success' | 'failure' | 'neutral';
  summary: string;
  details: string;
}

// ============================================================================
// Coverage Gate Service
// ============================================================================

export class CoverageGateService {
  /**
   * Analyze documentation coverage for a commit
   */
  async analyzeCoverage(
    repositoryId: string,
    installationId: number,
    owner: string,
    repo: string,
    commitSha: string,
    branch: string
  ): Promise<CoverageResult> {
    log.info({ repositoryId, commitSha }, 'Analyzing documentation coverage');

    const octokit = createInstallationOctokit(installationId);
    if (!octokit) {
      throw new Error('Failed to get GitHub client');
    }

    // Get repository tree
    const { data: tree } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: commitSha,
      recursive: 'true',
    });

    // Filter for source files
    const sourceFiles = tree.tree.filter(
      (item: { type?: string; path?: string }) =>
        item.type === 'blob' &&
        item.path &&
        (item.path.endsWith('.ts') ||
          item.path.endsWith('.tsx') ||
          item.path.endsWith('.js') ||
          item.path.endsWith('.jsx')) &&
        !item.path.includes('node_modules') &&
        !item.path.includes('.test.') &&
        !item.path.includes('.spec.') &&
        !item.path.includes('__tests__')
    );

    log.info({ fileCount: sourceFiles.length }, 'Found source files');

    // Analyze exports in each file
    const allExports: ExportInfo[] = [];
    const byFileType: Record<string, { total: number; documented: number }> = {};
    const byModule: Record<string, { total: number; documented: number }> = {};

    for (const file of sourceFiles.slice(0, 100)) { // Limit to avoid rate limits
      if (!file.sha || !file.path) continue;

      try {
        const { data: blob } = await octokit.git.getBlob({
          owner,
          repo,
          file_sha: file.sha,
        });

        const content = Buffer.from(blob.content, 'base64').toString('utf-8');
        const fileExports = this.extractExports(content, file.path);

        allExports.push(...fileExports);

        // Track by file type
        const ext = file.path.split('.').pop() || 'unknown';
        if (!byFileType[ext]) {
          byFileType[ext] = { total: 0, documented: 0 };
        }
        byFileType[ext].total += fileExports.length;
        byFileType[ext].documented += fileExports.filter((e) => e.hasJSDoc).length;

        // Track by module (first directory)
        const module = file.path.split('/')[0] || 'root';
        if (!byModule[module]) {
          byModule[module] = { total: 0, documented: 0 };
        }
        byModule[module].total += fileExports.length;
        byModule[module].documented += fileExports.filter((e) => e.hasJSDoc).length;
      } catch (error) {
        log.warn({ error, file: file.path }, 'Failed to analyze file');
      }
    }

    // Check for README coverage
    const documents = await prisma.document.findMany({
      where: { repositoryId },
      select: { path: true, content: true },
    });

    // Match exports to documentation
    for (const exp of allExports) {
      for (const doc of documents) {
        if (
          doc.content.includes(exp.name) ||
          doc.path.toLowerCase().includes(exp.name.toLowerCase())
        ) {
          exp.hasReadme = true;
          break;
        }
      }
    }

    // Categorize exports
    const undocumented = allExports.filter((e) => !e.hasJSDoc && !e.hasReadme);
    const partiallyDocumented = allExports.filter(
      (e) => (e.hasJSDoc || e.hasReadme) && !(e.hasJSDoc && e.hasReadme)
    );
    const fullyDocumented = allExports.filter((e) => e.hasJSDoc && e.hasReadme);

    const totalExports = allExports.length;
    const documentedExports = fullyDocumented.length + partiallyDocumented.length;
    const coveragePercent =
      totalExports > 0 ? Math.round((documentedExports / totalExports) * 100) : 100;

    // Generate suggestions for undocumented exports
    await this.generateSuggestions(undocumented.slice(0, 10));

    return {
      coveragePercent,
      totalExports,
      documentedExports,
      undocumented,
      partiallyDocumented,
      fullyDocumented,
      byFileType,
      byModule,
    };
  }

  /**
   * Extract exports from a source file
   */
  private extractExports(content: string, filePath: string): ExportInfo[] {
    const exports: ExportInfo[] = [];
    const lines = content.split('\n');

    // Regex patterns for different export types
    const patterns = [
      { regex: /^export\s+(?:async\s+)?function\s+(\w+)/gm, type: 'function' as const },
      { regex: /^export\s+class\s+(\w+)/gm, type: 'class' as const },
      { regex: /^export\s+interface\s+(\w+)/gm, type: 'interface' as const },
      { regex: /^export\s+type\s+(\w+)/gm, type: 'type' as const },
      { regex: /^export\s+const\s+(\w+)/gm, type: 'const' as const },
      { regex: /^export\s+enum\s+(\w+)/gm, type: 'enum' as const },
      { regex: /^export\s+default\s+(?:class|function)\s+(\w+)/gm, type: 'class' as const },
    ];

    for (const { regex, type } of patterns) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        if (!name) continue;

        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const line = beforeMatch.split('\n').length;

        // Check for JSDoc
        const hasJSDoc = this.hasJSDocComment(lines, line - 1);

        exports.push({
          name,
          type,
          filePath,
          line,
          hasJSDoc,
          hasReadme: false,
        });
      }
    }

    return exports;
  }

  /**
   * Check if there's a JSDoc comment above the given line
   */
  private hasJSDocComment(lines: string[], lineIndex: number): boolean {
    // Look backwards for JSDoc comment
    for (let i = lineIndex - 1; i >= 0 && i >= lineIndex - 10; i--) {
      const line = lines[i]?.trim() || '';
      if (line === '*/') {
        // Found end of comment, look for start
        for (let j = i - 1; j >= 0 && j >= i - 50; j--) {
          const startLine = lines[j]?.trim() || '';
          if (startLine.startsWith('/**')) {
            return true;
          }
          if (startLine && !startLine.startsWith('*') && !startLine.startsWith('//')) {
            break;
          }
        }
      }
      if (line && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*')) {
        break;
      }
    }
    return false;
  }

  /**
   * Generate documentation suggestions using AI
   */
  private async generateSuggestions(exports: ExportInfo[]): Promise<void> {
    const anthropic = getAnthropicClient();
    if (!anthropic || exports.length === 0) {
      return;
    }

    const exportList = exports
      .map((e) => `- ${e.type} ${e.name} in ${e.filePath}:${e.line}`)
      .join('\n');

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: `Generate brief documentation suggestions for these undocumented exports:

${exportList}

For each export, provide a one-line suggestion for what documentation should include. Return as JSON array:
[
  {"name": "exportName", "suggestion": "Brief documentation suggestion"}
]`,
          },
        ],
      });

      const content =
        response.content[0]?.type === 'text' ? response.content[0].text : null;

      if (content) {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const suggestions = JSON.parse(jsonMatch[0]) as Array<{
            name: string;
            suggestion: string;
          }>;

          for (const suggestion of suggestions) {
            const exp = exports.find((e) => e.name === suggestion.name);
            if (exp) {
              exp.suggestion = suggestion.suggestion;
            }
          }
        }
      }
    } catch (error) {
      log.warn({ error }, 'Failed to generate suggestions');
    }
  }

  /**
   * Create or update a GitHub Check Run
   */
  async createCheckRun(
    installationId: number,
    owner: string,
    repo: string,
    commitSha: string,
    result: CoverageResult,
    config: { minCoveragePercent: number; failOnDecrease: boolean; maxDecreasePercent: number },
    previousPercent: number | null
  ): Promise<CheckRunResult> {
    const octokit = createInstallationOctokit(installationId);
    if (!octokit) {
      throw new Error('Failed to get GitHub client');
    }

    // Determine conclusion
    let conclusion: 'success' | 'failure' | 'neutral' = 'success';
    const issues: string[] = [];

    if (result.coveragePercent < config.minCoveragePercent) {
      conclusion = 'failure';
      issues.push(
        `Coverage ${result.coveragePercent}% is below minimum threshold ${config.minCoveragePercent}%`
      );
    }

    if (config.failOnDecrease && previousPercent !== null) {
      const decrease = previousPercent - result.coveragePercent;
      if (decrease > config.maxDecreasePercent) {
        conclusion = 'failure';
        issues.push(
          `Coverage decreased by ${decrease.toFixed(1)}% (max allowed: ${config.maxDecreasePercent}%)`
        );
      }
    }

    // Build summary
    const summary = this.buildCheckRunSummary(result, previousPercent, issues);
    const details = this.buildCheckRunDetails(result);

    // Create check run
    const { data: checkRun } = await octokit.checks.create({
      owner,
      repo,
      name: 'DocSynth Coverage',
      head_sha: commitSha,
      status: 'completed',
      conclusion,
      output: {
        title:
          conclusion === 'success'
            ? `✅ Documentation Coverage: ${result.coveragePercent}%`
            : `❌ Documentation Coverage: ${result.coveragePercent}%`,
        summary,
        text: details,
      },
    });

    return {
      checkRunId: checkRun.id,
      conclusion,
      summary,
      details,
    };
  }

  /**
   * Build check run summary
   */
  private buildCheckRunSummary(
    result: CoverageResult,
    previousPercent: number | null,
    issues: string[]
  ): string {
    let summary = `## Documentation Coverage Report\n\n`;
    summary += `**Coverage: ${result.coveragePercent}%**`;

    if (previousPercent !== null) {
      const change = result.coveragePercent - previousPercent;
      const changeIcon = change >= 0 ? '📈' : '📉';
      summary += ` ${changeIcon} (${change >= 0 ? '+' : ''}${change.toFixed(1)}% from previous)`;
    }

    summary += `\n\n`;
    summary += `| Metric | Count |\n`;
    summary += `|--------|-------|\n`;
    summary += `| Total Exports | ${result.totalExports} |\n`;
    summary += `| Documented | ${result.documentedExports} |\n`;
    summary += `| Undocumented | ${result.undocumented.length} |\n`;

    if (issues.length > 0) {
      summary += `\n### ⚠️ Issues\n\n`;
      for (const issue of issues) {
        summary += `- ${issue}\n`;
      }
    }

    if (result.undocumented.length > 0) {
      summary += `\n### Missing Documentation\n\n`;
      summary += `The following exports need documentation:\n\n`;
      for (const exp of result.undocumented.slice(0, 10)) {
        summary += `- \`${exp.name}\` (${exp.type}) in \`${exp.filePath}:${exp.line}\``;
        if (exp.suggestion) {
          summary += `\n  > 💡 ${exp.suggestion}`;
        }
        summary += `\n`;
      }
      if (result.undocumented.length > 10) {
        summary += `\n_...and ${result.undocumented.length - 10} more_\n`;
      }
    }

    return summary;
  }

  /**
   * Build detailed check run output
   */
  private buildCheckRunDetails(result: CoverageResult): string {
    let details = `## Coverage by Module\n\n`;
    details += `| Module | Coverage | Total | Documented |\n`;
    details += `|--------|----------|-------|------------|\n`;

    for (const [module, stats] of Object.entries(result.byModule)) {
      const pct = stats.total > 0 ? Math.round((stats.documented / stats.total) * 100) : 100;
      details += `| ${module} | ${pct}% | ${stats.total} | ${stats.documented} |\n`;
    }

    details += `\n## Coverage by File Type\n\n`;
    details += `| Type | Coverage | Total | Documented |\n`;
    details += `|------|----------|-------|------------|\n`;

    for (const [type, stats] of Object.entries(result.byFileType)) {
      const pct = stats.total > 0 ? Math.round((stats.documented / stats.total) * 100) : 100;
      details += `| .${type} | ${pct}% | ${stats.total} | ${stats.documented} |\n`;
    }

    return details;
  }

  /**
   * Get or create coverage gate configuration
   */
  async getConfig(repositoryId: string): Promise<{
    enabled: boolean;
    minCoveragePercent: number;
    failOnDecrease: boolean;
    maxDecreasePercent: number;
    blockMerge: boolean;
  }> {
    const config = await db.coverageGateConfig.findUnique({
      where: { repositoryId },
    });

    return {
      enabled: config?.enabled ?? false,
      minCoveragePercent: config?.minCoveragePercent ?? 70,
      failOnDecrease: config?.failOnDecrease ?? true,
      maxDecreasePercent: config?.maxDecreasePercent ?? 5,
      blockMerge: config?.blockMerge ?? false,
    };
  }

  /**
   * Get previous coverage for comparison
   */
  async getPreviousCoverage(
    repositoryId: string,
    branch: string
  ): Promise<number | null> {
    const previous = await db.coverageReport.findFirst({
      where: { repositoryId, branch, passed: true },
      orderBy: { createdAt: 'desc' },
      select: { coveragePercent: true },
    });

    return previous?.coveragePercent ?? null;
  }

  /**
   * Store coverage report
   */
  async storeCoverageReport(
    repositoryId: string,
    commitSha: string,
    branch: string,
    prNumber: number | null,
    result: CoverageResult,
    checkRunId: number | null,
    passed: boolean
  ): Promise<string> {
    const report = await db.coverageReport.create({
      data: {
        repositoryId,
        commitSha,
        branch,
        totalExports: result.totalExports,
        documentedCount: result.documentedExports,
        coveragePercent: result.coveragePercent,
        undocumented: result.undocumented.map((e) => ({
          name: e.name,
          type: e.type,
          file: e.filePath,
          line: e.line,
          suggestion: e.suggestion,
        })),
        partiallyDoc: result.partiallyDocumented.map((e) => ({
          name: e.name,
          type: e.type,
          file: e.filePath,
        })),
        fullyDoc: result.fullyDocumented.map((e) => ({
          name: e.name,
          type: e.type,
          file: e.filePath,
        })),
        byFileType: result.byFileType,
        byModule: result.byModule,
        threshold: 70,
        passed,
        checkRunId: checkRunId?.toString(),
      },
    });

    return report.id;
  }
}

export const coverageGateService = new CoverageGateService();
