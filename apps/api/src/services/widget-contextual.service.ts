/**
 * Widget Contextual Service
 *
 * Manages contextual documentation lookup for embedded widgets,
 * including URL-based resolution, token auth, and analytics.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('widget-contextual-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface WidgetConfig {
  widgetId: string;
  repositoryId: string;
  theme: 'light' | 'dark' | 'auto';
  position: 'bottom-right' | 'bottom-left' | 'sidebar';
  enableSearch: boolean;
  enableChat: boolean;
  contextRules: ContextRule[];
  allowedOrigins: string[];
  branding: boolean;
}

export interface ContextRule {
  urlPattern: string;
  docPath: string;
  priority: number;
}

export interface ContextResult {
  widgetId: string;
  matchedDocs: MatchedDoc[];
  searchResults?: SearchResult[];
  resolvedAt: Date;
}

export interface MatchedDoc {
  path: string;
  title: string;
  excerpt: string;
  relevanceScore: number;
  source: 'url-match' | 'api-match' | 'search';
}

export interface SearchResult {
  documentPath: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface WidgetAnalytics {
  widgetId: string;
  period: string;
  views: number;
  searches: number;
  docViews: number;
  topDocs: Array<{ path: string; views: number }>;
  topSearches: Array<{ query: string; count: number }>;
}

export interface EmbedSnippet {
  html: string;
  scriptUrl: string;
  configJson: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Resolve contextual docs for a widget request
 */
export async function resolveContext(
  widgetId: string,
  context: { urlPath?: string; apiEndpoint?: string; searchQuery?: string; userRole?: string }
): Promise<ContextResult> {
  const config = await getWidgetConfig(widgetId);
  if (!config) throw new Error(`Widget not found: ${widgetId}`);

  const matchedDocs: MatchedDoc[] = [];

  // URL-based matching
  if (context.urlPath) {
    const urlMatches = findUrlMatches(context.urlPath, config.contextRules);
    for (const rule of urlMatches) {
      const doc = await prisma.document.findFirst({
        where: { repositoryId: config.repositoryId, path: { contains: rule.docPath } },
        select: { path: true, title: true, content: true },
      });
      if (doc) {
        matchedDocs.push({
          path: doc.path,
          title: doc.title ?? doc.path,
          excerpt: extractExcerpt(doc.content ?? '', 200),
          relevanceScore: rule.priority / 10,
          source: 'url-match',
        });
      }
    }
  }

  // API endpoint matching
  if (context.apiEndpoint) {
    const apiDocs = await prisma.document.findMany({
      where: {
        repositoryId: config.repositoryId,
        content: { contains: context.apiEndpoint },
      },
      select: { path: true, title: true, content: true },
      take: 3,
    });
    for (const doc of apiDocs) {
      matchedDocs.push({
        path: doc.path,
        title: doc.title ?? doc.path,
        excerpt: extractExcerpt(doc.content ?? '', 200),
        relevanceScore: 0.8,
        source: 'api-match',
      });
    }
  }

  // Search
  let searchResults: SearchResult[] | undefined;
  if (context.searchQuery && config.enableSearch) {
    searchResults = await searchDocs(config.repositoryId, context.searchQuery);
  }

  // Track analytics
  await trackWidgetEvent(widgetId, 'view', {
    urlPath: context.urlPath,
    searchQuery: context.searchQuery,
  });

  return { widgetId, matchedDocs, searchResults, resolvedAt: new Date() };
}

/**
 * Create or update widget config
 */
export async function getWidgetConfig(widgetId: string): Promise<WidgetConfig | null> {
  const config = await db.widgetEmbedConfig.findUnique({ where: { id: widgetId } });
  if (!config) return null;

  return {
    widgetId: config.id,
    repositoryId: config.repositoryId,
    theme: config.theme ?? 'auto',
    position: config.position ?? 'bottom-right',
    enableSearch: config.enableSearch ?? true,
    enableChat: config.enableChat ?? false,
    contextRules: (config.contextRules as unknown as ContextRule[]) ?? [],
    allowedOrigins: config.allowedOrigins ?? [],
    branding: config.branding ?? true,
  };
}

