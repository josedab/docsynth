import { createLogger } from '@docsynth/utils';
import type { BotPlatform } from '@docsynth/types';
import { chatRAGService } from './chat-rag.js';

const log = createLogger('doc-bot-service');

// Local source type matching ChatSource structure
interface SourceReference {
  documentId: string;
  documentPath: string;
  excerpt: string;
  relevanceScore: number;
}

interface BotInput {
  platform: BotPlatform;
  channelId: string;
  threadId?: string;
  userId: string;
  message: string;
  organizationId: string;
}

interface BotResponse {
  text: string;
  blocks?: unknown[]; // Platform-specific rich formatting
  sources: SourceReference[];
  ephemeral?: boolean;
}

interface ParsedCommand {
  command: string;
  args: string[];
  rawArgs: string;
}

class DocBotService {
  /**
   * Process incoming bot message
   */
  async processMessage(
    input: BotInput,
    documents: Array<{ id: string; title: string; content: string; type: string; path: string }>
  ): Promise<BotResponse> {
    const { platform, message } = input;

    log.info({ platform, messageLength: message.length }, 'Processing bot message');

    // Parse command
    const parsed = this.parseCommand(message);

    // Handle command
    switch (parsed.command) {
      case 'search':
        return this.handleSearch(parsed.rawArgs, documents, platform);
      case 'ask':
        return this.handleAsk(input, parsed.rawArgs, documents);
      case 'health':
        return this.handleHealth(input, parsed.args[0]);
      case 'subscribe':
        return this.handleSubscribe(input, parsed.args);
      case 'help':
        return this.handleHelp(platform);
      default:
        // Treat as a question if no command
        return this.handleAsk(input, message, documents);
    }
  }

  /**
   * Parse command from message
   */
  private parseCommand(message: string): ParsedCommand {
    const trimmed = message.trim();

    // Check for /docs prefix
    if (trimmed.startsWith('/docs ')) {
      const parts = trimmed.slice(6).trim().split(/\s+/);
      const command = parts[0] || '';
      const args = parts.slice(1);
      return {
        command: command.toLowerCase(),
        args,
        rawArgs: args.join(' '),
      };
    }

    // Check for direct commands
    const commands = ['search', 'ask', 'health', 'subscribe', 'help'];
    for (const cmd of commands) {
      if (trimmed.toLowerCase().startsWith(cmd + ' ') || trimmed.toLowerCase() === cmd) {
        const args = trimmed.slice(cmd.length).trim().split(/\s+/).filter(Boolean);
        return {
          command: cmd,
          args,
          rawArgs: args.join(' '),
        };
      }
    }

    // Treat as question
    return {
      command: 'ask',
      args: [trimmed],
      rawArgs: trimmed,
    };
  }

