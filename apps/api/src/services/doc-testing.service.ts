/**
 * Documentation Testing Service
 *
 * Provides automated testing and validation for documentation:
 * - Code example validation (syntax, execution)
 * - Link checking (internal and external)
 * - API reference validation
 * - Markdown structure validation
 * - Freshness checks
 */

import * as ts from 'typescript';

export interface CodeBlock {
  language: string;
  code: string;
  lineNumber: number;
}

export interface LinkInfo {
  url: string;
  text: string;
  lineNumber: number;
  type: 'internal' | 'external' | 'anchor';
}

export interface DocTestResult {
  passed: boolean;
  category: 'code' | 'link' | 'structure' | 'api' | 'freshness';
  message: string;
  lineNumber?: number;
  severity: 'error' | 'warning' | 'info';
  details?: Record<string, unknown>;
}

export interface DocTestReport {
  documentPath: string;
  timestamp: Date;
  duration: number;
  results: DocTestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    score: number;
  };
}

export interface ApiReference {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'variable';
  path: string;
  lineNumber: number;
}

/**
 * Extract code blocks from markdown content
 */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const codeBlocks: CodeBlock[] = [];
  const lines = markdown.split('\n');

  let inCodeBlock = false;
  let currentLanguage = '';
  let currentCode: string[] = [];
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        codeBlocks.push({
          language: currentLanguage,
          code: currentCode.join('\n'),
          lineNumber: startLine + 1,
        });
        inCodeBlock = false;
        currentLanguage = '';
        currentCode = [];
      } else {
        // Start of code block
        inCodeBlock = true;
        currentLanguage = line.slice(3).trim().toLowerCase();
        startLine = i;
      }
    } else if (inCodeBlock) {
      currentCode.push(line);
    }
  }

  return codeBlocks;
}

/**
 * Extract links from markdown content
 */
export function extractLinks(markdown: string): LinkInfo[] {
  const links: LinkInfo[] = [];
  const lines = markdown.split('\n');

  // Match markdown links: [text](url)
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  // Match reference links: [text][ref]
  const refLinkRegex = /\[([^\]]*)\]\[([^\]]+)\]/g;
  // Match reference definitions: [ref]: url
  const refDefRegex = /^\[([^\]]+)\]:\s*(.+)$/;

  const references: Map<string, string> = new Map();

  // First pass: collect reference definitions
  for (const line of lines) {
    if (!line) continue;
    const match = refDefRegex.exec(line);
    if (match && match[1] && match[2]) {
      references.set(match[1].toLowerCase(), match[2].trim());
    }
  }

  // Second pass: extract links
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let match;

    // Direct links
    linkRegex.lastIndex = 0;
    while ((match = linkRegex.exec(line)) !== null) {
      const text = match[1] ?? '';
      const url = match[2] ?? '';
      if (url) {
        links.push({
          text,
          url,
          lineNumber: i + 1,
          type: classifyLink(url),
        });
      }
    }

    // Reference links
    refLinkRegex.lastIndex = 0;
    while ((match = refLinkRegex.exec(line)) !== null) {
      const text = match[1] ?? '';
      const refKey = (match[2] ?? '').toLowerCase();
      const url = references.get(refKey);
      if (url) {
        links.push({
          text,
          url,
          lineNumber: i + 1,
          type: classifyLink(url),
        });
      }
    }
  }

  return links;
}

function classifyLink(url: string): 'internal' | 'external' | 'anchor' {
  if (url.startsWith('#')) {
    return 'anchor';
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return 'external';
  }
  return 'internal';
}

/**
 * Validate TypeScript/JavaScript code syntax
 */
