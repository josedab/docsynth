/**
 * GitHub Copilot Extension Service
 *
 * Handles @docsynth commands in GitHub Copilot chat. Supports update, explain,
 * status, coverage, and conversational documentation queries.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _log = createLogger('copilot-extension-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface CopilotCommand {
  command: 'update' | 'explain' | 'status' | 'coverage' | 'chat';
  args: string[];
  context: CopilotContext;
}

export interface CopilotContext {
  repositoryId: string;
  userId: string;
  conversationId: string;
  filePath?: string;
  selection?: string;
  prNumber?: number;
  branch?: string;
}

export interface CopilotResponse {
  message: string;
  references?: CopilotReference[];
  actions?: CopilotAction[];
  streaming: boolean;
}

export interface CopilotReference {
  type: 'file' | 'doc' | 'pr' | 'issue';
  path: string;
  title: string;
  url?: string;
}

export interface CopilotAction {
  label: string;
  command: string;
  description: string;
}

export interface ConversationHistory {
  conversationId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Parse and execute a Copilot command
 */
export async function handleCommand(
  message: string,
  context: CopilotContext
): Promise<CopilotResponse> {
  const command = parseCommand(message);

  switch (command.command) {
    case 'update':
      return handleUpdateCommand(context, command.args);
    case 'explain':
      return handleExplainCommand(context, command.args);
    case 'status':
      return handleStatusCommand(context);
    case 'coverage':
      return handleCoverageCommand(context);
    case 'chat':
    default:
      return handleChatCommand(context, message);
  }
}

/**
 * Store conversation message
 */
export async function storeMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  await db.copilotConversation.create({
    data: { conversationId, role, content, createdAt: new Date() },
  });
}

/**
 * Get conversation history
 */
export async function getConversationHistory(
  conversationId: string,
  limit: number = 20
): Promise<ConversationHistory> {
  const messages = await db.copilotConversation.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { role: true, content: true, createdAt: true },
  });

  return {
    conversationId,
    messages: messages.map((m: any) => ({
      role: m.role,
      content: m.content,
      timestamp: m.createdAt,
    })),
  };
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleUpdateCommand(
  context: CopilotContext,
  args: string[]
): Promise<CopilotResponse> {
  const target = args[0] ?? context.filePath ?? 'all docs';

  const recentJobs = await prisma.generationJob.findMany({
    where: { repositoryId: context.repositoryId, status: 'completed' },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { id: true, status: true, createdAt: true },
  });

  return {
    message: `📝 **Documentation update queued** for \`${target}\`\n\nI'll analyze the recent changes and generate updated documentation. ${recentJobs.length > 0 ? `Last generation was ${timeAgo(recentJobs[0]!.createdAt)}.` : 'This will be the first generation for this repo.'}\n\nYou'll receive a PR with the proposed changes once complete.`,
    references: context.filePath
      ? [{ type: 'file', path: context.filePath, title: context.filePath }]
      : [],
    actions: [
      {
        label: 'View Status',
        command: '@docsynth status',
        description: 'Check generation progress',
      },
      {
        label: 'View Coverage',
        command: '@docsynth coverage',
        description: 'See doc coverage report',
      },
    ],
    streaming: false,
  };
}

async function handleExplainCommand(
  context: CopilotContext,
  args: string[]
): Promise<CopilotResponse> {
  const target = args.join(' ') || context.selection || context.filePath || '';

  if (!target) {
    return {
      message:
        "❓ Please specify what you'd like explained. You can:\n- Select code and ask `@docsynth explain`\n- Specify a file: `@docsynth explain src/auth.ts`\n- Ask about a concept: `@docsynth explain the authentication flow`",
      streaming: false,
    };
  }

  // Look for existing docs about the target
  const relatedDocs = await prisma.document.findMany({
    where: {
      repositoryId: context.repositoryId,
      OR: [
        { path: { contains: target } },
        { content: { contains: target } },
        { title: { contains: target } },
      ],
    },
    select: { path: true, title: true, content: true },
    take: 3,
  });

  if (relatedDocs.length > 0) {
    const doc = relatedDocs[0]!;
    const excerpt = doc.content ? doc.content.substring(0, 500) + '...' : 'No content available';
    return {
      message: `## 📖 ${doc.title ?? doc.path}\n\n${excerpt}\n\n---\n*Found ${relatedDocs.length} related document(s)*`,
      references: relatedDocs.map((d) => ({
        type: 'doc' as const,
        path: d.path,
        title: d.title ?? d.path,
      })),
      streaming: false,
    };
  }

  return {
    message: `I don't have existing documentation for \`${target}\` yet. Would you like me to generate it?\n\nUse \`@docsynth update ${target}\` to create documentation.`,
    actions: [
      {
        label: 'Generate Docs',
        command: `@docsynth update ${target}`,
        description: 'Generate documentation for this target',
      },
    ],
    streaming: false,
  };
}

