import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { NotFoundError, ValidationError, getAnthropicClient } from '@docsynth/utils';
import {
  getEditSessionParticipants,
  getEditSessionVersion,
  getEditSessionOperations,
  getActiveEditSessions,
  broadcastAISuggestion,
} from '../services/websocket.js';

const app = new Hono();

// ============================================================================
// Collaborative Session Management
// ============================================================================

// Get active edit session for a document
app.get('/documents/:documentId/session', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { repository: { select: { organizationId: true } } },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  const participants = getEditSessionParticipants(documentId);
  const version = getEditSessionVersion(documentId);

  return c.json({
    success: true,
    data: {
      documentId,
      active: participants.length > 0,
      version,
      participants: participants.map(p => ({
        userId: p.userId,
        color: p.color,
        cursor: p.cursor,
        lastActivity: p.lastActivity,
      })),
    },
  });
});

// Get operations since version (for sync)
app.get('/documents/:documentId/operations', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');
  const sinceVersion = c.req.query('since');

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { repository: { select: { organizationId: true } } },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  const operations = getEditSessionOperations(
    documentId,
    sinceVersion ? parseInt(sinceVersion, 10) : undefined
  );
  const currentVersion = getEditSessionVersion(documentId);

  return c.json({
    success: true,
    data: {
      documentId,
      currentVersion,
      operations,
    },
  });
});

// List all active collaborative sessions for an organization
app.get('/sessions', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const allSessions = getActiveEditSessions();

  // Filter to org's documents
  const documentIds = allSessions.map(s => s.documentId);
  
  const documents = await prisma.document.findMany({
    where: {
      id: { in: documentIds },
      repository: { organizationId: orgId },
    },
    select: {
      id: true,
      path: true,
      title: true,
      repository: { select: { name: true } },
    },
  });

  const docMap = new Map(documents.map(d => [d.id, d]));
  
  const sessions = allSessions
    .filter(s => docMap.has(s.documentId))
    .map(s => {
      const doc = docMap.get(s.documentId)!;
      return {
        documentId: s.documentId,
        documentPath: doc.path,
        documentTitle: doc.title,
        repositoryName: doc.repository.name,
        participantCount: s.participantCount,
        version: s.version,
        lastActivity: s.lastActivity,
      };
    });

  return c.json({
    success: true,
    data: {
      sessions,
      total: sessions.length,
    },
  });
});

// ============================================================================
// AI-Assisted Editing
// ============================================================================

// Get AI suggestion for improving selected text
app.post('/documents/:documentId/suggest', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    selectedText: string;
    context: string;
    position: { line: number; character: number };
    endPosition: { line: number; character: number };
    instruction?: string;
  }>();

  if (!body.selectedText || !body.position) {
    throw new ValidationError('selectedText and position are required');
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { repository: { select: { organizationId: true } } },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  // Generate improvement suggestion
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `Improve this documentation text. ${body.instruction || 'Make it clearer and more concise.'}

Selected text:
"${body.selectedText}"

Surrounding context:
${body.context}

Return ONLY the improved text, no explanations.`,
      },
    ],
  });

  const improvedText = response.content[0]?.type === 'text' 
    ? response.content[0].text 
    : body.selectedText;

  const suggestion = {
    id: `sug-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    text: improvedText,
    position: body.position,
    endPosition: body.endPosition,
    type: 'replace' as const,
    reason: body.instruction || 'Improved clarity and conciseness',
  };

  // Broadcast to other participants
  broadcastAISuggestion(documentId, suggestion);

  return c.json({
    success: true,
    data: suggestion,
  });
});

// Auto-complete documentation
app.post('/documents/:documentId/autocomplete', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    textBefore: string;
    textAfter: string;
    position: { line: number; character: number };
    triggerKind: 'manual' | 'automatic';
  }>();

  if (!body.textBefore || !body.position) {
    throw new ValidationError('textBefore and position are required');
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { repository: { select: { organizationId: true, name: true } } },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  // Generate auto-completion
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: `Complete this documentation text naturally. Return ONLY the completion text.

Text before cursor:
${body.textBefore.slice(-500)}

Text after cursor:
${body.textAfter.slice(0, 200)}

Document type: ${document.type}
Repository: ${document.repository.name}`,
      },
    ],
  });

  const completion = response.content[0]?.type === 'text' 
    ? response.content[0].text.trim()
    : '';

  return c.json({
    success: true,
    data: {
      completion,
      position: body.position,
    },
  });
});

// Generate section content
app.post('/documents/:documentId/generate-section', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    sectionHeading: string;
    existingContent: string;
    position: { line: number; character: number };
    codeContext?: string;
  }>();

  if (!body.sectionHeading || !body.position) {
    throw new ValidationError('sectionHeading and position are required');
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { repository: { select: { organizationId: true } } },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  // Generate section content
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `Generate content for this documentation section.

Section heading: ${body.sectionHeading}

Existing document context:
${body.existingContent.slice(0, 1000)}

${body.codeContext ? `Related code:\n${body.codeContext}` : ''}

Generate the section content in markdown format. Include:
- Clear explanation
- Code examples if relevant
- Keep it concise but complete

Return ONLY the section content, no heading.`,
      },
    ],
  });

  const content = response.content[0]?.type === 'text' 
    ? response.content[0].text.trim()
    : '';

  const suggestion = {
    id: `sug-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    text: `\n${content}\n`,
    position: body.position,
    type: 'insert' as const,
    reason: `Generated content for "${body.sectionHeading}"`,
  };

  // Broadcast to participants
  broadcastAISuggestion(documentId, suggestion);

  return c.json({
    success: true,
    data: suggestion,
  });
});