export async function createWidgetConfig(
  config: Omit<WidgetConfig, 'widgetId'>
): Promise<WidgetConfig> {
  const created = await db.widgetEmbedConfig.create({
    data: {
      repositoryId: config.repositoryId,
      theme: config.theme,
      position: config.position,
      enableSearch: config.enableSearch,
      enableChat: config.enableChat,
      contextRules: JSON.parse(JSON.stringify(config.contextRules)),
      allowedOrigins: config.allowedOrigins,
      branding: config.branding,
      createdAt: new Date(),
    },
  });

  return { ...config, widgetId: created.id };
}

export async function updateWidgetConfig(
  widgetId: string,
  updates: Partial<WidgetConfig>
): Promise<WidgetConfig | null> {
  await db.widgetEmbedConfig.update({
    where: { id: widgetId },
    data: {
      ...updates,
      contextRules: updates.contextRules
        ? JSON.parse(JSON.stringify(updates.contextRules))
        : undefined,
      updatedAt: new Date(),
    },
  });

  return getWidgetConfig(widgetId);
}

/**
 * Generate embed snippet
 */
export function generateEmbedSnippet(widgetId: string, baseUrl: string): EmbedSnippet {
  const scriptUrl = `${baseUrl}/widget/${widgetId}/embed.js`;
  const configJson = JSON.stringify({ widgetId, baseUrl });

  const html = [
    `<!-- DocSynth Documentation Widget -->`,
    `<script src="${scriptUrl}" data-config='${configJson}' async defer></script>`,
  ].join('\n');

  return { html, scriptUrl, configJson };
}

/**
 * Get widget analytics
 */
export async function getWidgetAnalytics(
  widgetId: string,
  days: number = 30
): Promise<WidgetAnalytics> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const events = await db.widgetEvent.findMany({
    where: { widgetId, createdAt: { gte: startDate } },
    select: { eventType: true, metadata: true },
  });

  const views = events.filter((e: { eventType: string }) => e.eventType === 'view').length;
  const searches = events.filter((e: { eventType: string }) => e.eventType === 'search').length;
  const docViews = events.filter((e: { eventType: string }) => e.eventType === 'doc-view').length;

  return {
    widgetId,
    period: `${days} days`,
    views,
    searches,
    docViews,
    topDocs: [],
    topSearches: [],
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function findUrlMatches(urlPath: string, rules: ContextRule[]): ContextRule[] {
  return rules
    .filter((rule) => {
      const regex = new RegExp(rule.urlPattern.replace(/\*/g, '.*'));
      return regex.test(urlPath);
    })
    .sort((a, b) => b.priority - a.priority);
}

function extractExcerpt(content: string, maxLength: number): string {
  const clean = content
    .replace(/^#+\s.*/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return clean.length > maxLength ? clean.substring(0, maxLength) + '...' : clean;
}

async function searchDocs(repositoryId: string, query: string): Promise<SearchResult[]> {
  const docs = await prisma.document.findMany({
    where: {
      repositoryId,
      OR: [{ content: { contains: query } }, { title: { contains: query } }],
    },
    select: { path: true, title: true, content: true },
    take: 5,
  });

  return docs.map((doc) => ({
    documentPath: doc.path,
    title: doc.title ?? doc.path,
    excerpt: extractExcerpt(doc.content ?? '', 150),
    score: 0.7,
  }));
}

async function trackWidgetEvent(
  widgetId: string,
  eventType: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await db.widgetEvent.create({
      data: {
        widgetId,
        eventType,
        metadata: JSON.parse(JSON.stringify(metadata)),
        createdAt: new Date(),
      },
    });
  } catch (error) {
    log.debug({ error, widgetId }, 'Failed to track widget event');
  }
}
