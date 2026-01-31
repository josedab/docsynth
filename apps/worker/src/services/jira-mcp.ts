import { createLogger, RateLimiter, Cache } from '@docsynth/utils';

const log = createLogger('jira-mcp');

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey?: string;
  rateLimitPerMinute?: number;
  cacheTtlMs?: number;
}

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  description: string | null;
  status: string;
  issueType: string;
  priority: string;
  assignee: string | null;
  reporter: string;
  created: string;
  updated: string;
  labels: string[];
  url: string;
  comments: JiraComment[];
}

export interface JiraComment {
  id: string;
  author: string;
  body: string;
  created: string;
}

export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
}

export class JiraMCPClient {
  private baseUrl: string;
  private email: string;
  private apiToken: string;
  private projectKey?: string;
  private rateLimiter: RateLimiter;
  private cache: Cache<JiraIssue>;

  constructor(config: JiraConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.email = config.email;
    this.apiToken = config.apiToken;
    this.projectKey = config.projectKey;

    // Default: 60 requests per minute (Jira Cloud limit is ~100/min)
    this.rateLimiter = new RateLimiter({
      maxRequests: config.rateLimitPerMinute ?? 60,
      windowMs: 60000,
    });

    // Default: 5 minute cache TTL
    this.cache = new Cache<JiraIssue>({
      ttlMs: config.cacheTtlMs ?? 300000,
      maxSize: 500,
    });
  }