// ============================================================================
// Document Comments/Annotations
// ============================================================================

// Type assertion for new Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// Add a comment/annotation to a document
app.post('/documents/:documentId/comments', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const userId = c.get('userId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    content: string;
    lineStart: number;
    lineEnd?: number;
    selectedText?: string;
  }>();

  if (!body.content || body.lineStart === undefined) {
    throw new ValidationError('content and lineStart are required');
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { repository: { select: { organizationId: true } } },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  const comment = await db.documentComment.create({
    data: {
      documentId,
      userId,
      content: body.content,
      lineStart: body.lineStart,
      lineEnd: body.lineEnd ?? body.lineStart,
      selectedText: body.selectedText,
      resolved: false,
    },
  });

  return c.json({
    success: true,
    data: comment,
  }, 201);
});

// Get comments for a document
app.get('/documents/:documentId/comments', requireAuth, requireOrgAccess, async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');
  const includeResolved = c.req.query('includeResolved') === 'true';

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { repository: { select: { organizationId: true } } },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  const whereClause: Record<string, unknown> = { documentId };
  if (!includeResolved) {
    whereClause.resolved = false;
  }

  const comments = await db.documentComment.findMany({
    where: whereClause,
    orderBy: { lineStart: 'asc' },
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
    data: comments,
  });
});

// Resolve a comment
app.post('/comments/:commentId/resolve', requireAuth, async (c) => {
  const commentId = c.req.param('commentId');
  const userId = c.get('userId');

  const comment = await db.documentComment.findUnique({
    where: { id: commentId },
  });

  if (!comment) {
    throw new NotFoundError('Comment', commentId);
  }

  const updated = await db.documentComment.update({
    where: { id: commentId },
    data: {
      resolved: true,
      resolvedBy: userId,
      resolvedAt: new Date(),
    },
  });

  return c.json({
    success: true,
    data: updated,
  });
});

// Reply to a comment
app.post('/comments/:commentId/reply', requireAuth, async (c) => {
  const commentId = c.req.param('commentId');
  const userId = c.get('userId');
  const body = await c.req.json<{ content: string }>();

  if (!body.content) {
    throw new ValidationError('content is required');
  }

  const comment = await db.documentComment.findUnique({
    where: { id: commentId },
  });

  if (!comment) {
    throw new NotFoundError('Comment', commentId);
  }

  const reply = await db.commentReply.create({
    data: {
      commentId,
      userId,
      content: body.content,
    },
  });

  return c.json({
    success: true,
    data: reply,
  }, 201);
});

export { app as collaborativeRoutes };