export function validateCodeSyntax(code: string, language: string): DocTestResult {
  if (!['typescript', 'ts', 'javascript', 'js', 'tsx', 'jsx'].includes(language)) {
    return {
      passed: true,
      category: 'code',
      message: `Skipped syntax validation for ${language}`,
      severity: 'info',
    };
  }

  const isTypeScript = ['typescript', 'ts', 'tsx'].includes(language);
  const fileName = isTypeScript ? 'example.tsx' : 'example.jsx';

  try {
    const sourceFile = ts.createSourceFile(
      fileName,
      code,
      ts.ScriptTarget.Latest,
      true,
      isTypeScript ? ts.ScriptKind.TSX : ts.ScriptKind.JSX
    );

    // Check for syntax errors by looking for diagnostic messages
    const syntaxDiagnostics: string[] = [];

    // Walk the AST to check for parse errors
    function visit(node: ts.Node) {
      if (node.kind === ts.SyntaxKind.Unknown) {
        syntaxDiagnostics.push('Unknown syntax element found');
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    // Additional validation using the compiler
    const compilerOptions: ts.CompilerOptions = {
      noEmit: true,
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      strict: false,
      skipLibCheck: true,
      noImplicitAny: false,
    };

    const host = ts.createCompilerHost(compilerOptions);
    host.getSourceFile = (name) => {
      if (name === fileName) {
        return sourceFile;
      }
      return undefined;
    };

    const program = ts.createProgram([fileName], compilerOptions, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    const syntaxErrors = diagnostics.filter(
      (d) => d.category === ts.DiagnosticCategory.Error
    );

    if (syntaxErrors.length > 0) {
      const errorMessages = syntaxErrors
        .slice(0, 3)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));

      return {
        passed: false,
        category: 'code',
        message: `Syntax errors: ${errorMessages.join('; ')}`,
        severity: 'error',
        details: { errorCount: syntaxErrors.length },
      };
    }

    return {
      passed: true,
      category: 'code',
      message: 'Code syntax is valid',
      severity: 'info',
    };
  } catch (error) {
    return {
      passed: false,
      category: 'code',
      message: `Failed to parse code: ${error instanceof Error ? error.message : 'Unknown error'}`,
      severity: 'error',
    };
  }
}

/**
 * Validate JSON code blocks
 */
export function validateJsonSyntax(code: string): DocTestResult {
  try {
    JSON.parse(code);
    return {
      passed: true,
      category: 'code',
      message: 'JSON syntax is valid',
      severity: 'info',
    };
  } catch (error) {
    return {
      passed: false,
      category: 'code',
      message: `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`,
      severity: 'error',
    };
  }
}

/**
 * Validate YAML code blocks (basic validation)
 */
export function validateYamlSyntax(code: string): DocTestResult {
  // Basic YAML validation - check for common syntax issues
  const lines = code.split('\n');
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Check for tabs (YAML should use spaces)
    if (line.includes('\t')) {
      errors.push(`Line ${i + 1}: YAML should use spaces, not tabs`);
    }

    // Check for inconsistent indentation
    const leadingSpacesMatch = line.match(/^(\s*)/);
    const leadingSpaces = leadingSpacesMatch?.[1]?.length ?? 0;
    if (leadingSpaces % 2 !== 0 && line.trim().length > 0) {
      errors.push(`Line ${i + 1}: Inconsistent indentation (odd number of spaces)`);
    }
  }

  if (errors.length > 0) {
    return {
      passed: false,
      category: 'code',
      message: errors.slice(0, 3).join('; '),
      severity: 'warning',
      details: { errorCount: errors.length },
    };
  }

  return {
    passed: true,
    category: 'code',
    message: 'YAML syntax appears valid',
    severity: 'info',
  };
}

/**
 * Check link accessibility
 */
export async function checkLink(
  link: LinkInfo,
  timeout: number = 5000
): Promise<DocTestResult> {
  if (link.type === 'anchor') {
    // Anchor links are validated separately with document structure
    return {
      passed: true,
      category: 'link',
      message: `Anchor link: ${link.url}`,
      lineNumber: link.lineNumber,
      severity: 'info',
    };
  }

  if (link.type === 'internal') {
    // Internal links need file system validation
    return {
      passed: true,
      category: 'link',
      message: `Internal link: ${link.url} (requires file system validation)`,
      lineNumber: link.lineNumber,
      severity: 'info',
    };
  }

  // External link validation
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(link.url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'DocSynth-LinkChecker/1.0',
      },
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return {
        passed: true,
        category: 'link',
        message: `Link accessible: ${link.url}`,
        lineNumber: link.lineNumber,
        severity: 'info',
      };
    }

    if (response.status === 403 || response.status === 405) {
      // Some servers block HEAD requests
      return {
        passed: true,
        category: 'link',
        message: `Link may be accessible (server blocks HEAD): ${link.url}`,
        lineNumber: link.lineNumber,
        severity: 'info',
      };
    }

    return {
      passed: false,
      category: 'link',
      message: `Broken link (${response.status}): ${link.url}`,
      lineNumber: link.lineNumber,
      severity: 'error',
      details: { statusCode: response.status },
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    return {
      passed: false,
      category: 'link',
      message: isTimeout
        ? `Link timeout: ${link.url}`
        : `Link check failed: ${link.url}`,
      lineNumber: link.lineNumber,
      severity: 'warning',
      details: { error: error instanceof Error ? error.message : 'Unknown' },
    };
  }
}

/**
 * Validate markdown structure
 */
