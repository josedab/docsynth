import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { createLogger } from '@docsynth/utils';
import * as jose from 'jose';
import type { ChatMessage, ChatSource } from '@docsynth/types';

const log = createLogger('websocket');

interface Client {
  ws: WebSocket;
  userId: string;
  organizationId: string;
  subscriptions: Set<string>;
  chatSessions: Set<string>;
  editSessions: Set<string>; // Track active collaborative edit sessions
  cursorPosition?: { line: number; character: number };
}

// Collaborative editing state
interface EditSession {
  documentId: string;
  participants: Map<string, {
    userId: string;
    color: string;
    cursor?: { line: number; character: number };
    selection?: { start: { line: number; character: number }; end: { line: number; character: number } };
    lastActivity: Date;
  }>;
  operations: EditOperation[];
  version: number;
}

interface EditOperation {
  id: string;
  userId: string;
  type: 'insert' | 'delete' | 'replace';
  position: { line: number; character: number };
  text?: string;
  length?: number;
  timestamp: Date;
  version: number;
}

const clients = new Map<WebSocket, Client>();
const editSessions = new Map<string, EditSession>();

// User colors for collaborative editing
const userColors = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6',
];

let wss: WebSocketServer | null = null;

export function initializeWebSocket(server: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    log.info('New WebSocket connection');

    // Extract token from query string
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      log.warn('WebSocket connection without token');
      ws.close(4001, 'Authentication required');
      return;
    }

    try {
      // Verify token
      const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret');
      const { payload } = await jose.jwtVerify(token, secret);

      const client: Client = {
        ws,
        userId: payload.sub as string,
        organizationId: payload.organizationId as string,
        subscriptions: new Set(),
        chatSessions: new Set(),
        editSessions: new Set(),
      };

      clients.set(ws, client);

      log.info({ userId: client.userId }, 'WebSocket client authenticated');

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        data: { userId: client.userId },
      }));

      // Handle messages
      ws.on('message', (message) => {
        handleMessage(ws, client, message.toString());
      });

      ws.on('close', () => {
        // Clean up edit sessions
        for (const sessionId of client.editSessions) {
          handleEditLeave(client, { documentId: sessionId });
        }
        clients.delete(ws);
        log.info({ userId: client.userId }, 'WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        log.error({ error, userId: client.userId }, 'WebSocket error');
        clients.delete(ws);
      });
    } catch (error) {
      log.warn({ error }, 'Invalid WebSocket token');
      ws.close(4001, 'Invalid token');
    }
  });

  log.info('WebSocket server initialized');
  return wss;
}

function handleMessage(ws: WebSocket, client: Client, message: string): void {
  try {
    const data = JSON.parse(message);

    switch (data.type) {
      case 'subscribe':
        handleSubscribe(client, data);
        break;

      case 'unsubscribe':
        handleUnsubscribe(client, data);
        break;

      case 'chat:join':
        handleChatJoin(client, data);
        break;

      case 'chat:leave':
        handleChatLeave(client, data);
        break;

      case 'chat:typing':
        handleChatTyping(client, data);
        break;

      // Collaborative editing handlers
      case 'edit:join':
        handleEditJoin(client, data);
        break;

      case 'edit:leave':
        handleEditLeave(client, data);
        break;

      case 'edit:cursor':
        handleEditCursor(client, data);
        break;

      case 'edit:selection':
        handleEditSelection(client, data);
        break;

      case 'edit:operation':
        handleEditOperation(client, data);
        break;

      case 'edit:suggestion':
        handleEditSuggestion(client, data);
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      default:
        log.debug({ type: data.type }, 'Unknown message type');
    }
  } catch (error) {
    log.error({ error, message }, 'Failed to parse WebSocket message');
  }
}

function handleSubscribe(client: Client, data: { channel: string }): void {
  const { channel } = data;

  // Validate channel access
  if (channel.startsWith('job:')) {
    client.subscriptions.add(channel);
    log.debug({ userId: client.userId, channel }, 'Client subscribed');
    client.ws.send(JSON.stringify({
      type: 'subscribed',
      data: { channel },
    }));
  } else if (channel.startsWith('org:')) {
    const orgId = channel.split(':')[1];
    if (orgId === client.organizationId) {
      client.subscriptions.add(channel);
      log.debug({ userId: client.userId, channel }, 'Client subscribed');
      client.ws.send(JSON.stringify({
        type: 'subscribed',
        data: { channel },
      }));
    }
  }
}

