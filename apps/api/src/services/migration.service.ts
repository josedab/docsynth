import { prisma } from '@docsynth/database';
import { createLogger, ValidationError, withRetry } from '@docsynth/utils';
import { createHash } from 'crypto';

const log = createLogger('migration-service');

// ============================================================================
// Types
// ============================================================================

export type MigrationSource = 'confluence' | 'notion' | 'gitbook' | 'markdown' | 'readme';

export interface MigrationConfig {
  source: MigrationSource;
  connectionConfig: {
    baseUrl?: string;
    apiToken?: string;
    spaceKey?: string;
    databaseId?: string;
    repoUrl?: string;
  };
  mappings: {
    targetRepositoryId: string;
    pathPrefix?: string;
    docTypeMapping?: Record<string, string>;
  };
  options: {
    preserveMetadata: boolean;
    convertImages: boolean;
    bidirectionalSync: boolean;
    dryRun: boolean;
  };
}

export interface MigrationResult {
  id: string;
  source: MigrationSource;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'partial';
  totalDocuments: number;
  importedDocuments: number;
  skippedDocuments: number;
  failedDocuments: number;
  documents: MigratedDocument[];
  startedAt: Date;
  completedAt: Date | null;
  errors: string[];
}

export interface MigratedDocument {
  sourceId: string;
  sourcePath: string;
  targetDocumentId: string | null;
  targetPath: string;
  status: 'imported' | 'skipped' | 'failed' | 'updated';
  contentHash: string;
  error?: string;
}