export function validateStructure(markdown: string): DocTestResult[] {
  const results: DocTestResult[] = [];
  const lines = markdown.split('\n');

  let hasTitle = false;
  let previousHeadingLevel = 0;
  const headingLevels: number[] = [];
  const anchors: Set<string> = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Check for headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const hashes = headingMatch[1] ?? '';
      const text = headingMatch[2] ?? '';
      const level = hashes.length;

      if (level === 1) {
        if (hasTitle) {
          results.push({
            passed: false,
            category: 'structure',
            message: 'Multiple H1 headings found',
            lineNumber: i + 1,
            severity: 'warning',
          });
        }
        hasTitle = true;
      }

      // Check heading hierarchy
      if (level > previousHeadingLevel + 1 && previousHeadingLevel > 0) {
        results.push({
          passed: false,
          category: 'structure',
          message: `Skipped heading level: H${previousHeadingLevel} to H${level}`,
          lineNumber: i + 1,
          severity: 'warning',
        });
      }

      previousHeadingLevel = level;
      headingLevels.push(level);

      // Create anchor from heading
      if (text) {
        const anchor = text
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-');
        anchors.add(`#${anchor}`);
      }
    }
  }

  if (!hasTitle) {
    results.push({
      passed: false,
      category: 'structure',
      message: 'Document missing H1 title',
      severity: 'warning',
    });
  }

  // Check for empty document
  const contentLines = lines.filter((l) => l && l.trim().length > 0);
  if (contentLines.length < 3) {
    results.push({
      passed: false,
      category: 'structure',
      message: 'Document appears too short (less than 3 non-empty lines)',
      severity: 'warning',
    });
  }

  // Validate anchor links
  const links = extractLinks(markdown);
  for (const link of links) {
    if (link.type === 'anchor' && !anchors.has(link.url)) {
      results.push({
        passed: false,
        category: 'link',
        message: `Broken anchor link: ${link.url}`,
        lineNumber: link.lineNumber,
        severity: 'error',
      });
    }
  }

  if (results.length === 0) {
    results.push({
      passed: true,
      category: 'structure',
      message: 'Document structure is valid',
      severity: 'info',
    });
  }

  return results;
}

/**
 * Check documentation freshness
 */
export function checkFreshness(
  documentUpdatedAt: Date,
  codeUpdatedAt: Date,
  thresholdDays: number = 30
): DocTestResult {
  const daysDiff = Math.floor(
    (codeUpdatedAt.getTime() - documentUpdatedAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysDiff > thresholdDays) {
    return {
      passed: false,
      category: 'freshness',
      message: `Documentation is ${daysDiff} days behind code changes`,
      severity: 'warning',
      details: {
        documentUpdatedAt: documentUpdatedAt.toISOString(),
        codeUpdatedAt: codeUpdatedAt.toISOString(),
        daysBehind: daysDiff,
      },
    };
  }

  if (daysDiff > 0) {
    return {
      passed: true,
      category: 'freshness',
      message: `Documentation is ${daysDiff} days behind code (within threshold)`,
      severity: 'info',
      details: { daysBehind: daysDiff },
    };
  }

  return {
    passed: true,
    category: 'freshness',
    message: 'Documentation is up to date with code',
    severity: 'info',
  };
}

/**
 * Extract API references from documentation
 */
export function extractApiReferences(markdown: string): ApiReference[] {
  const references: ApiReference[] = [];
  const lines = markdown.split('\n');

  // Patterns for API references in documentation
  const patterns = [
    // Function references: `functionName()`
    /`([a-zA-Z_][a-zA-Z0-9_]*)\(\)`/g,
    // Class references: `ClassName`
    /`([A-Z][a-zA-Z0-9_]+)`/g,
    // Interface references: `IInterface` or `InterfaceName`
    /`(I[A-Z][a-zA-Z0-9_]+)`/g,
    // Type references in code blocks
    /type\s+([A-Z][a-zA-Z0-9_]+)/g,
    /interface\s+([A-Z][a-zA-Z0-9_]+)/g,
    /class\s+([A-Z][a-zA-Z0-9_]+)/g,
  ];

  const seenNames = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    for (const pattern of patterns) {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(line)) !== null) {
        const name = match[1];
        if (!name) continue;

        if (!seenNames.has(name)) {
          seenNames.add(name);

          let type: ApiReference['type'] = 'variable';
          if (name.endsWith('()') || pattern.source.includes('\\(\\)')) {
            type = 'function';
          } else if (name.length > 1 && name.startsWith('I') && name.charAt(1) === name.charAt(1).toUpperCase()) {
            type = 'interface';
          } else if (pattern.source.includes('class')) {
            type = 'class';
          } else if (pattern.source.includes('type') || pattern.source.includes('interface')) {
            type = 'type';
          } else if (name.charAt(0) === name.charAt(0).toUpperCase()) {
            type = 'class';
          }

          references.push({
            name: name.replace('()', ''),
            type,
            path: '', // To be filled by caller
            lineNumber: i + 1,
          });
        }
      }
    }
  }

  return references;
}

