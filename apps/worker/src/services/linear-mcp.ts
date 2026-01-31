import { createLogger, RateLimiter, Cache } from '@docsynth/utils';

const log = createLogger('linear-mcp');

export interface LinearConfig {
  apiKey: string;
  teamId?: string;
  rateLimitPerMinute?: number;
  cacheTtlMs?: number;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: string;
  priority: number;
  priorityLabel: string;
  assignee: string | null;
  creator: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  url: string;
  comments: LinearComment[];
}

export interface LinearComment {
  id: string;
  body: string;
  user: string;
  createdAt: string;
}

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearSearchResult {
  issues: LinearIssue[];
}

export class LinearMCPClient {
  private apiKey: string;
  private teamId?: string;
  private baseUrl = 'https://api.linear.app/graphql';
  private rateLimiter: RateLimiter;
  private issueCache: Cache<LinearIssue>;
  private teamCache: Cache<LinearTeam[]>;

  constructor(config: LinearConfig) {
    this.apiKey = config.apiKey;
    this.teamId = config.teamId;

    // Linear rate limit: 1500 requests per hour (~25/min conservative)
    this.rateLimiter = new RateLimiter({
      maxRequests: config.rateLimitPerMinute ?? 25,
      windowMs: 60000,
    });

    // Cache issues for 5 minutes
    this.issueCache = new Cache<LinearIssue>({
      ttlMs: config.cacheTtlMs ?? 300000,
      maxSize: 500,
    });

    // Cache teams for 30 minutes (they rarely change)
    this.teamCache = new Cache<LinearTeam[]>({
      ttlMs: 1800000,
      maxSize: 10,
    });
  }

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    // Apply rate limiting
    await this.rateLimiter.acquire();

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const error = await response.text();
      log.error({ status: response.status, error }, 'Linear API error');
      throw new Error(`Linear API error: ${response.status}`);
    }

    const data = await response.json() as { data: T; errors?: Array<{ message: string }> };

    if (data.errors && data.errors.length > 0) {
      log.error({ errors: data.errors }, 'Linear GraphQL errors');
      throw new Error(`Linear GraphQL error: ${data.errors[0]?.message}`);
    }

    return data.data;
  }

  // Get teams (with caching)
  async getTeams(): Promise<LinearTeam[]> {
    // Check cache first
    const cached = this.teamCache.get('all-teams');
    if (cached) {
      log.debug('Returning cached Linear teams');
      return cached;
    }

    const query = `
      query {
        teams {
          nodes {
            id
            name
            key
          }
        }
      }
    `;

    const data = await this.graphql<{
      teams: { nodes: Array<{ id: string; name: string; key: string }> };
    }>(query);

    this.teamCache.set('all-teams', data.teams.nodes);
    return data.teams.nodes;
  }

  // Search issues
  async searchIssues(searchText: string, teamId?: string): Promise<LinearIssue[]> {
    const team = teamId || this.teamId;

    const query = `
      query SearchIssues($filter: IssueFilter, $first: Int) {
        issues(filter: $filter, first: $first) {
          nodes {
            id
            identifier
            title
            description
            state { name }
            priority
            priorityLabel
            assignee { name }
            creator { name }
            createdAt
            updatedAt
            labels { nodes { name } }
            url
            comments {
              nodes {
                id
                body
                user { name }
                createdAt
              }
            }
          }
        }
      }
    `;

    const filter: Record<string, unknown> = {
      or: [
        { title: { containsIgnoreCase: searchText } },
        { description: { containsIgnoreCase: searchText } },
      ],
    };

    if (team) {
      filter.team = { id: { eq: team } };
    }

    const data = await this.graphql<{
      issues: {
        nodes: Array<{
          id: string;
          identifier: string;
          title: string;
          description: string | null;
          state: { name: string };
          priority: number;
          priorityLabel: string;
          assignee: { name: string } | null;
          creator: { name: string };
          createdAt: string;
          updatedAt: string;
          labels: { nodes: Array<{ name: string }> };
          url: string;
          comments: {
            nodes: Array<{
              id: string;
              body: string;
              user: { name: string };
              createdAt: string;
            }>;
          };
        }>;
      };
    }>(query, { filter, first: 20 });

    return data.issues.nodes.map((issue) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      state: issue.state.name,
      priority: issue.priority,
      priorityLabel: issue.priorityLabel,
      assignee: issue.assignee?.name || null,
      creator: issue.creator.name,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      labels: issue.labels.nodes.map((l) => l.name),
      url: issue.url,
      comments: issue.comments.nodes.map((c) => ({
        id: c.id,
        body: c.body,
        user: c.user.name,
        createdAt: c.createdAt,
      })),
    }));
  }

  // Get issue by identifier (e.g., ENG-123) with caching
  async getIssue(identifier: string): Promise<LinearIssue> {
    // Check cache first
    const cached = this.issueCache.get(identifier);
    if (cached) {
      log.debug({ identifier }, 'Returning cached Linear issue');
      return cached;
    }

    // Linear uses UUID for ID, but we can search by identifier
    const issues = await this.searchIssues(identifier);
    const issue = issues.find((i) => i.identifier === identifier);

    if (!issue) {
      throw new Error(`Issue ${identifier} not found`);
    }

    this.issueCache.set(identifier, issue);
    return issue;
  }

  // Extract issue identifiers from text (e.g., ENG-123, PROJ-456)
  extractIssueIdentifiers(text: string): string[] {
    const pattern = /([A-Z][A-Z0-9]+-\d+)/g;
    const matches = text.match(pattern);
    return [...new Set(matches || [])];
  }

  // Get context for a PR
  async getContextForPR(
    prTitle: string,
    prBody: string | null
  ): Promise<{
    issues: LinearIssue[];
    summary: string;
  }> {
    const issues: LinearIssue[] = [];

    // Extract issue identifiers from PR
    const textToSearch = `${prTitle} ${prBody || ''}`;
    const identifiers = this.extractIssueIdentifiers(textToSearch);

    // Fetch each linked issue
    for (const identifier of identifiers) {
      try {
        const issue = await this.getIssue(identifier);
        issues.push(issue);
        log.info({ identifier }, 'Fetched linked Linear issue');
      } catch (error) {
        log.warn({ identifier, error }, 'Failed to fetch Linear issue');
      }
    }

    // If no explicit issues, search by title keywords
    if (issues.length === 0) {
      const searchTerms = prTitle.split(/\s+/).slice(0, 3).join(' ');
      const searchResults = await this.searchIssues(searchTerms);
      issues.push(...searchResults.slice(0, 3));
    }

    // Build summary
    const summary = issues.length > 0
      ? issues
          .map((i) => {
            let text = `[${i.identifier}] ${i.title} (${i.state})`;
            if (i.description) {
              text += `\n  ${i.description.slice(0, 200)}`;
            }
            if (i.comments.length > 0) {
              text += `\n  Latest comment: ${i.comments[0]?.body.slice(0, 100)}...`;
            }
            return text;
          })
          .join('\n\n')
      : 'No related Linear issues found';

    return { issues, summary };
  }

  // Get recent issues for context
  async getRecentIssues(teamId?: string, limit: number = 20): Promise<LinearIssue[]> {
    const team = teamId || this.teamId;

    const query = `
      query RecentIssues($filter: IssueFilter, $first: Int) {
        issues(filter: $filter, first: $first, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            description
            state { name }
            priority
            priorityLabel
            assignee { name }
            creator { name }
            createdAt
            updatedAt
            labels { nodes { name } }
            url
            comments {
              nodes {
                id
                body
                user { name }
                createdAt
              }
            }
          }
        }
      }
    `;

    const filter: Record<string, unknown> = {};
    if (team) {
      filter.team = { id: { eq: team } };
    }

    const data = await this.graphql<{
      issues: {
        nodes: Array<{
          id: string;
          identifier: string;
          title: string;
          description: string | null;
          state: { name: string };
          priority: number;
          priorityLabel: string;
          assignee: { name: string } | null;
          creator: { name: string };
          createdAt: string;
          updatedAt: string;
          labels: { nodes: Array<{ name: string }> };
          url: string;
          comments: {
            nodes: Array<{
              id: string;
              body: string;
              user: { name: string };
              createdAt: string;
            }>;
          };
        }>;
      };
    }>(query, { filter, first: limit });

    return data.issues.nodes.map((issue) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      state: issue.state.name,
      priority: issue.priority,
      priorityLabel: issue.priorityLabel,
      assignee: issue.assignee?.name || null,
      creator: issue.creator.name,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      labels: issue.labels.nodes.map((l) => l.name),
      url: issue.url,
      comments: issue.comments.nodes.map((c) => ({
        id: c.id,
        body: c.body,
        user: c.user.name,
        createdAt: c.createdAt,
      })),
    }));
  }

  // Get issue with full comment history
  async getIssueWithComments(identifier: string): Promise<LinearIssue> {
    return this.getIssue(identifier);
  }

  // Clear the cache
  clearCache(): void {
    this.issueCache.clear();
    this.teamCache.clear();
    log.debug('Linear cache cleared');
  }

  // Check if rate limit allows a request
  canMakeRequest(): boolean {
    return this.rateLimiter.canAcquire();
  }
}

export function createLinearClient(config: LinearConfig): LinearMCPClient {
  return new LinearMCPClient(config);
}
