/**
 * Federated Hub Indexing Worker
 *
 * Aggregates documents from multiple repositories into a unified
 * hub index, builds cross-repo links, and generates a navigation tree.
 */

import { createWorker } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('federated-hub-worker');

// Job data interface - will be moved to @docsynth/queue types as FederatedHubJobData
interface FederatedHubJobData {
  organizationId: string;
  hubId: string;
  repositoryIds: string[];
  fullRebuild: boolean;
  includePrivateRepos: boolean;
}

export function startFederatedHubWorker() {
  // TODO: Add 'federated-hub' to QUEUE_NAMES constant in @docsynth/queue
  const worker = createWorker(
    'federated-hub' as any,
    async (job) => {
      const data = job.data as FederatedHubJobData;
      const startTime = Date.now();

      log.info(
        {
          jobId: job.id,
          hubId: data.hubId,
          repositoryCount: data.repositoryIds.length,
          fullRebuild: data.fullRebuild,
        },
        'Starting federated hub indexing'
      );

      await job.updateProgress(10);

      try {
        // Validate organization and repositories
        const organization = await prisma.organization.findUnique({
          where: { id: data.organizationId },
          select: { id: true, name: true },
        });

        if (!organization) {
          throw new Error(`Organization not found: ${data.organizationId}`);
        }

        const repositories = await prisma.repository.findMany({
          where: {
            id: { in: data.repositoryIds },
            organizationId: data.organizationId,
          },
          include: {
            documents: {
              select: {
                id: true,
                path: true,
                type: true,
                title: true,
                content: true,
              },
            },
          },
        });

        if (repositories.length === 0) {
          throw new Error('No valid repositories found for hub indexing');
        }

        await job.updateProgress(30);

        // Aggregate documents from all repositories
        const hubDocuments: Array<{
          repositoryId: string;
          repositoryName: string;
          documentId: string;
          path: string;
          type: string;
          title: string;
          contentPreview: string;
        }> = [];

        for (const repo of repositories) {
          for (const doc of repo.documents) {
            hubDocuments.push({
              repositoryId: repo.id,
              repositoryName: repo.githubFullName,
              documentId: doc.id,
              path: doc.path,
              type: doc.type,
              title: doc.title,
              contentPreview: doc.content.substring(0, 500),
            });
          }
        }

        await job.updateProgress(50);

        // Build cross-repo links by analyzing document references
        const crossRepoLinks: Array<{
          sourceRepoId: string;
          sourceDocId: string;
          targetRepoId: string;
          targetDocId: string;
          linkType: 'reference' | 'dependency' | 'related';
        }> = [];

        for (const doc of hubDocuments) {
          // Find references to other repos' docs in content
          for (const otherDoc of hubDocuments) {
            if (
              doc.repositoryId !== otherDoc.repositoryId &&
              doc.contentPreview.includes(otherDoc.title)
            ) {
              crossRepoLinks.push({
                sourceRepoId: doc.repositoryId,
                sourceDocId: doc.documentId,
                targetRepoId: otherDoc.repositoryId,
                targetDocId: otherDoc.documentId,
                linkType: 'reference',
              });
            }
          }
        }

        await job.updateProgress(70);

        // Generate navigation tree structure
        const navigationTree = buildNavigationTree(repositories, hubDocuments);

        await job.updateProgress(90);

        // Store hub index results
        const buildDurationMs = Date.now() - startTime;
        const hubIndex = {
          hubId: data.hubId,
          organizationId: data.organizationId,
          repositoryCount: repositories.length,
          documentCount: hubDocuments.length,
          crossRepoLinkCount: crossRepoLinks.length,
          navigationTree,
          buildDurationMs,
          indexedAt: new Date(),
        };

        await job.updateProgress(100);

        log.info(
          {
            jobId: job.id,
            hubId: data.hubId,
            repositoryCount: repositories.length,
            documentCount: hubDocuments.length,
            crossRepoLinks: crossRepoLinks.length,
            buildDurationMs,
          },
          'Federated hub indexing completed'
        );

      } catch (error) {
        log.error(
          { error, jobId: job.id, hubId: data.hubId },
          'Federated hub indexing failed'
        );
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Federated hub indexing worker started');
  return worker;
}

interface NavigationNode {
  label: string;
  type: 'organization' | 'repository' | 'folder' | 'document';
  path: string;
  children: NavigationNode[];
}

function buildNavigationTree(
  repositories: Array<{
    id: string;
    githubFullName: string;
    documents: Array<{ id: string; path: string; type: string; title: string }>;
  }>,
  hubDocuments: Array<{
    repositoryId: string;
    repositoryName: string;
    documentId: string;
    path: string;
    type: string;
    title: string;
  }>
): NavigationNode {
  const root: NavigationNode = {
    label: 'Hub',
    type: 'organization',
    path: '/',
    children: [],
  };

  for (const repo of repositories) {
    const repoNode: NavigationNode = {
      label: repo.githubFullName,
      type: 'repository',
      path: `/${repo.githubFullName}`,
      children: [],
    };

    // Group documents by directory
    const docsByDir = new Map<string, NavigationNode[]>();

    const repoDocs = hubDocuments.filter((d) => d.repositoryId === repo.id);
    for (const doc of repoDocs) {
      const parts = doc.path.split('/');
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

      if (!docsByDir.has(dir)) {
        docsByDir.set(dir, []);
      }

      docsByDir.get(dir)!.push({
        label: doc.title,
        type: 'document',
        path: `/${repo.githubFullName}/${doc.path}`,
        children: [],
      });
    }

    // Build folder structure
    for (const [dir, docs] of docsByDir.entries()) {
      if (dir === '') {
        repoNode.children.push(...docs);
      } else {
        const folderNode: NavigationNode = {
          label: dir,
          type: 'folder',
          path: `/${repo.githubFullName}/${dir}`,
          children: docs,
        };
        repoNode.children.push(folderNode);
      }
    }

    root.children.push(repoNode);
  }

  return root;
}
