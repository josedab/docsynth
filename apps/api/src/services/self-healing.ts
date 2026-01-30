import { prisma } from '@docsynth/database';
import { getAnthropicClient } from '@docsynth/utils';

// ============================================================================
// Types
// ============================================================================

export interface DocumentIssue {
  id: string;
  type: 'broken-link' | 'outdated-reference' | 'terminology-drift' | 'missing-section' | 'deprecated-api' | 'code-mismatch';
  severity: 'low' | 'medium' | 'high' | 'critical';
  documentId: string;
  documentPath: string;
  location: {
    line?: number;
    column?: number;
    text?: string;
  };
  description: string;
  suggestedFix?: string;
  autoFixable: boolean;
  detectedAt: Date;
}

export interface HealingResult {
  issueId: string;
  status: 'fixed' | 'failed' | 'skipped';
  originalContent?: string;
  newContent?: string;
  error?: string;
}

export interface LinkCheckResult {
  url: string;
  type: 'internal' | 'external' | 'anchor';
  broken: boolean;
  reason?: string;
  suggestedFix?: string;
  line?: number;
}

// ============================================================================
// Link Detection
// ============================================================================

export async function detectBrokenLinks(content: string, _repoName: string): Promise<LinkCheckResult[]> {
  const results: LinkCheckResult[] = [];
  const lines = content.split('\n');

  // Markdown link pattern: [text](url)
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? '';
    let match;

    while ((match = linkPattern.exec(line)) !== null) {
      const url = match[2] ?? '';
      const result: LinkCheckResult = {
        url,
        type: 'internal',
        broken: false,
        line: lineIdx + 1,
      };

      if (url.startsWith('http://') || url.startsWith('https://')) {
        result.type = 'external';
        // For external links, we'd need to make HTTP requests (placeholder)
        // In production, this would be done in a worker
        result.broken = false; // Skip external link checking in sync context
      } else if (url.startsWith('#')) {
        result.type = 'anchor';
        // Check if anchor exists in document
        const anchorId = url.slice(1);
        const headingPattern = new RegExp(`^#+\\s+.*${anchorId}`, 'i');
        if (!lines.some(l => headingPattern.test(l))) {
          result.broken = true;
          result.reason = `Anchor "${anchorId}" not found in document`;
          result.suggestedFix = 'Remove or update anchor link';
        }
      } else {
        // Internal file link - check relative path
        if (url.includes('..') || url.startsWith('/')) {
          // Would need filesystem access to verify
          result.broken = false; // Assume valid for now
        }
      }

      if (result.broken) {
        results.push(result);
      }
    }
  }

  return results;
}

