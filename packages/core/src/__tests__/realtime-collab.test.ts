import { describe, it, expect } from 'vitest';
import {
  parseMentions,
  resolveMentions,
  formatMentionNotification,
  formatMentionHtml,
  formatMentionMarkdown,
  trackMentionStats,
  getMentionSuggestions,
  type UserDirectory,
} from '../mentions.js';
import {
  createWorkflow,
  submitForApproval,
  recordDecision,
  evaluateAutoApprove,
  checkPolicy,
  getApprovalSummary,
  type ReviewDecision,
} from '../approval-workflow.js';
import {
  createPresenceRoom,
  updatePresence,
  removePresence,
  applyHeartbeatTimeouts,
  getDocumentPresence,
  getSectionPresence,
  calculateOverlap,
  generatePresenceIndicators,
} from '../presence.js';

// ============================================================================
// Fixtures
// ============================================================================

function makeDirectory(): UserDirectory {
  return {
    users: new Map([
      ['alice', { displayName: 'Alice Smith', avatarUrl: 'https://example.com/alice.png' }],
      ['bob', { displayName: 'Bob Jones' }],
    ]),
    teams: new Map([['team-docs', { displayName: 'Docs Team', members: ['alice', 'bob'] }]]),
  };
}

function decision(
  reviewerId: string,
  d: ReviewDecision['decision'],
  offsetMs: number = 0
): ReviewDecision {
  return {
    reviewerId,
    role: 'reviewer',
    decision: d,
    comment: `${d} by ${reviewerId}`,
    timestamp: new Date(Date.now() + offsetMs).toISOString(),
  };
}

// ============================================================================
// Mentions
// ============================================================================

describe('mentions', () => {
  it('parses @user mentions from text', () => {
    const result = parseMentions('Hello @alice and @bob!');
    expect(result).toHaveLength(2);
    expect(result[0].identifier).toBe('alice');
    expect(result[0].type).toBe('user');
    expect(result[1].identifier).toBe('bob');
  });

  it('parses @team mentions', () => {
    const result = parseMentions('cc @team-docs for review');
    expect(result).toHaveLength(1);
    expect(result[0].identifier).toBe('team-docs');
    expect(result[0].type).toBe('team');
  });

  it('handles text with no mentions', () => {
    expect(parseMentions('No mentions here')).toHaveLength(0);
  });

  it('handles email-like patterns gracefully', () => {
    const result = parseMentions('email user@example.com please');
    expect(result).toHaveLength(0);
  });

  it('resolves mentions against a directory', () => {
    const mentions = parseMentions('Hey @alice and @unknown');
    const dir = makeDirectory();
    const resolved = resolveMentions(mentions, dir);
    expect(resolved[0].displayName).toBe('Alice Smith');
    expect(resolved[0].notifiable).toBe(true);
    expect(resolved[1].notifiable).toBe(false);
  });

  it('generates notification payloads for resolved mentions', () => {
    const mentions = parseMentions('Hey @alice');
    const dir = makeDirectory();
    const resolved = resolveMentions(mentions, dir);
    const notifications = formatMentionNotification(resolved, 'bob', 'doc-1', 'Hey @alice');
    expect(notifications).toHaveLength(1);
    expect(notifications[0].recipientId).toBe('alice');
    expect(notifications[0].mentionedBy).toBe('bob');
    expect(notifications[0].documentId).toBe('doc-1');
  });

  it('formats mentions as HTML', () => {
    const mentions = parseMentions('Hello @alice');
    const dir = makeDirectory();
    const resolved = resolveMentions(mentions, dir);
    const html = formatMentionHtml('Hello @alice', resolved);
    expect(html).toContain('<span class="mention"');
    expect(html).toContain('Alice Smith');
  });

  it('formats mentions as markdown', () => {
    const mentions = parseMentions('Hello @alice');
    const dir = makeDirectory();
    const resolved = resolveMentions(mentions, dir);
    const md = formatMentionMarkdown('Hello @alice', resolved);
    expect(md).toContain('**@Alice Smith**');
  });

  it('tracks mention statistics', () => {
    const mentions = parseMentions('@alice @alice @bob');
    const stats = trackMentionStats([], 'charlie', mentions);
    const aliceStat = stats.find((s) => s.mentionedId === 'alice');
    expect(aliceStat?.count).toBe(2);
    expect(stats.find((s) => s.mentionedId === 'bob')?.count).toBe(1);
  });

  it('provides autocomplete suggestions', () => {
    const dir = makeDirectory();
    const suggestions = getMentionSuggestions('al', dir);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].identifier).toBe('alice');
  });

  it('returns empty suggestions for no match', () => {
    const dir = makeDirectory();
    expect(getMentionSuggestions('zzz', dir)).toHaveLength(0);
  });
});

