// ============================================================================
// Types
// ============================================================================

export interface Mention {
  type: 'user' | 'team';
  raw: string;
  identifier: string;
  startIndex: number;
  endIndex: number;
}

export interface ResolvedMention extends Mention {
  displayName: string;
  avatarUrl?: string;
  notifiable: boolean;
}

export interface MentionNotification {
  recipientId: string;
  mentionedBy: string;
  documentId: string;
  context: string;
  timestamp: string;
}

export interface MentionSuggestion {
  identifier: string;
  displayName: string;
  type: 'user' | 'team';
  score: number;
}

export interface MentionStats {
  mentionerId: string;
  mentionedId: string;
  count: number;
}

// ============================================================================
// Parsing
// ============================================================================

const MENTION_RE = /(?:^|(?<=\s))@([\w][\w.-]{0,38}[\w]|[\w])(?=\s|[.,;:!?)}\]]|$)/g;

export function parseMentions(text: string): Mention[] {
  const mentions: Mention[] = [];
  let match: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;

  while ((match = MENTION_RE.exec(text)) !== null) {
    const raw = match[0];
    const identifier = match[1] ?? '';
    if (!identifier) continue;
    const startIndex = match.index;
    const type: Mention['type'] = identifier.startsWith('team-') ? 'team' : 'user';
    mentions.push({ type, raw, identifier, startIndex, endIndex: startIndex + raw.length });
  }

  return mentions;
}

// ============================================================================
// Resolution
// ============================================================================

export interface UserDirectory {
  users: Map<string, { displayName: string; avatarUrl?: string }>;
  teams: Map<string, { displayName: string; members: string[] }>;
}

export function resolveMentions(mentions: Mention[], directory: UserDirectory): ResolvedMention[] {
  return mentions.map((m) => {
    if (m.type === 'team') {
      const team = directory.teams.get(m.identifier);
      return {
        ...m,
        displayName: team?.displayName ?? m.identifier,
        notifiable: team != null,
      };
    }
    const user = directory.users.get(m.identifier);
    return {
      ...m,
      displayName: user?.displayName ?? m.identifier,
      avatarUrl: user?.avatarUrl,
      notifiable: user != null,
    };
  });
}

// ============================================================================
// Notifications
// ============================================================================

export function formatMentionNotification(
  resolved: ResolvedMention[],
  mentionedBy: string,
  documentId: string,
  contextSnippet: string
): MentionNotification[] {
  const now = new Date().toISOString();
  const notifications: MentionNotification[] = [];

  for (const m of resolved) {
    if (!m.notifiable) continue;
    notifications.push({
      recipientId: m.identifier,
      mentionedBy,
      documentId,
      context: contextSnippet,
      timestamp: now,
    });
  }

  return notifications;
}

// ============================================================================
// Formatting
// ============================================================================

export function formatMentionHtml(text: string, mentions: ResolvedMention[]): string {
  let result = text;
  const sorted = [...mentions].sort((a, b) => b.startIndex - a.startIndex);
  for (const m of sorted) {
    const tag = `<span class="mention" data-id="${m.identifier}" data-type="${m.type}">@${m.displayName}</span>`;
    result = result.slice(0, m.startIndex) + tag + result.slice(m.endIndex);
  }
  return result;
}

export function formatMentionMarkdown(text: string, mentions: ResolvedMention[]): string {
  let result = text;
  const sorted = [...mentions].sort((a, b) => b.startIndex - a.startIndex);
  for (const m of sorted) {
    const md = `**@${m.displayName}**`;
    result = result.slice(0, m.startIndex) + md + result.slice(m.endIndex);
  }
  return result;
}

// ============================================================================
// Statistics
// ============================================================================

export function trackMentionStats(
  existing: MentionStats[],
  mentionerId: string,
  mentions: Mention[]
): MentionStats[] {
  const stats = [...existing];
  for (const m of mentions) {
    const idx = stats.findIndex(
      (s) => s.mentionerId === mentionerId && s.mentionedId === m.identifier
    );
    if (idx >= 0) {
      const existing_stat = stats[idx]!;
      stats[idx] = { ...existing_stat, count: existing_stat.count + 1 };
    } else {
      stats.push({ mentionerId, mentionedId: m.identifier, count: 1 });
    }
  }
  return stats;
}

// ============================================================================
// Autocomplete
// ============================================================================

export function getMentionSuggestions(
  prefix: string,
  directory: UserDirectory,
  limit: number = 10
): MentionSuggestion[] {
  const lower = prefix.toLowerCase();
  const results: MentionSuggestion[] = [];

  for (const [id, info] of directory.users) {
    if (id.toLowerCase().startsWith(lower) || info.displayName.toLowerCase().startsWith(lower)) {
      results.push({
        identifier: id,
        displayName: info.displayName,
        type: 'user',
        score: computeMatchScore(id, info.displayName, lower),
      });
    }
  }

  for (const [id, info] of directory.teams) {
    if (id.toLowerCase().startsWith(lower) || info.displayName.toLowerCase().startsWith(lower)) {
      results.push({
        identifier: id,
        displayName: info.displayName,
        type: 'team',
        score: computeMatchScore(id, info.displayName, lower),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function computeMatchScore(id: string, displayName: string, prefix: string): number {
  if (id.toLowerCase() === prefix) return 100;
  if (displayName.toLowerCase() === prefix) return 90;
  if (id.toLowerCase().startsWith(prefix)) return 80;
  if (displayName.toLowerCase().startsWith(prefix)) return 70;
  return 50;
}