  private getAuthHeader(): string {
    const credentials = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
    return `Basic ${credentials}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    // Apply rate limiting
    await this.rateLimiter.acquire();

    const url = `${this.baseUrl}/rest/api/3${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': this.getAuthHeader(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      log.error({ status: response.status, error, path }, 'Jira API error');
      throw new Error(`Jira API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  // Search for issues using JQL
  async searchIssues(jql: string, maxResults: number = 20): Promise<JiraSearchResult> {
    const response = await this.request<{
      issues: Array<{
        id: string;
        key: string;
        fields: {
          summary: string;
          description: { content?: Array<{ content?: Array<{ text?: string }> }> } | null;
          status: { name: string };
          issuetype: { name: string };
          priority: { name: string };
          assignee: { displayName: string } | null;
          reporter: { displayName: string };
          created: string;
          updated: string;
          labels: string[];
          comment?: {
            comments: Array<{
              id: string;
              author: { displayName: string };
              body: { content?: Array<{ content?: Array<{ text?: string }> }> };
              created: string;
            }>;
          };
        };
      }>;
      total: number;
    }>('POST', '/search', {
      jql,
      maxResults,
      fields: [
        'summary',
        'description',
        'status',
        'issuetype',
        'priority',
        'assignee',
        'reporter',
        'created',
        'updated',
        'labels',
        'comment',
      ],
    });

    return {
      issues: response.issues.map((issue) => ({
        id: issue.id,
        key: issue.key,
        summary: issue.fields.summary,
        description: this.parseAdfToText(issue.fields.description),
        status: issue.fields.status.name,
        issueType: issue.fields.issuetype.name,
        priority: issue.fields.priority.name,
        assignee: issue.fields.assignee?.displayName || null,
        reporter: issue.fields.reporter.displayName,
        created: issue.fields.created,
        updated: issue.fields.updated,
        labels: issue.fields.labels,
        url: `${this.baseUrl}/browse/${issue.key}`,
        comments: (issue.fields.comment?.comments || []).map((c) => ({
          id: c.id,
          author: c.author.displayName,
          body: this.parseAdfToText(c.body) || '',
          created: c.created,
        })),
      })),
      total: response.total,
    };
  }

  // Parse Atlassian Document Format to plain text
  private parseAdfToText(adf: { content?: Array<{ content?: Array<{ text?: string }> }> } | null): string | null {
    if (!adf || !adf.content) return null;

    const extractText = (node: { text?: string; content?: Array<{ text?: string; content?: unknown[] }> }): string => {
      if (node.text) return node.text;
      if (node.content && Array.isArray(node.content)) {
        return node.content.map((child) => extractText(child as { text?: string; content?: Array<{ text?: string }> })).join('');
      }
      return '';
    };

    return adf.content
      .map((block) => extractText(block as { text?: string; content?: Array<{ text?: string }> }))
      .join('\n')
      .trim();
  }

  // Get a specific issue by key (with caching)
  async getIssue(issueKey: string): Promise<JiraIssue> {
    // Check cache first
    const cached = this.cache.get(issueKey);
    if (cached) {
      log.debug({ issueKey }, 'Returning cached Jira issue');
      return cached;
    }

    const result = await this.searchIssues(`key = "${issueKey}"`, 1);
    if (result.issues.length === 0) {
      throw new Error(`Issue ${issueKey} not found`);
    }

    const issue = result.issues[0]!;
    this.cache.set(issueKey, issue);
    return issue;
  }

  // Find issues related to a PR by searching text
  async findRelatedIssues(searchText: string, projectKey?: string): Promise<JiraIssue[]> {
    const project = projectKey || this.projectKey;
    const projectClause = project ? `project = "${project}" AND ` : '';
    const jql = `${projectClause}(summary ~ "${searchText}" OR description ~ "${searchText}")`;

    try {
      const result = await this.searchIssues(jql, 10);
      return result.issues;
    } catch (error) {
      log.warn({ error, searchText }, 'Failed to search Jira issues');
      return [];
    }
  }

  // Extract issue keys from text (e.g., PROJ-123)
  extractIssueKeys(text: string): string[] {
    const pattern = /([A-Z][A-Z0-9]+-\d+)/g;
    const matches = text.match(pattern);
    return [...new Set(matches || [])];
  }

  // Get context from PR for intent inference
  async getContextForPR(
    prTitle: string,
    prBody: string | null
  ): Promise<{
    issues: JiraIssue[];
    summary: string;
  }> {
    const issues: JiraIssue[] = [];

    // Extract issue keys from PR title and body
    const textToSearch = `${prTitle} ${prBody || ''}`;
    const issueKeys = this.extractIssueKeys(textToSearch);

    // Fetch each linked issue
    for (const key of issueKeys) {
      try {
        const issue = await this.getIssue(key);
        issues.push(issue);
        log.info({ issueKey: key }, 'Fetched linked Jira issue');
      } catch (error) {
        log.warn({ issueKey: key, error }, 'Failed to fetch Jira issue');
      }
    }

    // If no explicit issues found, search by PR title
    if (issues.length === 0) {
      const searchTerms = prTitle.split(/\s+/).slice(0, 5).join(' ');
      const relatedIssues = await this.findRelatedIssues(searchTerms);
      issues.push(...relatedIssues.slice(0, 3));
    }

    // Build summary
    const summary = issues.length > 0
      ? issues
          .map((i) => `[${i.key}] ${i.summary}: ${i.description?.slice(0, 200) || 'No description'}`)
          .join('\n\n')
      : 'No related Jira issues found';

    return { issues, summary };
  }

  // Get recent activity for a project
  async getRecentActivity(projectKey?: string, days: number = 7): Promise<JiraIssue[]> {
    const project = projectKey || this.projectKey;
    if (!project) {
      throw new Error('Project key is required');
    }

    const jql = `project = "${project}" AND updated >= -${days}d ORDER BY updated DESC`;
    const result = await this.searchIssues(jql, 50);
    return result.issues;
  }

  // Get issue with all comments for full context
  async getIssueWithComments(issueKey: string): Promise<JiraIssue> {
    const issue = await this.getIssue(issueKey);

    // Fetch all comments if not included
    if (issue.comments.length === 0) {
      try {
        const commentsResponse = await this.request<{
          comments: Array<{
            id: string;
            author: { displayName: string };
            body: { content?: Array<{ content?: Array<{ text?: string }> }> };
            created: string;
          }>;
        }>('GET', `/issue/${issueKey}/comment`);

        issue.comments = commentsResponse.comments.map((c) => ({
          id: c.id,
          author: c.author.displayName,
          body: this.parseAdfToText(c.body) || '',
          created: c.created,
        }));
      } catch (error) {
        log.warn({ issueKey, error }, 'Failed to fetch issue comments');
      }
    }

    return issue;
  }

  // Clear the cache
  clearCache(): void {
    this.cache.clear();
    log.debug('Jira cache cleared');
  }

  // Check if rate limit allows a request
  canMakeRequest(): boolean {
    return this.rateLimiter.canAcquire();
  }
}

export function createJiraClient(config: JiraConfig): JiraMCPClient {
  return new JiraMCPClient(config);
}
