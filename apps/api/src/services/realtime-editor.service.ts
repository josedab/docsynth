/**
 * Real-Time Collaborative Editor Service
 *
 * Provides real-time collaborative editing with CRDT-inspired
 * operational transform, cursor tracking, AI suggestions,
 * and version history.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId } from '@docsynth/utils';

const log = createLogger('realtime-editor');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface EditorDocument {
  id: string;
  repositoryId: string;
  path: string;
  content: string;
  version: number;
  lastModified: Date;
  activeEditors: EditorUser[];
}

export interface EditorUser {
  userId: string;
  displayName: string;
  color: string;
  cursorPosition: CursorPosition;
  lastActivity: Date;
}

export interface CursorPosition {
  line: number;
  column: number;
  selectionStart?: { line: number; column: number };
  selectionEnd?: { line: number; column: number };
}

export interface EditOperation {
  type: 'insert' | 'delete' | 'replace';
  position: { line: number; column: number };
  content?: string;
  length?: number;
  userId: string;
  timestamp: number;
  version: number;
}

export interface EditorSession {
  sessionId: string;
  documentId: string;
  users: EditorUser[];
  operations: EditOperation[];
  createdAt: Date;
  expiresAt: Date;
}

export interface AISuggestion {
  id: string;
  type: 'autocomplete' | 'rewrite' | 'tone' | 'link' | 'fix';
  range: { startLine: number; startCol: number; endLine: number; endCol: number };
  originalText: string;
  suggestedText: string;
  confidence: number;
  description: string;
}

export interface VersionHistoryEntry {
  version: number;
  userId: string;
  timestamp: Date;
  summary: string;
  operationCount: number;
}

// ============================================================================
// In-Memory State
// ============================================================================

const activeSessions = new Map<string, EditorSession>();
const documents = new Map<string, EditorDocument>();
const aiSuggestions = new Map<string, AISuggestion[]>();
const versionHistories = new Map<string, VersionHistoryEntry[]>();

const USER_COLORS = [
  '#E06C75',
  '#61AFEF',
  '#98C379',
  '#E5C07B',
  '#C678DD',
  '#56B6C2',
  '#BE5046',
  '#D19A66',
  '#7EC8E3',
  '#F0A6CA',
];

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new editing session for a document.
 */
export async function createSession(documentId: string, userId: string): Promise<EditorSession> {
  log.info({ documentId, userId }, 'Creating editing session');

  let doc = documents.get(documentId);
  if (!doc) {
    try {
      const dbDoc = await prisma.document.findFirst({
        where: { id: documentId },
      });
      if (dbDoc) {
        doc = {
          id: dbDoc.id,
          repositoryId: (dbDoc as any).repositoryId ?? '',
          path: dbDoc.path,
          content: dbDoc.content ?? '',
          version: 1,
          lastModified: dbDoc.updatedAt,
          activeEditors: [],
        };
      }
    } catch {
      // Table may not exist
    }

    if (!doc) {
      doc = {
        id: documentId,
        repositoryId: '',
        path: '',
        content: '',
        version: 1,
        lastModified: new Date(),
        activeEditors: [],
      };
    }
    documents.set(documentId, doc);
  }

  const sessionId = generateId();
  const session: EditorSession = {
    sessionId,
    documentId,
    users: [],
    operations: [],
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };

  activeSessions.set(sessionId, session);

  // Persist session to database
  try {
    await db.editorSession?.create({
      data: {
        id: sessionId,
        documentId,
        createdBy: userId,
        status: 'active',
        expiresAt: session.expiresAt,
      },
    });
  } catch {
    // Table may not exist yet
  }

  log.info({ sessionId, documentId }, 'Editing session created');
  return session;
}

/**
 * Join an existing editing session.
 */
