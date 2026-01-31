import { createLogger, RateLimiter, Cache } from '@docsynth/utils';

const log = createLogger('slack-mcp');

export interface SlackConfig {
  botToken: string;
  defaultChannel?: string;
  rateLimitPerMinute?: number;
  cacheTtlMs?: number;
}

export interface SlackMessage {
  ts: string;
  channelId: string;
  channelName: string;
  user: string;
  username: string;
  text: string;
  timestamp: Date;
  threadTs?: string;
  replies?: SlackMessage[];
  permalink?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  topic: string;
  purpose: string;
}

export interface SlackSearchResult {
  messages: SlackMessage[];
  total: number;
}

export class SlackMCPClient {
  private botToken: string;
  private defaultChannel?: string;
  private baseUrl = 'https://slack.com/api';
  private rateLimiter: RateLimiter;
  private channelCache: Cache<SlackChannel>;
  private messageCache: Cache<SlackMessage[]>;

  constructor(config: SlackConfig) {
    this.botToken = config.botToken;
    this.defaultChannel = config.defaultChannel;

    // Slack Tier 3 rate limit: ~50 requests per minute for most methods
    this.rateLimiter = new RateLimiter({
      maxRequests: config.rateLimitPerMinute ?? 50,
      windowMs: 60000,
    });

    // Cache channels for 10 minutes (they don't change often)
    this.channelCache = new Cache<SlackChannel>({
      ttlMs: config.cacheTtlMs ?? 600000,
      maxSize: 200,
    });

    // Cache message searches for 2 minutes
    this.messageCache = new Cache<SlackMessage[]>({
      ttlMs: 120000,
      maxSize: 100,
    });
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    // Apply rate limiting
    await this.rateLimiter.acquire();

    const url = `${this.baseUrl}/${endpoint}`;

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    };

    if (body && method === 'POST') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json() as { ok: boolean; error?: string } & T;

    if (!data.ok) {
      log.error({ endpoint, error: data.error }, 'Slack API error');
      throw new Error(`Slack API error: ${data.error}`);
    }

