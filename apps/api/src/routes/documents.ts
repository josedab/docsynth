import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { NotFoundError, createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { indexDocument, indexRepository, getVectorIndexStats, deleteDocumentChunks } from '../services/embedding.js';

const app = new Hono();
const log = createLogger('document-routes');

// List all documents for organization
app.get('/', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const repositoryId = c.req.query('repositoryId');
  const type = c.req.query('type');
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const perPage = Math.min(parseInt(c.req.query('perPage') ?? '20', 10), 100);

  const where = {
    repository: {
      organizationId: orgId,
    },
    ...(repositoryId && { repositoryId }),
    ...(type && {
      type: type.toUpperCase() as
        | 'README'
        | 'API_REFERENCE'
        | 'CHANGELOG'
        | 'GUIDE'
        | 'TUTORIAL'
        | 'ARCHITECTURE'
        | 'ADR'
        | 'INLINE_COMMENT',
    }),
  };

  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { updatedAt: 'desc' },
      include: {
        repository: {
          select: {
            id: true,
            name: true,
            githubFullName: true,
          },
        },
      },
    }),
    prisma.document.count({ where }),
  ]);

  return c.json({
    success: true,
    data: documents,
    meta: {
      page,
      perPage,
      total,
      hasMore: page * perPage < total,
    },
  });
});

// Get single document with content
app.get('/:docId', requireAuth, async (c) => {
  const docId = c.req.param('docId');

  const document = await prisma.document.findUnique({
    where: { id: docId },
    include: {
      repository: {
        select: {
          id: true,
          name: true,
          githubFullName: true,
        },
      },
      versions: {
        orderBy: { version: 'desc' },
        take: 10,
        include: {
          generationJob: {
            select: {
              id: true,
              status: true,
              completedAt: true,
            },
          },
        },
      },
    },
  });

  if (!document) {
    throw new NotFoundError('Document', docId);
  }

  return c.json({
    success: true,
    data: document,
  });
});

