/**
 * API Changelog Generation Worker
 *
 * Fetches API specs from two refs, diffs them, detects breaking
 * changes, and generates changelog markdown.
 */

import { createWorker } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('api-changelog-worker');

// Job data interface - will be moved to @docsynth/queue types as APIChangelogJobData
interface APIChangelogJobData {
  repositoryId: string;
  installationId: number;
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
  specPath: string;
  specFormat: 'openapi' | 'graphql' | 'protobuf';
  outputPath: string;
}

export function startAPIChangelogWorker() {
  // TODO: Add 'api-changelog' to QUEUE_NAMES constant in @docsynth/queue
  const worker = createWorker(
    'api-changelog' as any,
    async (job) => {
      const data = job.data as APIChangelogJobData;

      log.info(
        {
          jobId: job.id,
          repo: `${data.owner}/${data.repo}`,
          baseRef: data.baseRef,
          headRef: data.headRef,
        },
        'Starting API changelog generation'
      );

      await job.updateProgress(10);

      try {
        // Validate repository exists
        const repository = await prisma.repository.findUnique({
          where: { id: data.repositoryId },
        });

        if (!repository) {
          throw new Error(`Repository not found: ${data.repositoryId}`);
        }

        await job.updateProgress(30);

        // Fetch API spec from base ref
        // In a real implementation, this would use the GitHub client to fetch file contents at specific refs
        const baseSpec = await fetchSpecAtRef(
          data.owner,
          data.repo,
          data.specPath,
          data.baseRef,
          data.installationId
        );

        // Fetch API spec from head ref
        const headSpec = await fetchSpecAtRef(
          data.owner,
          data.repo,
          data.specPath,
          data.headRef,
          data.installationId
        );

        await job.updateProgress(50);

        // Diff the specs and detect changes
        const diffResult = diffAPISpecs(baseSpec, headSpec, data.specFormat);

        await job.updateProgress(70);

        // Detect breaking changes
        const breakingChanges = diffResult.changes.filter((change) => change.breaking);
        const nonBreakingChanges = diffResult.changes.filter((change) => !change.breaking);

        // Generate changelog markdown
        const changelog = generateChangelogMarkdown({
          repoFullName: `${data.owner}/${data.repo}`,
          baseRef: data.baseRef,
          headRef: data.headRef,
          specFormat: data.specFormat,
          breakingChanges,
          nonBreakingChanges,
          generatedAt: new Date(),
        });

        await job.updateProgress(90);

        // Store changelog result
        const result = {
          repositoryId: data.repositoryId,
          baseRef: data.baseRef,
          headRef: data.headRef,
          specFormat: data.specFormat,
          totalChanges: diffResult.changes.length,
          breakingChangesCount: breakingChanges.length,
          nonBreakingChangesCount: nonBreakingChanges.length,
          changelogMarkdown: changelog,
          outputPath: data.outputPath,
          generatedAt: new Date(),
        };

        await job.updateProgress(100);

        log.info(
          {
            jobId: job.id,
            repo: `${data.owner}/${data.repo}`,
            totalChanges: diffResult.changes.length,
            breakingChanges: breakingChanges.length,
          },
          'API changelog generation completed'
        );

      } catch (error) {
        log.error(
          { error, jobId: job.id, repo: `${data.owner}/${data.repo}` },
          'API changelog generation failed'
        );
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('API changelog generation worker started');
  return worker;
}

interface APIChange {
  path: string;
  method?: string;
  changeType: 'added' | 'removed' | 'modified' | 'deprecated';
  breaking: boolean;
  description: string;
  details?: string;
}

interface DiffResult {
  changes: APIChange[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    deprecated: number;
  };
}

async function fetchSpecAtRef(
  _owner: string,
  _repo: string,
  _specPath: string,
  _ref: string,
  _installationId: number
): Promise<string> {
  // Placeholder: In production, this would use GitHubClient to fetch the file at a specific ref
  // e.g., const client = GitHubClient.forInstallation(installationId);
  //       return client.getFileContent(owner, repo, specPath, ref);
  return '{}';
}

function diffAPISpecs(
  _baseSpec: string,
  _headSpec: string,
  _format: 'openapi' | 'graphql' | 'protobuf'
): DiffResult {
  // Placeholder: In production, this would parse and diff the specs based on format
  // For OpenAPI: parse JSON/YAML, compare endpoints, schemas, parameters
  // For GraphQL: compare type definitions, queries, mutations
  // For Protobuf: compare message definitions, services
  return {
    changes: [],
    summary: { added: 0, removed: 0, modified: 0, deprecated: 0 },
  };
}

function generateChangelogMarkdown(params: {
  repoFullName: string;
  baseRef: string;
  headRef: string;
  specFormat: string;
  breakingChanges: APIChange[];
  nonBreakingChanges: APIChange[];
  generatedAt: Date;
}): string {
  const lines: string[] = [];

  lines.push(`# API Changelog`);
  lines.push('');
  lines.push(`**Repository:** ${params.repoFullName}`);
  lines.push(`**Comparing:** \`${params.baseRef}\` -> \`${params.headRef}\``);
  lines.push(`**Format:** ${params.specFormat}`);
  lines.push(`**Generated:** ${params.generatedAt.toISOString()}`);
  lines.push('');

  if (params.breakingChanges.length > 0) {
    lines.push('## Breaking Changes');
    lines.push('');
    for (const change of params.breakingChanges) {
      const method = change.method ? ` \`${change.method.toUpperCase()}\`` : '';
      lines.push(`- **${change.changeType.toUpperCase()}**${method} \`${change.path}\` - ${change.description}`);
      if (change.details) {
        lines.push(`  > ${change.details}`);
      }
    }
    lines.push('');
  }

  if (params.nonBreakingChanges.length > 0) {
    lines.push('## Changes');
    lines.push('');
    for (const change of params.nonBreakingChanges) {
      const method = change.method ? ` \`${change.method.toUpperCase()}\`` : '';
      lines.push(`- **${change.changeType.toUpperCase()}**${method} \`${change.path}\` - ${change.description}`);
      if (change.details) {
        lines.push(`  > ${change.details}`);
      }
    }
    lines.push('');
  }

  if (params.breakingChanges.length === 0 && params.nonBreakingChanges.length === 0) {
    lines.push('No API changes detected between the specified refs.');
    lines.push('');
  }

  lines.push('---');
  lines.push('*Generated by DocSynth*');

  return lines.join('\n');
}