export interface SourceDocument {
  id: string;
  title: string;
  content: string;
  path: string;
  metadata?: Record<string, unknown>;
  parentId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// ============================================================================
// Validation
// ============================================================================

export function validateMigrationConfig(config: MigrationConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate source
  const validSources: MigrationSource[] = ['confluence', 'notion', 'gitbook', 'markdown', 'readme'];
  if (!validSources.includes(config.source)) {
    errors.push(`Invalid source: ${config.source}. Must be one of: ${validSources.join(', ')}`);
  }

  // Validate connection config based on source
  switch (config.source) {
    case 'confluence':
      if (!config.connectionConfig.baseUrl) {
        errors.push('Confluence requires baseUrl');
      }
      if (!config.connectionConfig.apiToken) {
        errors.push('Confluence requires apiToken');
      }
      if (!config.connectionConfig.spaceKey) {
        errors.push('Confluence requires spaceKey');
      }
      break;

    case 'notion':
      if (!config.connectionConfig.apiToken) {
        errors.push('Notion requires apiToken');
      }
      if (!config.connectionConfig.databaseId) {
        errors.push('Notion requires databaseId');
      }
      break;

    case 'gitbook':
      if (!config.connectionConfig.baseUrl) {
        errors.push('GitBook requires baseUrl');
      }
      if (!config.connectionConfig.apiToken) {
        errors.push('GitBook requires apiToken');
      }
      break;

    case 'markdown':
    case 'readme':
      if (!config.connectionConfig.repoUrl) {
        errors.push(`${config.source} requires repoUrl`);
      }
      break;
  }

  // Validate mappings
  if (!config.mappings.targetRepositoryId) {
    errors.push('targetRepositoryId is required in mappings');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Migration Management
// ============================================================================

export async function startMigration(
  config: MigrationConfig,
  organizationId: string
): Promise<MigrationResult> {
  // Validate config
  const validation = validateMigrationConfig(config);
  if (!validation.valid) {
    throw new ValidationError('Invalid migration configuration', { errors: validation.errors });
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: {
      id: config.mappings.targetRepositoryId,
      organizationId,
    },
  });

  if (!repository) {
    throw new ValidationError('Target repository not found or access denied');
  }

  // Create migration record
  const migration = await prisma.migration.create({
    data: {
      source: config.source,
      organizationId,
      repositoryId: config.mappings.targetRepositoryId,
      config: config as unknown as Record<string, unknown>,
      status: 'pending',
      totalDocuments: 0,
      importedDocuments: 0,
      skippedDocuments: 0,
      failedDocuments: 0,
      documents: [],
      startedAt: new Date(),
      errors: [],
    },
  });

  const result: MigrationResult = {
    id: migration.id,
    source: config.source,
    status: 'pending',
    totalDocuments: 0,
    importedDocuments: 0,
    skippedDocuments: 0,
    failedDocuments: 0,
    documents: [],
    startedAt: migration.startedAt,
    completedAt: null,
    errors: [],
  };

  log.info({ migrationId: migration.id, source: config.source }, 'Migration started');

  return result;
}

export async function getMigrationStatus(migrationId: string): Promise<MigrationResult | null> {
  const migration = await prisma.migration.findUnique({
    where: { id: migrationId },
  });

  if (!migration) {
    return null;
  }

  return {
    id: migration.id,
    source: migration.source as MigrationSource,
    status: migration.status as MigrationResult['status'],
    totalDocuments: migration.totalDocuments,
    importedDocuments: migration.importedDocuments,
    skippedDocuments: migration.skippedDocuments,
    failedDocuments: migration.failedDocuments,
    documents: (migration.documents as MigratedDocument[]) || [],
    startedAt: migration.startedAt,
    completedAt: migration.completedAt,
    errors: (migration.errors as string[]) || [],
  };
}

export async function getMigrationHistory(
  organizationId: string,
  options?: { repositoryId?: string; limit?: number }
): Promise<MigrationResult[]> {
  const migrations = await prisma.migration.findMany({
    where: {
      organizationId,
      ...(options?.repositoryId && { repositoryId: options.repositoryId }),
    },
    orderBy: { startedAt: 'desc' },
    take: options?.limit || 50,
  });

  return migrations.map((m) => ({
    id: m.id,
    source: m.source as MigrationSource,
    status: m.status as MigrationResult['status'],
    totalDocuments: m.totalDocuments,
    importedDocuments: m.importedDocuments,
    skippedDocuments: m.skippedDocuments,
    failedDocuments: m.failedDocuments,
    documents: (m.documents as MigratedDocument[]) || [],
    startedAt: m.startedAt,
    completedAt: m.completedAt,
    errors: (m.errors as string[]) || [],
  }));
}

// ============================================================================
// Source-Specific Import Functions
// ============================================================================

export async function importFromConfluence(config: MigrationConfig): Promise<SourceDocument[]> {
  const { baseUrl, apiToken, spaceKey } = config.connectionConfig;

  if (!baseUrl || !apiToken || !spaceKey) {
    throw new ValidationError('Missing required Confluence configuration');
  }

  log.info({ baseUrl, spaceKey }, 'Importing from Confluence');

  // Simulate Confluence API call
  // In production, this would use the Confluence REST API
  const documents: SourceDocument[] = [];

  try {
    await withRetry(
      async () => {
        // Mock: Fetch pages from Confluence space
        // Real implementation would use:
        // const response = await fetch(`${baseUrl}/rest/api/content?spaceKey=${spaceKey}&limit=100`, {
        //   headers: { Authorization: `Bearer ${apiToken}` }
        // });

        log.info('Fetching Confluence pages...');

        // For now, return empty array (placeholder for actual API implementation)
        return documents;
      },
      { maxAttempts: 3, baseDelayMs: 1000 }
    );
  } catch (error) {
    log.error({ error }, 'Failed to import from Confluence');
    throw error;
  }

  return documents;
}

export async function importFromNotion(config: MigrationConfig): Promise<SourceDocument[]> {
  const { apiToken, databaseId } = config.connectionConfig;

  if (!apiToken || !databaseId) {
    throw new ValidationError('Missing required Notion configuration');
  }

  log.info({ databaseId }, 'Importing from Notion');

  const documents: SourceDocument[] = [];

  try {
    await withRetry(
      async () => {
        // Mock: Fetch pages from Notion database
        // Real implementation would use Notion SDK:
        // const notion = new Client({ auth: apiToken });
        // const response = await notion.databases.query({ database_id: databaseId });

        log.info('Fetching Notion pages...');

        return documents;
      },
      { maxAttempts: 3, baseDelayMs: 1000 }
    );
  } catch (error) {
    log.error({ error }, 'Failed to import from Notion');
    throw error;
  }

  return documents;
}

export async function importFromGitBook(config: MigrationConfig): Promise<SourceDocument[]> {
  const { baseUrl, apiToken } = config.connectionConfig;

  if (!baseUrl || !apiToken) {
    throw new ValidationError('Missing required GitBook configuration');
  }

  log.info({ baseUrl }, 'Importing from GitBook');

  const documents: SourceDocument[] = [];

  try {
    await withRetry(
      async () => {
        // Mock: Fetch content from GitBook
        // Real implementation would use GitBook API:
        // const response = await fetch(`${baseUrl}/v1/spaces/content`, {
        //   headers: { Authorization: `Bearer ${apiToken}` }
        // });

        log.info('Fetching GitBook content...');

        return documents;
      },
      { maxAttempts: 3, baseDelayMs: 1000 }
    );
  } catch (error) {
    log.error({ error }, 'Failed to import from GitBook');
    throw error;
  }

  return documents;
}

export async function importFromMarkdown(config: MigrationConfig): Promise<SourceDocument[]> {
  const { repoUrl } = config.connectionConfig;

  if (!repoUrl) {
    throw new ValidationError('Missing required markdown repo URL');
  }

  log.info({ repoUrl }, 'Importing from markdown repository');

  const documents: SourceDocument[] = [];

  try {
    await withRetry(
      async () => {
        // Mock: Clone and parse markdown files
        // Real implementation would:
        // 1. Clone the git repository
        // 2. Find all .md files
        // 3. Parse frontmatter and content
        // 4. Build document structure

        log.info('Cloning and parsing markdown repository...');

        return documents;
      },
      { maxAttempts: 3, baseDelayMs: 1000 }
    );
  } catch (error) {
    log.error({ error }, 'Failed to import from markdown repository');
    throw error;
  }

  return documents;
}

// ============================================================================
// Content Conversion
// ============================================================================

export function convertToDocSynthFormat(content: string, source: MigrationSource): string {
  log.info({ source }, 'Converting content to DocSynth format');

  let converted = content;

  switch (source) {
    case 'confluence':
      // Convert Confluence storage format to Markdown
      converted = convertConfluenceToMarkdown(content);
      break;

    case 'notion':
      // Convert Notion blocks to Markdown
      converted = convertNotionToMarkdown(content);
      break;

    case 'gitbook':
      // GitBook already uses Markdown, minimal conversion needed
      converted = normalizeMarkdown(content);
      break;

    case 'markdown':
    case 'readme':
      // Already Markdown, just normalize
      converted = normalizeMarkdown(content);
      break;
  }

  return converted;
}

function convertConfluenceToMarkdown(content: string): string {
  // Basic Confluence storage format to Markdown conversion
  let markdown = content;

  // Convert headings: <h1>...</h1> -> # ...
  markdown = markdown.replace(/<h1>(.*?)<\/h1>/gi, '# $1');
  markdown = markdown.replace(/<h2>(.*?)<\/h2>/gi, '## $1');
  markdown = markdown.replace(/<h3>(.*?)<\/h3>/gi, '### $1');

  // Convert bold: <strong>...</strong> -> **...**
  markdown = markdown.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
  markdown = markdown.replace(/<b>(.*?)<\/b>/gi, '**$1**');

  // Convert italic: <em>...</em> -> *...*
  markdown = markdown.replace(/<em>(.*?)<\/em>/gi, '*$1*');
  markdown = markdown.replace(/<i>(.*?)<\/i>/gi, '*$1*');

  // Convert code: <code>...</code> -> `...`
  markdown = markdown.replace(/<code>(.*?)<\/code>/gi, '`$1`');

  // Convert links: <a href="...">...</a> -> [...]()
  markdown = markdown.replace(/<a href="([^"]*)">(.*?)<\/a>/gi, '[$2]($1)');

  // Convert lists
  markdown = markdown.replace(/<ul>/gi, '');
  markdown = markdown.replace(/<\/ul>/gi, '');
  markdown = markdown.replace(/<li>(.*?)<\/li>/gi, '- $1');

  // Remove remaining HTML tags (simplified)
  markdown = markdown.replace(/<[^>]*>/g, '');

  return markdown.trim();
}

function convertNotionToMarkdown(content: string): string {
  // Notion blocks are typically already in a structured format
  // This is a simplified conversion
  let markdown = content;

  // Handle Notion-specific syntax
  markdown = markdown.replace(/\*\*(.*?)\*\*/g, '**$1**'); // Bold
  markdown = markdown.replace(/\*(.*?)\*/g, '*$1*'); // Italic
  markdown = markdown.replace(/`(.*?)`/g, '`$1`'); // Code

  return markdown.trim();
}

function normalizeMarkdown(content: string): string {
  // Normalize line endings
  let normalized = content.replace(/\r\n/g, '\n');

  // Ensure consistent spacing around headings
  normalized = normalized.replace(/\n{3,}/g, '\n\n');

  // Trim trailing whitespace
  normalized = normalized.split('\n').map(line => line.trimEnd()).join('\n');

  return normalized.trim();
}

// ============================================================================
// Helper Functions
// ============================================================================

export function generateContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function buildDocumentPath(sourcePath: string, pathPrefix?: string): string {
  if (pathPrefix) {
    // Remove leading/trailing slashes and combine
    const prefix = pathPrefix.replace(/^\/|\/$/g, '');
    const path = sourcePath.replace(/^\//, '');
    return `${prefix}/${path}`;
  }
  return sourcePath;
}

export async function createOrUpdateDocument(
  sourceDoc: SourceDocument,
  config: MigrationConfig,
  organizationId: string
): Promise<MigratedDocument> {
  const { targetRepositoryId, pathPrefix } = config.mappings;

  // Convert content to DocSynth format
  const convertedContent = convertToDocSynthFormat(sourceDoc.content, config.source);
  const contentHash = generateContentHash(convertedContent);
  const targetPath = buildDocumentPath(sourceDoc.path, pathPrefix);

  try {
    // Check if document already exists
    const existing = await prisma.document.findFirst({
      where: {
        repositoryId: targetRepositoryId,
        path: targetPath,
      },
    });

    if (existing) {
      // Check if content has changed
      const existingMetadata = (existing.metadata as Record<string, unknown>) || {};
      const existingHash = existingMetadata.migrationContentHash as string;

      if (existingHash === contentHash && !config.options.dryRun) {
        // No changes, skip
        return {
          sourceId: sourceDoc.id,
          sourcePath: sourceDoc.path,
          targetDocumentId: existing.id,
          targetPath,
          status: 'skipped',
          contentHash,
        };
      }

      // Update existing document
      if (!config.options.dryRun) {
        await prisma.document.update({
          where: { id: existing.id },
          data: {
            content: convertedContent,
            title: sourceDoc.title,
            metadata: {
              ...existingMetadata,
              migrationSource: config.source,
              migrationSourceId: sourceDoc.id,
              migrationContentHash: contentHash,
              migrationUpdatedAt: new Date().toISOString(),
              ...(config.options.preserveMetadata && sourceDoc.metadata ? sourceDoc.metadata : {}),
            },
            version: { increment: 1 },
          },
        });
      }

      return {
        sourceId: sourceDoc.id,
        sourcePath: sourceDoc.path,
        targetDocumentId: existing.id,
        targetPath,
        status: 'updated',
        contentHash,
      };
    }

    // Create new document
    let documentId: string | null = null;

    if (!config.options.dryRun) {
      // Determine document type from path or use GUIDE as default
      let docType: 'README' | 'API_REFERENCE' | 'CHANGELOG' | 'GUIDE' | 'TUTORIAL' | 'ARCHITECTURE' | 'ADR' | 'INLINE_COMMENT' = 'GUIDE';
      const lowerPath = targetPath.toLowerCase();
      if (lowerPath.includes('readme')) {
        docType = 'README';
      } else if (lowerPath.includes('changelog')) {
        docType = 'CHANGELOG';
      } else if (lowerPath.includes('api') || lowerPath.includes('reference')) {
        docType = 'API_REFERENCE';
      } else if (lowerPath.includes('tutorial')) {
        docType = 'TUTORIAL';
      } else if (lowerPath.includes('architecture')) {
        docType = 'ARCHITECTURE';
      } else if (lowerPath.includes('adr') || lowerPath.includes('decision')) {
        docType = 'ADR';
      }

      const newDoc = await prisma.document.create({
        data: {
          repositoryId: targetRepositoryId,
          path: targetPath,
          type: docType,
          title: sourceDoc.title,
          content: convertedContent,
          metadata: {
            migrationSource: config.source,
            migrationSourceId: sourceDoc.id,
            migrationContentHash: contentHash,
            migrationImportedAt: new Date().toISOString(),
            ...(config.options.preserveMetadata && sourceDoc.metadata ? sourceDoc.metadata : {}),
          },
        },
      });
      documentId = newDoc.id;
    }

    return {
      sourceId: sourceDoc.id,
      sourcePath: sourceDoc.path,
      targetDocumentId: documentId,
      targetPath,
      status: 'imported',
      contentHash,
    };
  } catch (error) {
    log.error({ error, sourceDoc }, 'Failed to create/update document');
    return {
      sourceId: sourceDoc.id,
      sourcePath: sourceDoc.path,
      targetDocumentId: null,
      targetPath,
      status: 'failed',
      contentHash,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
