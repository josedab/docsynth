/**
 * Natural Language Doc Editor Routes
 *
 * Endpoints for natural language documentation editing.
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import {
  processNLEdit,
  applyEdit,
  rejectEdit,
  getEditHistory,
  suggestEdits,
  type NLEditRequest,
  type BatchEditRequest,
} from '../services/nl-editor.service.js';

const app = new Hono();

// ============================================================================
// Single Document Edit
// ============================================================================

/**
 * POST /edit - Submit a natural language edit request (returns preview)
 */
app.post('/edit', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<NLEditRequest>();

  if (!body.documentId || !body.instruction) {
    throw new ValidationError('documentId and instruction are required');
  }

  // Verify document access
  const document = await prisma.document.findFirst({
    where: { id: body.documentId },
    include: {
      repository: {
        select: { id: true, organizationId: true },
      },
    },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', body.documentId);
  }

  // Process the edit
  const result = await processNLEdit(body);

  return c.json({
    success: true,
    data: result,
  });
});

// ============================================================================
// Apply/Reject Edit
// ============================================================================

/**
 * POST /apply/:editId - Apply a previewed edit
 */
app.post('/apply/:editId', requireAuth, requireOrgAccess, async (c) => {
  const editId = c.req.param('editId');
  const orgId = c.get('organizationId');

  // Verify edit access
  const edit = await prisma.nLEdit.findUnique({
    where: { id: editId },
    include: {
      document: {
        include: {
          repository: {
            select: { organizationId: true },
          },
        },
      },
    },
  });

  if (!edit || edit.document.repository.organizationId !== orgId) {
    throw new NotFoundError('Edit', editId);
  }

  // Apply the edit
  const result = await applyEdit(editId);

  return c.json({
    success: true,
    data: result,
    message: 'Edit applied successfully',
  });
});

/**
 * POST /reject/:editId - Reject a previewed edit
 */
app.post('/reject/:editId', requireAuth, requireOrgAccess, async (c) => {
  const editId = c.req.param('editId');
  const orgId = c.get('organizationId');

  // Verify edit access
  const edit = await prisma.nLEdit.findUnique({
    where: { id: editId },
    include: {
      document: {
        include: {
          repository: {
            select: { organizationId: true },
          },
        },
      },
    },
  });

  if (!edit || edit.document.repository.organizationId !== orgId) {
    throw new NotFoundError('Edit', editId);
  }

  // Reject the edit
  const result = await rejectEdit(editId);

  return c.json({
    success: true,
    data: result,
    message: 'Edit rejected',
  });
});

// ============================================================================
// Batch Edit
// ============================================================================

/**
 * POST /batch - Submit batch edit across documents
 */
app.post('/batch', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<BatchEditRequest>();

  if (!body.instruction || !body.repositoryId) {
    throw new ValidationError('instruction and repositoryId are required');
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Queue batch edit as background job
  const job = await addJob(QUEUE_NAMES.NL_EDITOR, {
    type: 'batch',
    repositoryId: body.repositoryId,
    instruction: body.instruction,
    targetDocuments: body.targetDocuments,
    scope: body.scope,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Batch edit job queued',
      estimatedDocuments: body.targetDocuments?.length || 'all matching documents',
    },
  });
});

// ============================================================================
// Edit History
// ============================================================================

/**
 * GET /history/:documentId - Get edit history for a document
 */
