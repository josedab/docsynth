/**
 * Real-Time Collaborative Document Editor Routes
 *
 * API endpoints for managing collaborative editing sessions with
 * CRDT operations, threaded comments, AI suggestions, and approval workflows.
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { createLogger, ValidationError, NotFoundError } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';

const log = createLogger('collaborative-editor-routes');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new collaborative editing session
 * POST /sessions
 */
app.post('/sessions', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    documentId: string;
    userId: string;
  }>();

  if (!body.documentId || !body.userId) {
    throw new ValidationError('documentId and userId are required');
  }

  // Verify the document exists
  const document = await prisma.document.findUnique({
    where: { id: body.documentId },
    include: { repository: { select: { organizationId: true, name: true } } },
  });

  if (!document) {
    throw new NotFoundError('Document', body.documentId);
  }

  // Check if an active session already exists for this document
  const existingSession = await db.collaborativeEditSession.findFirst({
    where: {
      documentId: body.documentId,
      status: 'active',
    },
  });

  if (existingSession) {
    // Add participant to existing session
    await db.sessionParticipant.upsert({
      where: {
        sessionId_userId: {
          sessionId: existingSession.id,
          userId: body.userId,
        },
      },
      create: {
        sessionId: existingSession.id,
        userId: body.userId,
        joinedAt: new Date(),
        cursorPosition: null,
      },
      update: {
        joinedAt: new Date(),
        leftAt: null,
      },
    });

    log.info({ sessionId: existingSession.id, userId: body.userId }, 'User joined existing editing session');

    return c.json({
      success: true,
      data: {
        sessionId: existingSession.id,
        documentId: body.documentId,
        created: false,
        message: 'Joined existing session',
      },
    }, 200);
  }

  // Create new session
  const session = await db.collaborativeEditSession.create({
    data: {
      documentId: body.documentId,
      createdBy: body.userId,
      status: 'active',
      documentState: document.content || '',
      version: 1,
      participants: {
        create: {
          userId: body.userId,
          joinedAt: new Date(),
          cursorPosition: null,
        },
      },
    },
  });

  log.info({ sessionId: session.id, documentId: body.documentId, userId: body.userId }, 'Collaborative editing session created');

  return c.json({
    success: true,
    data: {
      sessionId: session.id,
      documentId: body.documentId,
      created: true,
      version: session.version,
    },
  }, 201);
});

/**
 * Get a specific editing session with document state and participants
 * GET /sessions/:sessionId
 */
