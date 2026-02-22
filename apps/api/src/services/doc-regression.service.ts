/**
 * Documentation Regression Testing Service
 *
 * Provides an assertion DSL for CI-based documentation checks,
 * enabling automated validation of doc coverage, link integrity,
 * freshness, and custom rules across repositories.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId } from '@docsynth/utils';

const log = createLogger('doc-regression-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export type AssertionType =
  | 'endpoint-documented'
  | 'public-functions-have-examples'
  | 'no-stale-docs'
  | 'no-broken-links'
  | 'min-coverage'
  | 'custom';

export interface Assertion {
  id: string;
  type: AssertionType;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface TestSuite {
  id: string;
  repositoryId: string;
  assertions: Assertion[];
  lastRun?: TestRun;
}

export interface AssertionResult {
  assertionId: string;
  type: AssertionType;
  passed: boolean;
  message: string;
  details?: string;
  severity: 'error' | 'warning' | 'info';
}

export interface TestRun {
  id: string;
  suiteId: string;
  results: AssertionResult[];
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  runAt: Date;
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Execute all assertions in a test suite for a given repository.
 */
export async function runAssertions(repositoryId: string, suitePath?: string): Promise<TestRun> {
  log.info({ repositoryId, suitePath }, 'Running doc regression assertions');
  const startMs = Date.now();

  const suite = suitePath
    ? await loadSuiteFromPath(repositoryId, suitePath)
    : await getDefaultSuite(repositoryId);

  const results: AssertionResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const assertion of suite.assertions) {
    if (!assertion.enabled) {
      skipped++;
      continue;
    }
    try {
      const result = await evaluateAssertion(assertion, repositoryId);
      results.push(result);
      if (result.passed) passed++;
      else failed++;
    } catch (err) {
      log.error({ err, assertionId: assertion.id }, 'Assertion evaluation failed');
      results.push({
        assertionId: assertion.id,
        type: assertion.type,
        passed: false,
        message: `Assertion error: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'error',
      });
      failed++;
    }
  }

  const durationMs = Date.now() - startMs;
  const testRun: TestRun = {
    id: generateId(),
    suiteId: suite.id,
    results,
    passed,
    failed,
    skipped,
    durationMs,
    runAt: new Date(),
  };

  await db.docRegressionRun.create({
    data: {
      id: testRun.id,
      repositoryId,
      suiteId: suite.id,
      results: JSON.stringify(results),
      passed,
      failed,
      skipped,
      durationMs,
      runAt: testRun.runAt,
    },
  });

  log.info({ repositoryId, passed, failed, skipped, durationMs }, 'Regression run complete');
  return testRun;
}

/**
 * Validate assertion DSL content and return parsed suite.
 */
export async function validateSuite(
  suiteContent: string
): Promise<{ valid: boolean; errors: string[]; parsed?: TestSuite }> {
  const errors: string[] = [];

  let raw: unknown;
  try {
    raw = JSON.parse(suiteContent);
  } catch {
    return { valid: false, errors: ['Invalid JSON: could not parse suite content'] };
  }

  const obj = raw as Record<string, unknown>;
  if (!obj.assertions || !Array.isArray(obj.assertions)) {
    errors.push('Missing or invalid "assertions" array');
  }

  const validTypes: AssertionType[] = [
    'endpoint-documented',
    'public-functions-have-examples',
    'no-stale-docs',
    'no-broken-links',
    'min-coverage',
    'custom',
  ];

  const assertions = (obj.assertions as unknown[]) ?? [];
  for (let i = 0; i < assertions.length; i++) {
    const a = assertions[i] as Record<string, unknown>;
    if (!a.type || !validTypes.includes(a.type as AssertionType)) {
      errors.push(`Assertion[${i}]: invalid or missing type "${String(a.type)}"`);
    }
    if (a.config !== undefined && typeof a.config !== 'object') {
      errors.push(`Assertion[${i}]: config must be an object`);
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  const parsed: TestSuite = {
    id: (obj.id as string) ?? generateId(),
    repositoryId: (obj.repositoryId as string) ?? '',
    assertions: assertions.map((a: any, i: number) => ({
      id: a.id ?? `assertion-${i}`,
      type: a.type as AssertionType,
      config: a.config ?? {},
      enabled: a.enabled !== false,
    })),
  };

  return { valid: true, errors: [], parsed };
}

/**
 * Get or create the default test suite for a repository.
 */
export async function getDefaultSuite(repositoryId: string): Promise<TestSuite> {
  const existing = await db.docRegressionSuite.findFirst({
    where: { repositoryId, isDefault: true },
  });

  if (existing) {
    return {
      id: existing.id,
      repositoryId,
      assertions:
        typeof existing.assertions === 'string'
          ? JSON.parse(existing.assertions)
          : (existing.assertions ?? []),
    };
  }

  const defaultAssertions: Assertion[] = [
    { id: 'no-broken-links', type: 'no-broken-links', config: {}, enabled: true },
    { id: 'no-stale-docs', type: 'no-stale-docs', config: { maxAgeDays: 90 }, enabled: true },
    { id: 'min-coverage', type: 'min-coverage', config: { threshold: 0.6 }, enabled: true },
    { id: 'endpoint-docs', type: 'endpoint-documented', config: {}, enabled: true },
  ];

  const id = generateId();
  await db.docRegressionSuite.create({
    data: { id, repositoryId, isDefault: true, assertions: JSON.stringify(defaultAssertions) },
  });

  log.info({ repositoryId, suiteId: id }, 'Created default regression suite');
  return { id, repositoryId, assertions: defaultAssertions };
}

/**
 * Get recent test run history for a repository.
 */
export async function getTestHistory(repositoryId: string, limit = 20): Promise<TestRun[]> {
  const rows = await db.docRegressionRun.findMany({
    where: { repositoryId },
    orderBy: { runAt: 'desc' },
    take: limit,
  });

  return rows.map((r: any) => ({
    id: r.id,
    suiteId: r.suiteId,
    results: typeof r.results === 'string' ? JSON.parse(r.results) : r.results,
    passed: r.passed,
    failed: r.failed,
    skipped: r.skipped,
    durationMs: r.durationMs,
    runAt: r.runAt,
  }));
}

/**
 * Format a test run as JUnit XML for CI integration.
 */
export function formatJUnitXML(testRun: TestRun): string {
  const total = testRun.passed + testRun.failed + testRun.skipped;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${total}" failures="${testRun.failed}" skipped="${testRun.skipped}" time="${(testRun.durationMs / 1000).toFixed(3)}">`,
    `  <testsuite name="doc-regression" tests="${total}" failures="${testRun.failed}" skipped="${testRun.skipped}">`,
  ];

  for (const result of testRun.results) {
    lines.push(`    <testcase name="${escapeXml(result.assertionId)}" classname="${result.type}">`);
    if (!result.passed) {
      lines.push(
        `      <failure message="${escapeXml(result.message)}" type="${result.severity}">`
      );
      if (result.details) lines.push(`        ${escapeXml(result.details)}`);
      lines.push('      </failure>');
    }
    lines.push('    </testcase>');
  }

  lines.push('  </testsuite>', '</testsuites>');
  return lines.join('\n');
}

/**
 * Format a test run as a GitHub PR comment with markdown.
 */
export function formatGitHubComment(testRun: TestRun): string {
  const total = testRun.passed + testRun.failed + testRun.skipped;
  const icon = testRun.failed === 0 ? '✅' : '❌';

  const lines: string[] = [
    `## ${icon} Documentation Regression Results`,
    '',
    `| Metric | Count |`,
    `|--------|-------|`,
    `| ✅ Passed | ${testRun.passed} |`,
    `| ❌ Failed | ${testRun.failed} |`,
    `| ⏭️ Skipped | ${testRun.skipped} |`,
    `| ⏱️ Duration | ${(testRun.durationMs / 1000).toFixed(1)}s |`,
    '',
  ];

  if (testRun.failed > 0) {
    lines.push('### Failures', '');
    for (const result of testRun.results.filter((r) => !r.passed)) {
      lines.push(`- **${result.type}** (${result.assertionId}): ${result.message}`);
      if (result.details) lines.push(`  > ${result.details}`);
    }
    lines.push('');
  }

  lines.push(`_Total assertions: ${total} | Run at ${testRun.runAt.toISOString()}_`);
  return lines.join('\n');
}

// ============================================================================
// Helpers
// ============================================================================

async function evaluateAssertion(
  assertion: Assertion,
  repositoryId: string
): Promise<AssertionResult> {
  switch (assertion.type) {
    case 'endpoint-documented':
      return checkEndpointDocumented(assertion.config, repositoryId);
    case 'no-stale-docs':
      return checkNoStaleDocuments(assertion.config, repositoryId);
    case 'no-broken-links':
      return checkNoBrokenLinks(repositoryId);
    case 'min-coverage':
      return checkMinCoverage(assertion.config, repositoryId);
    case 'public-functions-have-examples':
      return checkPublicFunctionsHaveExamples(repositoryId);
    case 'custom':
      return {
        assertionId: assertion.id,
        type: 'custom',
        passed: true,
        message: 'Custom assertion skipped (no evaluator)',
        severity: 'info',
      };
    default:
      return {
        assertionId: assertion.id,
        type: assertion.type,
        passed: false,
        message: `Unknown assertion type: ${assertion.type}`,
        severity: 'error',
      };
  }
}

async function checkEndpointDocumented(
  config: Record<string, unknown>,
  repositoryId: string
): Promise<AssertionResult> {
  const endpoints = await db.apiEndpoint.findMany({ where: { repositoryId } });
  const docs = await db.document.findMany({ where: { repositoryId }, select: { content: true } });
  const docContent = docs.map((d: any) => d.content ?? '').join('\n');

  let documented = 0;
  const undocumented: string[] = [];
  for (const ep of endpoints) {
    const pattern = `${ep.method} ${ep.path}`.toLowerCase();
    if (docContent.toLowerCase().includes(pattern)) documented++;
    else undocumented.push(`${ep.method} ${ep.path}`);
  }

  const total = endpoints.length || 1;
  const ratio = documented / total;
  const passed = ratio >= ((config.threshold as number) ?? 0.8);

  return {
    assertionId: 'endpoint-documented',
    type: 'endpoint-documented',
    passed,
    message: `${documented}/${endpoints.length} endpoints documented (${(ratio * 100).toFixed(0)}%)`,
    details:
      undocumented.length > 0 ? `Missing: ${undocumented.slice(0, 5).join(', ')}` : undefined,
    severity: passed ? 'info' : 'warning',
  };
}

async function checkNoStaleDocuments(
  config: Record<string, unknown>,
  repositoryId: string
): Promise<AssertionResult> {
  const maxAgeDays = (config.maxAgeDays as number) ?? 90;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  const staleDocs = await db.document.findMany({
    where: { repositoryId, updatedAt: { lt: cutoff } },
    select: { path: true, updatedAt: true },
  });

  const passed = staleDocs.length === 0;
  return {
    assertionId: 'no-stale-docs',
    type: 'no-stale-docs',
    passed,
    message: passed
      ? 'No stale documents found'
      : `${staleDocs.length} document(s) older than ${maxAgeDays} days`,
    details:
      staleDocs
        .slice(0, 5)
        .map((d: any) => d.path)
        .join(', ') || undefined,
    severity: passed ? 'info' : 'warning',
  };
}

async function checkNoBrokenLinks(repositoryId: string): Promise<AssertionResult> {
  const docs = await db.document.findMany({
    where: { repositoryId },
    select: { content: true, path: true },
  });
  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  const allPaths = new Set(docs.map((d: any) => d.path));
  const brokenLinks: string[] = [];

  for (const doc of docs) {
    const content = doc.content ?? '';
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(content)) !== null) {
      const href = match[2];
      if (href.startsWith('http')) continue;
      const resolved = resolveRelativePath(doc.path, href);
      if (!allPaths.has(resolved) && !allPaths.has(resolved + '.md')) {
        brokenLinks.push(`${doc.path} -> ${href}`);
      }
    }
  }

  const passed = brokenLinks.length === 0;
  return {
    assertionId: 'no-broken-links',
    type: 'no-broken-links',
    passed,
    message: passed ? 'No broken internal links' : `${brokenLinks.length} broken link(s) found`,
    details: brokenLinks.slice(0, 5).join('; ') || undefined,
    severity: passed ? 'info' : 'error',
  };
}

