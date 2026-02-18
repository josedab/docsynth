/**
 * PR Review Bot Service
 *
 * Generates inline documentation suggestions on PRs by analyzing code diffs,
 * identifying doc-impacting changes, and creating review comments with
 * one-click "Apply suggestion" formatting.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('pr-review-bot-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface DocSuggestion {
  id: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  currentContent: string;
  suggestedContent: string;
  reason: string;
  confidence: number;
  category:
    | 'missing-jsdoc'
    | 'outdated-param'
    | 'missing-return'
    | 'stale-example'
    | 'missing-description';
}

export interface PRAnalysisResult {
  repositoryId: string;
  prNumber: number;
  suggestions: DocSuggestion[];
  summary: string;
  overallConfidence: number;
  stats: {
    filesAnalyzed: number;
    suggestionsGenerated: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
  };
}

export interface SuggestionFeedback {
  suggestionId: string;
  action: 'accepted' | 'rejected' | 'modified';
  repositoryId: string;
  prNumber: number;
}

export interface BotConfig {
  repositoryId: string;
  enabled: boolean;
  confidenceThreshold: number;
  maxSuggestionsPerPR: number;
  categories: string[];
  cooldownMinutes: number;
  ignorePatterns: string[];
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Analyze a PR and generate inline doc suggestions
 */
export async function analyzePRAndSuggest(
  repositoryId: string,
  prNumber: number,
  changedFiles: Array<{
    filename: string;
    patch?: string;
    status: string;
    additions: number;
    deletions: number;
  }>
): Promise<PRAnalysisResult> {
  const suggestions: DocSuggestion[] = [];
  let sugId = 0;

  for (const file of changedFiles) {
    if (!file.patch || isIgnoredFile(file.filename)) continue;

    const fileSuggestions = analyzeFileChanges(
      file.filename,
      file.patch,
      `sug-${repositoryId}-${prNumber}-${sugId++}`
    );
    suggestions.push(...fileSuggestions);
  }

  // Apply confidence threshold from config
  const config = await getBotConfig(repositoryId);
  const filtered = suggestions
    .filter((s) => s.confidence >= config.confidenceThreshold)
    .slice(0, config.maxSuggestionsPerPR);

  const stats = {
    filesAnalyzed: changedFiles.length,
    suggestionsGenerated: filtered.length,
    highConfidence: filtered.filter((s) => s.confidence >= 0.8).length,
    mediumConfidence: filtered.filter((s) => s.confidence >= 0.5 && s.confidence < 0.8).length,
    lowConfidence: filtered.filter((s) => s.confidence < 0.5).length,
  };

  const result: PRAnalysisResult = {
    repositoryId,
    prNumber,
    suggestions: filtered,
    summary: generateSummary(filtered, changedFiles.length),
    overallConfidence:
      filtered.length > 0
        ? filtered.reduce((sum, s) => sum + s.confidence, 0) / filtered.length
        : 0,
    stats,
  };

  // Store analysis
  await db.prReviewBotAnalysis.create({
    data: {
      repositoryId,
      prNumber,
      suggestionsCount: filtered.length,
      suggestions: JSON.parse(JSON.stringify(filtered)),
      summary: result.summary,
      overallConfidence: result.overallConfidence,
      createdAt: new Date(),
    },
  });

  log.info(
    { repositoryId, prNumber, suggestions: filtered.length },
    'PR analysis complete with suggestions'
  );

  return result;
}

/**
 * Record feedback on a suggestion (accept/reject)
 */
export async function recordSuggestionFeedback(feedback: SuggestionFeedback): Promise<void> {
  await db.prReviewBotFeedback.create({
    data: {
      suggestionId: feedback.suggestionId,
      action: feedback.action,
      repositoryId: feedback.repositoryId,
      prNumber: feedback.prNumber,
      createdAt: new Date(),
    },
  });

  log.info(
    { suggestionId: feedback.suggestionId, action: feedback.action },
    'Suggestion feedback recorded'
  );
}

/**
 * Get acceptance rate for a repository
 */
export async function getAcceptanceRate(repositoryId: string): Promise<{
  total: number;
  accepted: number;
  rejected: number;
  modified: number;
  acceptanceRate: number;
}> {
  const feedbacks = await db.prReviewBotFeedback.findMany({
    where: { repositoryId },
    select: { action: true },
  });

  const total = feedbacks.length;
  const accepted = feedbacks.filter((f: { action: string }) => f.action === 'accepted').length;
  const rejected = feedbacks.filter((f: { action: string }) => f.action === 'rejected').length;
  const modified = feedbacks.filter((f: { action: string }) => f.action === 'modified').length;

  return {
    total,
    accepted,
    rejected,
    modified,
    acceptanceRate: total > 0 ? Math.round((accepted / total) * 100) : 0,
  };
}

/**
 * Get or create bot config
 */
export async function getBotConfig(repositoryId: string): Promise<BotConfig> {
  const config = await db.prReviewBotConfig.findUnique({
    where: { repositoryId },
  });

  return {
    repositoryId,
    enabled: config?.enabled ?? true,
    confidenceThreshold: config?.confidenceThreshold ?? 0.6,
    maxSuggestionsPerPR: config?.maxSuggestionsPerPR ?? 10,
    categories: config?.categories ?? [
      'missing-jsdoc',
      'outdated-param',
      'missing-return',
      'stale-example',
      'missing-description',
    ],
    cooldownMinutes: config?.cooldownMinutes ?? 60,
    ignorePatterns: config?.ignorePatterns ?? ['*.test.*', '*.spec.*', '__mocks__/*'],
  };
}

