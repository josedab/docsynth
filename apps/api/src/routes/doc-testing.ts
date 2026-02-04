/**
 * Documentation Testing Routes
 *
 * Provides endpoints for testing and validating documentation:
 * - Code example validation
 * - Link checking
 * - Structure validation
 * - Freshness checks
 * - Batch testing
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import {
  runDocumentTests,
  runBatchDocumentTests,
  extractCodeBlocks,
  extractLinks,
  extractApiReferences,
  validateCodeSyntax,
  validateStructure,
  checkFreshness,
} from '../services/doc-testing.service.js';

const app = new Hono();

interface TestDocumentBody {
  content: string;
  documentPath?: string;
  checkExternalLinks?: boolean;
  documentUpdatedAt?: string;
  codeUpdatedAt?: string;
}

interface ContentBody {
  content: string;
  checkExternal?: boolean;
}

interface FreshnessBody {
  documentUpdatedAt: string;
  codeUpdatedAt: string;
  thresholdDays?: number;
}

interface ValidateBody {
  content: string;
  checks?: Array<'code' | 'links' | 'structure'>;
}

// Test a single document
app.post('/test', async (c) => {
  const body = await c.req.json<TestDocumentBody>();

  if (!body.content) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'content is required' } }, 400);
  }

  const report = await runDocumentTests(body.content, {
    documentPath: body.documentPath || 'inline-document.md',
    checkExternalLinks: body.checkExternalLinks || false,
    documentUpdatedAt: body.documentUpdatedAt ? new Date(body.documentUpdatedAt) : undefined,
    codeUpdatedAt: body.codeUpdatedAt ? new Date(body.codeUpdatedAt) : undefined,
    linkTimeout: 5000,
  });

  return c.json({
    success: true,
    data: report,
  });
});

// Test a document by ID
app.post('/test/:documentId', async (c) => {
  const documentId = c.req.param('documentId');
  const body = await c.req.json<{ checkExternalLinks?: boolean }>().catch(() => ({ checkExternalLinks: false }));

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      repository: true,
    },
  });

  if (!document) {
    return c.json(
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Document not found' },
      },
      404
    );
  }

  const report = await runDocumentTests(document.content, {
    documentPath: document.path,
    checkExternalLinks: body.checkExternalLinks || false,
    documentUpdatedAt: document.updatedAt,
    linkTimeout: 5000,
  });

  return c.json({
    success: true,
    data: report,
  });
});

// Test all documents in a repository
app.post('/test/repository/:repositoryId', async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const body = await c.req.json<{ checkExternalLinks?: boolean }>().catch(() => ({ checkExternalLinks: false }));

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    include: {
      documents: true,
    },
  });

  if (!repository) {
    return c.json(
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Repository not found' },
      },
      404
    );
  }

  const documents = repository.documents.map((doc: { path: string; content: string; updatedAt: Date }) => ({
    path: doc.path,
    content: doc.content,
    updatedAt: doc.updatedAt,
  }));

  const { reports, aggregatedSummary } = await runBatchDocumentTests(documents, {
    checkExternalLinks: body.checkExternalLinks || false,
    linkTimeout: 5000,
  });

  return c.json({
    success: true,
    data: {
      repositoryId,
      repositoryName: repository.name,
      reports,
      summary: aggregatedSummary,
    },
  });
});

// Extract and analyze code blocks
app.post('/analyze/code-blocks', async (c) => {
  const body = await c.req.json<ContentBody>();

  if (!body.content) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'content is required' } }, 400);
  }

  const codeBlocks = extractCodeBlocks(body.content);

  const analysis = codeBlocks.map((block) => {
    const validation = validateCodeSyntax(block.code, block.language);
    return {
      ...block,
      validation,
    };
  });

  return c.json({
    success: true,
    data: {
      total: codeBlocks.length,
      byLanguage: codeBlocks.reduce<Record<string, number>>(
        (acc, block) => {
          const lang = block.language || 'unknown';
          acc[lang] = (acc[lang] || 0) + 1;
          return acc;
        },
        {}
      ),
      blocks: analysis,
    },
  });
});

// Extract and check links
app.post('/analyze/links', async (c) => {
  const body = await c.req.json<ContentBody>();

  if (!body.content) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'content is required' } }, 400);
  }

  const links = extractLinks(body.content);

  const linksByType = {
    internal: links.filter((l) => l.type === 'internal'),
    external: links.filter((l) => l.type === 'external'),
    anchor: links.filter((l) => l.type === 'anchor'),
  };

  return c.json({
    success: true,
    data: {
      total: links.length,
      byType: {
        internal: linksByType.internal.length,
        external: linksByType.external.length,
        anchor: linksByType.anchor.length,
      },
      links,
    },
  });
});

// Validate document structure
app.post('/analyze/structure', async (c) => {
  const body = await c.req.json<ContentBody>();

  if (!body.content) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'content is required' } }, 400);
  }

  const results = validateStructure(body.content);
  const errors = results.filter((r) => r.severity === 'error' && !r.passed);
  const warnings = results.filter((r) => r.severity === 'warning' && !r.passed);

  return c.json({
    success: true,
    data: {
      isValid: errors.length === 0,
      errorCount: errors.length,
      warningCount: warnings.length,
      results,
    },
  });
});

// Extract API references
app.post('/analyze/api-references', async (c) => {
  const body = await c.req.json<ContentBody>();

  if (!body.content) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'content is required' } }, 400);
  }

  const references = extractApiReferences(body.content);

  const byType = references.reduce<Record<string, number>>(
    (acc, ref) => {
      acc[ref.type] = (acc[ref.type] || 0) + 1;
      return acc;
    },
    {}
  );

  return c.json({
    success: true,
    data: {
      total: references.length,
      byType,
      references,
    },
  });
});

// Check documentation freshness
app.post('/analyze/freshness', async (c) => {
  const body = await c.req.json<FreshnessBody>();

  if (!body.documentUpdatedAt || !body.codeUpdatedAt) {
    return c.json({
      success: false,
      error: { code: 'INVALID_INPUT', message: 'documentUpdatedAt and codeUpdatedAt are required' }
    }, 400);
  }

  const result = checkFreshness(
    new Date(body.documentUpdatedAt),
    new Date(body.codeUpdatedAt),
    body.thresholdDays || 30
  );

  return c.json({
    success: true,
    data: result,
  });
});

// Get test history for a document
app.get('/history/:documentId', async (c) => {
  const documentId = c.req.param('documentId');

  // Return empty array - table might not exist in schema yet
  return c.json({
    success: true,
    data: [],
  });
});

// Get test summary for a repository
app.get('/summary/:repositoryId', async (c) => {
  const repositoryId = c.req.param('repositoryId');

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    include: {
      documents: {
        select: {
          id: true,
          path: true,
          title: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!repository) {
    return c.json(
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Repository not found' },
      },
      404
    );
  }

  interface DocumentSummary {
    id: string;
    path: string;
    title: string;
    updatedAt: Date;
    testResult: null;
  }

  const documentSummaries: DocumentSummary[] = repository.documents.map((doc: { id: string; path: string; title: string; updatedAt: Date }) => ({
    id: doc.id,
    path: doc.path,
    title: doc.title,
    updatedAt: doc.updatedAt,
    testResult: null,
  }));

  return c.json({
    success: true,
    data: {
      repositoryId,
      repositoryName: repository.name,
      totalDocuments: repository.documents.length,
      testedDocuments: 0,
      untestedDocuments: repository.documents.length,
      averageScore: null,
      totalPassed: 0,
      totalFailed: 0,
      totalWarnings: 0,
      documents: documentSummaries,
    },
  });
});

// Quick validation endpoint (no storage)
app.post('/validate', async (c) => {
  const body = await c.req.json<ValidateBody>();

  if (!body.content) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'content is required' } }, 400);
  }

  const checks = body.checks || ['code', 'links', 'structure'];
  const results: Record<string, unknown> = {};

  if (checks.includes('code')) {
    const codeBlocks = extractCodeBlocks(body.content);
    const codeResults = codeBlocks.map((block) => ({
      language: block.language,
      lineNumber: block.lineNumber,
      ...validateCodeSyntax(block.code, block.language),
    }));
    results.code = {
      total: codeBlocks.length,
      valid: codeResults.filter((r) => r.passed).length,
      invalid: codeResults.filter((r) => !r.passed).length,
      details: codeResults.filter((r) => !r.passed),
    };
  }

  if (checks.includes('links')) {
    const links = extractLinks(body.content);
    results.links = {
      total: links.length,
      internal: links.filter((l) => l.type === 'internal').length,
      external: links.filter((l) => l.type === 'external').length,
      anchor: links.filter((l) => l.type === 'anchor').length,
    };
  }

  if (checks.includes('structure')) {
    const structureResults = validateStructure(body.content);
    const errors = structureResults.filter((r) => !r.passed && r.severity === 'error');
    const warnings = structureResults.filter((r) => !r.passed && r.severity === 'warning');
    results.structure = {
      isValid: errors.length === 0,
      errors: errors.length,
      warnings: warnings.length,
      issues: [...errors, ...warnings],
    };
  }

  // Calculate overall validity
  const isValid =
    (!results.code || (results.code as Record<string, number>).invalid === 0) &&
    (!results.structure || (results.structure as Record<string, boolean>).isValid);

  return c.json({
    success: true,
    data: {
      isValid,
      results,
    },
  });
});

export default app;
