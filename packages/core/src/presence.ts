// ============================================================================
// Types
// ============================================================================

export type PresenceState = 'online' | 'idle' | 'editing' | 'reviewing' | 'offline';

export interface CursorPosition {
  line: number;
  column: number;
}

export interface SelectionRange {
  start: CursorPosition;
  end: CursorPosition;
}

export interface UserPresence {
  userId: string;
  documentId: string;
  sectionId?: string;
  state: PresenceState;
  cursor?: CursorPosition;
  selection?: SelectionRange;
  lastHeartbeat: number;
  color: string;
}

export interface PresenceRoom {
  documentId: string;
  users: Map<string, UserPresence>;
}

export interface OverlapResult {
  documentId: string;
  users: string[];
  overlapDurationMs: number;
  sectionId?: string;
}

// ============================================================================
// Constants
// ============================================================================

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const OFFLINE_TIMEOUT_MS = 15 * 60 * 1000;

const COLORS = [
  '#e06c75',
  '#61afef',
  '#98c379',
  '#d19a66',
  '#c678dd',
  '#56b6c2',
  '#e5c07b',
  '#be5046',
];

// ============================================================================
// Presence management
// ============================================================================

export function createPresenceRoom(documentId: string): PresenceRoom {
  return { documentId, users: new Map() };
}

export function updatePresence(
  room: PresenceRoom,
  update: {
    userId: string;
    state?: PresenceState;
    cursor?: CursorPosition;
    selection?: SelectionRange;
    sectionId?: string;
  },
  nowMs: number = Date.now()
): PresenceRoom {
  const existing = room.users.get(update.userId);
  const color = existing?.color ?? assignColor(room);

  const presence: UserPresence = {
    userId: update.userId,
    documentId: room.documentId,
    sectionId: update.sectionId ?? existing?.sectionId,
    state: update.state ?? existing?.state ?? 'online',
    cursor: update.cursor ?? existing?.cursor,
    selection: update.selection ?? existing?.selection,
    lastHeartbeat: nowMs,
    color,
  };

  const users = new Map(room.users);
  users.set(update.userId, presence);
  return { ...room, users };
}

function assignColor(room: PresenceRoom): string {
  const usedColors = new Set([...room.users.values()].map((u) => u.color));
  return (
    COLORS.find((c) => !usedColors.has(c)) ?? COLORS[room.users.size % COLORS.length] ?? COLORS[0]!
  );
}

export function removePresence(room: PresenceRoom, userId: string): PresenceRoom {
  const users = new Map(room.users);
  users.delete(userId);
  return { ...room, users };
}

// ============================================================================
// Heartbeat & timeouts
// ============================================================================

export function applyHeartbeatTimeouts(
  room: PresenceRoom,
  nowMs: number = Date.now()
): PresenceRoom {
  const users = new Map<string, UserPresence>();

  for (const [id, presence] of room.users) {
    const elapsed = nowMs - presence.lastHeartbeat;
    if (elapsed >= OFFLINE_TIMEOUT_MS) {
      users.set(id, { ...presence, state: 'offline' });
    } else if (elapsed >= IDLE_TIMEOUT_MS && presence.state !== 'offline') {
      users.set(id, { ...presence, state: 'idle' });
    } else {
      users.set(id, presence);
    }
  }

  return { ...room, users };
}

// ============================================================================
// Query helpers
// ============================================================================

export function getDocumentPresence(room: PresenceRoom): UserPresence[] {
  return [...room.users.values()].filter((u) => u.state !== 'offline');
}

export function getSectionPresence(room: PresenceRoom, sectionId: string): UserPresence[] {
  return [...room.users.values()].filter((u) => u.sectionId === sectionId && u.state !== 'offline');
}

// ============================================================================
// Overlap calculation
// ============================================================================

export function calculateOverlap(
  sessions: Array<{
    userId: string;
    documentId: string;
    sectionId?: string;
    joinedAt: number;
    leftAt: number | null;
  }>,
  nowMs: number = Date.now()
): OverlapResult[] {
  const byDoc = new Map<string, typeof sessions>();

  for (const s of sessions) {
    const key = s.sectionId ? `${s.documentId}::${s.sectionId}` : s.documentId;
    if (!byDoc.has(key)) byDoc.set(key, []);
    byDoc.get(key)!.push(s);
  }

  const results: OverlapResult[] = [];

  for (const [key, group] of byDoc) {
    if (group.length < 2) continue;
    const [docId, sectionId] = key.split('::');

    let maxOverlap = 0;
    const userSet = new Set<string>();

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const aEnd = a.leftAt ?? nowMs;
        const bEnd = b.leftAt ?? nowMs;
        const overlapStart = Math.max(a.joinedAt, b.joinedAt);
        const overlapEnd = Math.min(aEnd, bEnd);
        const overlap = Math.max(0, overlapEnd - overlapStart);
        if (overlap > 0) {
          userSet.add(a.userId);
          userSet.add(b.userId);
          maxOverlap = Math.max(maxOverlap, overlap);
        }
      }
    }

    if (userSet.size > 0) {
      results.push({
        documentId: docId ?? key,
        users: [...userSet],
        overlapDurationMs: maxOverlap,
        ...(sectionId ? { sectionId } : {}),
      });
    }
  }

  return results;
}

// ============================================================================
// Presence indicators
// ============================================================================

export function generatePresenceIndicators(room: PresenceRoom): Array<{
  userId: string;
  color: string;
  cursor?: CursorPosition;
  selection?: SelectionRange;
  state: PresenceState;
}> {
  return getDocumentPresence(room).map((u) => ({
    userId: u.userId,
    color: u.color,
    cursor: u.cursor,
    selection: u.selection,
    state: u.state,
  }));
}
