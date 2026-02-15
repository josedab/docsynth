// ============================================================================
// Types
// ============================================================================

export type CaptionFormat = 'srt' | 'vtt';

export interface AccessibilityResult {
  score: number;
  issues: AccessibilityIssue[];
  passedChecks: string[];
  summary: string;
}

export interface AccessibilityIssue {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  element: string;
  message: string;
  wcagCriteria: string;
}

export interface CaptionEntry {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface AltTextResult {
  altText: string;
  confidence: number;
  contentType: 'diagram' | 'chart' | 'screenshot' | 'icon' | 'generic';
}

export interface ContrastResult {
  ratio: number;
  passesAA: boolean;
  passesAAA: boolean;
  foreground: string;
  background: string;
}

// ============================================================================
// Constants
// ============================================================================

const WCAG_AA_CONTRAST = 4.5;
const WCAG_AAA_CONTRAST = 7.0;

// ============================================================================
// Alt text generation
// ============================================================================

/**
 * Generate alt text for diagrams and images based on their content description.
 */
export function generateAltText(
  contentDescription: string,
  contentType: AltTextResult['contentType'] = 'generic'
): AltTextResult {
  const desc = contentDescription.trim();
  if (desc.length === 0) {
    return { altText: 'Decorative image', confidence: 0.3, contentType };
  }

  const prefixes: Record<AltTextResult['contentType'], string> = {
    diagram: 'Diagram showing',
    chart: 'Chart displaying',
    screenshot: 'Screenshot of',
    icon: 'Icon representing',
    generic: 'Image of',
  };

  const prefix = prefixes[contentType];
  const normalizedDesc = desc.charAt(0).toLowerCase() + desc.slice(1);
  const altText = `${prefix} ${normalizedDesc}`.replace(/\.+$/, '');
  const confidence = Math.min(0.5 + desc.length / 200, 0.95);

  return { altText, confidence, contentType };
}

// ============================================================================
// Caption generation
// ============================================================================

function formatTimeSrt(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  const millis = ms % 1_000;
  return (
    `${String(hours).padStart(2, '0')}:` +
    `${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')},` +
    `${String(millis).padStart(3, '0')}`
  );
}

function formatTimeVtt(ms: number): string {
  return formatTimeSrt(ms).replace(',', '.');
}

/**
 * Generate structured captions for video content.
 */
export function generateCaptions(entries: CaptionEntry[], format: CaptionFormat = 'vtt'): string {
  if (entries.length === 0) return format === 'vtt' ? 'WEBVTT\n' : '';

  if (format === 'vtt') {
    const lines = ['WEBVTT', ''];
    for (const entry of entries) {
      lines.push(String(entry.index));
      lines.push(`${formatTimeVtt(entry.startMs)} --> ${formatTimeVtt(entry.endMs)}`);
      lines.push(entry.text);
      lines.push('');
    }
    return lines.join('\n');
  }

  const lines: string[] = [];
  for (const entry of entries) {
    lines.push(String(entry.index));
    lines.push(`${formatTimeSrt(entry.startMs)} --> ${formatTimeSrt(entry.endMs)}`);
    lines.push(entry.text);
    lines.push('');
  }
  return lines.join('\n');
}

// ============================================================================
// Color contrast
// ============================================================================

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return null;
  return {
    r: parseInt(match[1]!, 16),
    g: parseInt(match[2]!, 16),
    b: parseInt(match[3]!, 16),
  };
}

function relativeLuminance(r: number, g: number, b: number): number {
  const vals = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * vals[0]! + 0.7152 * vals[1]! + 0.0722 * vals[2]!;
}

/**
 * Check color contrast ratio between foreground and background colors.
 */
export function checkColorContrast(foreground: string, background: string): ContrastResult {
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);

  if (!fg || !bg) {
    return { ratio: 0, passesAA: false, passesAAA: false, foreground, background };
  }

  const l1 = relativeLuminance(fg.r, fg.g, fg.b);
  const l2 = relativeLuminance(bg.r, bg.g, bg.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;

  return {
    ratio,
    passesAA: ratio >= WCAG_AA_CONTRAST,
    passesAAA: ratio >= WCAG_AAA_CONTRAST,
    foreground,
    background,
  };
}

// ============================================================================
// WCAG compliance
// ============================================================================

/**
 * Validate WCAG 2.1 AA compliance for documentation content.
 */