export async function updateBotConfig(
  repositoryId: string,
  updates: Partial<BotConfig>
): Promise<BotConfig> {
  await db.prReviewBotConfig.upsert({
    where: { repositoryId },
    create: { repositoryId, ...updates },
    update: { ...updates, updatedAt: new Date() },
  });

  return getBotConfig(repositoryId);
}

/**
 * Format suggestions as GitHub review comments
 */
export function formatAsGitHubReviewComments(
  suggestions: DocSuggestion[]
): Array<{ path: string; position: number; body: string }> {
  return suggestions.map((s) => ({
    path: s.filePath,
    position: s.lineStart,
    body: formatSuggestionComment(s),
  }));
}

// ============================================================================
// Helper Functions
// ============================================================================

function analyzeFileChanges(filename: string, patch: string, idPrefix: string): DocSuggestion[] {
  const suggestions: DocSuggestion[] = [];
  const lines = patch.split('\n');
  let lineNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Track line numbers from hunk headers
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      lineNumber = parseInt(hunkMatch[1]!, 10) - 1;
      continue;
    }

    if (line.startsWith('+')) lineNumber++;
    else if (line.startsWith('-')) continue;
    else lineNumber++;

    // Detect new exported functions without JSDoc
    if (line.startsWith('+') && isExportedFunction(line)) {
      const prevLine = i > 0 ? lines[i - 1] : '';
      if (!prevLine?.includes('/**') && !prevLine?.includes('*/')) {
        const funcName = extractFunctionName(line);
        suggestions.push({
          id: `${idPrefix}-${suggestions.length}`,
          filePath: filename,
          lineStart: lineNumber,
          lineEnd: lineNumber,
          currentContent: line.substring(1).trim(),
          suggestedContent: generateJSDocStub(funcName, line),
          reason: `New exported function \`${funcName}\` is missing JSDoc documentation`,
          confidence: 0.85,
          category: 'missing-jsdoc',
        });
      }
    }

    // Detect changed function parameters
    if (line.startsWith('+') && hasParameterChange(line, lines, i)) {
      suggestions.push({
        id: `${idPrefix}-${suggestions.length}`,
        filePath: filename,
        lineStart: lineNumber,
        lineEnd: lineNumber,
        currentContent: line.substring(1).trim(),
        suggestedContent: '',
        reason: 'Function parameter changed — update parameter documentation',
        confidence: 0.7,
        category: 'outdated-param',
      });
    }
  }

  return suggestions;
}

function isExportedFunction(line: string): boolean {
  return (
    /^\+\s*export\s+(async\s+)?function\s+\w+/.test(line) ||
    /^\+\s*export\s+const\s+\w+\s*=\s*(async\s+)?\(/.test(line)
  );
}

function extractFunctionName(line: string): string {
  const match = line.match(/(?:function|const)\s+(\w+)/);
  return match?.[1] ?? 'unknown';
}

function generateJSDocStub(funcName: string, line: string): string {
  const params = line.match(/\(([^)]*)\)/)?.[1] ?? '';
  const paramLines = params
    .split(',')
    .filter((p) => p.trim())
    .map((p) => {
      const name = p
        .trim()
        .split(/[:\s=]/)[0]!
        .trim();
      return ` * @param ${name} - TODO: describe parameter`;
    });

  return [
    '/**',
    ` * TODO: describe ${funcName}`,
    ...paramLines,
    ' * @returns TODO: describe return value',
    ' */',
    line.substring(1).trim(),
  ].join('\n');
}

function hasParameterChange(line: string, lines: string[], index: number): boolean {
  if (!/\(/.test(line)) return false;
  // Check if the previous line is a removal of a similar function
  for (let j = index - 1; j >= Math.max(0, index - 3); j--) {
    if (lines[j]?.startsWith('-') && /function\s+/.test(lines[j]!) && /\(/.test(lines[j]!)) {
      return true;
    }
  }
  return false;
}

function isIgnoredFile(filename: string): boolean {
  const lowerFilename = filename.toLowerCase();
  return (
    lowerFilename.includes('.test.') ||
    lowerFilename.includes('.spec.') ||
    lowerFilename.includes('__tests__') ||
    lowerFilename.includes('__mocks__') ||
    lowerFilename.endsWith('.md') ||
    lowerFilename.endsWith('.json') ||
    lowerFilename.endsWith('.lock') ||
    lowerFilename.endsWith('.yaml') ||
    lowerFilename.endsWith('.yml')
  );
}

function formatSuggestionComment(suggestion: DocSuggestion): string {
  const confidenceEmoji =
    suggestion.confidence >= 0.8 ? '🟢' : suggestion.confidence >= 0.5 ? '🟡' : '🔴';

  let comment = `### 📝 DocSynth Suggestion\n\n`;
  comment += `${confidenceEmoji} **${suggestion.category.replace(/-/g, ' ')}** (confidence: ${Math.round(suggestion.confidence * 100)}%)\n\n`;
  comment += `${suggestion.reason}\n\n`;

  if (suggestion.suggestedContent) {
    comment += `\`\`\`suggestion\n${suggestion.suggestedContent}\n\`\`\`\n\n`;
  }

  comment += `<sub>🤖 Generated by DocSynth PR Review Bot | \`/docsynth ignore\` to skip</sub>`;

  return comment;
}

function generateSummary(suggestions: DocSuggestion[], filesAnalyzed: number): string {
  if (suggestions.length === 0) {
    return `Analyzed ${filesAnalyzed} file(s) — no documentation suggestions needed.`;
  }

  const categories = [...new Set(suggestions.map((s) => s.category))];
  return `Found ${suggestions.length} documentation suggestion(s) across ${filesAnalyzed} file(s). Categories: ${categories.join(', ')}.`;
}
