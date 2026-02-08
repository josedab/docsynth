/**
 * Real-Time Collaborative Editor Service
 *
 * Provides functionality for real-time collaborative document editing,
 * including CRDT-based operations, threaded comments, presence tracking,
 * AI writing suggestions, and approval workflows.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId, getAnthropicClient } from '@docsynth/utils';

const log = createLogger('collaborative-editor');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface EditingSession {
  id: string;
  documentId: string;
  documentContent: string;
  participants: string[];
  status: 'active' | 'closed';
  createdAt: Date;
  updatedAt: Date;
}

export interface CRDTOperation {
  type: 'insert' | 'delete' | 'format';
  position: number;
  content?: string;
  length?: number;
  format?: Record<string, unknown>;
  userId: string;
  timestamp: Date;
}

export interface SessionComment {
  id: string;
  sessionId: string;
  userId: string;
  content: string;
  position: number;
  parentId?: string;
  resolved: boolean;
  createdAt: Date;
}

export interface AISuggestion {
  type: 'expand' | 'rewrite' | 'simplify';
  original: string;
  suggestion: string;
  confidence: number;
}

export interface ParticipantPresence {
  userId: string;
  cursor: { line: number; column: number };
  lastActive: Date;
  color: string;
}

export interface ApprovalRecord {
  userId: string;
  status: 'approved' | 'request_changes';
  comment?: string;
  timestamp: Date;
}

// ============================================================================
// Constants
// ============================================================================

/** TTL for presence entries in milliseconds (2 minutes) */
const PRESENCE_TTL_MS = 2 * 60 * 1000;

/** Interval for flushing in-memory operations to the database (30 seconds) */
const FLUSH_INTERVAL_MS = 30 * 1000;

/** Predefined colors for participant cursors */
const CURSOR_COLORS = [
  '#E06C75', '#61AFEF', '#98C379', '#E5C07B', '#C678DD',
  '#56B6C2', '#BE5046', '#D19A66', '#7EC8E3', '#C3E88D',
];

// ============================================================================
// Service
// ============================================================================

class CollaborativeEditorService {
  /** Active sessions stored in memory for fast access */
  private activeSessions = new Map<string, EditingSession>();

  /** Presence data per session, keyed by sessionId -> userId -> presence */
  private presenceMap = new Map<string, Map<string, ParticipantPresence>>();

  /** Buffered CRDT operations per session, flushed periodically */
  private operationBuffers = new Map<string, CRDTOperation[]>();