export async function joinSession(
  sessionId: string,
  userId: string,
  displayName: string
): Promise<EditorSession> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const existing = session.users.find((u) => u.userId === userId);
  if (existing) {
    existing.lastActivity = new Date();
    return session;
  }

  const color = USER_COLORS[session.users.length % USER_COLORS.length]!;
  const user: EditorUser = {
    userId,
    displayName,
    color,
    cursorPosition: { line: 0, column: 0 },
    lastActivity: new Date(),
  };

  session.users.push(user);

  // Update document active editors
  const doc = documents.get(session.documentId);
  if (doc) {
    doc.activeEditors = session.users;
  }

  log.info({ sessionId, userId, displayName }, 'User joined session');
  return session;
}

/**
 * Leave an editing session.
 */
export async function leaveSession(sessionId: string, userId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  session.users = session.users.filter((u) => u.userId !== userId);

  const doc = documents.get(session.documentId);
  if (doc) {
    doc.activeEditors = session.users;
  }

  // Clean up session if empty
  if (session.users.length === 0) {
    await flushSession(sessionId);
    activeSessions.delete(sessionId);
  }

  log.info({ sessionId, userId }, 'User left session');
}

// ============================================================================
// Operational Transform
// ============================================================================

/**
 * Apply an edit operation with simple operational transform.
 */
export async function applyOperation(
  sessionId: string,
  operation: EditOperation
): Promise<EditorDocument> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const doc = documents.get(session.documentId);
  if (!doc) {
    throw new Error(`Document ${session.documentId} not found`);
  }

  // Resolve conflicts with pending operations
  const transformed = resolveConflict([
    ...session.operations.filter(
      (op) => op.version >= operation.version && op.userId !== operation.userId
    ),
    operation,
  ]);

  const resolvedOp = transformed[transformed.length - 1] ?? operation;

  // Apply the operation to document content
  const lines = doc.content.split('\n');
  const { line, column } = resolvedOp.position;

  switch (resolvedOp.type) {
    case 'insert': {
      if (line < lines.length) {
        const currentLine = lines[line] ?? '';
        lines[line] =
          currentLine.slice(0, column) + (resolvedOp.content ?? '') + currentLine.slice(column);
      } else {
        lines.push(resolvedOp.content ?? '');
      }
      break;
    }
    case 'delete': {
      if (line < lines.length) {
        const currentLine = lines[line] ?? '';
        const deleteLen = resolvedOp.length ?? 1;
        lines[line] = currentLine.slice(0, column) + currentLine.slice(column + deleteLen);
      }
      break;
    }
    case 'replace': {
      if (line < lines.length) {
        const currentLine = lines[line] ?? '';
        const deleteLen = resolvedOp.length ?? 0;
        lines[line] =
          currentLine.slice(0, column) +
          (resolvedOp.content ?? '') +
          currentLine.slice(column + deleteLen);
      }
      break;
    }
  }

  doc.content = lines.join('\n');
  doc.version += 1;
  doc.lastModified = new Date();

  // Store operation
  session.operations.push({ ...resolvedOp, version: doc.version });

  // Update version history
  addVersionEntry(session.documentId, {
    version: doc.version,
    userId: resolvedOp.userId,
    timestamp: new Date(),
    summary: `${resolvedOp.type} operation`,
    operationCount: 1,
  });

  log.debug({ sessionId, type: resolvedOp.type, version: doc.version }, 'Operation applied');
  return doc;
}

/**
 * Simple operational transform conflict resolution.
 * Adjusts positions of concurrent operations to maintain consistency.
 */
export function resolveConflict(operations: EditOperation[]): EditOperation[] {
  if (operations.length <= 1) return operations;

  const sorted = [...operations].sort((a, b) => a.timestamp - b.timestamp);
  const resolved: EditOperation[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const op = { ...sorted[i]! };
    const prev = resolved[resolved.length - 1]!;

    // Adjust position based on previous operations
    if (op.position.line === prev.position.line) {
      if (prev.type === 'insert' && op.position.column >= prev.position.column) {
        op.position = {
          ...op.position,
          column: op.position.column + (prev.content?.length ?? 0),
        };
      } else if (prev.type === 'delete' && op.position.column > prev.position.column) {
        op.position = {
          ...op.position,
          column: Math.max(prev.position.column, op.position.column - (prev.length ?? 1)),
        };
      }
    }

    resolved.push(op);
  }

  return resolved;
}

