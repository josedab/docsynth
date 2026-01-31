import { createLogger } from '@docsynth/utils';

const log = createLogger('notion-mcp');

export interface NotionConfig {
  apiToken: string;
  databaseId?: string;
}

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  lastEditedTime: string;
  parentId?: string;
}

export class NotionMCPClient {
  private apiToken: string;
  private databaseId?: string;
  private baseUrl = 'https://api.notion.com/v1';

  constructor(config: NotionConfig) {
    this.apiToken = config.apiToken;
    this.databaseId = config.databaseId;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      log.error({ status: response.status, error }, 'Notion API error');
      throw new Error(`Notion API error: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  // Search for pages
  async searchPages(query: string): Promise<NotionPage[]> {
    const response = await this.request<{
      results: Array<{
        id: string;
        url: string;
        last_edited_time: string;
        parent: { page_id?: string };
        properties: {
          title?: { title: Array<{ plain_text: string }> };
          Name?: { title: Array<{ plain_text: string }> };
        };
      }>;
    }>('POST', '/search', {
      query,
      filter: { property: 'object', value: 'page' },
      page_size: 20,
    });

    return response.results.map((r) => ({
      id: r.id,
      title: this.extractTitle(r.properties),
      url: r.url,
      lastEditedTime: r.last_edited_time,
      parentId: r.parent.page_id,
    }));
  }

  private extractTitle(properties: Record<string, { title?: Array<{ plain_text: string }> }>): string {
    const titleProp = properties.title || properties.Name;
    if (titleProp?.title?.[0]?.plain_text) {
      return titleProp.title[0].plain_text;
    }
    return 'Untitled';
  }

  // Get page content
  async getPageContent(pageId: string): Promise<string> {
    const response = await this.request<{
      results: Array<{
        type: string;
        paragraph?: { rich_text: Array<{ plain_text: string }> };
        heading_1?: { rich_text: Array<{ plain_text: string }> };
        heading_2?: { rich_text: Array<{ plain_text: string }> };
        heading_3?: { rich_text: Array<{ plain_text: string }> };
        bulleted_list_item?: { rich_text: Array<{ plain_text: string }> };
        numbered_list_item?: { rich_text: Array<{ plain_text: string }> };
        code?: { rich_text: Array<{ plain_text: string }>; language: string };
      }>;
    }>('GET', `/blocks/${pageId}/children`);

    return response.results
      .map((block) => {
        const getText = (rt: Array<{ plain_text: string }> | undefined) =>
          rt?.map((t) => t.plain_text).join('') || '';

        switch (block.type) {
          case 'paragraph':
            return getText(block.paragraph?.rich_text);
          case 'heading_1':
            return `# ${getText(block.heading_1?.rich_text)}`;
          case 'heading_2':
            return `## ${getText(block.heading_2?.rich_text)}`;
          case 'heading_3':
            return `### ${getText(block.heading_3?.rich_text)}`;
          case 'bulleted_list_item':
            return `- ${getText(block.bulleted_list_item?.rich_text)}`;
          case 'numbered_list_item':
            return `1. ${getText(block.numbered_list_item?.rich_text)}`;
          case 'code':
            return `\`\`\`${block.code?.language || ''}\n${getText(block.code?.rich_text)}\n\`\`\``;
          default:
            return '';
        }
      })
      .join('\n\n');
  }

  // Create a new page
  async createPage(
    title: string,
    content: string,
    parentPageId?: string
  ): Promise<NotionPage> {
    const blocks = this.markdownToNotionBlocks(content);

    const parent = parentPageId
      ? { page_id: parentPageId }
      : this.databaseId
        ? { database_id: this.databaseId }
        : null;

    if (!parent) {
      throw new Error('Parent page ID or database ID is required');
    }

    const body: {
      parent: { page_id: string } | { database_id: string };
      properties: Record<string, { title: Array<{ text: { content: string } }> }>;
      children: Array<Record<string, unknown>>;
    } = {
      parent,
      properties: this.databaseId
        ? { Name: { title: [{ text: { content: title } }] } }
        : { title: { title: [{ text: { content: title } }] } },
      children: blocks,
    };

    const response = await this.request<{
      id: string;
      url: string;
      last_edited_time: string;
    }>('POST', '/pages', body);

    return {
      id: response.id,
      title,
      url: response.url,
      lastEditedTime: response.last_edited_time,
      parentId: parentPageId,
    };
  }

  // Update page content
  async updatePage(pageId: string, content: string): Promise<void> {
    // First, get existing blocks to delete
    const existingBlocks = await this.request<{
      results: Array<{ id: string }>;
    }>('GET', `/blocks/${pageId}/children`);

    // Delete existing blocks
    for (const block of existingBlocks.results) {
      await this.request('DELETE', `/blocks/${block.id}`);
    }

    // Add new content
    const blocks = this.markdownToNotionBlocks(content);

    await this.request('PATCH', `/blocks/${pageId}/children`, {
      children: blocks,
    });

    log.info({ pageId }, 'Updated Notion page');
  }

  // Convert markdown to Notion blocks
  markdownToNotionBlocks(markdown: string): Array<Record<string, unknown>> {
    const lines = markdown.split('\n');
    const blocks: Array<Record<string, unknown>> = [];
    let inCodeBlock = false;
    let codeContent = '';
    let codeLanguage = '';

    for (const line of lines) {
      // Code block handling
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLanguage = line.slice(3).trim() || 'plain text';
          codeContent = '';
        } else {
          inCodeBlock = false;
          blocks.push({
            type: 'code',
            code: {
              rich_text: [{ type: 'text', text: { content: codeContent.trim() } }],
              language: codeLanguage,
            },
          });
        }
        continue;
      }

      if (inCodeBlock) {
        codeContent += line + '\n';
        continue;
      }

      // Skip empty lines
      if (!line.trim()) continue;

      // Headings
      if (line.startsWith('### ')) {
        blocks.push({
          type: 'heading_3',
          heading_3: {
            rich_text: [{ type: 'text', text: { content: line.slice(4) } }],
          },
        });
      } else if (line.startsWith('## ')) {
        blocks.push({
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: line.slice(3) } }],
          },
        });
      } else if (line.startsWith('# ')) {
        blocks.push({
          type: 'heading_1',
          heading_1: {
            rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
          },
        });
      }
      // Lists
      else if (line.startsWith('- ') || line.startsWith('* ')) {
        blocks.push({
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
          },
        });
      } else if (/^\d+\. /.test(line)) {
        blocks.push({
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\. /, '') } }],
          },
        });
      }
      // Regular paragraphs
      else {
        blocks.push({
          type: 'paragraph',
          paragraph: {
            rich_text: this.parseInlineMarkdown(line),
          },
        });
      }
    }

    return blocks;
  }

  // Parse inline markdown (bold, italic, code, links)
  private parseInlineMarkdown(text: string): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];

    // Patterns defined for future implementation
    // const patterns = [
    //   { regex: /\*\*(.+?)\*\*/g, style: 'bold' },
    //   { regex: /\*(.+?)\*/g, style: 'italic' },
    //   { regex: /`(.+?)`/g, style: 'code' },
    //   { regex: /\[(.+?)\]\((.+?)\)/g, style: 'link' },
    // ];

    // Simplified: just return plain text for now
    // Full implementation would parse all patterns
    result.push({
      type: 'text',
      text: { content: text },
    });

    return result;
  }

  // Publish documentation to Notion
  async publishDocumentation(
    docs: Array<{
      title: string;
      content: string;
      parentId?: string;
    }>
  ): Promise<NotionPage[]> {
    const results: NotionPage[] = [];

    for (const doc of docs) {
      try {
        // Search for existing page
        const existing = await this.searchPages(doc.title);
        const match = existing.find((p) => p.title === doc.title);

        if (match) {
          // Update existing
          await this.updatePage(match.id, doc.content);
          results.push({
            ...match,
            lastEditedTime: new Date().toISOString(),
          });
          log.info({ pageId: match.id, title: doc.title }, 'Updated Notion page');
        } else {
          // Create new
          const created = await this.createPage(doc.title, doc.content, doc.parentId);
          results.push(created);
          log.info({ pageId: created.id, title: doc.title }, 'Created Notion page');
        }
      } catch (error) {
        log.error({ error, title: doc.title }, 'Failed to publish to Notion');
      }
    }

    return results;
  }
}

export function createNotionClient(config: NotionConfig): NotionMCPClient {
  return new NotionMCPClient(config);
}
