import { createWorker, QUEUE_NAMES, type PRPreviewJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { GitHubClient } from '@docsynth/github';
import { createLogger } from '@docsynth/utils';
import { changeAnalyzerService } from '../services/change-analyzer.js';
import { prPreviewService } from '../services/pr-preview.js';

const log = createLogger('pr-preview-worker');

export function startPRPreviewWorker() {
  const worker = createWorker(
    QUEUE_NAMES.PR_PREVIEW,
    async (job) => {
      const data = job.data as PRPreviewJobData;

      log.info({ jobId: job.id, prNumber: data.prNumber }, 'Generating PR preview');

      await job.updateProgress(10);

      // Create GitHub client
      const client = GitHubClient.forInstallation(data.installationId);

      // Get repository config
      const repository = await prisma.repository.findUnique({
        where: { id: data.repositoryId },
      });

      if (!repository) {
        log.warn({ repositoryId: data.repositoryId }, 'Repository not found');
        return;
      }

      await job.updateProgress(20);

      // Analyze changes for the PR
      const analysis = await changeAnalyzerService.analyzeChanges(
        client,
        data.owner,
        data.repo,
        data.prNumber
      );

      await job.updateProgress(50);

      // Get list of existing docs in the repo
      const existingDocs = await getExistingDocs(client, data.owner, data.repo);

      await job.updateProgress(60);

      // Generate preview
      const preview = await prPreviewService.generatePreview({
        prNumber: data.prNumber,
        prTitle: data.prTitle,
        prBody: data.prBody,
        authorUsername: data.authorUsername,
        changes: analysis.changes,
        documentationImpact: analysis.documentationImpact,
        repositoryName: `${data.owner}/${data.repo}`,
        existingDocs,
      });

      await job.updateProgress(80);

      // Check if we already have a DocSynth comment on this PR
      const existingComment = await client.findDocSynthComment(
        data.owner,
        data.repo,
        data.prNumber
      );

      if (existingComment) {
        // Update existing comment
        await client.updatePRComment(
          data.owner,
          data.repo,
          existingComment.id,
          preview.previewComment
        );
        log.info({ prNumber: data.prNumber, commentId: existingComment.id }, 'Updated PR preview comment');
      } else {
        // Create new comment
        const comment = await client.createPRComment(
          data.owner,
          data.repo,
          data.prNumber,
          preview.previewComment
        );
        log.info({ prNumber: data.prNumber, commentId: comment.id }, 'Created PR preview comment');
      }

      await job.updateProgress(100);

      log.info(
        {
          prNumber: data.prNumber,
          docTypes: preview.suggestedDocTypes,
          creates: preview.estimatedChanges.creates,
          updates: preview.estimatedChanges.updates,
        },
        'PR preview generated successfully'
      );
    },
    { concurrency: 5 }
  );

  log.info('PR preview worker started');

  return worker;
}

async function getExistingDocs(
  client: GitHubClient,
  owner: string,
  repo: string
): Promise<string[]> {
  const docs: string[] = [];

  // Check common doc locations
  const docPaths = ['README.md', 'docs', 'documentation', 'CHANGELOG.md', 'API.md'];

  for (const path of docPaths) {
    try {
      if (path.endsWith('.md')) {
        const content = await client.getFileContent(owner, repo, path);
        if (content) {
          docs.push(path);
        }
      } else {
        const contents = await client.getDirectoryContents(owner, repo, path);
        for (const item of contents) {
          if (item.type === 'file' && item.name.endsWith('.md')) {
            docs.push(item.path);
          }
        }
      }
    } catch {
      // Path doesn't exist, skip
    }
  }

  return docs;
}
