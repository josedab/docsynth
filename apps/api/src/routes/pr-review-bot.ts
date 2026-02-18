/**
 * PR Review Bot Routes
 *
 * Endpoints for inline documentation suggestions on pull requests.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  analyzePRAndSuggest,
  recordSuggestionFeedback,
  getAcceptanceRate,
  getBotConfig,
  updateBotConfig,
  formatAsGitHubReviewComments,
} from '../services/pr-review-bot.service.js';

const log = createLogger('pr-review-bot-routes');
const app = new Hono();

app.post('/analyze', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    prNumber: number;
    changedFiles: Array<{
      filename: string;
      patch?: string;
      status: string;
      additions: number;
      deletions: number;
    }>;
  }>();

  if (!body.repositoryId || !body.prNumber) {
    return c.json({ success: false, error: 'repositoryId and prNumber are required' }, 400);
  }

  try {
    const result = await analyzePRAndSuggest(
      body.repositoryId,
      body.prNumber,
      body.changedFiles ?? []
    );
    const reviewComments = formatAsGitHubReviewComments(result.suggestions);

    return c.json({
      success: true,
      data: { ...result, reviewComments },
    });
  } catch (error) {
    log.error(
      { error, repositoryId: body.repositoryId, prNumber: body.prNumber },
      'Failed to analyze PR'
    );
    return c.json({ success: false, error: 'Failed to analyze PR' }, 500);
  }
});

app.post('/queue', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    prNumber: number;
    installationId: number;
    owner: string;
    repo: string;
  }>();

  if (!body.repositoryId || !body.prNumber) {
    return c.json({ success: false, error: 'repositoryId and prNumber are required' }, 400);
  }

  try {
    await addJob(QUEUE_NAMES.PR_REVIEW_BOT, {
      repositoryId: body.repositoryId,
      prNumber: body.prNumber,
      installationId: body.installationId,
      owner: body.owner,
      repo: body.repo,
      action: 'analyze-and-suggest' as const,
    });

    return c.json({ success: true, data: { message: 'PR review bot analysis queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to queue PR review');
    return c.json({ success: false, error: 'Failed to queue review' }, 500);
  }
});

app.post('/feedback', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    suggestionId: string;
    action: 'accepted' | 'rejected' | 'modified';
    repositoryId: string;
    prNumber: number;
  }>();

  if (!body.suggestionId || !body.action) {
    return c.json({ success: false, error: 'suggestionId and action are required' }, 400);
  }

  try {
    await recordSuggestionFeedback(body);
    return c.json({ success: true, data: { message: 'Feedback recorded' } });
  } catch (error) {
    log.error({ error }, 'Failed to record feedback');
    return c.json({ success: false, error: 'Failed to record feedback' }, 500);
  }
});

app.get('/acceptance-rate/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  try {
    const rate = await getAcceptanceRate(repositoryId);
    return c.json({ success: true, data: rate });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get acceptance rate');
    return c.json({ success: false, error: 'Failed to get acceptance rate' }, 500);
  }
});

app.get('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  try {
    const config = await getBotConfig(repositoryId);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get bot config');
    return c.json({ success: false, error: 'Failed to get config' }, 500);
  }
});

app.post('/config', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    confidenceThreshold?: number;
    maxSuggestionsPerPR?: number;
    enabled?: boolean;
  }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  try {
    const config = await updateBotConfig(body.repositoryId, body);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error }, 'Failed to update bot config');
    return c.json({ success: false, error: 'Failed to update config' }, 500);
  }
});

export { app as prReviewBotRoutes };