  /** Handle for the periodic flush interval */
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  /** Handle for the presence cleanup interval */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startPeriodicFlush();
    this.startPresenceCleanup();
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Create a new collaborative editing session for a document
   */
  async createSession(documentId: string, userId: string): Promise<EditingSession> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, content: true },
    });

    if (!document) {
      throw new Error('Document not found');
    }

    const sessionId = generateId();
    const now = new Date();

    const session: EditingSession = {
      id: sessionId,
      documentId,
      documentContent: document.content || '',
      participants: [userId],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    // Persist session to database
    await db.collaborativeSession.create({
      data: {
        id: sessionId,
        documentId,
        documentContent: document.content || '',
        participants: [userId],
        status: 'active',
      },
    });

    // Store in memory for fast access
    this.activeSessions.set(sessionId, session);
    this.presenceMap.set(sessionId, new Map());
    this.operationBuffers.set(sessionId, []);

    // Initialize presence for the creator
    this.updatePresenceInternal(sessionId, userId, { line: 0, column: 0 });

    log.info({ sessionId, documentId, userId }, 'Collaborative editing session created');

    return session;
  }

  /**
   * Get an editing session by ID, including participants and document state
   */
  async getSession(sessionId: string): Promise<EditingSession | null> {
    // Check in-memory cache first
    const cached = this.activeSessions.get(sessionId);
    if (cached) {
      return cached;
    }

    // Fall back to database
    const record = await db.collaborativeSession.findUnique({
      where: { id: sessionId },
    });

    if (!record) {
      return null;
    }

    const session: EditingSession = {
      id: record.id,
      documentId: record.documentId,
      documentContent: record.documentContent,
      participants: record.participants as string[],
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };

    // Populate in-memory cache if session is still active
    if (session.status === 'active') {
      this.activeSessions.set(sessionId, session);
      if (!this.presenceMap.has(sessionId)) {
        this.presenceMap.set(sessionId, new Map());
      }
      if (!this.operationBuffers.has(sessionId)) {
        this.operationBuffers.set(sessionId, []);
      }
    }

    return session;
  }

  /**
   * List active sessions, optionally filtered by document ID
   */
  async listActiveSessions(documentId?: string): Promise<EditingSession[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { status: 'active' };
    if (documentId) {
      where.documentId = documentId;
    }

    const records = await db.collaborativeSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return records.map((r: {
      id: string;
      documentId: string;
      documentContent: string;
      participants: string[];
      status: string;
      createdAt: Date;
      updatedAt: Date;
    }) => ({
      id: r.id,
      documentId: r.documentId,
      documentContent: r.documentContent,
      participants: r.participants,
      status: r.status as 'active' | 'closed',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  // ==========================================================================
  // CRDT Operations
  // ==========================================================================

  /**
   * Apply CRDT operations (insert, delete, format) to a session.
   * Operations are buffered in memory and periodically flushed to the database.
   */
  async applyOperations(sessionId: string, operations: CRDTOperation[]): Promise<EditingSession> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'active') {
      throw new Error('Session is not active');
    }

    let content = session.documentContent;

    for (const op of operations) {
      switch (op.type) {
        case 'insert': {
          if (op.content == null) {
            throw new Error('Insert operation requires content');
          }
          const before = content.slice(0, op.position);
          const after = content.slice(op.position);
          content = before + op.content + after;
          break;
        }
        case 'delete': {
          if (op.length == null) {
            throw new Error('Delete operation requires length');
          }
          const before = content.slice(0, op.position);
          const after = content.slice(op.position + op.length);
          content = before + after;
          break;
        }
        case 'format': {
          // Format operations are metadata-only; they do not change plain text content
          // but are recorded for rich-text state tracking
          break;
        }
        default:
          log.warn({ type: (op as CRDTOperation).type }, 'Unknown operation type');
      }
    }

    // Update in-memory session
    session.documentContent = content;
    session.updatedAt = new Date();
    this.activeSessions.set(sessionId, session);

    // Ensure participant is tracked
    for (const op of operations) {
      if (!session.participants.includes(op.userId)) {
        session.participants.push(op.userId);
      }
    }

    // Buffer operations for periodic persistence
    const buffer = this.operationBuffers.get(sessionId) || [];
    buffer.push(...operations);
    this.operationBuffers.set(sessionId, buffer);

    log.debug(
      { sessionId, operationCount: operations.length },
      'Applied CRDT operations'
    );

    return session;
  }

  /**
   * Get paginated operation history for a session
   */
  async getOperationHistory(
    sessionId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<CRDTOperation[]> {
    const records = await db.collaborativeOperation.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' },
      skip: offset,
      take: limit,
    });

    return records.map((r: {
      type: string;
      position: number;
      content: string | null;
      length: number | null;
      format: Record<string, unknown> | null;
      userId: string;
      timestamp: Date;
    }) => ({
      type: r.type as 'insert' | 'delete' | 'format',
      position: r.position,
      content: r.content || undefined,
      length: r.length ?? undefined,
      format: r.format || undefined,
      userId: r.userId,
      timestamp: r.timestamp,
    }));
  }

  // ==========================================================================
  // Comments
  // ==========================================================================

  /**
   * Add a threaded comment to a session
   */
  async addComment(
    sessionId: string,
    params: { content: string; position: number; userId: string; parentId?: string }
  ): Promise<SessionComment> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const commentId = generateId();
    const now = new Date();

    await db.collaborativeComment.create({
      data: {
        id: commentId,
        sessionId,
        userId: params.userId,
        content: params.content,
        position: params.position,
        parentId: params.parentId || null,
        resolved: false,
      },
    });

    log.info({ sessionId, commentId, userId: params.userId }, 'Comment added to session');

    return {
      id: commentId,
      sessionId,
      userId: params.userId,
      content: params.content,
      position: params.position,
      parentId: params.parentId,
      resolved: false,
      createdAt: now,
    };
  }

  /**
   * Get all comments for a session
   */
  async getComments(sessionId: string): Promise<SessionComment[]> {
    const records = await db.collaborativeComment.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    return records.map((r: {
      id: string;
      sessionId: string;
      userId: string;
      content: string;
      position: number;
      parentId: string | null;
      resolved: boolean;
      createdAt: Date;
    }) => ({
      id: r.id,
      sessionId: r.sessionId,
      userId: r.userId,
      content: r.content,
      position: r.position,
      parentId: r.parentId || undefined,
      resolved: r.resolved,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Update a comment (resolve or edit content)
   */
  async updateComment(
    sessionId: string,
    commentId: string,
    updates: { content?: string; resolved?: boolean }
  ): Promise<SessionComment> {
    const existing = await db.collaborativeComment.findUnique({
      where: { id: commentId },
    });

    if (!existing || existing.sessionId !== sessionId) {
      throw new Error('Comment not found in this session');
    }

    const updated = await db.collaborativeComment.update({
      where: { id: commentId },
      data: {
        ...(updates.content !== undefined && { content: updates.content }),
        ...(updates.resolved !== undefined && { resolved: updates.resolved }),
      },
    });

    log.info({ sessionId, commentId, updates }, 'Comment updated');

    return {
      id: updated.id,
      sessionId: updated.sessionId,
      userId: updated.userId,
      content: updated.content,
      position: updated.position,
      parentId: updated.parentId || undefined,
      resolved: updated.resolved,
      createdAt: updated.createdAt,
    };
  }

  // ==========================================================================
  // AI Suggestions
  // ==========================================================================

  /**
   * Get an AI-powered writing suggestion for selected text
   */
  async getAISuggestion(
    sessionId: string,
    params: { type: 'expand' | 'rewrite' | 'simplify'; selectedText: string; context?: string }
  ): Promise<AISuggestion> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const anthropic = getAnthropicClient();
    if (!anthropic) {
      throw new Error('Anthropic client not available');
    }

    const prompts: Record<string, string> = {
      expand:
        'Expand the following text with more detail, examples, and explanations while preserving the original meaning and tone.',
      rewrite:
        'Rewrite the following text to improve clarity, flow, and readability while preserving the original meaning.',
      simplify:
        'Simplify the following text to make it more concise and easier to understand. Remove jargon and unnecessary complexity.',
    };

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: `You are a documentation writing assistant. ${prompts[params.type]}

Return ONLY the improved text, no explanations or markdown code blocks.`,
        messages: [
          {
            role: 'user',
            content: `${params.context ? `Context from the document:\n${params.context}\n\n` : ''}Text to ${params.type}:\n\n${params.selectedText}`,
          },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const suggestion = text.trim();

      // Calculate confidence based on the quality of the transformation
      const lengthRatio = suggestion.length / Math.max(params.selectedText.length, 1);
      let confidence = 0.85;

      if (params.type === 'expand' && lengthRatio < 1.2) confidence = 0.6;
      if (params.type === 'simplify' && lengthRatio > 0.95) confidence = 0.6;
      if (params.type === 'rewrite' && suggestion === params.selectedText) confidence = 0.4;

      log.info(
        { sessionId, type: params.type, confidence },
        'AI suggestion generated'
      );

      return {
        type: params.type,
        original: params.selectedText,
        suggestion,
        confidence,
      };
    } catch (error) {
      log.warn({ error, sessionId, type: params.type }, 'Failed to generate AI suggestion');
      return {
        type: params.type,
        original: params.selectedText,
        suggestion: params.selectedText,
        confidence: 0,
      };
    }
  }

  // ==========================================================================
  // Approvals
  // ==========================================================================

  /**
   * Submit an approval or change request for a session
   */
  async submitApproval(
    sessionId: string,
    userId: string,
    status: 'approved' | 'request_changes',
    comment?: string
  ): Promise<ApprovalRecord> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const now = new Date();

    await db.collaborativeApproval.upsert({
      where: {
        sessionId_userId: {
          sessionId,
          userId,
        },
      },
      update: {
        status,
        comment: comment || null,
        timestamp: now,
      },
      create: {
        id: generateId(),
        sessionId,
        userId,
        status,
        comment: comment || null,
        timestamp: now,
      },
    });

    log.info({ sessionId, userId, status }, 'Approval submitted');

    return {
      userId,
      status,
      comment,
      timestamp: now,
    };
  }

  // ==========================================================================
  // Presence
  // ==========================================================================

  /**
   * Get current participants with cursor positions for a session
   */
  async getPresence(sessionId: string): Promise<ParticipantPresence[]> {
    const sessionPresence = this.presenceMap.get(sessionId);
    if (!sessionPresence) {
      return [];
    }

    const now = Date.now();
    const result: ParticipantPresence[] = [];

    for (const [userId, presence] of sessionPresence) {
      // Only include participants whose presence has not expired
      if (now - presence.lastActive.getTime() <= PRESENCE_TTL_MS) {
        result.push(presence);
      } else {
        sessionPresence.delete(userId);
      }
    }

    return result;
  }

  /**
   * Update a user's cursor position within a session
   */
  async updatePresence(
    sessionId: string,
    userId: string,
    cursor: { line: number; column: number }
  ): Promise<ParticipantPresence> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return this.updatePresenceInternal(sessionId, userId, cursor);
  }

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  /**
   * Update presence without session validation (used during session creation)
   */
  private updatePresenceInternal(
    sessionId: string,
    userId: string,
    cursor: { line: number; column: number }
  ): ParticipantPresence {
    if (!this.presenceMap.has(sessionId)) {
      this.presenceMap.set(sessionId, new Map());
    }

    const sessionPresence = this.presenceMap.get(sessionId)!;
    const existing = sessionPresence.get(userId);

    const presence: ParticipantPresence = {
      userId,
      cursor,
      lastActive: new Date(),
      color: existing?.color || this.assignColor(sessionPresence.size),
    };

    sessionPresence.set(userId, presence);

    return presence;
  }

  /**
   * Assign a cursor color based on participant index
   */
  private assignColor(participantIndex: number): string {
    return CURSOR_COLORS[participantIndex % CURSOR_COLORS.length] || CURSOR_COLORS[0]!;
  }

  /**
   * Periodically flush buffered operations to the database
   */
  private startPeriodicFlush(): void {
    this.flushInterval = setInterval(async () => {
      await this.flushAllBuffers();
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Flush all in-memory operation buffers to the database
   */
  private async flushAllBuffers(): Promise<void> {
    for (const [sessionId, operations] of this.operationBuffers) {
      if (operations.length === 0) continue;

      try {
        // Persist operations
        for (const op of operations) {
          await db.collaborativeOperation.create({
            data: {
              id: generateId(),
              sessionId,
              type: op.type,
              position: op.position,
              content: op.content || null,
              length: op.length ?? null,
              format: op.format || null,
              userId: op.userId,
              timestamp: op.timestamp,
            },
          });
        }

        // Update session document content in the database
        const session = this.activeSessions.get(sessionId);
        if (session) {
          await db.collaborativeSession.update({
            where: { id: sessionId },
            data: {
              documentContent: session.documentContent,
              participants: session.participants,
              updatedAt: session.updatedAt,
            },
          });
        }

        // Clear the buffer
        this.operationBuffers.set(sessionId, []);

        log.debug(
          { sessionId, flushedCount: operations.length },
          'Flushed operation buffer to database'
        );
      } catch (error) {
        log.error(
          { error, sessionId, operationCount: operations.length },
          'Failed to flush operation buffer'
        );
      }
    }
  }

  /**
   * Periodically clean up stale presence entries and inactive sessions from memory
   */
  private startPresenceCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();

      for (const [sessionId, sessionPresence] of this.presenceMap) {
        for (const [userId, presence] of sessionPresence) {
          if (now - presence.lastActive.getTime() > PRESENCE_TTL_MS) {
            sessionPresence.delete(userId);
          }
        }

        // If no active participants remain, remove the session from memory
        if (sessionPresence.size === 0) {
          this.presenceMap.delete(sessionId);
          this.activeSessions.delete(sessionId);
          this.operationBuffers.delete(sessionId);
        }
      }
    }, PRESENCE_TTL_MS);
  }

  /**
   * Gracefully shut down background intervals and flush remaining buffers
   */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Final flush of any remaining buffered operations
    await this.flushAllBuffers();

    log.info('Collaborative editor service shut down');
  }
}

export const collaborativeEditorService = new CollaborativeEditorService();
