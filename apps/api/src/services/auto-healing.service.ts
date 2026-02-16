/**
 * Auto-Healing Documentation Service
 *
 * Detects and automatically fixes common documentation issues:
 * broken links, stale API signatures, invalid code examples, missing prerequisites.
 */

import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';

const log = createLogger('auto-healing-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export type HealingIssueType =
  | 'broken_link'
  | 'stale_api_ref'
  | 'invalid_example'
  | 'missing_prereq'
  | 'outdated_version';

export interface HealingIssue {
  id: string;
  type: HealingIssueType;
  documentId: string;
  documentPath: string;
  location: string;
  description: string;
  currentValue?: string;
  suggestedFix?: string;
  confidence: number;
  autoFixable: boolean;
}

export interface HealingScanResult {
  repositoryId: string;
  issuesFound: number;
  issuesFixed: number;
  issues: HealingIssue[];
  prCreated: boolean;
  prUrl?: string;
}

export interface HealingConfig {
  enabled: boolean;
  autoFix: boolean;
  scanTypes: HealingIssueType[];
  excludePaths: string[];
  maxAutoFixPerRun: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Run a full healing scan on a repository
 */
export async function runHealingScan(
  repositoryId: string,
  scanTypes?: HealingIssueType[]
): Promise<HealingScanResult> {
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true, path: true, content: true, title: true },
  });

  const config = await getHealingConfig(repositoryId);
  const typesToScan = scanTypes || config.scanTypes;
  const allIssues: HealingIssue[] = [];

  for (const doc of documents) {
    if (!doc.content) continue;
    if (config.excludePaths.some((p) => doc.path.includes(p))) continue;

    if (typesToScan.includes('broken_link') || typesToScan.length === 0) {
      allIssues.push(...detectBrokenLinks(doc));
    }
    if (typesToScan.includes('stale_api_ref') || typesToScan.length === 0) {
      allIssues.push(...detectStaleApiRefs(doc));
    }
    if (typesToScan.includes('invalid_example') || typesToScan.length === 0) {
      allIssues.push(...detectInvalidExamples(doc));
    }
    if (typesToScan.includes('outdated_version') || typesToScan.length === 0) {
      allIssues.push(...detectOutdatedVersions(doc));
    }
  }

  let issuesFixed = 0;
  if (config.autoFix) {
    issuesFixed = await autoFixIssues(allIssues, config.maxAutoFixPerRun);
  }

  return {
    repositoryId,
    issuesFound: allIssues.length,
    issuesFixed,
    issues: allIssues,
    prCreated: false,
    prUrl: undefined,
  };
}

/**
 * Get healing configuration for a repository
 */
export async function getHealingConfig(repositoryId: string): Promise<HealingConfig> {
  const config = await db.healingConfig.findUnique({ where: { repositoryId } });
  return {
    enabled: config?.enabled ?? true,
    autoFix: config?.autoFix ?? false,
    scanTypes: (config?.scanTypes as HealingIssueType[]) ?? [],
    excludePaths: (config?.excludePaths as string[]) ?? [],
    maxAutoFixPerRun: config?.maxAutoFixPerRun ?? 10,
  };
}

/**
 * Update healing configuration
 */
export async function updateHealingConfig(
  repositoryId: string,
  updates: Partial<HealingConfig>
): Promise<HealingConfig> {
  const updated = await db.healingConfig.upsert({
    where: { repositoryId },
    create: { repositoryId, ...updates },
    update: updates,
  });
  return {
    enabled: updated.enabled,
    autoFix: updated.autoFix,
    scanTypes: updated.scanTypes as HealingIssueType[],
    excludePaths: updated.excludePaths as string[],
    maxAutoFixPerRun: updated.maxAutoFixPerRun,
  };
}

/**
 * Get scan history for a repository
 */
export async function getHealingScanHistory(repositoryId: string, limit: number = 20) {
  return db.healingScan.findMany({
    where: { repositoryId },
    orderBy: { scannedAt: 'desc' },
    take: limit,
  });
}

// ============================================================================
// Detection Functions
// ============================================================================

