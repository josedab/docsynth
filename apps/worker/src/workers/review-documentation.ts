/**
 * Review Documentation Worker
 *
 * Processes PR review threads to extract architectural decisions
 * and build institutional knowledge from code review discussions.
 */

import { Worker, Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import {
  QUEUE_NAMES,
  getRedisConnection,
  addJob,
  type ReviewDocumentationJobData,
} from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { createInstallationOctokit } from '@docsynth/github';
import { ReviewDocumentationService, type ReviewThread, type ReviewComment } from '../services/review-documentation.js';

const log = createLogger('review-documentation-worker');
const reviewDocumentationService = new ReviewDocumentationService();

async function processReviewDocumentation(
  job: Job<ReviewDocumentationJobData>
): Promise<void> {
  const { repositoryId, installationId, owner, repo, prNumber, action, threadId } =
    job.data;

  log.info({ repositoryId, prNumber, action }, 'Processing review documentation job');

  try {
    await job.updateProgress(10);

    // Get repository
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repository) {
      throw new Error(`Repository not found: ${repositoryId}`);
    }

    // Get GitHub client
    const octokit = createInstallationOctokit(installationId);
    if (!octokit) {
      throw new Error('Failed to get GitHub client');
    }

    await job.updateProgress(20);

    switch (action) {
      case 'process_thread':
        await processThread(job, octokit, repository, owner, repo, prNumber, threadId);
        break;
      case 'analyze_pr':
        await analyzePR(job, octokit, repository, owner, repo, prNumber);
        break;
      case 'build_knowledge':
        await buildKnowledge(job, repositoryId);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    await job.updateProgress(100);
  } catch (error) {
    log.error({ error, repositoryId, prNumber, action }, 'Review documentation job failed');
    throw error;
  }
}

/**
 * Process a single review thread
 */
async function processThread(
  job: Job<ReviewDocumentationJobData>,
  octokit: Awaited<ReturnType<typeof createInstallationOctokit>>,
  repository: { id: string; name: string },
  owner: string,
  repo: string,
  prNumber: number,
  threadId: string | undefined
): Promise<void> {
  if (!octokit || !threadId) {
    throw new Error('Missing octokit or threadId');
  }

  await job.updateProgress(30);

  // Get PR details
  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  // Get review comments
  const { data: comments } = await octokit.pulls.listReviewComments({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  await job.updateProgress(50);

  // Find comments for this thread
  const threadComments = comments.filter(
    (c: { id: number; in_reply_to_id?: number | null }) =>
      c.id.toString() === threadId || c.in_reply_to_id?.toString() === threadId
  );

  if (threadComments.length === 0) {
    log.info({ threadId }, 'No comments found for thread');
    return;
  }

  // Build thread structure
  const firstComment = threadComments[0];
  const thread: ReviewThread = {
    threadId,
    filePath: firstComment?.path || null,
    lineStart: firstComment?.start_line || firstComment?.line || null,
    lineEnd: firstComment?.line || null,
    comments: threadComments.map((c: {
      id: number;
      body: string;
      user: { login: string } | null;
      created_at: string;
      in_reply_to_id?: number | null;
      path?: string;
      line?: number | null;
      start_line?: number | null;
    }) => ({
      id: c.id,
      body: c.body,
      user: { login: c.user?.login || 'unknown' },
      created_at: c.created_at,
      in_reply_to_id: c.in_reply_to_id ?? undefined,
      path: c.path,
      line: c.line ?? undefined,
      start_line: c.start_line ?? undefined,
    })),
    status: 'resolved', // Assuming resolved since we're processing merged PRs
  };

  await job.updateProgress(70);

  // Process the thread
  const result = await reviewDocumentationService.processReviewThread(
    repository.id,
    prNumber,
    pr.title,
    thread
  );

  log.info(
    { threadId, isSignificant: result.isSignificant, rationaleId: result.rationaleId },
    'Thread processed'
  );

  await job.updateProgress(90);

  // If significant, trigger knowledge base rebuild
  if (result.isSignificant) {
    await addJob(QUEUE_NAMES.REVIEW_DOCUMENTATION, {
      repositoryId: repository.id,
      installationId: job.data.installationId,
      owner,
      repo,
      prNumber,
      action: 'build_knowledge',
    });
  }
}

/**
 * Analyze all review threads in a PR
 */
async function analyzePR(
  job: Job<ReviewDocumentationJobData>,
  octokit: Awaited<ReturnType<typeof createInstallationOctokit>>,
  repository: { id: string; name: string },
  owner: string,
  repo: string,
  prNumber: number
): Promise<void> {
  if (!octokit) {
    throw new Error('Missing octokit');
  }

  // Get PR details
  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  await job.updateProgress(30);

  // Get all review comments
  const { data: comments } = await octokit.pulls.listReviewComments({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  await job.updateProgress(40);

  // Group comments into threads
  const threads = groupCommentsIntoThreads(comments);

  log.info({ prNumber, threadCount: threads.length }, 'Found review threads');

  await job.updateProgress(50);

  // Process each thread
  let processed = 0;
  let significant = 0;

  for (const thread of threads) {
    const result = await reviewDocumentationService.processReviewThread(
      repository.id,
      prNumber,
      pr.title,
      thread
    );

    processed++;
    if (result.isSignificant) {
      significant++;
    }

    // Update progress proportionally
    const threadProgress = 50 + Math.floor((processed / threads.length) * 40);
    await job.updateProgress(threadProgress);
  }

  log.info(
    { prNumber, processed, significant },
    'PR review analysis complete'
  );

  // Trigger knowledge base rebuild if we found significant decisions
  if (significant > 0) {
    await addJob(QUEUE_NAMES.REVIEW_DOCUMENTATION, {
      repositoryId: repository.id,
      installationId: job.data.installationId,
      owner,
      repo,
      prNumber,
      action: 'build_knowledge',
    });
  }
}

/**
 * Build knowledge base from accumulated rationales
 */
async function buildKnowledge(
  job: Job<ReviewDocumentationJobData>,
  repositoryId: string
): Promise<void> {
  await job.updateProgress(30);

  const result = await reviewDocumentationService.buildKnowledgeBase(repositoryId);

  log.info({ repositoryId, entriesCreated: result.entriesCreated }, 'Knowledge base built');

  await job.updateProgress(90);
}

/**
 * Group comments into threads
 */
function groupCommentsIntoThreads(
  comments: Array<{
    id: number;
    body: string;
    user: { login: string } | null;
    created_at: string;
    in_reply_to_id?: number | null;
    path?: string;
    line?: number | null;
    start_line?: number | null;
  }>
): ReviewThread[] {
  const threadMap = new Map<string, ReviewComment[]>();
  const threadMeta = new Map<
    string,
    { filePath: string | null; lineStart: number | null; lineEnd: number | null }
  >();

  // First pass: identify root comments (no in_reply_to_id)
  for (const comment of comments) {
    if (!comment.in_reply_to_id) {
      const threadId = comment.id.toString();
      threadMap.set(threadId, [
        {
          id: comment.id,
          body: comment.body,
          user: { login: comment.user?.login || 'unknown' },
          created_at: comment.created_at,
          path: comment.path,
          line: comment.line ?? undefined,
          start_line: comment.start_line ?? undefined,
        },
      ]);
      threadMeta.set(threadId, {
        filePath: comment.path || null,
        lineStart: comment.start_line || comment.line || null,
        lineEnd: comment.line || null,
      });
    }
  }

  // Second pass: add replies to threads
  for (const comment of comments) {
    if (comment.in_reply_to_id) {
      const threadId = comment.in_reply_to_id.toString();
      const thread = threadMap.get(threadId);
      if (thread) {
        thread.push({
          id: comment.id,
          body: comment.body,
          user: { login: comment.user?.login || 'unknown' },
          created_at: comment.created_at,
          in_reply_to_id: comment.in_reply_to_id,
          path: comment.path,
          line: comment.line ?? undefined,
          start_line: comment.start_line ?? undefined,
        });
      }
    }
  }

  // Convert to array of ReviewThread
  const threads: ReviewThread[] = [];
  for (const [threadId, threadComments] of threadMap) {
    const meta = threadMeta.get(threadId);
    threads.push({
      threadId,
      filePath: meta?.filePath || null,
      lineStart: meta?.lineStart || null,
      lineEnd: meta?.lineEnd || null,
      comments: threadComments.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
      status: 'resolved',
    });
  }

  return threads;
}

export function startReviewDocumentationWorker(): Worker<ReviewDocumentationJobData> {
  const worker = new Worker<ReviewDocumentationJobData>(
    QUEUE_NAMES.REVIEW_DOCUMENTATION,
    processReviewDocumentation,
    {
      connection: getRedisConnection(),
      concurrency: 3,
    }
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id, action: job.data.action }, 'Review documentation job completed');
  });

  worker.on('failed', (job, error) => {
    log.error(
      { jobId: job?.id, action: job?.data.action, error: error.message },
      'Review documentation job failed'
    );
  });

  log.info('Review documentation worker started');
  return worker;
}