// ============================================================================
// Approval Workflow
// ============================================================================

describe('approval-workflow', () => {
  it('creates a pending workflow', () => {
    const wf = createWorkflow({
      id: 'wf-1',
      documentId: 'doc-1',
      requiredReviewers: ['alice', 'bob'],
    });
    expect(wf.state).toBe('pending');
    expect(wf.requiredReviewers).toEqual(['alice', 'bob']);
    expect(wf.strategy).toBe('all-of');
  });

  it('transitions to in_review on submit', () => {
    const wf = createWorkflow({ id: 'wf-1', documentId: 'doc-1', requiredReviewers: ['alice'] });
    const submitted = submitForApproval(wf);
    expect(submitted.state).toBe('in_review');
  });

  it('does not transition if already in review', () => {
    const wf = submitForApproval(
      createWorkflow({ id: 'wf-1', documentId: 'doc-1', requiredReviewers: ['alice'] })
    );
    const again = submitForApproval(wf);
    expect(again.state).toBe('in_review');
  });

  it('approves with all-of strategy when all reviewers approve', () => {
    let wf = submitForApproval(
      createWorkflow({ id: 'wf-1', documentId: 'doc-1', requiredReviewers: ['alice', 'bob'] })
    );
    wf = recordDecision(wf, decision('alice', 'approved'));
    expect(wf.state).toBe('in_review');
    wf = recordDecision(wf, decision('bob', 'approved'));
    expect(wf.state).toBe('approved');
  });

  it('approves with any-of strategy on first approval', () => {
    let wf = submitForApproval(
      createWorkflow({
        id: 'wf-1',
        documentId: 'doc-1',
        requiredReviewers: ['alice', 'bob'],
        strategy: 'any-of',
      })
    );
    wf = recordDecision(wf, decision('alice', 'approved'));
    expect(wf.state).toBe('approved');
  });

  it('rejects if any reviewer rejects', () => {
    let wf = submitForApproval(
      createWorkflow({ id: 'wf-1', documentId: 'doc-1', requiredReviewers: ['alice', 'bob'] })
    );
    wf = recordDecision(wf, decision('alice', 'rejected'));
    expect(wf.state).toBe('rejected');
  });

  it('moves to changes_requested state', () => {
    let wf = submitForApproval(
      createWorkflow({ id: 'wf-1', documentId: 'doc-1', requiredReviewers: ['alice', 'bob'] })
    );
    wf = recordDecision(wf, decision('alice', 'changes_requested'));
    expect(wf.state).toBe('changes_requested');
  });

  it('ignores decisions when not in_review', () => {
    const wf = createWorkflow({ id: 'wf-1', documentId: 'doc-1', requiredReviewers: ['alice'] });
    const updated = recordDecision(wf, decision('alice', 'approved'));
    expect(updated.state).toBe('pending');
  });

  it('evaluates auto-approve rules', () => {
    const wf = createWorkflow({
      id: 'wf-1',
      documentId: 'doc-1',
      requiredReviewers: ['alice'],
      autoApproveRules: [{ condition: 'minor-edit', value: '' }],
    });
    expect(
      evaluateAutoApprove(wf, { changeSize: 'minor', authorId: 'bob', authorRole: 'editor' })
    ).toBe(true);
    expect(
      evaluateAutoApprove(wf, { changeSize: 'major', authorId: 'bob', authorRole: 'editor' })
    ).toBe(false);
  });

  it('checks policy violations', () => {
    const wf = createWorkflow({
      id: 'wf-1',
      documentId: 'doc-1',
      requiredReviewers: ['alice'],
      minReviewers: 2,
      requiredRoles: ['lead'],
    });
    const policy = checkPolicy(wf);
    expect(policy.valid).toBe(false);
    expect(policy.violations.length).toBeGreaterThan(0);
  });

  it('generates an approval summary', () => {
    let wf = submitForApproval(
      createWorkflow({ id: 'wf-1', documentId: 'doc-1', requiredReviewers: ['alice', 'bob'] })
    );
    wf = recordDecision(wf, decision('alice', 'approved', 1000));
    const summary = getApprovalSummary(wf);
    expect(summary.workflowId).toBe('wf-1');
    expect(summary.approved).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.decisionsRecorded).toBe(1);
  });
});

// ============================================================================
// Presence
// ============================================================================