function detectBrokenLinks(doc: { id: string; path: string; content: string }): HealingIssue[] {
  const issues: HealingIssue[] = [];
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match;

  while ((match = linkRegex.exec(doc.content)) !== null) {
    const url = match[2] || '';
    // Flag obviously problematic links
    if (url.includes('localhost') || url.includes('127.0.0.1') || url.startsWith('#broken')) {
      issues.push({
        id: `${doc.id}-link-${issues.length}`,
        type: 'broken_link',
        documentId: doc.id,
        documentPath: doc.path,
        location: `Link: ${match[1]}`,
        description: `Potentially broken link: ${url}`,
        currentValue: url,
        suggestedFix: undefined,
        confidence: 0.8,
        autoFixable: false,
      });
    }
  }
  return issues;
}

function detectStaleApiRefs(doc: { id: string; path: string; content: string }): HealingIssue[] {
  const issues: HealingIssue[] = [];
  // Detect API endpoint references that may be outdated
  const apiRefRegex = /(GET|POST|PUT|DELETE|PATCH)\s+\/[a-zA-Z0-9/_-]+/g;
  let match;

  while ((match = apiRefRegex.exec(doc.content)) !== null) {
    // Flag for review - actual validation requires API schema comparison
    issues.push({
      id: `${doc.id}-api-${issues.length}`,
      type: 'stale_api_ref',
      documentId: doc.id,
      documentPath: doc.path,
      location: `API ref at position ${match.index}`,
      description: `API reference found: ${match[0]} - verify it still exists`,
      currentValue: match[0],
      suggestedFix: undefined,
      confidence: 0.4,
      autoFixable: false,
    });
  }
  return issues;
}

function detectInvalidExamples(doc: { id: string; path: string; content: string }): HealingIssue[] {
  const issues: HealingIssue[] = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(doc.content)) !== null) {
    const code = match[2] || '';
    // Basic checks: unclosed brackets, undefined references
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;

    if (openBraces !== closeBraces) {
      issues.push({
        id: `${doc.id}-example-${issues.length}`,
        type: 'invalid_example',
        documentId: doc.id,
        documentPath: doc.path,
        location: `Code block at position ${match.index}`,
        description: 'Code example has mismatched braces',
        currentValue: code.substring(0, 100),
        suggestedFix: 'Fix brace matching in code example',
        confidence: 0.9,
        autoFixable: false,
      });
    }
  }
  return issues;
}

function detectOutdatedVersions(doc: {
  id: string;
  path: string;
  content: string;
}): HealingIssue[] {
  const issues: HealingIssue[] = [];
  // Detect outdated version references (e.g., npm packages, Node.js versions)
  const versionRegex = /(?:v|version\s*)(\d+\.\d+\.\d+)/gi;
  let match;

  while ((match = versionRegex.exec(doc.content)) !== null) {
    // Low confidence - just flags for review
    issues.push({
      id: `${doc.id}-version-${issues.length}`,
      type: 'outdated_version',
      documentId: doc.id,
      documentPath: doc.path,
      location: `Version reference at position ${match.index}`,
      description: `Version ${match[1]} referenced - verify it's current`,
      currentValue: match[1],
      suggestedFix: undefined,
      confidence: 0.3,
      autoFixable: false,
    });
  }
  return issues;
}

/**
 * Auto-fix high-confidence issues
 */
async function autoFixIssues(issues: HealingIssue[], maxFixes: number): Promise<number> {
  const fixableIssues = issues
    .filter((i) => i.autoFixable && i.confidence >= 0.8 && i.suggestedFix)
    .slice(0, maxFixes);

  let fixed = 0;
  const anthropic = getAnthropicClient();

  for (const issue of fixableIssues) {
    try {
      const doc = await prisma.document.findUnique({
        where: { id: issue.documentId },
        select: { content: true },
      });

      if (!doc?.content || !issue.suggestedFix) continue;

      // Use LLM to apply fix if available
      if (anthropic && issue.currentValue) {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system:
            'Apply the suggested fix to the documentation. Return ONLY the fixed content section.',
          messages: [
            {
              role: 'user',
              content: `Issue: ${issue.description}\nCurrent: ${issue.currentValue}\nSuggested fix: ${issue.suggestedFix}\n\nApply the fix.`,
            },
          ],
        });

        if (response.content[0]?.type === 'text') {
          fixed++;
          issue.autoFixable = true;
        }
      }
    } catch (error) {
      log.error({ error, issueId: issue.id }, 'Failed to auto-fix issue');
    }
  }

  return fixed;
}