app.get('/history/:documentId', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');
  const { limit } = c.req.query();

  // Verify document access
  const document = await prisma.document.findFirst({
    where: { id: documentId },
    include: {
      repository: {
        select: { organizationId: true, name: true },
      },
    },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  // Get edit history
  const history = await getEditHistory(documentId, limit ? parseInt(limit, 10) : 20);

  return c.json({
    success: true,
    data: {
      documentId,
      documentPath: document.path,
      history,
      totalEdits: history.length,
      appliedEdits: history.filter(e => e.status === 'applied').length,
      rejectedEdits: history.filter(e => e.status === 'rejected').length,
      pendingEdits: history.filter(e => e.status === 'preview').length,
    },
  });
});

// ============================================================================
// Edit Suggestions
// ============================================================================

/**
 * GET /suggestions/:documentId - Get AI edit suggestions
 */
app.get('/suggestions/:documentId', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');

  // Verify document access
  const document = await prisma.document.findFirst({
    where: { id: documentId },
    include: {
      repository: {
        select: { organizationId: true, name: true },
      },
    },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  // Generate suggestions
  const suggestions = await suggestEdits(documentId);

  return c.json({
    success: true,
    data: {
      documentId,
      documentPath: document.path,
      suggestions,
      totalSuggestions: suggestions.length,
      highPriority: suggestions.filter(s => s.priority === 'high').length,
    },
  });
});

// ============================================================================
// Get Edit Details
// ============================================================================

/**
 * GET /edit/:editId - Get specific edit details
 */
app.get('/edit/:editId', requireAuth, requireOrgAccess, async (c) => {
  const editId = c.req.param('editId');
  const orgId = c.get('organizationId');

  // Verify edit access
  const edit = await prisma.nLEdit.findUnique({
    where: { id: editId },
    include: {
      document: {
        select: {
          id: true,
          path: true,
          title: true,
          repository: {
            select: { organizationId: true, name: true },
          },
        },
      },
    },
  });

  if (!edit || edit.document.repository.organizationId !== orgId) {
    throw new NotFoundError('Edit', editId);
  }

  return c.json({
    success: true,
    data: {
      id: edit.id,
      documentId: edit.documentId,
      documentPath: edit.document.path,
      documentTitle: edit.document.title,
      instruction: edit.instruction,
      originalContent: edit.originalContent,
      editedContent: edit.editedContent,
      diff: edit.diff,
      sectionsModified: edit.sectionsModified,
      confidence: edit.confidence,
      status: edit.status,
      createdAt: edit.createdAt,
      appliedAt: edit.appliedAt,
      rejectedAt: edit.rejectedAt,
      metadata: edit.metadata,
    },
  });
});

// ============================================================================
// Batch Edit Status
// ============================================================================

/**
 * GET /batch/:batchId - Get batch edit status
 */
app.get('/batch/:batchId', requireAuth, requireOrgAccess, async (c) => {
  const batchId = c.req.param('batchId');
  const orgId = c.get('organizationId');

  // Verify batch access
  const batch = await prisma.batchNLEdit.findUnique({
    where: { id: batchId },
    include: {
      repository: {
        select: { organizationId: true, name: true },
      },
    },
  });

  if (!batch || batch.repository.organizationId !== orgId) {
    throw new NotFoundError('Batch edit', batchId);
  }

  // Get edit results
  const resultIds = batch.results as string[];
  const edits = await prisma.nLEdit.findMany({
    where: { id: { in: resultIds } },
    include: {
      document: {
        select: { path: true, title: true },
      },
    },
  });

  return c.json({
    success: true,
    data: {
      id: batch.id,
      repositoryId: batch.repositoryId,
      repositoryName: batch.repository.name,
      instruction: batch.instruction,
      scope: batch.scope,
      totalDocuments: batch.totalDocuments,
      editedDocuments: batch.editedDocuments,
      skippedDocuments: batch.skippedDocuments,
      createdAt: batch.createdAt,
      edits: edits.map(e => ({
        id: e.id,
        documentPath: e.document.path,
        documentTitle: e.document.title,
        status: e.status,
        confidence: e.confidence,
        sectionsModified: e.sectionsModified,
      })),
    },
  });
});

// ============================================================================
// Repository Edit Stats
// ============================================================================

/**
 * GET /stats/:repositoryId - Get edit statistics for a repository
 */
app.get('/stats/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  // Get all documents for this repository
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true },
  });

  const documentIds = documents.map(d => d.id);

  // Get edit stats
  const totalEdits = await prisma.nLEdit.count({
    where: { documentId: { in: documentIds } },
  });

  const appliedEdits = await prisma.nLEdit.count({
    where: { documentId: { in: documentIds }, status: 'applied' },
  });

  const rejectedEdits = await prisma.nLEdit.count({
    where: { documentId: { in: documentIds }, status: 'rejected' },
  });

  const pendingEdits = await prisma.nLEdit.count({
    where: { documentId: { in: documentIds }, status: 'preview' },
  });

  const totalBatchEdits = await prisma.batchNLEdit.count({
    where: { repositoryId },
  });

  // Get recent edits
  const recentEdits = await prisma.nLEdit.findMany({
    where: { documentId: { in: documentIds } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      document: {
        select: { path: true, title: true },
      },
    },
  });

  return c.json({
    success: true,
    data: {
      repositoryId,
      repositoryName: repository.name,
      stats: {
        totalEdits,
        appliedEdits,
        rejectedEdits,
        pendingEdits,
        totalBatchEdits,
        acceptanceRate: totalEdits > 0 ? (appliedEdits / totalEdits) * 100 : 0,
      },
      recentEdits: recentEdits.map(e => ({
        id: e.id,
        documentPath: e.document.path,
        instruction: e.instruction,
        status: e.status,
        confidence: e.confidence,
        createdAt: e.createdAt,
      })),
    },
  });
});

export { app as nlEditorRoutes };