// ============================================================================
// Healing Functions
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function healIssue(alert: any, document: any, mode: 'auto' | 'review'): Promise<HealingResult> {
  const issueType = mapAlertTypeToIssueType(alert.alertType);
  const content = document.content || '';

  switch (issueType) {
    case 'broken-link':
      return healBrokenLink(alert, content, mode);
    case 'terminology-drift':
      return healTerminologyDrift(alert, content, mode);
    case 'outdated-reference':
      return healOutdatedReference(alert, content, mode);
    default:
      return {
        issueId: alert.id,
        status: 'skipped',
        error: `Issue type "${issueType}" not supported for auto-healing`,
      };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function healBrokenLink(alert: any, content: string, mode: string): Promise<HealingResult> {
  const metadata = alert.metadata as Record<string, string> || {};
  const brokenUrl = metadata.url;
  const suggestedFix = metadata.suggestedFix;

  if (!brokenUrl || !suggestedFix) {
    return {
      issueId: alert.id,
      status: 'skipped',
      error: 'Missing URL or suggested fix',
    };
  }

  // Replace broken link
  const newContent = content.replace(brokenUrl, suggestedFix);

  if (newContent === content) {
    return {
      issueId: alert.id,
      status: 'failed',
      error: 'Could not find URL in document',
    };
  }

  // In review mode, just return the proposed change
  if (mode === 'review') {
    return {
      issueId: alert.id,
      status: 'fixed',
      originalContent: content,
      newContent,
    };
  }

  // In auto mode, update the document
  await prisma.document.update({
    where: { id: alert.documentId },
    data: { content: newContent },
  });

  return {
    issueId: alert.id,
    status: 'fixed',
    originalContent: content,
    newContent,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function healTerminologyDrift(alert: any, content: string, mode: string): Promise<HealingResult> {
  const metadata = alert.metadata as Record<string, string> || {};
  const incorrectTerm = metadata.term;
  const preferredTerm = metadata.preferredTerm;

  if (!incorrectTerm || !preferredTerm) {
    return {
      issueId: alert.id,
      status: 'skipped',
      error: 'Missing terminology information',
    };
  }

  // Replace terminology (case-insensitive but preserve case pattern)
  const pattern = new RegExp(incorrectTerm, 'gi');
  const newContent = content.replace(pattern, preferredTerm);

  if (newContent === content) {
    return {
      issueId: alert.id,
      status: 'failed',
      error: 'Could not find term in document',
    };
  }

  if (mode === 'review') {
    return {
      issueId: alert.id,
      status: 'fixed',
      originalContent: content,
      newContent,
    };
  }

  await prisma.document.update({
    where: { id: alert.documentId },
    data: { content: newContent },
  });

  return {
    issueId: alert.id,
    status: 'fixed',
    originalContent: content,
    newContent,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function healOutdatedReference(alert: any, content: string, mode: string): Promise<HealingResult> {
  const metadata = alert.metadata as Record<string, string> || {};
  const outdatedRef = metadata.reference;
  const currentRef = metadata.currentReference;

  if (!outdatedRef) {
    // Use AI to fix if we don't have specific metadata
    try {
      const anthropic = getAnthropicClient();
      if (!anthropic) {
        throw new Error('Anthropic client not available');
      }
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: `You are a documentation expert. Fix outdated references in the following documentation.
Return ONLY the corrected content, no explanations.`,
        messages: [{
          role: 'user',
          content: `Fix outdated references in this documentation:\n\n${content.slice(0, 8000)}`,
        }],
      });

      const textContent = response.content[0];
      if (!textContent || textContent.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      const newContent = (textContent as { type: 'text'; text: string }).text;

      if (mode === 'review') {
        return {
          issueId: alert.id,
          status: 'fixed',
          originalContent: content,
          newContent,
        };
      }

      await prisma.document.update({
        where: { id: alert.documentId },
        data: { content: newContent },
      });

      return {
        issueId: alert.id,
        status: 'fixed',
        originalContent: content,
        newContent,
      };
    } catch {
      return {
        issueId: alert.id,
        status: 'failed',
        error: 'AI-based fixing failed',
      };
    }
  }

  // Simple replacement
  const replacement = currentRef || '';
  const newContent = content.replace(outdatedRef, replacement);

  if (newContent === content) {
    return {
      issueId: alert.id,
      status: 'failed',
      error: 'Could not find outdated reference in document',
    };
  }

  if (mode === 'review') {
    return {
      issueId: alert.id,
      status: 'fixed',
      originalContent: content,
      newContent,
    };
  }

  await prisma.document.update({
    where: { id: alert.documentId },
    data: { content: newContent },
  });

  return {
    issueId: alert.id,
    status: 'fixed',
    originalContent: content,
    newContent,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

export function generateSimpleDiff(original: string, updated: string): string {
  const originalLines = original.split('\n');
  const updatedLines = updated.split('\n');
  const diffLines: string[] = [];

  const maxLines = Math.max(originalLines.length, updatedLines.length);
  for (let i = 0; i < maxLines; i++) {
    const origLine = originalLines[i] || '';
    const newLine = updatedLines[i] || '';

    if (origLine !== newLine) {
      if (origLine) diffLines.push(`- ${origLine}`);
      if (newLine) diffLines.push(`+ ${newLine}`);
    }
  }

  return diffLines.slice(0, 50).join('\n'); // Limit diff size
}

export function mapAlertTypeToIssueType(alertType: string): DocumentIssue['type'] {
  const mapping: Record<string, DocumentIssue['type']> = {
    broken_link: 'broken-link',
    outdated: 'outdated-reference',
    terminology: 'terminology-drift',
    missing_section: 'missing-section',
    deprecated_api: 'deprecated-api',
    code_mismatch: 'code-mismatch',
    stale: 'outdated-reference',
    coverage: 'missing-section',
  };
  return mapping[alertType] || 'outdated-reference';
}

export function isAutoFixable(alertType: string): boolean {
  const autoFixableTypes = ['broken_link', 'terminology', 'outdated'];
  return autoFixableTypes.includes(alertType);
}
