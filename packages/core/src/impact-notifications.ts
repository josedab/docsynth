import type { BatchImpactReport, ImpactResult, SeverityLevel } from './impact-analysis.js';

// ============================================================================
// Types
// ============================================================================

export type NotificationChannel = 'slack' | 'email' | 'github';

export interface NotificationOptions {
  channel: NotificationChannel;
  /** When true, aggregate multiple results into a single digest */
  digest?: boolean;
  /** Repository full name (owner/repo) */
  repoFullName?: string;
  prNumber?: number;
}

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text: string }>;
  fields?: Array<{ type: string; text: string }>;
}

export interface SlackMessage {
  blocks: SlackBlock[];
}

// ============================================================================
// Constants
// ============================================================================

const SEVERITY_EMOJI: Record<SeverityLevel, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
};

const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

// ============================================================================
// Notification Formatting
// ============================================================================

/**
 * Format an impact report as a notification for the specified channel.
 */
export function formatNotification(
  report: BatchImpactReport,
  options: NotificationOptions
): string {
  const results = options.digest ? digestResults(report.results) : report.results;

  switch (options.channel) {
    case 'slack':
      return JSON.stringify(formatSlackMessage(results, report, options));
    case 'email':
      return formatEmailBody(results, report, options);
    case 'github':
      return formatGitHubComment(results, report, options);
  }
}

// ============================================================================
// Slack Block Kit
// ============================================================================

/**
 * Generate a Slack Block Kit message for an impact report.
 */
export function formatSlackMessage(
  results: ImpactResult[],
  report: BatchImpactReport,
  options: NotificationOptions
): SlackMessage {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `📄 Doc Impact Analysis${options.prNumber ? ` — PR #${options.prNumber}` : ''}`,
      emoji: true,
    },
  });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${report.summary}*\n_${report.totalChanges} code change(s) analysed._`,
    },
  });

  if (results.length > 0) {
    blocks.push({ type: 'divider' });
  }

  for (const result of results.slice(0, 10)) {
    const emoji = SEVERITY_EMOJI[result.severity];
    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Section:*\n${result.section.title}` },
        { type: 'mrkdwn', text: `*Severity:*\n${emoji} ${SEVERITY_LABELS[result.severity]}` },
        { type: 'mrkdwn', text: `*Score:*\n${result.score}/100` },
        { type: 'mrkdwn', text: `*Changes:*\n${result.changes.length}` },
      ],
    });
  }

  if (results.length > 10) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_…and ${results.length - 10} more section(s)._` }],
    });
  }

  return { blocks };
}

// ============================================================================
// GitHub PR Comment (Markdown)
// ============================================================================

/**
 * Generate a markdown-formatted GitHub PR comment.
 */
export function formatGitHubComment(
  results: ImpactResult[],
  report: BatchImpactReport,
  options: NotificationOptions
): string {
  const lines: string[] = [];

  lines.push('## 📄 Documentation Impact Analysis');
  lines.push('');
  lines.push(`> ${report.summary}`);
  lines.push('');

  if (results.length > 0) {
    lines.push('| Section | Severity | Score | Changes |');
    lines.push('|---------|----------|-------|---------|');

    for (const result of results) {
      const emoji = SEVERITY_EMOJI[result.severity];
      const label = SEVERITY_LABELS[result.severity];
      lines.push(
        `| ${result.section.title} | ${emoji} ${label} | ${result.score}/100 | ${result.changes.length} |`
      );
    }

    lines.push('');
  }

  const hasCritical = results.some((r) => r.severity === 'critical');
  const hasHigh = results.some((r) => r.severity === 'high');

  if (hasCritical || hasHigh) {
    lines.push(
      '> ⚠️ **Action required:** High or critical severity documentation impacts detected. Please update the affected sections before merging.'
    );
    lines.push('');
  }

  if (options.repoFullName && options.prNumber) {
    lines.push(`<sub>Generated by DocSynth for ${options.repoFullName}#${options.prNumber}</sub>`);
  }

  return lines.join('\n');
}

// ============================================================================
// Email
// ============================================================================

/**
 * Generate a plain-text email body for an impact report.
 */
export function formatEmailBody(
  results: ImpactResult[],
  report: BatchImpactReport,
  options: NotificationOptions
): string {
  const lines: string[] = [];

  lines.push('Documentation Impact Analysis');
  lines.push('='.repeat(40));
  lines.push('');
  lines.push(report.summary);
  lines.push(`Total code changes analysed: ${report.totalChanges}`);
  lines.push('');

  if (options.repoFullName) {
    lines.push(`Repository: ${options.repoFullName}`);
  }
  if (options.prNumber) {
    lines.push(`Pull Request: #${options.prNumber}`);
  }
  lines.push('');

  if (results.length > 0) {
    lines.push('Impacted Sections:');
    lines.push('-'.repeat(30));

    for (const result of results) {
      const label = SEVERITY_LABELS[result.severity];
      lines.push(
        `  [${label}] ${result.section.title} — Score: ${result.score}/100 (${result.changes.length} change(s))`
      );
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Digest Batching
// ============================================================================

/**
 * Batch results by severity, keeping only the highest-severity entries
 * to reduce notification noise.
 */
export function digestResults(results: ImpactResult[]): ImpactResult[] {
  if (results.length <= 5) return results;

  const order: SeverityLevel[] = ['critical', 'high', 'medium', 'low'];
  const sorted = [...results].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  return sorted.slice(0, 5);
}

// ============================================================================
// Severity Templates
// ============================================================================

/**
 * Return a human-readable notification template string for a severity level.
 */
export function severityTemplate(severity: SeverityLevel): string {
  const templates: Record<SeverityLevel, string> = {
    critical:
      '🔴 CRITICAL: Documentation is likely broken by this change. Immediate update required.',
    high: '🟠 HIGH: Significant documentation impact detected. Update recommended before merge.',
    medium: '🟡 MEDIUM: Documentation may need minor updates to stay accurate.',
    low: '🟢 LOW: Minimal documentation impact. Review at your convenience.',
  };
  return templates[severity];
}
