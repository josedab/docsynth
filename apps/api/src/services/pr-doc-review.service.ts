/**
 * PR Documentation Review Service
 *
 * Analyzes pull requests for documentation impact and generates actionable
 * review comments for undocumented exports, broken examples, and inconsistent
 * terminology. Posts comments directly to GitHub/GitLab via their APIs.
 */

import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';
import { createInstallationOctokit } from '@docsynth/github';

const log = createLogger('pr-doc-review-service');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface PRDocReviewAnalysis {
  prNumber: number;
  repositoryId: string;
  changedFiles: string[];
  undocumentedExports: UndocumentedExport[];
  brokenExamples: BrokenExample[];
  inconsistentTerms: InconsistentTerm[];
  suggestedFixes: SuggestedFix[];
}

export interface UndocumentedExport {
  filePath: string;
  exportName: string;
  exportType: 'function' | 'class' | 'interface' | 'type' | 'const';
  line: number;
}

export interface BrokenExample {
  filePath: string;
  section: string;
  reason: string;
  line: number;
}

export interface InconsistentTerm {
  term: string;
  variants: string[];
  occurrences: Array<{ filePath: string; line: number }>;
  preferredTerm: string;
}

export interface SuggestedFix {
  filePath: string;
  line: number;
  description: string;
  replacement?: string;
}

export interface ReviewComment {
  id: string;
  filePath: string;
  line: number;
  body: string;
  severity: 'info' | 'warning' | 'error';
  confidence: number;
  suggestion?: string;
}

export interface ReviewSettings {
  enabled: boolean;
  sensitivity: 'low' | 'medium' | 'high';
  autoComment: boolean;
  notifyOnBreaking: boolean;
  minConfidence: number;
  excludePatterns: string[];
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  enabled: false,
  sensitivity: 'medium',
  autoComment: true,
  notifyOnBreaking: true,
  minConfidence: 0.7,
  excludePatterns: [],
};

// ============================================================================
// PR Documentation Review Service
// ============================================================================

class PRDocReviewService {
  /**
   * Analyze a PR's changed files to find undocumented exports,
   * broken examples, and inconsistent terminology.
   */
  async analyzePRForDocImpact(params: {
    repositoryId: string;
    prNumber: number;
    changedFiles: Array<{
      filename: string;
      status: 'added' | 'modified' | 'removed' | 'renamed';
      patch?: string;
    }>;
  }): Promise<PRDocReviewAnalysis> {
    const { repositoryId, prNumber, changedFiles } = params;

    log.info({ repositoryId, prNumber, fileCount: changedFiles.length }, 'Analyzing PR for doc impact');

    const settings = await this.getReviewSettings(repositoryId);

    // Filter out excluded files
    const filesToAnalyze = changedFiles.filter(
      (f) => !settings.excludePatterns.some((pattern) => this.matchPattern(f.filename, pattern))
    );

    // Get existing documentation for this repository
    const documents = await prisma.document.findMany({
      where: { repositoryId },
      select: { id: true, path: true, title: true, content: true, metadata: true },
    });

    const undocumentedExports: UndocumentedExport[] = [];
    const brokenExamples: BrokenExample[] = [];
    const inconsistentTerms: InconsistentTerm[] = [];
    const suggestedFixes: SuggestedFix[] = [];

    const anthropic = getAnthropicClient();

    if (anthropic) {
      // Use AI-enhanced analysis
      try {
        const analysis = await this.analyzeWithAI(
          anthropic,
          filesToAnalyze,
          documents,
          settings
        );

        undocumentedExports.push(...analysis.undocumentedExports);
        brokenExamples.push(...analysis.brokenExamples);
        inconsistentTerms.push(...analysis.inconsistentTerms);
        suggestedFixes.push(...analysis.suggestedFixes);
      } catch (error) {
        log.error({ error, repositoryId, prNumber }, 'AI analysis failed, falling back to heuristic analysis');
        const heuristicResult = this.analyzeWithHeuristics(filesToAnalyze, documents);
        undocumentedExports.push(...heuristicResult.undocumentedExports);
        brokenExamples.push(...heuristicResult.brokenExamples);
        suggestedFixes.push(...heuristicResult.suggestedFixes);
      }
    } else {
      // Fallback: heuristic analysis
      const heuristicResult = this.analyzeWithHeuristics(filesToAnalyze, documents);
      undocumentedExports.push(...heuristicResult.undocumentedExports);
      brokenExamples.push(...heuristicResult.brokenExamples);
      suggestedFixes.push(...heuristicResult.suggestedFixes);
    }

    const analysis: PRDocReviewAnalysis = {
      prNumber,
      repositoryId,
      changedFiles: filesToAnalyze.map((f) => f.filename),
      undocumentedExports,
      brokenExamples,
      inconsistentTerms,
      suggestedFixes,
    };

    // Persist the analysis
    await db.prDocReview.create({
      data: {
        repositoryId,
        prNumber,
        changedFiles: analysis.changedFiles,
        undocumentedExports: analysis.undocumentedExports as object[],
        brokenExamples: analysis.brokenExamples as object[],
        inconsistentTerms: analysis.inconsistentTerms as object[],
        suggestedFixes: analysis.suggestedFixes as object[],
        status: 'completed',
      },
    });

    log.info(
      {
        repositoryId,
        prNumber,
        undocumented: undocumentedExports.length,
        broken: brokenExamples.length,
        inconsistent: inconsistentTerms.length,
      },
      'PR doc impact analysis completed'
    );

    return analysis;
  }