// Get specific version content
app.get('/:docId/versions/:versionNumber', requireAuth, async (c) => {
  const docId = c.req.param('docId');
  const versionNumber = parseInt(c.req.param('versionNumber'), 10);

  const docVersion = await prisma.docVersion.findFirst({
    where: {
      documentId: docId,
      version: versionNumber,
    },
    include: {
      document: {
        include: {
          repository: {
            select: {
              id: true,
              name: true,
              githubFullName: true,
            },
          },
        },
      },
      generationJob: {
        select: {
          id: true,
          status: true,
          completedAt: true,
          changeAnalysis: {
            select: {
              prEvent: {
                select: {
                  prNumber: true,
                  title: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!docVersion) {
    throw new NotFoundError('DocVersion', `${docId}/v${versionNumber}`);
  }

  return c.json({
    success: true,
    data: docVersion,
  });
});

// Compare two versions (diff)
app.get('/:docId/diff', requireAuth, async (c) => {
  const docId = c.req.param('docId');
  const fromVersion = parseInt(c.req.query('from') ?? '1', 10);
  const toVersion = parseInt(c.req.query('to') ?? '2', 10);

  const [fromDoc, toDoc] = await Promise.all([
    prisma.docVersion.findFirst({
      where: { documentId: docId, version: fromVersion },
    }),
    prisma.docVersion.findFirst({
      where: { documentId: docId, version: toVersion },
    }),
  ]);

  if (!fromDoc || !toDoc) {
    throw new NotFoundError('DocVersion', `${docId} versions ${fromVersion} or ${toVersion}`);
  }

  return c.json({
    success: true,
    data: {
      from: {
        version: fromDoc.version,
        content: fromDoc.content,
        createdAt: fromDoc.generatedAt,
      },
      to: {
        version: toDoc.version,
        content: toDoc.content,
        createdAt: toDoc.generatedAt,
      },
    },
  });
});

// Get document types summary
app.get('/stats/types', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const stats = await prisma.document.groupBy({
    by: ['type'],
    where: {
      repository: {
        organizationId: orgId,
      },
    },
    _count: {
      type: true,
    },
  });

  return c.json({
    success: true,
    data: stats.map((s) => ({
      type: s.type,
      count: s._count.type,
    })),
  });
});

// Update document content (create new version)
app.patch('/:docId', requireAuth, async (c) => {
  const docId = c.req.param('docId');
  const body = await c.req.json();
  const { content, title } = body as { content?: string; title?: string };

  const document = await prisma.document.findUnique({
    where: { id: docId },
  });

  if (!document) {
    throw new NotFoundError('Document', docId);
  }

  // Create new version with updated content
  if (content !== undefined) {
    const newVersion = document.version + 1;

    await prisma.$transaction([
      prisma.docVersion.create({
        data: {
          documentId: docId,
          version: newVersion,
          content,
          generatedAt: new Date(),
        },
      }),
      prisma.document.update({
        where: { id: docId },
        data: {
          content,
          version: newVersion,
          title: title ?? document.title,
          updatedAt: new Date(),
        },
      }),
    ]);
  } else if (title !== undefined) {
    await prisma.document.update({
      where: { id: docId },
      data: { title },
    });
  }

  const updated = await prisma.document.findUnique({
    where: { id: docId },
    include: {
      repository: {
        select: {
          id: true,
          name: true,
          githubFullName: true,
        },
      },
    },
  });

  return c.json({
    success: true,
    data: updated,
  });
});

// Delete document
app.delete('/:docId', requireAuth, async (c) => {
  const docId = c.req.param('docId');

  const document = await prisma.document.findUnique({
    where: { id: docId },
  });

  if (!document) {
    throw new NotFoundError('Document', docId);
  }

  // Delete versions first, then document
  await prisma.$transaction([
    prisma.docVersion.deleteMany({
      where: { documentId: docId },
    }),
    prisma.document.delete({
      where: { id: docId },
    }),
  ]);

  return c.json({
    success: true,
    data: { deleted: true },
  });
});

// ============================================================================
// Vector Indexing Endpoints (Feature 1: AI Documentation Chat)
// ============================================================================

// Index a single document for semantic search
app.post('/:docId/index', requireAuth, async (c) => {
  const docId = c.req.param('docId');

  const document = await prisma.document.findUnique({
    where: { id: docId },
    select: { id: true, repositoryId: true },
  });

  if (!document) {
    throw new NotFoundError('Document', docId);
  }

  try {
    const result = await indexDocument(docId, document.repositoryId);
    log.info({ docId, chunksCreated: result.chunksCreated }, 'Document indexed');

    return c.json({
      success: true,
      data: {
        documentId: docId,
        chunksCreated: result.chunksCreated,
        tokensUsed: result.tokensUsed,
      },
    });
  } catch (error) {
    log.error({ error, docId }, 'Failed to index document');
    throw error;
  }
});

// Index all documents in a repository
app.post('/repository/:repositoryId/index', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ async?: boolean }>()
    .catch(() => ({ async: undefined } as { async?: boolean }));

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // If async, queue the job
  if (body.async) {
    await addJob(QUEUE_NAMES.VECTOR_INDEX, {
      repositoryId,
      reindex: true,
    });

    return c.json({
      success: true,
      data: {
        repositoryId,
        status: 'queued',
        message: 'Indexing job has been queued',
      },
    }, 202);
  }

  // Synchronous indexing
  try {
    const result = await indexRepository(repositoryId);
    log.info({ repositoryId, ...result }, 'Repository indexed');

    return c.json({
      success: true,
      data: {
        repositoryId,
        documentsIndexed: result.documentsIndexed,
        chunksCreated: result.chunksCreated,
        tokensUsed: result.tokensUsed,
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to index repository');
    throw error;
  }
});

// Get vector index status for a repository
app.get('/repository/:repositoryId/index/status', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const stats = await getVectorIndexStats(repositoryId);

  if (!stats) {
    return c.json({
      success: true,
      data: {
        repositoryId,
        indexed: false,
        message: 'No vector index found for this repository',
      },
    });
  }

  return c.json({
    success: true,
    data: {
      indexed: true,
      ...stats,
    },
  });
});

// Delete vector index for a document
app.delete('/:docId/index', requireAuth, async (c) => {
  const docId = c.req.param('docId');

  const document = await prisma.document.findUnique({
    where: { id: docId },
  });

  if (!document) {
    throw new NotFoundError('Document', docId);
  }

  const deletedCount = await deleteDocumentChunks(docId);

  return c.json({
    success: true,
    data: {
      documentId: docId,
      chunksDeleted: deletedCount,
    },
  });
});

export { app as documentRoutes };
