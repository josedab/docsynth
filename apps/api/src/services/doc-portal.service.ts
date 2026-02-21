/**
 * Multi-Tenant Documentation Portal Service
 *
 * Manages white-labeled customer-facing documentation sites with custom domains,
 * theming, SSO, audience-based access control, and build/deploy pipelines.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-portal-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface PortalTheme {
  primaryColor: string;
  logo: string;
  favicon: string;
  headerHtml?: string;
  footerHtml?: string;
  cssOverrides?: string;
}

export interface Portal {
  id: string;
  organizationId: string;
  name: string;
  customDomain: string | null;
  theme: PortalTheme;
  repositoryIds: string[];
  ssoConfig?: { provider: string; clientId: string; issuerUrl: string };
  status: 'active' | 'inactive' | 'building';
  createdAt: Date;
}

export interface PortalBuild {
  id: string;
  portalId: string;
  status: 'building' | 'deployed' | 'failed';
  version: string;
  pages: number;
  deployedAt?: Date;
}

export interface PortalPage {
  path: string;
  title: string;
  content: string;
  audience: 'public' | 'partner' | 'internal';
  version?: string;
}

export interface PortalAnalytics {
  portalId: string;
  period: string;
  pageViews: number;
  uniqueVisitors: number;
  topPages: Array<{ path: string; views: number }>;
  avgTimeOnPage: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create a new documentation portal for an organization.
 */
export async function createPortal(
  organizationId: string,
  config: Omit<Portal, 'id' | 'status' | 'createdAt'>
): Promise<Portal> {
  log.info({ organizationId, name: config.name }, 'Creating portal');

  const portalId = `portal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const portal: Portal = {
    id: portalId,
    organizationId,
    name: config.name,
    customDomain: config.customDomain,
    theme: config.theme,
    repositoryIds: config.repositoryIds,
    ssoConfig: config.ssoConfig,
    status: 'active',
    createdAt: new Date(),
  };

  await db.docPortal.create({
    data: {
      id: portal.id,
      organizationId,
      name: portal.name,
      customDomain: portal.customDomain,
      theme: JSON.parse(JSON.stringify(portal.theme)),
      repositoryIds: portal.repositoryIds,
      ssoConfig: portal.ssoConfig ? JSON.parse(JSON.stringify(portal.ssoConfig)) : null,
      status: portal.status,
      createdAt: portal.createdAt,
    },
  });

  log.info({ portalId, organizationId }, 'Portal created');
  return portal;
}

/**
 * Build a static documentation site from linked repository content.
 */
export async function buildPortal(portalId: string): Promise<PortalBuild> {
  log.info({ portalId }, 'Building portal');

  const portal = await getPortal(portalId);
  if (!portal) throw new Error(`Portal ${portalId} not found`);

  // Update portal status to building
  await db.docPortal.update({
    where: { id: portalId },
    data: { status: 'building' },
  });

  const buildId = `build-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const version = `v${Date.now().toString(36)}`;

  // Collect documents from all linked repositories
  let totalPages = 0;

  try {
    for (const repoId of portal.repositoryIds) {
      const docs = await prisma.document.findMany({
        where: { repositoryId: repoId, path: { endsWith: '.md' } },
        select: { id: true, path: true, content: true },
      });

      const filteredDocs = docs.filter((d) => d.content && d.content.trim().length > 0);
      totalPages += filteredDocs.length;

      // Apply theme transformations
      for (const doc of filteredDocs) {
        const themed = applyTheme(doc.content ?? '', portal.theme);
        await db.portalPage.upsert({
          where: { portalId_path: { portalId, path: doc.path } },
          create: {
            portalId,
            path: doc.path,
            title: extractTitle(doc.path, doc.content ?? ''),
            content: themed,
            audience: inferAudience(doc.path),
            version,
          },
          update: {
            title: extractTitle(doc.path, doc.content ?? ''),
            content: themed,
            version,
            updatedAt: new Date(),
          },
        });
      }
    }

    // Generate sitemap
    const sitemap = generateSitemap(portalId, portal.customDomain ?? `${portalId}.docsynth.dev`);
    await db.portalPage.upsert({
      where: { portalId_path: { portalId, path: '/sitemap.xml' } },
      create: {
        portalId,
        path: '/sitemap.xml',
        title: 'Sitemap',
        content: sitemap,
        audience: 'public',
        version,
      },
      update: { content: sitemap, version, updatedAt: new Date() },
    });

    const build: PortalBuild = {
      id: buildId,
      portalId,
      status: 'deployed',
      version,
      pages: totalPages,
      deployedAt: new Date(),
    };

    await db.portalBuild.create({
      data: {
        id: buildId,
        portalId,
        status: 'deployed',
        version,
        pages: totalPages,
        deployedAt: new Date(),
      },
    });

    await db.docPortal.update({
      where: { id: portalId },
      data: { status: 'active', lastBuildAt: new Date(), lastBuildVersion: version },
    });

    log.info({ portalId, buildId, pages: totalPages, version }, 'Portal build deployed');
    return build;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown build error';

    await db.portalBuild.create({
      data: { id: buildId, portalId, status: 'failed', version, pages: 0, error: message },
    });

    await db.docPortal.update({
      where: { id: portalId },
      data: { status: 'active' },
    });

    log.error({ portalId, err: message }, 'Portal build failed');
    return { id: buildId, portalId, status: 'failed', version, pages: 0 };
  }
}

/**
 * Get a portal configuration by ID.
 */