function handleUnsubscribe(client: Client, data: { channel: string }): void {
  const { channel } = data;
  client.subscriptions.delete(channel);
  log.debug({ userId: client.userId, channel }, 'Client unsubscribed');
}

// ============================================================================
// Chat WebSocket Handlers
// ============================================================================

function handleChatJoin(client: Client, data: { sessionId: string }): void {
  const { sessionId } = data;
  if (!sessionId) return;

  client.chatSessions.add(sessionId);
  log.debug({ userId: client.userId, sessionId }, 'Client joined chat session');
  
  client.ws.send(JSON.stringify({
    type: 'chat:joined',
    data: { sessionId },
  }));
}

function handleChatLeave(client: Client, data: { sessionId: string }): void {
  const { sessionId } = data;
  if (!sessionId) return;

  client.chatSessions.delete(sessionId);
  log.debug({ userId: client.userId, sessionId }, 'Client left chat session');
}

function handleChatTyping(client: Client, data: { sessionId: string; isTyping: boolean }): void {
  const { sessionId, isTyping } = data;
  if (!sessionId) return;

  // Broadcast typing indicator to other clients in the same session
  const message = JSON.stringify({
    type: 'chat:typing',
    data: { sessionId, userId: client.userId, isTyping },
  });

  for (const [, otherClient] of clients) {
    if (otherClient.chatSessions.has(sessionId) && otherClient.userId !== client.userId) {
      if (otherClient.ws.readyState === WebSocket.OPEN) {
        otherClient.ws.send(message);
      }
    }
  }
}

// ============================================================================
// Chat Streaming Functions (for AI response streaming)
// ============================================================================

export interface ChatStreamingClient {
  sessionId: string;
  userId: string;
  messageId: string;
}

