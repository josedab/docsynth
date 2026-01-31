import { createLogger } from '@docsynth/utils';

const log = createLogger('confluence-mcp');

export interface ConfluenceConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  spaceKey?: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  spaceKey: string;
  body: string;
  version: number;
  url: string;
}

export class ConfluenceMCPClient {
  private baseUrl: string;
  private email: string;
  private apiToken: string;
  private spaceKey?: string;

  constructor(config: ConfluenceConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.email = config.email;
    this.apiToken = config.apiToken;
    this.spaceKey = config.spaceKey;
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
    const url = `${this.baseUrl}/wiki/rest/api${path}`;

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
      log.error({ status: response.status, error }, 'Confluence API error');
      throw new Error(`Confluence API error: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  // Search for pages
  async searchPages(query: string, spaceKey?: string): Promise<ConfluencePage[]> {
    const space = spaceKey || this.spaceKey;
    const cql = space
      ? `space = "${space}" AND text ~ "${query}"`
      : `text ~ "${query}"`;

    const response = await this.request<{
      results: Array<{
        content: {
          id: string;
          title: string;
          space: { key: string };
          _links: { webui: string };
        };
      }>;
    }>('GET', `/search?cql=${encodeURIComponent(cql)}&limit=20`);

    return response.results.map((r) => ({
      id: r.content.id,
      title: r.content.title,
      spaceKey: r.content.space.key,
      body: '',
      version: 0,
      url: `${this.baseUrl}/wiki${r.content._links.webui}`,
    }));
  }

  // Get page content
  async getPage(pageId: string): Promise<ConfluencePage> {
    const response = await this.request<{
      id: string;
      title: string;
      space: { key: string };
      body: { storage: { value: string } };
      version: { number: number };
      _links: { webui: string };
    }>('GET', `/content/${pageId}?expand=body.storage,version,space`);

    return {
      id: response.id,
      title: response.title,
      spaceKey: response.space.key,
      body: response.body.storage.value,
      version: response.version.number,
      url: `${this.baseUrl}/wiki${response._links.webui}`,
    };
  }

  // Create a new page
  async createPage(
    title: string,
    content: string,
    spaceKey?: string,
    parentId?: string
  ): Promise<ConfluencePage> {
    const space = spaceKey || this.spaceKey;
    if (!space) {
      throw new Error('Space key is required');
    }

    const body: {
      type: string;
      title: string;
      space: { key: string };
      body: { storage: { value: string; representation: string } };
      ancestors?: Array<{ id: string }>;
    } = {
      type: 'page',
      title,
      space: { key: space },
      body: {
        storage: {
          value: content,
          representation: 'storage',
        },
      },
    };

    if (parentId) {
      body.ancestors = [{ id: parentId }];
    }

    const response = await this.request<{
      id: string;
      title: string;
      space: { key: string };
      version: { number: number };
      _links: { webui: string };
    }>('POST', '/content', body);

    return {
      id: response.id,
      title: response.title,
      spaceKey: response.space.key,
      body: content,
      version: response.version.number,
      url: `${this.baseUrl}/wiki${response._links.webui}`,
    };
  }

  // Update existing page
  async updatePage(
    pageId: string,
    title: string,
    content: string,
    currentVersion: number
  ): Promise<ConfluencePage> {
    const response = await this.request<{
      id: string;
      title: string;
      space: { key: string };
      version: { number: number };
      _links: { webui: string };
    }>('PUT', `/content/${pageId}`, {
      type: 'page',
      title,
      body: {
        storage: {
          value: content,
          representation: 'storage',
        },
      },
      version: {
        number: currentVersion + 1,
      },
    });

    return {
      id: response.id,
      title: response.title,
      spaceKey: response.space.key,
      body: content,
      version: response.version.number,
      url: `${this.baseUrl}/wiki${response._links.webui}`,
    };
  }

  // Convert Markdown to Confluence storage format
  markdownToConfluence(markdown: string): string {
    // Basic markdown to Confluence conversion
    let storage = markdown;

    // Headers
    storage = storage.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    storage = storage.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    storage = storage.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold and italic
    storage = storage.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    storage = storage.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Code blocks
    storage = storage.replace(
      /```(\w+)?\n([\s\S]+?)```/g,
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">$1</ac:parameter><ac:plain-text-body><![CDATA[$2]]></ac:plain-text-body></ac:structured-macro>'
    );

    // Inline code
    storage = storage.replace(/`(.+?)`/g, '<code>$1</code>');

    // Links
    storage = storage.replace(
      /\[(.+?)\]\((.+?)\)/g,
      '<a href="$2">$1</a>'
    );

    // Lists
    storage = storage.replace(/^- (.+)$/gm, '<li>$1</li>');
    storage = storage.replace(/(<li>.*<\/li>(\n)?)+/g, '<ul>$&</ul>');

    // Paragraphs
    storage = storage.replace(/\n\n/g, '</p><p>');
    storage = `<p>${storage}</p>`;

    return storage;
  }

  // Publish documentation to Confluence
  async publishDocumentation(
    docs: Array<{
      title: string;
      content: string;
      parentId?: string;
    }>,
    spaceKey?: string
  ): Promise<ConfluencePage[]> {
    const results: ConfluencePage[] = [];

    for (const doc of docs) {
      try {
        // Check if page exists
        const existing = await this.searchPages(doc.title, spaceKey);
        const match = existing.find((p) => p.title === doc.title);

        const confluenceContent = this.markdownToConfluence(doc.content);

        if (match) {
          // Update existing page
          const fullPage = await this.getPage(match.id);
          const updated = await this.updatePage(
            match.id,
            doc.title,
            confluenceContent,
            fullPage.version
          );
          results.push(updated);
          log.info({ pageId: updated.id, title: doc.title }, 'Updated Confluence page');
        } else {
          // Create new page
          const created = await this.createPage(
            doc.title,
            confluenceContent,
            spaceKey,
            doc.parentId
          );
          results.push(created);
          log.info({ pageId: created.id, title: doc.title }, 'Created Confluence page');
        }
      } catch (error) {
        log.error({ error, title: doc.title }, 'Failed to publish to Confluence');
      }
    }

    return results;
  }
}

export function createConfluenceClient(config: ConfluenceConfig): ConfluenceMCPClient {
  return new ConfluenceMCPClient(config);
}