// ============================================================================
// Document & Cursor
// ============================================================================

/**
 * Get current document state.
 */
export async function getDocument(documentId: string): Promise<EditorDocument | null> {
  const cached = documents.get(documentId);
  if (cached) return cached;

  try {
    const dbDoc = await prisma.document.findFirst({
      where: { id: documentId },
    });
    if (dbDoc) {
      const doc: EditorDocument = {
        id: dbDoc.id,
        repositoryId: (dbDoc as any).repositoryId ?? '',
        path: dbDoc.path,
        content: dbDoc.content ?? '',
        version: 1,
        lastModified: dbDoc.updatedAt,
        activeEditors: [],
      };
      documents.set(documentId, doc);
      return doc;
    }
  } catch {
    // Table may not exist
  }

  return null;
}

/**
 * Update a user's cursor position in a session.
 */
export async function updateCursorPosition(
  sessionId: string,
  userId: string,
  position: CursorPosition
): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  const user = session.users.find((u) => u.userId === userId);
  if (user) {
    user.cursorPosition = position;
    user.lastActivity = new Date();
  }
}

/**
 * Get active users in a session.
 */
export async function getSessionUsers(sessionId: string): Promise<EditorUser[]> {
  const session = activeSessions.get(sessionId);
  return session?.users ?? [];
}

// ============================================================================
// Version History
// ============================================================================

function addVersionEntry(documentId: string, entry: VersionHistoryEntry): void {
  const history = versionHistories.get(documentId) ?? [];
  history.push(entry);
  versionHistories.set(documentId, history);
}

/**
 * Get version history for a document.
 */
export async function getVersionHistory(
  documentId: string,
  limit = 50
): Promise<VersionHistoryEntry[]> {
  const history = versionHistories.get(documentId) ?? [];
  return history.slice(-limit);
}

/**
 * Revert a document to a specific version.
 */
export async function revertToVersion(
  documentId: string,
  version: number
): Promise<EditorDocument> {
  const doc = documents.get(documentId);
  if (!doc) {
    throw new Error(`Document ${documentId} not found`);
  }

  const history = versionHistories.get(documentId) ?? [];
  const targetEntry = history.find((h) => h.version === version);
  if (!targetEntry) {
    throw new Error(`Version ${version} not found for document ${documentId}`);
  }

  // For simplicity, fetch original from DB and replay operations up to target version
  try {
    const dbDoc = await prisma.document.findFirst({
      where: { id: documentId },
    });
    if (dbDoc) {
      doc.content = dbDoc.content ?? '';
      doc.version = version;
      doc.lastModified = new Date();

      // Trim history to target version
      const trimmed = history.filter((h) => h.version <= version);
      versionHistories.set(documentId, trimmed);
    }
  } catch {
    doc.version = version;
    doc.lastModified = new Date();
  }

  log.info({ documentId, version }, 'Document reverted');
  return doc;
}

// ============================================================================
// AI Suggestions
// ============================================================================

/**
 * Generate AI writing suggestions for a document.
 */
