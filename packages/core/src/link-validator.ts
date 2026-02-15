// ============================================================================
// Types
// ============================================================================

export interface LinkValidationResult {
  url: string;
  type: 'internal' | 'external' | 'anchor';
  status: 'valid' | 'broken' | 'timeout' | 'skipped';
  statusCode?: number;
  responseTimeMs?: number;
  error?: string;
}

export interface DocumentLinkReport {
  total: number;
  valid: number;
  broken: number;
  timeout: number;
  skipped: number;
  results: LinkValidationResult[];
}

export interface LinkValidationOptions {
  /** Timeout in milliseconds for external link checks. Default: 5000 */
  timeoutMs?: number;
  /** Whether to validate external links. Default: true */
  checkExternal?: boolean;
  /** Known internal file paths for resolving relative links */
  knownPaths?: Set<string>;
  /** Document headings for anchor validation */
  headings?: string[];
}

// ============================================================================
// Link Extraction
// ============================================================================

const MARKDOWN_LINK_RE = /\[(?:[^\]]*)\]\(([^)]+)\)/g;
const HTML_HREF_RE = /<a\s[^>]*href="([^"]+)"/g;

/**
 * Extract all links from markdown content.
 */
export function extractLinks(markdown: string): string[] {
  const links = new Set<string>();

  for (const match of markdown.matchAll(MARKDOWN_LINK_RE)) {
    links.add(match[1]!);
  }
  for (const match of markdown.matchAll(HTML_HREF_RE)) {
    links.add(match[1]!);
  }

  return Array.from(links);
}

/**
 * Classify a link as internal, external, or anchor.
 */
export function classifyLink(url: string): LinkValidationResult['type'] {
  if (url.startsWith('#')) return 'anchor';
  if (/^https?:\/\//i.test(url)) return 'external';
  return 'internal';
}

// ============================================================================
// Heading Extraction
// ============================================================================

/**
 * Extract headings from markdown and return their slugified forms for anchor validation.
 */
export function extractHeadingSlugs(markdown: string): string[] {
  const headings: string[] = [];
  const lines = markdown.split('\n');

  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.+)/);
    if (match) {
      headings.push(slugify(match[1]!));
    }
  }

  return headings;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate all links found in a markdown document.
 */
export async function validateDocumentLinks(
  markdown: string,
  options: LinkValidationOptions = {}
): Promise<DocumentLinkReport> {
  const urls = extractLinks(markdown);
  const headingSlugs = extractHeadingSlugs(markdown);
  const opts: Required<LinkValidationOptions> = {
    timeoutMs: options.timeoutMs ?? 5000,
    checkExternal: options.checkExternal ?? true,
    knownPaths: options.knownPaths ?? new Set(),
    headings: options.headings ?? headingSlugs,
  };

  const results = await Promise.all(urls.map((url) => validateLink(url, opts)));

  return {
    total: results.length,
    valid: results.filter((r) => r.status === 'valid').length,
    broken: results.filter((r) => r.status === 'broken').length,
    timeout: results.filter((r) => r.status === 'timeout').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    results,
  };
}

/**
 * Validate a single link.
 */
export async function validateLink(
  url: string,
  options: Required<LinkValidationOptions>
): Promise<LinkValidationResult> {
  const type = classifyLink(url);

  switch (type) {
    case 'anchor':
      return validateAnchor(url, options.headings);
    case 'internal':
      return validateInternalLink(url, options.knownPaths);
    case 'external':
      if (!options.checkExternal) {
        return { url, type, status: 'skipped' };
      }
      return validateExternalLink(url, options.timeoutMs);
  }
}

// ============================================================================
// Internal Validators
// ============================================================================

function validateAnchor(url: string, headings: string[]): LinkValidationResult {
  const slug = url.slice(1); // strip leading #
  const valid = headings.includes(slugify(slug));
  return {
    url,
    type: 'anchor',
    status: valid ? 'valid' : 'broken',
    error: valid ? undefined : `Anchor '${slug}' not found in document headings`,
  };
}

function validateInternalLink(url: string, knownPaths: Set<string>): LinkValidationResult {
  // Strip anchors and query strings from the path
  const cleanPath = url.split('#')[0]!.split('?')[0]!;

  if (knownPaths.size === 0) {
    return {
      url,
      type: 'internal',
      status: 'skipped',
      error: 'No known paths provided for internal link validation',
    };
  }

  const valid = knownPaths.has(cleanPath);
  return {
    url,
    type: 'internal',
    status: valid ? 'valid' : 'broken',
    error: valid ? undefined : `File '${cleanPath}' not found`,
  };
}

async function validateExternalLink(url: string, timeoutMs: number): Promise<LinkValidationResult> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timer);
    const responseTimeMs = Date.now() - start;
    const valid = response.ok;

    return {
      url,
      type: 'external',
      status: valid ? 'valid' : 'broken',
      statusCode: response.status,
      responseTimeMs,
      error: valid ? undefined : `HTTP ${response.status}`,
    };
  } catch (err: unknown) {
    const responseTimeMs = Date.now() - start;
    const isAbort = err instanceof Error && err.name === 'AbortError';

    return {
      url,
      type: 'external',
      status: isAbort ? 'timeout' : 'broken',
      responseTimeMs,
      error: isAbort ? `Request timed out after ${timeoutMs}ms` : String(err),
    };
  }
}