export async function getPortal(portalId: string): Promise<Portal | null> {
  const row = await db.docPortal.findUnique({ where: { id: portalId } });
  if (!row) return null;

  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    customDomain: row.customDomain,
    theme: row.theme as PortalTheme,
    repositoryIds: row.repositoryIds as string[],
    ssoConfig: row.ssoConfig as Portal['ssoConfig'],
    status: row.status,
    createdAt: row.createdAt,
  };
}

/**
 * Update a portal's configuration.
 */
export async function updatePortal(portalId: string, updates: Partial<Portal>): Promise<Portal> {
  log.info({ portalId }, 'Updating portal');

  const existing = await getPortal(portalId);
  if (!existing) throw new Error(`Portal ${portalId} not found`);

  const data: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.customDomain !== undefined) data.customDomain = updates.customDomain;
  if (updates.theme) data.theme = JSON.parse(JSON.stringify(updates.theme));
  if (updates.repositoryIds) data.repositoryIds = updates.repositoryIds;
  if (updates.ssoConfig) data.ssoConfig = JSON.parse(JSON.stringify(updates.ssoConfig));
  if (updates.status) data.status = updates.status;

  await db.docPortal.update({ where: { id: portalId }, data });

  const updated = await getPortal(portalId);
  log.info({ portalId }, 'Portal updated');
  return updated!;
}

/**
 * List all portals for an organization.
 */
export async function listPortals(organizationId: string): Promise<Portal[]> {
  const rows = await db.docPortal.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    organizationId: row.organizationId as string,
    name: row.name as string,
    customDomain: row.customDomain as string | null,
    theme: row.theme as PortalTheme,
    repositoryIds: row.repositoryIds as string[],
    ssoConfig: row.ssoConfig as Portal['ssoConfig'],
    status: row.status as Portal['status'],
    createdAt: row.createdAt as Date,
  }));
}

/**
 * Get portal analytics for a given time period.
 */
export async function getPortalAnalytics(portalId: string, days = 30): Promise<PortalAnalytics> {
  log.info({ portalId, days }, 'Fetching portal analytics');

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const events = await db.portalAnalyticsEvent.findMany({
    where: { portalId, timestamp: { gte: since } },
    select: { path: true, visitorId: true, timeOnPage: true },
  });

  // Aggregate page views
  const pageViewMap = new Map<string, number>();
  const visitors = new Set<string>();
  let totalTime = 0;

  for (const event of events) {
    pageViewMap.set(event.path, (pageViewMap.get(event.path) ?? 0) + 1);
    if (event.visitorId) visitors.add(event.visitorId);
    totalTime += event.timeOnPage ?? 0;
  }

  const topPages = [...pageViewMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, views]) => ({ path, views }));

  const analytics: PortalAnalytics = {
    portalId,
    period: `${days}d`,
    pageViews: events.length,
    uniqueVisitors: visitors.size,
    topPages,
    avgTimeOnPage: events.length > 0 ? Math.round(totalTime / events.length) : 0,
  };

  log.info(
    { portalId, pageViews: analytics.pageViews, visitors: analytics.uniqueVisitors },
    'Analytics fetched'
  );
  return analytics;
}

/**
 * Resolve a specific page for serving, with audience-based access control.
 */
export async function resolvePortalPage(
  portalId: string,
  path: string,
  audience?: string
): Promise<PortalPage | null> {
  const page = await db.portalPage.findFirst({
    where: { portalId, path },
    orderBy: { updatedAt: 'desc' },
  });

  if (!page) return null;

  const pageData: PortalPage = {
    path: page.path,
    title: page.title,
    content: page.content,
    audience: page.audience,
    version: page.version,
  };

  // Check audience access
  if (!filterByAudience(pageData, audience ?? 'public')) {
    log.warn({ portalId, path, audience }, 'Access denied — insufficient audience level');
    return null;
  }

  return pageData;
}

// ============================================================================
// Private Helpers
// ============================================================================

function generateSitemap(portalId: string, domain: string): string {
  const baseUrl = `https://${domain}`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${baseUrl}/</loc><priority>1.0</priority></url>`,
    `  <url><loc>${baseUrl}/docs</loc><priority>0.8</priority></url>`,
    `  <url><loc>${baseUrl}/api</loc><priority>0.7</priority></url>`,
    '</urlset>',
  ].join('\n');
}

function applyTheme(content: string, theme: PortalTheme): string {
  let themed = theme.headerHtml ? `${theme.headerHtml}\n\n${content}` : content;
  if (theme.footerHtml) themed = `${themed}\n\n${theme.footerHtml}`;
  return themed;
}

function filterByAudience(page: PortalPage, requestedAudience: string): boolean {
  const accessLevels: Record<string, number> = { public: 0, partner: 1, internal: 2 };
  const pageLevel = accessLevels[page.audience] ?? 0;
  const requestLevel = accessLevels[requestedAudience] ?? 0;
  return requestLevel >= pageLevel;
}

function extractTitle(path: string, content: string): string {
  const headerMatch = content.match(/^#\s+(.+)$/m);
  if (headerMatch) return headerMatch[1].trim();

  const filename = path.split('/').pop() ?? path;
  return filename
    .replace(/\.md$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferAudience(path: string): 'public' | 'partner' | 'internal' {
  const lower = path.toLowerCase();
  if (lower.includes('internal') || lower.includes('private') || lower.includes('design-doc')) {
    return 'internal';
  }
  if (lower.includes('partner') || lower.includes('integration') || lower.includes('sdk')) {
    return 'partner';
  }
  return 'public';
}