  /**
   * Generate actionable review comments with fix suggestions from analysis results.
   */
  generateReviewComments(analysis: PRDocReviewAnalysis): ReviewComment[] {
    const comments: ReviewComment[] = [];
    let commentIndex = 0;

    // Generate comments for undocumented exports
    for (const exp of analysis.undocumentedExports) {
      comments.push({
        id: `review-${analysis.prNumber}-${commentIndex++}`,
        filePath: exp.filePath,
        line: exp.line,
        body: `**Undocumented export detected:** The ${exp.exportType} \`${exp.exportName}\` is exported but lacks documentation.\n\nConsider adding JSDoc comments or updating the relevant documentation file.`,
        severity: 'warning',
        confidence: 0.85,
        suggestion: this.generateDocSuggestion(exp),
      });
    }

    // Generate comments for broken examples
    for (const example of analysis.brokenExamples) {
      comments.push({
        id: `review-${analysis.prNumber}-${commentIndex++}`,
        filePath: example.filePath,
        line: example.line,
        body: `**Potentially broken example:** The code example in section "${example.section}" may no longer work.\n\n**Reason:** ${example.reason}`,
        severity: 'error',
        confidence: 0.75,
      });
    }

    // Generate comments for inconsistent terminology
    for (const term of analysis.inconsistentTerms) {
      for (const occurrence of term.occurrences) {
        comments.push({
          id: `review-${analysis.prNumber}-${commentIndex++}`,
          filePath: occurrence.filePath,
          line: occurrence.line,
          body: `**Inconsistent terminology:** Found variations of "${term.preferredTerm}": ${term.variants.map((v) => `\`${v}\``).join(', ')}.\n\nConsider standardizing to \`${term.preferredTerm}\` for consistency.`,
          severity: 'info',
          confidence: 0.7,
          suggestion: term.preferredTerm,
        });
      }
    }

    // Generate comments for suggested fixes
    for (const fix of analysis.suggestedFixes) {
      comments.push({
        id: `review-${analysis.prNumber}-${commentIndex++}`,
        filePath: fix.filePath,
        line: fix.line,
        body: `**Documentation suggestion:** ${fix.description}`,
        severity: 'info',
        confidence: 0.65,
        suggestion: fix.replacement,
      });
    }

    return comments;
  }

  /**
   * Post comments to GitHub/GitLab via their APIs.
   */
  async postCommentsToSCM(params: {
    repositoryId: string;
    prNumber: number;
    owner: string;
    repo: string;
    installationId: number;
    comments: ReviewComment[];
  }): Promise<{ posted: number; failed: number }> {
    const { repositoryId, prNumber, owner, repo, installationId, comments } = params;

    log.info(
      { repositoryId, prNumber, commentCount: comments.length },
      'Posting review comments to SCM'
    );

    const settings = await this.getReviewSettings(repositoryId);

    // Filter comments based on settings
    const filteredComments = comments.filter(
      (c) => c.confidence >= settings.minConfidence
    );

    if (filteredComments.length === 0) {
      log.info({ repositoryId, prNumber }, 'No comments meet confidence threshold');
      return { posted: 0, failed: 0 };
    }

    const octokit = createInstallationOctokit(installationId);
    let posted = 0;
    let failed = 0;

    // Post a summary comment
    const summaryBody = this.buildSummaryComment(filteredComments, prNumber);

    try {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: summaryBody,
      });
      posted++;
    } catch (error) {
      log.error({ error, owner, repo, prNumber }, 'Failed to post summary comment');
      failed++;
    }

    // Post inline comments for specific file/line issues
    const inlineComments = filteredComments.filter(
      (c) => c.filePath && c.line > 0
    );

    for (const comment of inlineComments) {
      try {
        await octokit.pulls.createReviewComment({
          owner,
          repo,
          pull_number: prNumber,
          commit_id: 'HEAD',
          body: this.formatInlineComment(comment),
          path: comment.filePath,
          line: comment.line,
          side: 'RIGHT',
        });
        posted++;
      } catch (error) {
        log.error(
          { error, filePath: comment.filePath, line: comment.line },
          'Failed to post inline comment'
        );
        failed++;
      }
    }

    // Update the review record with posting results
    await db.prDocReview.updateMany({
      where: { repositoryId, prNumber },
      data: {
        commentsPosted: posted,
        commentsFailed: failed,
        postedAt: new Date(),
      },
    });

    log.info({ repositoryId, prNumber, posted, failed }, 'Review comments posted');

    return { posted, failed };
  }

  /**
   * Get review settings with defaults for a repository.
   */
  async getReviewSettings(repositoryId: string): Promise<ReviewSettings> {
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { metadata: true },
    });

    if (!repository) {
      return { ...DEFAULT_REVIEW_SETTINGS };
    }

    const metadata = repository.metadata as Record<string, unknown> | null;
    const storedSettings = metadata?.prDocReviewSettings as Partial<ReviewSettings> | undefined;

    if (!storedSettings) {
      return { ...DEFAULT_REVIEW_SETTINGS };
    }

    return {
      enabled: storedSettings.enabled ?? DEFAULT_REVIEW_SETTINGS.enabled,
      sensitivity: storedSettings.sensitivity ?? DEFAULT_REVIEW_SETTINGS.sensitivity,
      autoComment: storedSettings.autoComment ?? DEFAULT_REVIEW_SETTINGS.autoComment,
      notifyOnBreaking: storedSettings.notifyOnBreaking ?? DEFAULT_REVIEW_SETTINGS.notifyOnBreaking,
      minConfidence: storedSettings.minConfidence ?? DEFAULT_REVIEW_SETTINGS.minConfidence,
      excludePatterns: storedSettings.excludePatterns ?? DEFAULT_REVIEW_SETTINGS.excludePatterns,
    };
  }

  /**
   * Update review settings in repository metadata.
   */
  async updateReviewSettings(
    repositoryId: string,
    settings: Partial<ReviewSettings>
  ): Promise<ReviewSettings> {
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { metadata: true },
    });

    if (!repository) {
      throw new Error(`Repository not found: ${repositoryId}`);
    }

    const metadata = (repository.metadata as Record<string, unknown>) ?? {};
    const currentSettings = (metadata.prDocReviewSettings as Partial<ReviewSettings>) ?? {};

    const updatedSettings: ReviewSettings = {
      enabled: settings.enabled ?? currentSettings.enabled ?? DEFAULT_REVIEW_SETTINGS.enabled,
      sensitivity: settings.sensitivity ?? currentSettings.sensitivity ?? DEFAULT_REVIEW_SETTINGS.sensitivity,
      autoComment: settings.autoComment ?? currentSettings.autoComment ?? DEFAULT_REVIEW_SETTINGS.autoComment,
      notifyOnBreaking: settings.notifyOnBreaking ?? currentSettings.notifyOnBreaking ?? DEFAULT_REVIEW_SETTINGS.notifyOnBreaking,
      minConfidence: settings.minConfidence ?? currentSettings.minConfidence ?? DEFAULT_REVIEW_SETTINGS.minConfidence,
      excludePatterns: settings.excludePatterns ?? currentSettings.excludePatterns ?? DEFAULT_REVIEW_SETTINGS.excludePatterns,
    };

    metadata.prDocReviewSettings = updatedSettings;

    await prisma.repository.update({
      where: { id: repositoryId },
      data: { metadata: metadata as object },
    });

    log.info({ repositoryId, settings: updatedSettings }, 'Review settings updated');

    return updatedSettings;
  }

  /**
   * Record user feedback on a review comment to tune future reviews.
   */
  async recordFeedback(
    reviewId: string,
    commentId: string,
    helpful: boolean
  ): Promise<void> {
    log.info({ reviewId, commentId, helpful }, 'Recording review feedback');

    await db.prDocReviewFeedback.create({
      data: {
        reviewId,
        commentId,
        helpful,
        createdAt: new Date(),
      },
    });

    // Update aggregate feedback stats on the review record
    const feedbacks = await db.prDocReviewFeedback.findMany({
      where: { reviewId },
      select: { helpful: true },
    });

    const helpfulCount = feedbacks.filter((f: { helpful: boolean }) => f.helpful).length;
    const totalCount = feedbacks.length;

    await db.prDocReview.update({
      where: { id: reviewId },
      data: {
        feedbackScore: totalCount > 0 ? helpfulCount / totalCount : null,
        feedbackCount: totalCount,
      },
    });

    log.info(
      { reviewId, helpfulCount, totalCount },
      'Review feedback aggregated'
    );
  }

  // ============================================================================
  // Private: AI-Enhanced Analysis
  // ============================================================================

  private async analyzeWithAI(
    anthropic: ReturnType<typeof getAnthropicClient>,
    changedFiles: Array<{ filename: string; status: string; patch?: string }>,
    documents: Array<{ id: string; path: string; title: string; content: string | null; metadata: unknown }>,
    settings: ReviewSettings
  ): Promise<{
    undocumentedExports: UndocumentedExport[];
    brokenExamples: BrokenExample[];
    inconsistentTerms: InconsistentTerm[];
    suggestedFixes: SuggestedFix[];
  }> {
    if (!anthropic) {
      return { undocumentedExports: [], brokenExamples: [], inconsistentTerms: [], suggestedFixes: [] };
    }

    const changedCode = changedFiles
      .filter((f) => f.patch)
      .map((f) => `File: ${f.filename} (${f.status})\n${f.patch}`)
      .join('\n\n---\n\n')
      .substring(0, 6000);

    const docContext = documents
      .slice(0, 5)
      .map((d) => `Doc: ${d.path} (${d.title})\n${(d.content || '').substring(0, 1000)}`)
      .join('\n\n---\n\n')
      .substring(0, 4000);

    const sensitivityInstruction = {
      low: 'Only report high-confidence issues that are clearly problematic.',
      medium: 'Report issues with moderate to high confidence. Include likely problems.',
      high: 'Report all potential issues, even those with lower confidence.',
    }[settings.sensitivity];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: `You are a documentation review expert. Analyze code changes and related documentation to find:
1. Exported symbols (functions, classes, interfaces, types, constants) that lack documentation
2. Code examples in documentation that may be broken by the changes
3. Inconsistent terminology across files
4. Suggested documentation fixes

${sensitivityInstruction}

Return ONLY valid JSON, no explanations.`,
      messages: [
        {
          role: 'user',
          content: `## Changed Code
${changedCode}

## Existing Documentation
${docContext}

---

Analyze these changes and return JSON:
{
  "undocumentedExports": [{ "filePath": "...", "exportName": "...", "exportType": "function|class|interface|type|const", "line": 0 }],
  "brokenExamples": [{ "filePath": "...", "section": "...", "reason": "...", "line": 0 }],
  "inconsistentTerms": [{ "term": "...", "variants": ["..."], "occurrences": [{ "filePath": "...", "line": 0 }], "preferredTerm": "..." }],
  "suggestedFixes": [{ "filePath": "...", "line": 0, "description": "...", "replacement": "..." }]
}`,
        },
      ],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      return { undocumentedExports: [], brokenExamples: [], inconsistentTerms: [], suggestedFixes: [] };
    }

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn('Failed to extract JSON from AI response');
      return { undocumentedExports: [], brokenExamples: [], inconsistentTerms: [], suggestedFixes: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      undocumentedExports?: UndocumentedExport[];
      brokenExamples?: BrokenExample[];
      inconsistentTerms?: InconsistentTerm[];
      suggestedFixes?: SuggestedFix[];
    };

    return {
      undocumentedExports: parsed.undocumentedExports || [],
      brokenExamples: parsed.brokenExamples || [],
      inconsistentTerms: parsed.inconsistentTerms || [],
      suggestedFixes: parsed.suggestedFixes || [],
    };
  }

  // ============================================================================
  // Private: Heuristic Analysis
  // ============================================================================

  private analyzeWithHeuristics(
    changedFiles: Array<{ filename: string; status: string; patch?: string }>,
    documents: Array<{ id: string; path: string; title: string; content: string | null; metadata: unknown }>
  ): {
    undocumentedExports: UndocumentedExport[];
    brokenExamples: BrokenExample[];
    suggestedFixes: SuggestedFix[];
  } {
    const undocumentedExports: UndocumentedExport[] = [];
    const brokenExamples: BrokenExample[] = [];
    const suggestedFixes: SuggestedFix[] = [];

    for (const file of changedFiles) {
      if (!file.patch) continue;

      // Detect new exports without documentation
      const exportPattern = /^\+\s*export\s+(async\s+)?(function|class|interface|type|const)\s+(\w+)/gm;
      let match;

      while ((match = exportPattern.exec(file.patch)) !== null) {
        const exportType = (match[2] || 'const') as UndocumentedExport['exportType'];
        const exportName = match[3] || 'unknown';
        const lineInPatch = file.patch.substring(0, match.index).split('\n').length;

        // Check if any documentation mentions this export
        const isDocumented = documents.some(
          (doc) => doc.content && doc.content.includes(exportName)
        );

        if (!isDocumented) {
          undocumentedExports.push({
            filePath: file.filename,
            exportName,
            exportType,
            line: lineInPatch,
          });
        }
      }

      // Detect potential broken examples: renamed/removed functions referenced in docs
      if (file.status === 'modified' || file.status === 'removed') {
        const removedPattern = /^-\s*export\s+(async\s+)?(function|class|interface|type|const)\s+(\w+)/gm;

        while ((match = removedPattern.exec(file.patch)) !== null) {
          const removedName = match[3] || 'unknown';

          for (const doc of documents) {
            if (doc.content && doc.content.includes(removedName)) {
              brokenExamples.push({
                filePath: doc.path,
                section: doc.title,
                reason: `Export \`${removedName}\` was removed or renamed in ${file.filename}`,
                line: 0,
              });
            }
          }
        }
      }
    }

    // Suggest documentation updates for files with significant changes
    for (const file of changedFiles) {
      if (!file.patch) continue;
      const addedLines = (file.patch.match(/^\+[^+]/gm) || []).length;
      const removedLines = (file.patch.match(/^-[^-]/gm) || []).length;

      if (addedLines + removedLines > 50) {
        suggestedFixes.push({
          filePath: file.filename,
          line: 1,
          description: `This file has significant changes (${addedLines} additions, ${removedLines} deletions). Consider reviewing related documentation for accuracy.`,
        });
      }
    }

    return { undocumentedExports, brokenExamples, suggestedFixes };
  }

  // ============================================================================
  // Private: Comment Formatting
  // ============================================================================

  private buildSummaryComment(comments: ReviewComment[], prNumber: number): string {
    const errors = comments.filter((c) => c.severity === 'error');
    const warnings = comments.filter((c) => c.severity === 'warning');
    const infos = comments.filter((c) => c.severity === 'info');

    let body = `<!-- docsynth-pr-review -->\n`;
    body += `## Documentation Review\n\n`;

    if (errors.length === 0 && warnings.length === 0 && infos.length === 0) {
      body += `No documentation issues found in this PR.\n`;
      return body;
    }

    body += `| Severity | Count |\n|----------|-------|\n`;
    if (errors.length > 0) body += `| Error | ${errors.length} |\n`;
    if (warnings.length > 0) body += `| Warning | ${warnings.length} |\n`;
    if (infos.length > 0) body += `| Info | ${infos.length} |\n`;

    body += `\n### Issues Found\n\n`;

    for (const comment of [...errors, ...warnings, ...infos].slice(0, 15)) {
      const icon = comment.severity === 'error' ? '**Error**' : comment.severity === 'warning' ? '**Warning**' : 'Info';
      body += `- ${icon}: ${comment.body.split('\n')[0]} (\`${comment.filePath}:${comment.line}\`)\n`;
    }

    if (comments.length > 15) {
      body += `\n_...and ${comments.length - 15} more issues_\n`;
    }

    body += `\n---\n`;
    body += `<sub>Generated by DocSynth PR Review | Was this helpful? React with a thumbs up or down.</sub>\n`;

    return body;
  }

  private formatInlineComment(comment: ReviewComment): string {
    const severityLabel = {
      error: '**[DocSynth Error]**',
      warning: '**[DocSynth Warning]**',
      info: '[DocSynth Info]',
    }[comment.severity];

    let body = `${severityLabel} ${comment.body}`;

    if (comment.suggestion) {
      body += `\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``;
    }

    return body;
  }

  private generateDocSuggestion(exp: UndocumentedExport): string {
    const templates: Record<string, string> = {
      function: `/**\n * TODO: Add documentation for ${exp.exportName}\n * @param \n * @returns \n */`,
      class: `/**\n * TODO: Add documentation for ${exp.exportName}\n */`,
      interface: `/**\n * TODO: Add documentation for ${exp.exportName}\n */`,
      type: `/** TODO: Add documentation for ${exp.exportName} */`,
      const: `/** TODO: Add documentation for ${exp.exportName} */`,
    };

    return templates[exp.exportType] || `/** TODO: Document ${exp.exportName} */`;
  }

  // ============================================================================
  // Private: Utility Methods
  // ============================================================================

  private matchPattern(filepath: string, pattern: string): boolean {
    const regex = pattern
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{GLOBSTAR}}/g, '.*');
    return new RegExp(`^${regex}$`).test(filepath);
  }
}

export const prDocReviewService = new PRDocReviewService();