// Start streaming a chat response
export function startChatStream(sessionId: string, messageId: string): void {
  const message = JSON.stringify({
    type: 'chat:stream:start',
    data: { sessionId, messageId },
  });

  for (const [, client] of clients) {
    if (client.chatSessions.has(sessionId)) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
}

// Stream a chunk of the chat response
export function streamChatChunk(sessionId: string, messageId: string, chunk: string): void {
  const message = JSON.stringify({
    type: 'chat:stream:chunk',
    data: { sessionId, messageId, chunk },
  });

  for (const [, client] of clients) {
    if (client.chatSessions.has(sessionId)) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
}

// End streaming a chat response
export function endChatStream(
  sessionId: string,
  messageId: string,
  fullMessage: ChatMessage,
  sources: ChatSource[]
): void {
  const message = JSON.stringify({
    type: 'chat:stream:end',
    data: { sessionId, messageId, message: fullMessage, sources },
  });

  for (const [, client] of clients) {
    if (client.chatSessions.has(sessionId)) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
}

// Send error during streaming
export function streamChatError(sessionId: string, messageId: string, error: string): void {
  const message = JSON.stringify({
    type: 'chat:stream:error',
    data: { sessionId, messageId, error },
  });

  for (const [, client] of clients) {
    if (client.chatSessions.has(sessionId)) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
}

// Get clients subscribed to a chat session
export function getChatSessionClients(sessionId: string): number {
  let count = 0;
  for (const [, client] of clients) {
    if (client.chatSessions.has(sessionId)) {
      count++;
    }
  }
  return count;
}

// Broadcast to specific channel
export function broadcast(channel: string, event: string, data: unknown): void {
  const message = JSON.stringify({ type: event, channel, data });

  for (const [, client] of clients) {
    if (client.subscriptions.has(channel)) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
}

// Broadcast to organization
export function broadcastToOrg(organizationId: string, event: string, data: unknown): void {
  const message = JSON.stringify({ type: event, data });

  for (const [, client] of clients) {
    if (client.organizationId === organizationId) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
}

// Job-specific broadcasts
export function emitJobUpdate(jobId: string, status: string, progress: number, data?: Record<string, unknown>): void {
  broadcast(`job:${jobId}`, 'job:update', {
    jobId,
    status,
    progress,
    ...(data ?? {}),
  });
}

export function emitJobCompleted(jobId: string, result: unknown): void {
  broadcast(`job:${jobId}`, 'job:completed', {
    jobId,
    result,
  });
}

export function emitJobFailed(jobId: string, error: string): void {
  broadcast(`job:${jobId}`, 'job:failed', {
    jobId,
    error,
  });
}

export function getConnectedClients(): number {
  return clients.size;
}

export function closeWebSocket(): void {
  if (wss) {
    for (const [ws] of clients) {
      ws.close();
    }
    wss.close();
    wss = null;
    log.info('WebSocket server closed');
  }
}

// ============================================================================
// Collaborative Editing Handlers (Feature 4)
// ============================================================================

function handleEditJoin(client: Client, data: { documentId: string }): void {
  const { documentId } = data;
  if (!documentId) return;

  // Get or create edit session
  let session = editSessions.get(documentId);
  if (!session) {
    session = {
      documentId,
      participants: new Map(),
      operations: [],
      version: 0,
    };
    editSessions.set(documentId, session);
  }

  // Assign a color to the user
  const colorIndex = session.participants.size % userColors.length;
  const color = userColors[colorIndex] ?? '#000000';

  // Add participant
  session.participants.set(client.userId, {
    userId: client.userId,
    color,
    lastActivity: new Date(),
  });

  client.editSessions.add(documentId);

  // Notify client they joined
  client.ws.send(JSON.stringify({
    type: 'edit:joined',
    data: {
      documentId,
      color,
      version: session.version,
      participants: Array.from(session.participants.values()).map(p => ({
        userId: p.userId,
        color: p.color,
        cursor: p.cursor,
      })),
    },
  }));

  // Notify other participants
  broadcastToEditSession(documentId, 'edit:participant:joined', {
    userId: client.userId,
    color,
  }, client.userId);

  log.debug({ userId: client.userId, documentId }, 'User joined edit session');
}

function handleEditLeave(client: Client, data: { documentId: string }): void {
  const { documentId } = data;
  if (!documentId) return;

  const session = editSessions.get(documentId);
  if (session) {
    session.participants.delete(client.userId);

    // Notify other participants
    broadcastToEditSession(documentId, 'edit:participant:left', {
      userId: client.userId,
    });

    // Clean up empty sessions
    if (session.participants.size === 0) {
      editSessions.delete(documentId);
    }
  }

  client.editSessions.delete(documentId);
  log.debug({ userId: client.userId, documentId }, 'User left edit session');
}

function handleEditCursor(client: Client, data: { documentId: string; cursor: { line: number; character: number } }): void {
  const { documentId, cursor } = data;
  if (!documentId || !cursor) return;

  const session = editSessions.get(documentId);
  if (!session) return;

  const participant = session.participants.get(client.userId);
  if (participant) {
    participant.cursor = cursor;
    participant.lastActivity = new Date();
  }

  // Broadcast cursor update
  broadcastToEditSession(documentId, 'edit:cursor:update', {
    userId: client.userId,
    cursor,
  }, client.userId);
}

function handleEditSelection(client: Client, data: { 
  documentId: string; 
  selection: { start: { line: number; character: number }; end: { line: number; character: number } } | null;
}): void {
  const { documentId, selection } = data;
  if (!documentId) return;

  const session = editSessions.get(documentId);
  if (!session) return;

  const participant = session.participants.get(client.userId);
  if (participant) {
    participant.selection = selection ?? undefined;
    participant.lastActivity = new Date();
  }

  // Broadcast selection update
  broadcastToEditSession(documentId, 'edit:selection:update', {
    userId: client.userId,
    selection,
  }, client.userId);
}

function handleEditOperation(client: Client, data: {
  documentId: string;
  operation: {
    type: 'insert' | 'delete' | 'replace';
    position: { line: number; character: number };
    text?: string;
    length?: number;
  };
}): void {
  const { documentId, operation } = data;
  if (!documentId || !operation) return;

  const session = editSessions.get(documentId);
  if (!session) return;

  // Increment version
  session.version++;

  // Create operation record
  const op: EditOperation = {
    id: `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    userId: client.userId,
    type: operation.type,
    position: operation.position,
    text: operation.text,
    length: operation.length,
    timestamp: new Date(),
    version: session.version,
  };

  // Store operation (keep last 100 for undo support)
  session.operations.push(op);
  if (session.operations.length > 100) {
    session.operations = session.operations.slice(-100);
  }

  // Update participant activity
  const participant = session.participants.get(client.userId);
  if (participant) {
    participant.lastActivity = new Date();
  }

  // Acknowledge to sender
  client.ws.send(JSON.stringify({
    type: 'edit:operation:ack',
    data: {
      documentId,
      operationId: op.id,
      version: session.version,
    },
  }));

  // Broadcast to other participants
  broadcastToEditSession(documentId, 'edit:operation:remote', {
    operation: op,
    version: session.version,
  }, client.userId);

  log.debug({ userId: client.userId, documentId, operationType: operation.type }, 'Edit operation processed');
}

function handleEditSuggestion(client: Client, data: {
  documentId: string;
  suggestion: {
    id: string;
    text: string;
    position: { line: number; character: number };
    endPosition?: { line: number; character: number };
    type: 'insert' | 'replace' | 'delete';
    reason?: string;
  };
}): void {
  const { documentId, suggestion } = data;
  if (!documentId || !suggestion) return;

  const session = editSessions.get(documentId);
  if (!session) return;

  const participant = session.participants.get(client.userId);
  
  // Broadcast suggestion to all participants
  broadcastToEditSession(documentId, 'edit:suggestion:new', {
    userId: client.userId,
    userColor: participant?.color,
    suggestion,
  });

  log.debug({ userId: client.userId, documentId, suggestionId: suggestion.id }, 'Edit suggestion shared');
}

function broadcastToEditSession(
  documentId: string,
  event: string,
  data: unknown,
  excludeUserId?: string
): void {
  const message = JSON.stringify({ type: event, data: { documentId, ...data as object } });

  for (const [, client] of clients) {
    if (client.editSessions.has(documentId) && client.userId !== excludeUserId) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
}

// ============================================================================
// Collaborative Editing API Functions
// ============================================================================

export function getEditSessionParticipants(documentId: string): Array<{
  userId: string;
  color: string;
  cursor?: { line: number; character: number };
  lastActivity: Date;
}> {
  const session = editSessions.get(documentId);
  if (!session) return [];

  return Array.from(session.participants.values());
}

export function getEditSessionVersion(documentId: string): number {
  const session = editSessions.get(documentId);
  return session?.version ?? 0;
}

export function getEditSessionOperations(documentId: string, sinceVersion?: number): EditOperation[] {
  const session = editSessions.get(documentId);
  if (!session) return [];

  if (sinceVersion !== undefined) {
    return session.operations.filter(op => op.version > sinceVersion);
  }

  return session.operations;
}

export function getActiveEditSessions(): Array<{
  documentId: string;
  participantCount: number;
  version: number;
  lastActivity: Date;
}> {
  const sessions: Array<{
    documentId: string;
    participantCount: number;
    version: number;
    lastActivity: Date;
  }> = [];

  for (const [documentId, session] of editSessions) {
    const participants = Array.from(session.participants.values());
    const lastActivity = participants.reduce(
      (latest, p) => p.lastActivity > latest ? p.lastActivity : latest,
      new Date(0)
    );

    sessions.push({
      documentId,
      participantCount: session.participants.size,
      version: session.version,
      lastActivity,
    });
  }

  return sessions;
}

// Broadcast AI suggestion to edit session
export function broadcastAISuggestion(documentId: string, suggestion: {
  id: string;
  text: string;
  position: { line: number; character: number };
  endPosition?: { line: number; character: number };
  type: 'insert' | 'replace' | 'delete';
  reason: string;
}): void {
  broadcastToEditSession(documentId, 'edit:ai-suggestion', {
    suggestion,
    source: 'copilot',
  });
}