export function checkWCAGCompliance(html: string): AccessibilityResult {
  const issues: AccessibilityIssue[] = [];
  const passedChecks: string[] = [];

  // Check for images without alt text
  const imgWithoutAlt = html.match(/<img(?![^>]*alt=)[^>]*>/gi);
  if (imgWithoutAlt) {
    for (const img of imgWithoutAlt) {
      issues.push({
        rule: 'img-alt',
        severity: 'error',
        element: img.slice(0, 80),
        message: 'Image missing alt attribute',
        wcagCriteria: '1.1.1 Non-text Content',
      });
    }
  } else {
    passedChecks.push('All images have alt attributes');
  }

  // Check for empty alt on non-decorative images
  const emptyAlt = html.match(/<img[^>]*alt=["']\s*["'][^>]*>/gi);
  if (emptyAlt) {
    for (const img of emptyAlt) {
      if (!img.includes('role="presentation"') && !img.includes('aria-hidden')) {
        issues.push({
          rule: 'img-alt-empty',
          severity: 'warning',
          element: img.slice(0, 80),
          message: 'Image has empty alt text but is not marked as decorative',
          wcagCriteria: '1.1.1 Non-text Content',
        });
      }
    }
  }

  // Check heading hierarchy
  const headings = html.match(/<h([1-6])[^>]*>/gi) ?? [];
  const levels = headings.map((h) => parseInt(h.match(/<h([1-6])/i)?.[1] ?? '0', 10));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i]! - levels[i - 1]! > 1) {
      issues.push({
        rule: 'heading-order',
        severity: 'warning',
        element: headings[i]!,
        message: `Heading level skipped from h${levels[i - 1]} to h${levels[i]}`,
        wcagCriteria: '1.3.1 Info and Relationships',
      });
    }
  }
  if (issues.filter((i) => i.rule === 'heading-order').length === 0 && headings.length > 0) {
    passedChecks.push('Heading hierarchy is properly ordered');
  }

  // Check for lang attribute
  if (html.includes('<html') && !html.match(/<html[^>]*lang=/i)) {
    issues.push({
      rule: 'html-lang',
      severity: 'error',
      element: '<html>',
      message: 'HTML element missing lang attribute',
      wcagCriteria: '3.1.1 Language of Page',
    });
  } else if (html.includes('<html')) {
    passedChecks.push('HTML element has lang attribute');
  }

  // Check for links with meaningful text
  const emptyLinks = html.match(/<a[^>]*>\s*<\/a>/gi);
  if (emptyLinks) {
    for (const link of emptyLinks) {
      issues.push({
        rule: 'link-name',
        severity: 'error',
        element: link.slice(0, 80),
        message: 'Link has no accessible name',
        wcagCriteria: '2.4.4 Link Purpose',
      });
    }
  } else {
    passedChecks.push('All links have accessible names');
  }

  const score = scoreFromIssues(issues);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  return {
    score,
    issues,
    passedChecks,
    summary: `Score: ${score}/100. ${errorCount} error(s), ${warningCount} warning(s), ${passedChecks.length} check(s) passed.`,
  };
}

// ============================================================================
// Screen reader summaries
// ============================================================================

/**
 * Generate a screen reader-friendly summary for complex content.
 */
export function generateScreenReaderSummary(content: string): string {
  const tableCount = (content.match(/<table/gi) ?? []).length;
  const codeBlockCount = (content.match(/```/g) ?? []).length / 2;
  const imageCount = (content.match(/<img/gi) ?? []).length;
  const listCount = (content.match(/<[ou]l/gi) ?? []).length;

  const parts: string[] = ['This section contains'];
  const items: string[] = [];

  if (tableCount > 0) items.push(`${tableCount} table(s)`);
  if (codeBlockCount > 0) items.push(`${Math.floor(codeBlockCount)} code block(s)`);
  if (imageCount > 0) items.push(`${imageCount} image(s)`);
  if (listCount > 0) items.push(`${listCount} list(s)`);

  if (items.length === 0) return 'This section contains text content.';

  parts.push(items.join(', ') + '.');
  return parts.join(' ');
}

// ============================================================================
// Scoring
// ============================================================================

function scoreFromIssues(issues: AccessibilityIssue[]): number {
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'error') score -= 15;
    else if (issue.severity === 'warning') score -= 5;
    else score -= 2;
  }
  return Math.max(0, Math.min(100, score));
}

/**
 * Score accessibility compliance from 0-100.
 */
export function scoreAccessibility(html: string): number {
  const result = checkWCAGCompliance(html);
  return result.score;
}