    return data;
  }

  // Search messages
  async searchMessages(query: string, count: number = 20): Promise<SlackSearchResult> {
    const response = await this.request<{
      messages: {
        matches: Array<{
          ts: string;
          channel: { id: string; name: string };
          user: string;
          username: string;
          text: string;
          permalink: string;
        }>;
        total: number;
      };
    }>('POST', 'search.messages', {
      query,
      count,
      sort: 'timestamp',
      sort_dir: 'desc',
    });

    return {
      messages: response.messages.matches.map((m) => ({
        ts: m.ts,
        channelId: m.channel.id,
        channelName: m.channel.name,
        user: m.user,
        username: m.username,
        text: m.text,
        timestamp: new Date(parseFloat(m.ts) * 1000),
        permalink: m.permalink,
      })),
      total: response.messages.total,
    };
  }

  // Get channel history
  async getChannelHistory(
    channelId: string,
    limit: number = 100
  ): Promise<SlackMessage[]> {
    const response = await this.request<{
      messages: Array<{
        ts: string;
        user: string;
        text: string;
        thread_ts?: string;
      }>;
    }>('POST', 'conversations.history', {
      channel: channelId,
      limit,
    });

    // Get channel info for name
    const channelInfo = await this.getChannelInfo(channelId);

    return response.messages.map((m) => ({
      ts: m.ts,
      channelId,
      channelName: channelInfo.name,
      user: m.user,
      username: '', // Would need users.info call to get username
      text: m.text,
      timestamp: new Date(parseFloat(m.ts) * 1000),
      threadTs: m.thread_ts,
    }));
  }

  // Get thread replies
  async getThreadReplies(channelId: string, threadTs: string): Promise<SlackMessage[]> {
    const response = await this.request<{
      messages: Array<{
        ts: string;
        user: string;
        text: string;
      }>;
    }>('POST', 'conversations.replies', {
      channel: channelId,
      ts: threadTs,
    });

    const channelInfo = await this.getChannelInfo(channelId);

    return response.messages.map((m) => ({
      ts: m.ts,
      channelId,
      channelName: channelInfo.name,
      user: m.user,
      username: '',
      text: m.text,
      timestamp: new Date(parseFloat(m.ts) * 1000),
      threadTs,
    }));
  }

  // Get channel info (with caching)
  async getChannelInfo(channelId: string): Promise<SlackChannel> {
    // Check cache first
    const cached = this.channelCache.get(channelId);
    if (cached) {
      log.debug({ channelId }, 'Returning cached Slack channel info');
      return cached;
    }

    const response = await this.request<{
      channel: {
        id: string;
        name: string;
        is_private: boolean;
        topic: { value: string };
        purpose: { value: string };
      };
    }>('POST', 'conversations.info', {
      channel: channelId,
    });

    const channelInfo: SlackChannel = {
      id: response.channel.id,
      name: response.channel.name,
      isPrivate: response.channel.is_private,
      topic: response.channel.topic.value,
      purpose: response.channel.purpose.value,
    };

    this.channelCache.set(channelId, channelInfo);
    return channelInfo;
  }

  // List channels
  async listChannels(types: string = 'public_channel'): Promise<SlackChannel[]> {
    const response = await this.request<{
      channels: Array<{
        id: string;
        name: string;
        is_private: boolean;
        topic: { value: string };
        purpose: { value: string };
      }>;
    }>('POST', 'conversations.list', {
      types,
      limit: 1000,
    });

    return response.channels.map((c) => ({
      id: c.id,
      name: c.name,
      isPrivate: c.is_private,
      topic: c.topic.value,
      purpose: c.purpose.value,
    }));
  }

  // Get user info
  async getUserInfo(userId: string): Promise<{ id: string; name: string; realName: string }> {
    const response = await this.request<{
      user: {
        id: string;
        name: string;
        real_name: string;
      };
    }>('POST', 'users.info', {
      user: userId,
    });

    return {
      id: response.user.id,
      name: response.user.name,
      realName: response.user.real_name,
    };
  }

  // Find discussions related to a PR or feature
  async findRelatedDiscussions(
    searchTerms: string[],
    channels?: string[]
  ): Promise<SlackMessage[]> {
    const allMessages: SlackMessage[] = [];

    for (const term of searchTerms) {
      try {
        let query = term;
        if (channels && channels.length > 0) {
          query = `${term} in:${channels.join(' in:')}`;
        }

        const result = await this.searchMessages(query, 10);
        allMessages.push(...result.messages);
      } catch (error) {
        log.warn({ term, error }, 'Failed to search Slack messages');
      }
    }

    // Deduplicate by ts
    const seen = new Set<string>();
    return allMessages.filter((m) => {
      if (seen.has(m.ts)) return false;
      seen.add(m.ts);
      return true;
    });
  }

  // Get context for a PR from Slack discussions
  async getContextForPR(
    prTitle: string,
    prBody: string | null,
    repoName: string
  ): Promise<{
    messages: SlackMessage[];
    summary: string;
  }> {
    // Extract potential search terms
    const searchTerms = [
      repoName,
      ...prTitle.split(/\s+/).filter((word) => word.length > 3).slice(0, 3),
    ];

    // Search for related messages
    const messages = await this.findRelatedDiscussions(searchTerms);

    // Fetch thread context for relevant messages
    const messagesWithThreads: SlackMessage[] = [];
    for (const msg of messages.slice(0, 5)) {
      if (msg.threadTs) {
        try {
          const replies = await this.getThreadReplies(msg.channelId, msg.threadTs);
          msg.replies = replies;
        } catch (error) {
          log.warn({ ts: msg.ts, error }, 'Failed to fetch thread replies');
        }
      }
      messagesWithThreads.push(msg);
    }

    // Build summary
    const summary = messagesWithThreads.length > 0
      ? messagesWithThreads
          .map((m) => {
            let text = `[#${m.channelName}] ${m.text.slice(0, 200)}`;
            if (m.replies && m.replies.length > 0) {
              text += `\n  Thread (${m.replies.length} replies): ${m.replies[0]?.text.slice(0, 100)}...`;
            }
            return text;
          })
          .join('\n\n')
      : 'No related Slack discussions found';

    return { messages: messagesWithThreads, summary };
  }

  // Post a message (for notifications)
  async postMessage(
    channelId: string,
    text: string,
    threadTs?: string
  ): Promise<SlackMessage> {
    const body: Record<string, unknown> = {
      channel: channelId,
      text,
    };

    if (threadTs) {
      body.thread_ts = threadTs;
    }

    const response = await this.request<{
      ts: string;
      channel: string;
      message: { text: string };
    }>('POST', 'chat.postMessage', body);

    return {
      ts: response.ts,
      channelId: response.channel,
      channelName: '',
      user: '',
      username: 'DocSynth Bot',
      text: response.message.text,
      timestamp: new Date(),
      threadTs,
    };
  }

  // Post documentation update notification
  async notifyDocUpdate(
    channelId: string,
    repoName: string,
    prNumber: number,
    docsGenerated: string[]
  ): Promise<void> {
    const text = `📚 *Documentation Updated*\n\nRepository: \`${repoName}\`\nPR: #${prNumber}\n\nGenerated docs:\n${docsGenerated.map((d) => `• ${d}`).join('\n')}`;

    await this.postMessage(channelId, text);
    log.info({ channelId, repoName, prNumber }, 'Posted doc update notification to Slack');
  }

  // Clear the cache
  clearCache(): void {
    this.channelCache.clear();
    this.messageCache.clear();
    log.debug('Slack cache cleared');
  }

  // Check if rate limit allows a request
  canMakeRequest(): boolean {
    return this.rateLimiter.canAcquire();
  }
}

export function createSlackClient(config: SlackConfig): SlackMCPClient {
  return new SlackMCPClient(config);
}