async function checkMinCoverage(
  config: Record<string, unknown>,
  repositoryId: string
): Promise<AssertionResult> {
  const threshold = (config.threshold as number) ?? 0.6;
  const totalSymbols = await db.codeSymbol.count({ where: { repositoryId } });
  const documentedSymbols = await db.codeSymbol.count({
    where: { repositoryId, documented: true },
  });

  const coverage = totalSymbols > 0 ? documentedSymbols / totalSymbols : 0;
  const passed = coverage >= threshold;

  return {
    assertionId: 'min-coverage',
    type: 'min-coverage',
    passed,
    message: `Coverage: ${(coverage * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(0)}%)`,
    severity: passed ? 'info' : 'error',
  };
}

async function checkPublicFunctionsHaveExamples(repositoryId: string): Promise<AssertionResult> {
  const publicFns = await db.codeSymbol.findMany({
    where: { repositoryId, visibility: 'public', kind: 'function' },
    select: { name: true, hasExample: true },
  });

  const withExamples = publicFns.filter((f: any) => f.hasExample).length;
  const total = publicFns.length || 1;
  const ratio = withExamples / total;
  const passed = ratio >= 0.5;

  return {
    assertionId: 'public-functions-have-examples',
    type: 'public-functions-have-examples',
    passed,
    message: `${withExamples}/${publicFns.length} public functions have examples`,
    severity: passed ? 'info' : 'warning',
  };
}

async function loadSuiteFromPath(repositoryId: string, suitePath: string): Promise<TestSuite> {
  const file = await db.repositoryFile.findFirst({ where: { repositoryId, path: suitePath } });
  if (!file?.content) {
    log.warn({ repositoryId, suitePath }, 'Suite file not found, using default');
    return getDefaultSuite(repositoryId);
  }
  const validation = await validateSuite(file.content);
  if (!validation.valid || !validation.parsed) {
    log.warn({ errors: validation.errors }, 'Invalid suite file, using default');
    return getDefaultSuite(repositoryId);
  }
  return { ...validation.parsed, repositoryId };
}

function resolveRelativePath(basePath: string, href: string): string {
  if (href.startsWith('/')) return href;
  const dir = basePath.split('/').slice(0, -1).join('/');
  const parts = `${dir}/${href}`.split('/').filter(Boolean);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