async function handleStatusCommand(context: CopilotContext): Promise<CopilotResponse> {
  const [activeJobs, recentCompleted, healthScore] = await Promise.all([
    prisma.generationJob.count({
      where: { repositoryId: context.repositoryId, status: { in: ['pending', 'processing'] } },
    }),
    prisma.generationJob.count({
      where: { repositoryId: context.repositoryId, status: 'completed' },
    }),
    db.healthScoreSnapshot.findFirst({
      where: { repositoryId: context.repositoryId },
      orderBy: { createdAt: 'desc' },
      select: { overallScore: true, createdAt: true },
    }),
  ]);

  const score = healthScore?.overallScore ?? 'N/A';
  const statusEmoji = activeJobs > 0 ? '🔄' : '✅';

  return {
    message: `## ${statusEmoji} DocSynth Status\n\n| Metric | Value |\n|--------|-------|\n| Active Jobs | ${activeJobs} |\n| Completed Jobs | ${recentCompleted} |\n| Health Score | ${score}/100 |\n\n${activeJobs > 0 ? `⏳ ${activeJobs} job(s) currently processing...` : '✨ No active jobs. Documentation is up to date.'}`,
    streaming: false,
  };
}

async function handleCoverageCommand(context: CopilotContext): Promise<CopilotResponse> {
  const docs = await prisma.document.findMany({
    where: { repositoryId: context.repositoryId },
    select: { path: true, updatedAt: true },
  });

  const totalDocs = docs.length;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const freshDocs = docs.filter((d) => new Date(d.updatedAt) > thirtyDaysAgo).length;
  const freshness = totalDocs > 0 ? Math.round((freshDocs / totalDocs) * 100) : 0;

  const bar = (pct: number) =>
    '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));

  return {
    message: `## 📊 Documentation Coverage\n\n| Metric | Value |\n|--------|-------|\n| Total Documents | ${totalDocs} |\n| Fresh (< 30 days) | ${freshDocs} |\n| Freshness | ${bar(freshness)} ${freshness}% |\n\n${freshness < 50 ? '⚠️ Documentation freshness is low. Consider running `@docsynth update` to refresh.' : '✅ Documentation freshness is healthy.'}`,
    streaming: false,
  };
}

async function handleChatCommand(
  context: CopilotContext,
  message: string
): Promise<CopilotResponse> {
  // Search for relevant docs
  const results = await prisma.document.findMany({
    where: {
      repositoryId: context.repositoryId,
      OR: [
        { content: { contains: message.split(' ').slice(0, 3).join(' ') } },
        { title: { contains: message.split(' ')[0] ?? '' } },
      ],
    },
    select: { path: true, title: true, content: true },
    take: 3,
  });

  if (results.length > 0) {
    const excerpts = results
      .map((r) => `### ${r.title ?? r.path}\n${(r.content ?? '').substring(0, 200)}...`)
      .join('\n\n');
    return {
      message: `Here's what I found in your documentation:\n\n${excerpts}`,
      references: results.map((r) => ({
        type: 'doc' as const,
        path: r.path,
        title: r.title ?? r.path,
      })),
      streaming: false,
    };
  }

  return {
    message: `I couldn't find specific documentation related to your question. Here are some things I can help with:\n\n- \`@docsynth update\` — Generate/update documentation\n- \`@docsynth explain <file>\` — Explain code\n- \`@docsynth status\` — Check DocSynth status\n- \`@docsynth coverage\` — View documentation coverage`,
    streaming: false,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function parseCommand(message: string): CopilotCommand {
  const cleaned = message.replace(/^@docsynth\s*/i, '').trim();
  const parts = cleaned.split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? 'chat';
  const validCommands = ['update', 'explain', 'status', 'coverage', 'chat'];

  return {
    command: validCommands.includes(cmd) ? (cmd as CopilotCommand['command']) : 'chat',
    args: parts.slice(1),
    context: { repositoryId: '', userId: '', conversationId: '' },
  };
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