app.get('/sessions/:sessionId', requireAuth, requireOrgAccess, async (c) => {
  const sessionId = c.req.param('sessionId');

  const session = await db.collaborativeEditSession.findUnique({
    where: { id: sessionId },
    include: {
      participants: {
        where: { leftAt: null },
        include: {
          user: {
            select: { id: true, githubUsername: true, avatarUrl: true },
          },
        },
      },
    },
  });

  if (!session) {
    throw new NotFoundError('Session', sessionId);
  }

  return c.json({
    success: true,
    data: {
      id: session.id,
      documentId: session.documentId,
      status: session.status,
      documentState: session.documentState,
      version: session.version,
      participants: session.participants,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
  });
});

/**
 * List active editing sessions
 * GET /sessions
 */
app.get('/sessions', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.query('documentId');

  const whereClause: Record<string, unknown> = { status: 'active' };
  if (documentId) {
    whereClause.documentId = documentId;
  }

  const sessions = await db.collaborativeEditSession.findMany({
    where: whereClause,
    include: {
      participants: {
        where: { leftAt: null },
        select: { userId: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return c.json({
    success: true,
    data: {
      sessions: sessions.map((s: Record<string, unknown>) => ({
        id: s.id,
        documentId: s.documentId,
        status: s.status,
        version: s.version,
        participantCount: (s.participants as unknown[]).length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      total: sessions.length,
    },
  });
});

// ============================================================================
// CRDT Operations
// ============================================================================

/**
 * Submit CRDT operations to a session
 * POST /sessions/:sessionId/operations
 */
app.post('/sessions/:sessionId/operations', requireAuth, requireOrgAccess, async (c) => {
  const sessionId = c.req.param('sessionId');
  const userId = c.get('userId');
  const body = await c.req.json<{
    ops: Array<{
      type: 'insert' | 'delete' | 'format';
      position: number;
      content?: string;
      length?: number;
      attributes?: Record<string, unknown>;
    }>;
  }>();

  if (!body.ops || !Array.isArray(body.ops) || body.ops.length === 0) {
    throw new ValidationError('ops array is required and must not be empty');
  }

  // Validate each operation
  for (const op of body.ops) {
    if (!['insert', 'delete', 'format'].includes(op.type)) {
      throw new ValidationError('Each operation must have type: insert, delete, or format');
    }
    if (op.position === undefined || op.position < 0) {
      throw new ValidationError('Each operation must have a valid position');
    }
    if (op.type === 'insert' && !op.content) {
      throw new ValidationError('Insert operations must include content');
    }
    if (op.type === 'delete' && (!op.length || op.length < 1)) {
      throw new ValidationError('Delete operations must include a positive length');
    }
  }

  const session = await db.collaborativeEditSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError('Session', sessionId);
  }

  if (session.status !== 'active') {
    return c.json(
      { success: false, error: 'Session is not active' },
      400
    );
  }

  // Store operations and increment version
  const operations = await db.sessionOperation.createMany({
    data: body.ops.map((op, index) => ({
      sessionId,
      userId,
      type: op.type,
      position: op.position,
      content: op.content ?? null,
      length: op.length ?? null,
      attributes: op.attributes ?? null,
      version: session.version + index + 1,
      appliedAt: new Date(),
    })),
  });

  // Update session version
  const updatedSession = await db.collaborativeEditSession.update({
    where: { id: sessionId },
    data: {
      version: session.version + body.ops.length,
      updatedAt: new Date(),
    },
  });

  log.info({ sessionId, userId, opCount: body.ops.length, newVersion: updatedSession.version }, 'CRDT operations applied');

  return c.json({
    success: true,
    data: {
      applied: operations.count,
      version: updatedSession.version,
    },
  });
});

/**
 * Get operation history for a session with pagination
 * GET /sessions/:sessionId/history
 */
app.get('/sessions/:sessionId/history', requireAuth, requireOrgAccess, async (c) => {
  const sessionId = c.req.param('sessionId');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const sinceVersion = c.req.query('sinceVersion');

  const session = await db.collaborativeEditSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError('Session', sessionId);
  }

  const whereClause: Record<string, unknown> = { sessionId };
  if (sinceVersion) {
    whereClause.version = { gt: parseInt(sinceVersion, 10) };
  }

  const [operations, total] = await Promise.all([
    db.sessionOperation.findMany({
      where: whereClause,
      orderBy: { version: 'asc' },
      skip: offset,
      take: limit,
      include: {
        user: {
          select: { id: true, githubUsername: true, avatarUrl: true },
        },
      },
    }),
    db.sessionOperation.count({ where: whereClause }),
  ]);

  return c.json({
    success: true,
    data: {
      operations,
      total,
      limit,
      offset,
      currentVersion: session.version,
    },
  });
});

// ============================================================================
// Threaded Comments
// ============================================================================

/**
 * Add a threaded comment to a session
 * POST /sessions/:sessionId/comments
 */
app.post('/sessions/:sessionId/comments', requireAuth, requireOrgAccess, async (c) => {
  const sessionId = c.req.param('sessionId');
  const userId = c.get('userId');
  const body = await c.req.json<{
    content: string;
    position: number;
    parentId?: string;
  }>();

  if (!body.content) {
    throw new ValidationError('content is required');
  }

  if (body.position === undefined || body.position < 0) {
    throw new ValidationError('A valid position is required');
  }

  const session = await db.collaborativeEditSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError('Session', sessionId);
  }

  // If parentId is provided, verify the parent comment exists
  if (body.parentId) {
    const parentComment = await db.sessionComment.findUnique({
      where: { id: body.parentId },
    });
    if (!parentComment) {
      throw new NotFoundError('Parent comment', body.parentId);
    }
  }

  const comment = await db.sessionComment.create({
    data: {
      sessionId,
      userId,
      content: body.content,
      position: body.position,
      parentId: body.parentId ?? null,
      resolved: false,
    },
    include: {
      user: {
        select: { id: true, githubUsername: true, avatarUrl: true },
      },
    },
  });

  log.info({ sessionId, commentId: comment.id, userId, hasParent: !!body.parentId }, 'Comment added to session');

  return c.json({
    success: true,
    data: comment,
  }, 201);
});

/**
 * List all comments for a session
 * GET /sessions/:sessionId/comments
 */
app.get('/sessions/:sessionId/comments', requireAuth, requireOrgAccess, async (c) => {
  const sessionId = c.req.param('sessionId');
  const includeResolved = c.req.query('includeResolved') === 'true';

  const session = await db.collaborativeEditSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError('Session', sessionId);
  }

  const whereClause: Record<string, unknown> = {
    sessionId,
    parentId: null, // Only top-level comments
  };
  if (!includeResolved) {
    whereClause.resolved = false;
  }

  const comments = await db.sessionComment.findMany({
    where: whereClause,
    orderBy: { position: 'asc' },
    include: {
      user: {
        select: { id: true, githubUsername: true, avatarUrl: true },
      },
      replies: {
        orderBy: { createdAt: 'asc' },
        include: {
          user: {
            select: { id: true, githubUsername: true, avatarUrl: true },
          },
        },
      },
    },
  });

  return c.json({
    success: true,
    data: {
      comments,
      total: comments.length,
    },
  });
});

/**
 * Update a comment (resolve or edit content)
 * PUT /sessions/:sessionId/comments/:commentId
 */
app.put('/sessions/:sessionId/comments/:commentId', requireAuth, requireOrgAccess, async (c) => {
  const sessionId = c.req.param('sessionId');
  const commentId = c.req.param('commentId');
  const userId = c.get('userId');
  const body = await c.req.json<{
    resolved?: boolean;
    content?: string;
  }>();

  if (body.resolved === undefined && !body.content) {
    throw new ValidationError('At least one of resolved or content must be provided');
  }

  const comment = await db.sessionComment.findFirst({
    where: { id: commentId, sessionId },
  });

  if (!comment) {
    throw new NotFoundError('Comment', commentId);
  }

  const updateData: Record<string, unknown> = {};
  if (body.content !== undefined) {
    updateData.content = body.content;
  }
  if (body.resolved !== undefined) {
    updateData.resolved = body.resolved;
    updateData.resolvedBy = body.resolved ? userId : null;
    updateData.resolvedAt = body.resolved ? new Date() : null;
  }

  const updated = await db.sessionComment.update({
    where: { id: commentId },
    data: updateData,
    include: {
      user: {
        select: { id: true, githubUsername: true, avatarUrl: true },
      },
    },
  });

  log.info({ sessionId, commentId, resolved: body.resolved, edited: !!body.content }, 'Comment updated');

  return c.json({
    success: true,
    data: updated,
  });
});

// ============================================================================
// AI Suggestions
// ============================================================================

/**
 * Get an AI suggestion for a position in the document
 * POST /sessions/:sessionId/suggest
 */
app.post('/sessions/:sessionId/suggest', requireAuth, requireOrgAccess, async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json<{
    position: number;
    context: string;
    type: 'expand' | 'rewrite' | 'simplify';
  }>();

  if (body.position === undefined || body.position < 0) {
    throw new ValidationError('A valid position is required');
  }

  if (!body.context) {
    throw new ValidationError('context is required');
  }

  if (!body.type || !['expand', 'rewrite', 'simplify'].includes(body.type)) {
    throw new ValidationError('type must be one of: expand, rewrite, simplify');
  }

  const session = await db.collaborativeEditSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError('Session', sessionId);
  }

  if (session.status !== 'active') {
    return c.json(
      { success: false, error: 'Session is not active' },
      400
    );
  }

  // Build prompt based on suggestion type
  const typePrompts: Record<string, string> = {
    expand: 'Expand the following text with more detail, examples, and context while maintaining the same tone.',
    rewrite: 'Rewrite the following text to improve clarity, conciseness, and readability.',
    simplify: 'Simplify the following text to make it easier to understand for a broader audience.',
  };

  const suggestion = {
    id: `sug-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    sessionId,
    position: body.position,
    type: body.type,
    prompt: typePrompts[body.type],
    context: body.context,
    suggestedText: `[AI ${body.type} suggestion for the selected text would be generated here]`,
    status: 'pending',
    createdAt: new Date(),
  };

  // Store the suggestion
  await db.sessionSuggestion.create({
    data: {
      id: suggestion.id,
      sessionId,
      position: body.position,
      type: body.type,
      context: body.context,
      suggestedText: suggestion.suggestedText,
      status: 'pending',
    },
  });

  log.info({ sessionId, suggestionId: suggestion.id, type: body.type }, 'AI suggestion generated');

  return c.json({
    success: true,
    data: suggestion,
  });
});

// ============================================================================
// Approval Workflow
// ============================================================================

/**
 * Submit an approval for a session
 * POST /sessions/:sessionId/approve
 */
app.post('/sessions/:sessionId/approve', requireAuth, requireOrgAccess, async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json<{
    userId: string;
    status: 'approved' | 'request_changes';
    comment?: string;
  }>();

  if (!body.userId) {
    throw new ValidationError('userId is required');
  }

  if (!body.status || !['approved', 'request_changes'].includes(body.status)) {
    throw new ValidationError('status must be one of: approved, request_changes');
  }

  const session = await db.collaborativeEditSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError('Session', sessionId);
  }

  const approval = await db.sessionApproval.upsert({
    where: {
      sessionId_userId: {
        sessionId,
        userId: body.userId,
      },
    },
    create: {
      sessionId,
      userId: body.userId,
      status: body.status,
      comment: body.comment ?? null,
      submittedAt: new Date(),
    },
    update: {
      status: body.status,
      comment: body.comment ?? null,
      submittedAt: new Date(),
    },
  });

  log.info({ sessionId, userId: body.userId, status: body.status }, 'Session approval submitted');

  return c.json({
    success: true,
    data: approval,
  });
});

// ============================================================================
// Presence
// ============================================================================

/**
 * Get current participants with cursor positions
 * GET /sessions/:sessionId/presence
 */
app.get('/sessions/:sessionId/presence', requireAuth, requireOrgAccess, async (c) => {
  const sessionId = c.req.param('sessionId');

  const session = await db.collaborativeEditSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError('Session', sessionId);
  }

  const participants = await db.sessionParticipant.findMany({
    where: {
      sessionId,
      leftAt: null,
    },
    include: {
      user: {
        select: { id: true, githubUsername: true, avatarUrl: true },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  // Assign deterministic colors based on join order
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];

  return c.json({
    success: true,
    data: {
      sessionId,
      participants: participants.map((p: Record<string, unknown>, index: number) => ({
        user: p.user,
        cursorPosition: p.cursorPosition,
        color: colors[index % colors.length],
        joinedAt: p.joinedAt,
        lastActivity: p.updatedAt,
      })),
      total: participants.length,
    },
  });
});

export { app as collaborativeEditorRoutes };