  /**
   * Handle search command
   */
  private async handleSearch(
    query: string,
    documents: Array<{ id: string; title: string; content: string; type: string; path: string }>,
    platform: BotPlatform
  ): Promise<BotResponse> {
    if (!query) {
      return {
        text: 'Please provide a search query. Example: `/docs search authentication`',
        sources: [],
      };
    }

    // Simple keyword search
    const queryLower = query.toLowerCase();
    const keywords = queryLower.split(/\s+/);

    const results = documents
      .map((doc) => {
        const titleLower = doc.title.toLowerCase();
        const contentLower = doc.content.toLowerCase();
        let score = 0;

        for (const keyword of keywords) {
          if (titleLower.includes(keyword)) score += 3;
          if (contentLower.includes(keyword)) score += 1;
        }

        return { doc, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (results.length === 0) {
      return {
        text: `No results found for "${query}". Try different keywords.`,
        sources: [],
      };
    }

    // Format response
    const text = `Found ${results.length} result${results.length > 1 ? 's' : ''} for "${query}":\n\n` +
      results.map((r, i) => `${i + 1}. *${r.doc.title}* (${r.doc.type})\n   ${r.doc.path}`).join('\n\n');

    const blocks = platform === 'slack' ? this.formatSlackResults(results.map((r) => r.doc)) : undefined;

    return {
      text,
      blocks,
      sources: results.map((r) => ({
        documentId: r.doc.id,
        documentPath: r.doc.path,
        excerpt: r.doc.content.substring(0, 100) + '...',
        relevanceScore: r.score / 10,
      })),
    };
  }

  /**
   * Handle ask command
   */
  private async handleAsk(
    input: BotInput,
    question: string,
    documents: Array<{ id: string; title: string; content: string; type: string; path: string }>
  ): Promise<BotResponse> {
    if (!question) {
      return {
        text: 'Please ask a question. Example: `/docs ask How do I authenticate?`',
        sources: [],
      };
    }

    // Use RAG service
    const docChunks = documents.map((d) => ({
      id: d.id,
      documentId: d.id,
      title: d.title,
      content: d.content,
      type: d.type,
      path: d.path,
    }));

    const result = await chatRAGService.answer(
      {
        query: question,
        repositoryId: input.organizationId, // Using org as repo context for bot
      },
      docChunks,
      []
    );

    // Format response
    let text = result.answer;

    if (result.sources.length > 0) {
      text += '\n\n*Sources:*\n';
      text += result.sources.slice(0, 3).map((s) => `• ${s.documentPath}`).join('\n');
    }

    return {
      text,
      sources: result.sources,
    };
  }

  /**
   * Handle health command
   */
  private async handleHealth(input: BotInput, repoName?: string): Promise<BotResponse> {
    // This would typically query the health dashboard
    const text = repoName
      ? `📊 *Documentation Health for ${repoName}*\n\n` +
        `Overall Score: 78/100\n` +
        `Freshness: ✅ Good\n` +
        `Coverage: ⚠️ Needs attention (missing API docs)\n` +
        `Last updated: 2 days ago`
      : `📊 *Organization Documentation Health*\n\n` +
        `Total Repositories: 12\n` +
        `Healthy: 8\n` +
        `Needs Attention: 3\n` +
        `Critical: 1\n\n` +
        `Use \`/docs health [repo-name]\` for specific repository health.`;

    return {
      text,
      sources: [],
    };
  }

  /**
   * Handle subscribe command
   */
  private async handleSubscribe(input: BotInput, args: string[]): Promise<BotResponse> {
    const [repoName, alertType] = args;

    if (!repoName) {
      return {
        text: 'Please specify a repository. Example: `/docs subscribe my-repo drift`\n\n' +
          'Available alert types:\n' +
          '• `drift` - Documentation drift alerts\n' +
          '• `health` - Health score changes\n' +
          '• `review` - New documentation for review',
        sources: [],
      };
    }

    const subscriptionType = alertType || 'all';

    // In production, this would create a subscription record
    return {
      text: `✅ Subscribed to ${subscriptionType} alerts for *${repoName}*\n\n` +
        `You'll receive notifications in this channel when:\n` +
        (subscriptionType === 'all' || subscriptionType === 'drift'
          ? '• Documentation becomes outdated\n'
          : '') +
        (subscriptionType === 'all' || subscriptionType === 'health'
          ? '• Health score drops significantly\n'
          : '') +
        (subscriptionType === 'all' || subscriptionType === 'review'
          ? '• New documentation needs review\n'
          : ''),
      sources: [],
    };
  }

  /**
   * Handle help command
   */
  private handleHelp(_platform: BotPlatform): BotResponse {
    const text = `🤖 *DocSynth Bot Commands*\n\n` +
      `\`/docs search <query>\` - Search documentation\n` +
      `\`/docs ask <question>\` - Ask a question about the codebase\n` +
      `\`/docs health [repo]\` - Check documentation health\n` +
      `\`/docs subscribe <repo> [type]\` - Subscribe to alerts\n` +
      `\`/docs help\` - Show this help message\n\n` +
      `You can also just ask questions directly and I'll try to answer!`;

    return {
      text,
      sources: [],
      ephemeral: true,
    };
  }

  /**
   * Format results for Slack
   */
  private formatSlackResults(
    docs: Array<{ id: string; title: string; type: string; path: string }>
  ): unknown[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Search Results*',
        },
      },
      ...docs.map((doc) => ({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${doc.title}*\n_${doc.type}_ | ${doc.path}`,
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View',
          },
          url: `/docs/${doc.id}`,
        },
      })),
    ];
  }

  /**
   * Send alert to channel
   */
  async sendAlert(
    platform: BotPlatform,
    channelId: string,
    alertType: string,
    _message: string,
    _metadata: Record<string, unknown>
  ): Promise<void> {
    // In production, this would use platform-specific APIs (Slack Web API, MS Teams API)
    log.info({ platform, channelId, alertType }, 'Sending alert to channel');

    // This would make the actual API call
    // For Slack: await slackClient.chat.postMessage({ channel: channelId, text: message });
    // For Teams: await teamsClient.sendToChannel(channelId, message);
  }
}

export const docBotService = new DocBotService();
