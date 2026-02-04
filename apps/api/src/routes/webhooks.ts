import { Hono } from 'hono';
import crypto from 'crypto';
import { prisma, Prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger, ValidationError } from '@docsynth/utils';

const log = createLogger('webhooks');

const app = new Hono();

// Verify GitHub webhook signature
function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature =
    'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

app.post('/github', async (c) => {
  const signature = c.req.header('X-Hub-Signature-256');
  const event = c.req.header('X-GitHub-Event');
  const deliveryId = c.req.header('X-GitHub-Delivery');

  if (!signature || !event || !deliveryId) {
    throw new ValidationError('Missing required GitHub webhook headers');
  }

  const rawBody = await c.req.text();
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';

  if (!verifySignature(rawBody, signature, secret)) {
    log.warn({ deliveryId }, 'Invalid webhook signature');
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const payload = JSON.parse(rawBody) as Record<string, unknown>;

  log.info({ event, deliveryId }, 'Received GitHub webhook');

  // Log webhook - cast to Prisma's InputJsonValue type
  await prisma.webhookLog.create({
    data: {
      eventType: event,
      deliveryId,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });

  // Handle different event types
  switch (event) {
    case 'pull_request':
      await handlePullRequestEvent(payload, deliveryId);
      break;
    case 'pull_request_review':
      await handlePullRequestReviewEvent(payload);
      break;
    case 'pull_request_review_comment':
      await handlePullRequestReviewCommentEvent(payload);
      break;
    case 'check_suite':
      await handleCheckSuiteEvent(payload);
      break;
    case 'installation':
      await handleInstallationEvent(payload);
      break;
    case 'installation_repositories':
      await handleInstallationRepositoriesEvent(payload);
      break;
    default:
      log.debug({ event }, 'Ignoring unhandled event type');
  }

  return c.json({ received: true });
});

async function handlePullRequestEvent(
  payload: Record<string, unknown>,
  deliveryId: string
): Promise<void> {
  const action = payload.action as string;
  const pr = payload.pull_request as Record<string, unknown>;
  const repo = payload.repository as Record<string, unknown>;
  const installation = payload.installation as Record<string, unknown>;

  const githubRepoId = repo.id as number;
  const installationId = installation.id as number;

  // Check if repo is enabled
  const repository = await prisma.repository.findUnique({
    where: { githubRepoId },
  });

  if (!repository || !repository.enabled) {
    log.debug({ githubRepoId }, 'Repository not enabled, skipping');
    return;
  }

  // Handle PR opened or synchronized - trigger preview
  if (action === 'opened' || action === 'synchronize') {
    log.info({ prNumber: pr.number, action }, 'Triggering PR preview');

    // Queue PR preview job
    await addJob(QUEUE_NAMES.PR_PREVIEW, {
      prEventId: deliveryId,
      repositoryId: repository.id,
      installationId,
      owner: (repo.owner as Record<string, unknown>).login as string,
      repo: repo.name as string,
      prNumber: pr.number as number,
      prTitle: pr.title as string,
      prBody: pr.body as string | null,
      authorUsername: (pr.user as Record<string, unknown>).login as string,
    });

    return;
  }

  // Only process merged PRs for doc generation
  if (action !== 'closed' || !pr.merged) {
    log.debug({ action, merged: pr.merged }, 'Skipping non-merged PR event');
    return;
  }

  // Create PR event record
  const prEvent = await prisma.pREvent.create({
    data: {
      repositoryId: repository.id,
      prNumber: pr.number as number,
      action: 'MERGED',
      title: pr.title as string,
      body: pr.body as string | null,
      baseBranch: (pr.base as Record<string, unknown>).ref as string,
      headBranch: (pr.head as Record<string, unknown>).ref as string,
      authorUsername: (pr.user as Record<string, unknown>).login as string,
      mergedAt: new Date(pr.merged_at as string),
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });

  // Update webhook log
  await prisma.webhookLog.update({
    where: { deliveryId },
    data: {
      repositoryId: repository.id,
      processedAt: new Date(),
    },
  });

  // Queue change analysis job
  await addJob(QUEUE_NAMES.CHANGE_ANALYSIS, {
    prEventId: prEvent.id,
    repositoryId: repository.id,
    installationId,
    owner: (repo.owner as Record<string, unknown>).login as string,
    repo: repo.name as string,
    prNumber: pr.number as number,
  });

  log.info({ prEventId: prEvent.id, prNumber: pr.number }, 'PR event queued for analysis');
}

async function handleInstallationEvent(payload: Record<string, unknown>): Promise<void> {
  const action = payload.action as string;
  const installation = payload.installation as Record<string, unknown>;
  const account = installation.account as Record<string, unknown>;

  if (action === 'created') {
    // Create or update organization
    await prisma.organization.upsert({
      where: { githubOrgId: account.id as number },
      create: {
        name: account.login as string,
        githubOrgId: account.id as number,
      },
      update: {
        name: account.login as string,
      },
    });

    log.info({ orgId: account.id, login: account.login }, 'Installation created');
  } else if (action === 'deleted') {
    // Disable all repositories for this installation
    const org = await prisma.organization.findUnique({
      where: { githubOrgId: account.id as number },
    });

    if (org) {
      await prisma.repository.updateMany({
        where: { organizationId: org.id },
        data: { enabled: false },
      });
    }

    log.info({ orgId: account.id }, 'Installation deleted');
  }
}

async function handleInstallationRepositoriesEvent(payload: Record<string, unknown>): Promise<void> {
  const installation = payload.installation as Record<string, unknown>;
  const account = installation.account as Record<string, unknown>;
  const reposAdded = (payload.repositories_added ?? []) as Record<string, unknown>[];
  const reposRemoved = (payload.repositories_removed ?? []) as Record<string, unknown>[];

  const org = await prisma.organization.findUnique({
    where: { githubOrgId: account.id as number },
  });

  if (!org) {
    log.warn({ orgId: account.id }, 'Organization not found for installation');
    return;
  }

  // Add new repositories
  for (const repo of reposAdded) {
    await prisma.repository.upsert({
      where: { githubRepoId: repo.id as number },
      create: {
        organizationId: org.id,
        githubRepoId: repo.id as number,
        githubFullName: repo.full_name as string,
        fullName: repo.full_name as string,
        name: repo.name as string,
        installationId: installation.id as number,
        enabled: true,
      },
      update: {
        enabled: true,
        installationId: installation.id as number,
      },
    });
  }

  // Disable removed repositories
  for (const repo of reposRemoved) {
    await prisma.repository.updateMany({
      where: { githubRepoId: repo.id as number },
      data: { enabled: false },
    });
  }

  log.info(
    { added: reposAdded.length, removed: reposRemoved.length },
    'Installation repositories updated'
  );
}

async function handlePullRequestReviewEvent(payload: Record<string, unknown>): Promise<void> {
  const action = payload.action as string;
  const review = payload.review as Record<string, unknown>;
  const pr = payload.pull_request as Record<string, unknown>;
  const repo = payload.repository as Record<string, unknown>;
  const installation = payload.installation as Record<string, unknown>;

  // Only process submitted reviews
  if (action !== 'submitted') {
    return;
  }

  const githubRepoId = repo.id as number;
  const installationId = installation.id as number;

  // Check if repo is enabled
  const repository = await prisma.repository.findUnique({
    where: { githubRepoId },
  });

  if (!repository || !repository.enabled) {
    log.debug({ githubRepoId }, 'Repository not enabled, skipping review event');
    return;
  }

  // Queue review documentation job for significant reviews
  const reviewState = review.state as string;
  if (reviewState === 'changes_requested' || reviewState === 'approved') {
    await addJob(QUEUE_NAMES.REVIEW_DOCUMENTATION, {
      repositoryId: repository.id,
      installationId,
      owner: (repo.owner as Record<string, unknown>).login as string,
      repo: repo.name as string,
      prNumber: pr.number as number,
      action: 'analyze_pr',
    });

    log.info({ prNumber: pr.number, reviewState }, 'PR review queued for documentation analysis');
  }
}

async function handleCheckSuiteEvent(payload: Record<string, unknown>): Promise<void> {
  const action = payload.action as string;
  const checkSuite = payload.check_suite as Record<string, unknown>;
  const repo = payload.repository as Record<string, unknown>;
  const installation = payload.installation as Record<string, unknown>;

  // Only process requested check suites
  if (action !== 'requested' && action !== 'rerequested') {
    return;
  }

  const githubRepoId = repo.id as number;
  const installationId = installation.id as number;

  // Check if repo is enabled
  const repository = await prisma.repository.findUnique({
    where: { githubRepoId },
  });

  if (!repository || !repository.enabled) {
    log.debug({ githubRepoId }, 'Repository not enabled, skipping check suite event');
    return;
  }

  // Check if coverage gate is enabled for this repo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  const config = await db.coverageGateConfig.findUnique({
    where: { repositoryId: repository.id },
  });

  if (!config?.enabled) {
    log.debug({ repositoryId: repository.id }, 'Coverage gate not enabled, skipping');
    return;
  }

  // Queue coverage gate job
  const headSha = checkSuite.head_sha as string;
  const headBranch = checkSuite.head_branch as string;
  const pullRequests = checkSuite.pull_requests as Array<{ number: number }> | undefined;
  const prNumber = pullRequests?.[0]?.number;

  await addJob(QUEUE_NAMES.COVERAGE_GATE, {
    repositoryId: repository.id,
    installationId,
    owner: (repo.owner as Record<string, unknown>).login as string,
    repo: repo.name as string,
    commitSha: headSha,
    branch: headBranch,
    prNumber,
  });

  log.info({ repositoryId: repository.id, headSha, prNumber }, 'Coverage gate check queued');
}

async function handlePullRequestReviewCommentEvent(payload: Record<string, unknown>): Promise<void> {
  const action = payload.action as string;
  const comment = payload.comment as Record<string, unknown>;
  const pr = payload.pull_request as Record<string, unknown>;
  const repo = payload.repository as Record<string, unknown>;
  const installation = payload.installation as Record<string, unknown>;

  // Only process created comments that are part of a thread (have in_reply_to_id)
  if (action !== 'created') {
    return;
  }

  const githubRepoId = repo.id as number;
  const installationId = installation.id as number;

  // Check if repo is enabled
  const repository = await prisma.repository.findUnique({
    where: { githubRepoId },
  });

  if (!repository || !repository.enabled) {
    log.debug({ githubRepoId }, 'Repository not enabled, skipping review comment event');
    return;
  }

  // If this is a reply to a thread, queue for processing
  const inReplyToId = comment.in_reply_to_id as number | null;
  if (inReplyToId) {
    await addJob(QUEUE_NAMES.REVIEW_DOCUMENTATION, {
      repositoryId: repository.id,
      installationId,
      owner: (repo.owner as Record<string, unknown>).login as string,
      repo: repo.name as string,
      prNumber: pr.number as number,
      action: 'process_thread',
      threadId: inReplyToId.toString(),
    });

    log.info({ prNumber: pr.number, threadId: inReplyToId }, 'Review thread queued for documentation analysis');
  }
}

export { app as webhookRoutes };
