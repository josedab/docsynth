/**
 * Doc Migration Engine Service
 *
 * Import docs from Confluence, Notion, GitBook, Google Docs with format
 * conversion, link rewriting, and metadata preservation.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-migration-engine-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface MigrationJob {
  id: string;
  organizationId: string;
  source: 'confluence' | 'notion' | 'gitbook' | 'google-docs' | 'markdown';
  targetRepositoryId: string;
  status: 'pending' | 'connecting' | 'importing' | 'converting' | 'completed' | 'failed';
  progress: number;
  stats: MigrationStats;
  options: MigrationOptions;
  createdAt: Date;
}

export interface MigrationStats {
  pagesDiscovered: number;
  pagesImported: number;
  pagesFailed: number;
  imagesConverted: number;
  linksRewritten: number;
  totalWordCount: number;
}

export interface MigrationOptions {
  preserveMetadata: boolean;
  convertImages: boolean;
  rewriteLinks: boolean;
  dryRun: boolean;
  pathPrefix?: string;
}

export interface ImportedPage {
  sourcePath: string;
  targetPath: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  wordCount: number;
  imagesCount: number;
  linksCount: number;
}

export interface MigrationPreview {
  source: string;
  pagesFound: number;
  estimatedTime: string;
  pages: Array<{ sourcePath: string; targetPath: string; title: string; wordCount: number }>;
}

// ============================================================================
// Core Functions
// ============================================================================

export async function previewMigration(
  source: MigrationJob['source'],
  connectionConfig: Record<string, string>,
  _targetRepositoryId: string
): Promise<MigrationPreview> {
  const pages = await discoverPages(source, connectionConfig);

  return {
    source,
    pagesFound: pages.length,
    estimatedTime: `${Math.ceil(pages.length * 0.5)} minutes`,
    pages: pages.map((p) => ({
      sourcePath: p.sourcePath,
      targetPath: `docs/${p.sourcePath.replace(/\//g, '-').toLowerCase()}.md`,
      title: p.title,
      wordCount: p.wordCount,
    })),
  };
}

export async function startMigration(
  organizationId: string,
  source: MigrationJob['source'],
  connectionConfig: Record<string, string>,
  targetRepositoryId: string,
  options: MigrationOptions
): Promise<MigrationJob> {
  const job: MigrationJob = {
    id: `mig-${organizationId}-${Date.now()}`,
    organizationId,
    source,
    targetRepositoryId,
    status: 'pending',
    progress: 0,
    stats: {
      pagesDiscovered: 0,
      pagesImported: 0,
      pagesFailed: 0,
      imagesConverted: 0,
      linksRewritten: 0,
      totalWordCount: 0,
    },
    options,
    createdAt: new Date(),
  };

  await db.migrationJob.create({
    data: {
      id: job.id,
      organizationId,
      source,
      targetRepositoryId,
      status: 'pending',
      progress: 0,
      stats: JSON.parse(JSON.stringify(job.stats)),
      options: JSON.parse(JSON.stringify(options)),
      connectionConfig: JSON.parse(JSON.stringify(connectionConfig)),
      createdAt: new Date(),
    },
  });

  log.info({ jobId: job.id, source, target: targetRepositoryId }, 'Migration job created');
  return job;
}

export async function executeMigration(jobId: string): Promise<MigrationJob> {
  const stored = await db.migrationJob.findUnique({ where: { id: jobId } });
  if (!stored) throw new Error(`Migration job not found: ${jobId}`);

  const connectionConfig = stored.connectionConfig as Record<string, string>;
  const options = stored.options as unknown as MigrationOptions;

  // Discover pages
  await db.migrationJob.update({
    where: { id: jobId },
    data: { status: 'connecting', progress: 5 },
  });
  const pages = await discoverPages(stored.source, connectionConfig);

  await db.migrationJob.update({
    where: { id: jobId },
    data: { status: 'importing', progress: 10 },
  });

  const stats: MigrationStats = {
    pagesDiscovered: pages.length,
    pagesImported: 0,
    pagesFailed: 0,
    imagesConverted: 0,
    linksRewritten: 0,
    totalWordCount: 0,
  };
  const progressPerPage = 80 / Math.max(pages.length, 1);

  for (const page of pages) {
    try {
      const converted = convertPage(page, stored.source, options);

      if (!options.dryRun) {
        await prisma.document.create({
          data: {
            repositoryId: stored.targetRepositoryId,
            path: converted.targetPath,
            title: converted.title,
            content: converted.content,
            status: 'published',
          },
        });
      }

      stats.pagesImported++;
      stats.totalWordCount += converted.wordCount;
      stats.linksRewritten += converted.linksCount;
      stats.imagesConverted += converted.imagesCount;
    } catch (error) {
      stats.pagesFailed++;
      log.error({ error, page: page.sourcePath }, 'Failed to import page');
    }

    const progress = Math.round(10 + stats.pagesImported * progressPerPage);
    await db.migrationJob.update({
      where: { id: jobId },
      data: { progress, stats: JSON.parse(JSON.stringify(stats)) },
    });
  }

  await db.migrationJob.update({
    where: { id: jobId },
    data: { status: 'completed', progress: 100, stats: JSON.parse(JSON.stringify(stats)) },
  });

  log.info(
    { jobId, imported: stats.pagesImported, failed: stats.pagesFailed },
    'Migration completed'
  );
  return { ...stored, stats, status: 'completed', progress: 100 } as unknown as MigrationJob;
}

export async function getMigrationStatus(jobId: string): Promise<MigrationJob | null> {
  const stored = await db.migrationJob.findUnique({ where: { id: jobId } });
  if (!stored) return null;
  return {
    id: stored.id,
    organizationId: stored.organizationId,
    source: stored.source,
    targetRepositoryId: stored.targetRepositoryId,
    status: stored.status,
    progress: stored.progress,
    stats: stored.stats as unknown as MigrationStats,
    options: stored.options as unknown as MigrationOptions,
    createdAt: stored.createdAt,
  };
}

export async function getMigrationHistory(organizationId: string): Promise<MigrationJob[]> {
  const jobs = await db.migrationJob.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  return jobs.map((j: any) => ({
    id: j.id,
    organizationId: j.organizationId,
    source: j.source,
    targetRepositoryId: j.targetRepositoryId,
    status: j.status,
    progress: j.progress,
    stats: j.stats,
    options: j.options,
    createdAt: j.createdAt,
  }));
}

// ============================================================================
// Helper Functions
// ============================================================================

async function discoverPages(
  _source: string,
  _config: Record<string, string>
): Promise<ImportedPage[]> {
  // Placeholder: in production, calls source APIs
  const mockPages: ImportedPage[] = [
    {
      sourcePath: '/Getting-Started',
      targetPath: 'docs/getting-started.md',
      title: 'Getting Started',
      content: '# Getting Started\n\nWelcome to the project.',
      metadata: {},
      wordCount: 50,
      imagesCount: 0,
      linksCount: 2,
    },
    {
      sourcePath: '/API-Reference',
      targetPath: 'docs/api-reference.md',
      title: 'API Reference',
      content: '# API Reference\n\nEndpoints documentation.',
      metadata: {},
      wordCount: 120,
      imagesCount: 0,
      linksCount: 5,
    },
    {
      sourcePath: '/Architecture',
      targetPath: 'docs/architecture.md',
      title: 'Architecture',
      content: '# Architecture\n\nSystem overview.',
      metadata: {},
      wordCount: 200,
      imagesCount: 1,
      linksCount: 3,
    },
  ];
  return mockPages;
}

function convertPage(page: ImportedPage, source: string, options: MigrationOptions): ImportedPage {
  let content = page.content;

  // Convert HTML to markdown (simplified)
  content = content.replace(/<h1>(.*?)<\/h1>/g, '# $1');
  content = content.replace(/<h2>(.*?)<\/h2>/g, '## $1');
  content = content.replace(/<p>(.*?)<\/p>/g, '$1\n');
  content = content.replace(/<strong>(.*?)<\/strong>/g, '**$1**');
  content = content.replace(/<em>(.*?)<\/em>/g, '*$1*');
  content = content.replace(/<code>(.*?)<\/code>/g, '`$1`');

  // Rewrite links
  let linksCount = 0;
  if (options.rewriteLinks) {
    content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
      if (url.startsWith('http')) return match;
      linksCount++;
      const newUrl = url.replace(/\//g, '-').toLowerCase() + '.md';
      return `[${text}](${options.pathPrefix ?? 'docs'}/${newUrl})`;
    });
  }

  // Add metadata header
  if (options.preserveMetadata) {
    const frontmatter = `---\ntitle: "${page.title}"\nsource: "${source}"\nimported_at: "${new Date().toISOString()}"\n---\n\n`;
    content = frontmatter + content;
  }

  return { ...page, content, linksCount };
}
