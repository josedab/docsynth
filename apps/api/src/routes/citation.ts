/**
 * Citation API Routes
 * 
 * Provides smart search with inline citations.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { citationService } from '../services/citation.service.js';
import type { DocumentType } from '@docsynth/types';

const router = new Hono();

// All routes require authentication
router.use('*', requireAuth);

// Search with citations
const searchSchema = z.object({
  query: z.string().min(1).max(1000),
  topK: z.number().min(1).max(20).optional(),
  minScore: z.number().min(0).max(1).optional(),
  documentTypes: z.array(z.string()).optional(),
  includeCodeBlocks: z.boolean().optional(),
});

router.post('/search/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const body = await c.req.json();
  
  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  // Verify repository exists
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const result = await citationService.searchWithCitations(
      repositoryId,
      parsed.data.query,
      {
        topK: parsed.data.topK,
        minScore: parsed.data.minScore,
        documentTypes: parsed.data.documentTypes as DocumentType[],
        includeCodeBlocks: parsed.data.includeCodeBlocks,
      }
    );

    return c.json(result);
  } catch (error) {
    console.error('Citation search failed:', error);
    return c.json({ error: 'Search failed' }, 500);
  }
});

// Get citation by ID
router.get('/citation/:citationId', async (c) => {
  const { citationId } = c.req.param();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  
  const citation = await db.citationIndex.findUnique({
    where: { id: citationId },
    include: {
      document: {
        select: {
          id: true,
          path: true,
          title: true,
          repositoryId: true,
        },
      },
    },
  });

  if (!citation) {
    return c.json({ error: 'Citation not found' }, 404);
  }

  return c.json(citation);
});

// Verify citation accuracy
router.get('/citation/:citationId/verify', async (c) => {
  const { citationId } = c.req.param();
  
  const isValid = await citationService.verifyCitation(citationId);
  
  return c.json({
    citationId,
    valid: isValid,
    checkedAt: new Date().toISOString(),
  });
});

// Build citation index for repository
router.post('/index/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const body = await c.req.json().catch(() => ({}));

  // Verify repository exists
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  // Queue indexing job
  const job = await addJob(
    QUEUE_NAMES.CITATION_INDEX,
    {
      repositoryId,
      documentId: body.documentId,
      fullReindex: body.fullReindex ?? false,
    },
    {
      jobId: `citation-index-${repositoryId}-${Date.now()}`,
    }
  );

  return c.json({
    message: 'Citation indexing queued',
    jobId: job.id,
    repositoryId,
  });
});

// Get index status for repository
router.get('/index/:repositoryId/status', requireOrgAccess, async (c) => {
  const { repositoryId } = c.req.param();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  const [indexCount, lastIndexed, documentCount] = await Promise.all([
    db.citationIndex.count({ where: { repositoryId } }),
    db.citationIndex.findFirst({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.document.count({ where: { repositoryId } }),
  ]);

  return c.json({
    repositoryId,
    indexedSections: indexCount,
    documentsInRepository: documentCount,
    lastIndexedAt: lastIndexed?.createdAt || null,
    coveragePercent: documentCount > 0 ? Math.round((indexCount / documentCount) * 100) : 0,
  });
});

// List citations for a document
router.get('/document/:documentId', async (c) => {
  const { documentId } = c.req.param();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  const citations = await db.citationIndex.findMany({
    where: { documentId },
    orderBy: { lineStart: 'asc' },
    select: {
      id: true,
      sectionTitle: true,
      heading: true,
      lineStart: true,
      lineEnd: true,
      content: true,
      keywords: true,
      createdAt: true,
    },
  });

  return c.json({
    documentId,
    citations,
    total: citations.length,
  });
});

export default router;