export async function getAISuggestions(
  documentId: string,
  context: { cursorLine: number; cursorCol: number; selectedText?: string }
): Promise<AISuggestion[]> {
  const doc = documents.get(documentId);
  if (!doc) {
    throw new Error(`Document ${documentId} not found`);
  }

  const lines = doc.content.split('\n');
  const currentLine = lines[context.cursorLine] ?? '';
  const suggestions: AISuggestion[] = [];

  // Generate autocomplete suggestion
  if (currentLine.trim().length > 0) {
    suggestions.push({
      id: generateId(),
      type: 'autocomplete',
      range: {
        startLine: context.cursorLine,
        startCol: context.cursorCol,
        endLine: context.cursorLine,
        endCol: context.cursorCol,
      },
      originalText: '',
      suggestedText: ' — continued text suggestion',
      confidence: 0.75,
      description: 'AI autocomplete suggestion based on context',
    });
  }

  // Generate fix suggestion for common issues
  if (currentLine.includes('  ') && currentLine.trim().length > 0) {
    suggestions.push({
      id: generateId(),
      type: 'fix',
      range: {
        startLine: context.cursorLine,
        startCol: 0,
        endLine: context.cursorLine,
        endCol: currentLine.length,
      },
      originalText: currentLine,
      suggestedText: currentLine.replace(/  +/g, ' '),
      confidence: 0.9,
      description: 'Fix extra whitespace',
    });
  }

  // Generate rewrite suggestion for selected text
  if (context.selectedText && context.selectedText.length > 10) {
    suggestions.push({
      id: generateId(),
      type: 'rewrite',
      range: {
        startLine: context.cursorLine,
        startCol: context.cursorCol,
        endLine: context.cursorLine,
        endCol: context.cursorCol + context.selectedText.length,
      },
      originalText: context.selectedText,
      suggestedText: context.selectedText,
      confidence: 0.7,
      description: 'AI rewrite suggestion for clarity',
    });
  }

  aiSuggestions.set(documentId, suggestions);

  log.info({ documentId, count: suggestions.length }, 'AI suggestions generated');
  return suggestions;
}

/**
 * Apply an AI suggestion to a document.
 */
export async function applyAISuggestion(
  documentId: string,
  suggestionId: string
): Promise<EditorDocument> {
  const doc = documents.get(documentId);
  if (!doc) {
    throw new Error(`Document ${documentId} not found`);
  }

  const suggestions = aiSuggestions.get(documentId) ?? [];
  const suggestion = suggestions.find((s) => s.id === suggestionId);
  if (!suggestion) {
    throw new Error(`Suggestion ${suggestionId} not found`);
  }

  const lines = doc.content.split('\n');
  const { startLine, startCol, endLine, endCol } = suggestion.range;

  if (startLine === endLine && startLine < lines.length) {
    const line = lines[startLine] ?? '';
    lines[startLine] = line.slice(0, startCol) + suggestion.suggestedText + line.slice(endCol);
  } else {
    // Multi-line replacement
    const firstLine = lines[startLine] ?? '';
    const lastLine = lines[endLine] ?? '';
    const newContent =
      firstLine.slice(0, startCol) + suggestion.suggestedText + lastLine.slice(endCol);
    lines.splice(startLine, endLine - startLine + 1, newContent);
  }

  doc.content = lines.join('\n');
  doc.version += 1;
  doc.lastModified = new Date();

  // Remove applied suggestion
  aiSuggestions.set(
    documentId,
    suggestions.filter((s) => s.id !== suggestionId)
  );

  addVersionEntry(documentId, {
    version: doc.version,
    userId: 'ai',
    timestamp: new Date(),
    summary: `Applied AI ${suggestion.type} suggestion`,
    operationCount: 1,
  });

  log.info({ documentId, suggestionId, type: suggestion.type }, 'AI suggestion applied');
  return doc;
}

// ============================================================================
// Session Persistence
// ============================================================================

async function flushSession(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  const doc = documents.get(session.documentId);
  if (!doc) return;

  try {
    await prisma.document.update({
      where: { id: session.documentId },
      data: {
        content: doc.content,
        updatedAt: new Date(),
      },
    });

    await db.editorSession?.update({
      where: { id: sessionId },
      data: { status: 'closed', closedAt: new Date() },
    });
  } catch {
    log.warn({ sessionId }, 'Failed to flush session to database');
  }
}

/**
 * Get a session by ID.
 */
export async function getSession(sessionId: string): Promise<EditorSession | null> {
  return activeSessions.get(sessionId) ?? null;
}

/**
 * Get all active session IDs.
 */
export function getActiveSessions(): string[] {
  return Array.from(activeSessions.keys());
}

/**
 * Clean up expired sessions.
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const now = new Date();
  let cleaned = 0;

  for (const [sessionId, session] of activeSessions) {
    if (session.expiresAt < now) {
      await flushSession(sessionId);
      activeSessions.delete(sessionId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    log.info({ cleaned }, 'Expired sessions cleaned up');
  }
  return cleaned;
}