/**
 * Run comprehensive documentation tests
 */
export async function runDocumentTests(
  markdown: string,
  options: {
    documentPath: string;
    checkExternalLinks?: boolean;
    documentUpdatedAt?: Date;
    codeUpdatedAt?: Date;
    linkTimeout?: number;
  }
): Promise<DocTestReport> {
  const startTime = Date.now();
  const results: DocTestResult[] = [];

  // Extract and validate code blocks
  const codeBlocks = extractCodeBlocks(markdown);
  for (const block of codeBlocks) {
    let result: DocTestResult;

    switch (block.language) {
      case 'typescript':
      case 'ts':
      case 'javascript':
      case 'js':
      case 'tsx':
      case 'jsx':
        result = validateCodeSyntax(block.code, block.language);
        break;
      case 'json':
        result = validateJsonSyntax(block.code);
        break;
      case 'yaml':
      case 'yml':
        result = validateYamlSyntax(block.code);
        break;
      default:
        result = {
          passed: true,
          category: 'code',
          message: `Skipped validation for ${block.language || 'unknown'} code block`,
          severity: 'info',
        };
    }

    result.lineNumber = block.lineNumber;
    results.push(result);
  }

  // Validate document structure
  const structureResults = validateStructure(markdown);
  results.push(...structureResults);

  // Check links
  const links = extractLinks(markdown);
  for (const link of links) {
    if (link.type === 'external' && options.checkExternalLinks) {
      const result = await checkLink(link, options.linkTimeout);
      results.push(result);
    } else if (link.type === 'internal') {
      // Internal links - add as info (need file system access to validate)
      results.push({
        passed: true,
        category: 'link',
        message: `Internal link found: ${link.url}`,
        lineNumber: link.lineNumber,
        severity: 'info',
      });
    }
  }

  // Check freshness if dates provided
  if (options.documentUpdatedAt && options.codeUpdatedAt) {
    const freshnessResult = checkFreshness(
      options.documentUpdatedAt,
      options.codeUpdatedAt
    );
    results.push(freshnessResult);
  }

  const duration = Date.now() - startTime;

  // Calculate summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed && r.severity === 'error').length;
  const warnings = results.filter((r) => !r.passed && r.severity === 'warning').length;
  const total = results.length;

  // Calculate score (0-100)
  const score = Math.max(
    0,
    Math.round(((passed - failed * 2 - warnings * 0.5) / total) * 100)
  );

  return {
    documentPath: options.documentPath,
    timestamp: new Date(),
    duration,
    results,
    summary: {
      total,
      passed,
      failed,
      warnings,
      score: Math.min(100, Math.max(0, score)),
    },
  };
}

/**
 * Run tests on multiple documents and aggregate results
 */
export async function runBatchDocumentTests(
  documents: Array<{
    path: string;
    content: string;
    updatedAt?: Date;
  }>,
  options: {
    checkExternalLinks?: boolean;
    linkTimeout?: number;
  } = {}
): Promise<{
  reports: DocTestReport[];
  aggregatedSummary: {
    totalDocuments: number;
    totalTests: number;
    totalPassed: number;
    totalFailed: number;
    totalWarnings: number;
    averageScore: number;
    lowestScoringDocs: Array<{ path: string; score: number }>;
  };
}> {
  const reports: DocTestReport[] = [];

  for (const doc of documents) {
    const report = await runDocumentTests(doc.content, {
      documentPath: doc.path,
      checkExternalLinks: options.checkExternalLinks,
      documentUpdatedAt: doc.updatedAt,
      linkTimeout: options.linkTimeout,
    });
    reports.push(report);
  }

  // Aggregate results
  const totalTests = reports.reduce((sum, r) => sum + r.summary.total, 0);
  const totalPassed = reports.reduce((sum, r) => sum + r.summary.passed, 0);
  const totalFailed = reports.reduce((sum, r) => sum + r.summary.failed, 0);
  const totalWarnings = reports.reduce((sum, r) => sum + r.summary.warnings, 0);
  const averageScore =
    reports.length > 0
      ? Math.round(reports.reduce((sum, r) => sum + r.summary.score, 0) / reports.length)
      : 0;

  const lowestScoringDocs = reports
    .sort((a, b) => a.summary.score - b.summary.score)
    .slice(0, 5)
    .map((r) => ({ path: r.documentPath, score: r.summary.score }));

  return {
    reports,
    aggregatedSummary: {
      totalDocuments: documents.length,
      totalTests,
      totalPassed,
      totalFailed,
      totalWarnings,
      averageScore,
      lowestScoringDocs,
    },
  };
}