describe('presence', () => {
  it('creates an empty presence room', () => {
    const room = createPresenceRoom('doc-1');
    expect(room.documentId).toBe('doc-1');
    expect(room.users.size).toBe(0);
  });

  it('adds a user to a room', () => {
    let room = createPresenceRoom('doc-1');
    room = updatePresence(room, { userId: 'alice', state: 'editing' });
    expect(room.users.size).toBe(1);
    expect(room.users.get('alice')?.state).toBe('editing');
  });

  it('assigns unique colors to users', () => {
    let room = createPresenceRoom('doc-1');
    room = updatePresence(room, { userId: 'alice', state: 'online' });
    room = updatePresence(room, { userId: 'bob', state: 'online' });
    const alice = room.users.get('alice')!;
    const bob = room.users.get('bob')!;
    expect(alice.color).not.toBe(bob.color);
  });

  it('updates existing user presence', () => {
    let room = createPresenceRoom('doc-1');
    room = updatePresence(room, { userId: 'alice', state: 'online' });
    room = updatePresence(room, {
      userId: 'alice',
      state: 'editing',
      cursor: { line: 10, column: 5 },
    });
    expect(room.users.get('alice')?.state).toBe('editing');
    expect(room.users.get('alice')?.cursor?.line).toBe(10);
  });

  it('removes a user from a room', () => {
    let room = createPresenceRoom('doc-1');
    room = updatePresence(room, { userId: 'alice', state: 'online' });
    room = removePresence(room, 'alice');
    expect(room.users.size).toBe(0);
  });

  it('applies idle timeout', () => {
    const now = Date.now();
    let room = createPresenceRoom('doc-1');
    room = updatePresence(room, { userId: 'alice', state: 'editing' }, now - 6 * 60 * 1000);
    room = applyHeartbeatTimeouts(room, now);
    expect(room.users.get('alice')?.state).toBe('idle');
  });

  it('applies offline timeout', () => {
    const now = Date.now();
    let room = createPresenceRoom('doc-1');
    room = updatePresence(room, { userId: 'alice', state: 'editing' }, now - 16 * 60 * 1000);
    room = applyHeartbeatTimeouts(room, now);
    expect(room.users.get('alice')?.state).toBe('offline');
  });

  it('getDocumentPresence excludes offline users', () => {
    const now = Date.now();
    let room = createPresenceRoom('doc-1');
    room = updatePresence(room, { userId: 'alice', state: 'editing' }, now);
    room = updatePresence(room, { userId: 'bob', state: 'online' }, now - 16 * 60 * 1000);
    room = applyHeartbeatTimeouts(room, now);
    const active = getDocumentPresence(room);
    expect(active).toHaveLength(1);
    expect(active[0].userId).toBe('alice');
  });

  it('gets section-specific presence', () => {
    let room = createPresenceRoom('doc-1');
    room = updatePresence(room, { userId: 'alice', state: 'editing', sectionId: 'intro' });
    room = updatePresence(room, { userId: 'bob', state: 'editing', sectionId: 'conclusion' });
    expect(getSectionPresence(room, 'intro')).toHaveLength(1);
  });

  it('calculates session overlap', () => {
    const now = Date.now();
    const sessions = [
      { userId: 'alice', documentId: 'doc-1', joinedAt: now - 10000, leftAt: now - 2000 },
      { userId: 'bob', documentId: 'doc-1', joinedAt: now - 8000, leftAt: now - 1000 },
    ];
    const overlaps = calculateOverlap(sessions, now);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].users).toContain('alice');
    expect(overlaps[0].users).toContain('bob');
    expect(overlaps[0].overlapDurationMs).toBeGreaterThan(0);
  });

  it('returns no overlap for non-overlapping sessions', () => {
    const now = Date.now();
    const sessions = [
      { userId: 'alice', documentId: 'doc-1', joinedAt: now - 20000, leftAt: now - 15000 },
      { userId: 'bob', documentId: 'doc-1', joinedAt: now - 10000, leftAt: now - 5000 },
    ];
    expect(calculateOverlap(sessions, now)).toHaveLength(0);
  });

  it('generates presence indicators', () => {
    let room = createPresenceRoom('doc-1');
    room = updatePresence(room, {
      userId: 'alice',
      state: 'editing',
      cursor: { line: 1, column: 0 },
    });
    const indicators = generatePresenceIndicators(room);
    expect(indicators).toHaveLength(1);
    expect(indicators[0].cursor?.line).toBe(1);
    expect(indicators[0].color).toBeTruthy();
  });
});
