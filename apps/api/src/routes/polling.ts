/**
 * Polling Routes
 *
 * API endpoints for webhook-less change detection through scheduled polling.
 * Provides an alternative to GitHub webhooks for detecting code changes.
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  getPollingConfig,
  updatePollingConfig,
  pollRepository,
  getPollingStatus,
  getPollingHistory,
  recordPollResult,
  type PollingConfig,
} from '../services/polling.service.js';

const log = createLogger('polling-routes');

const app = new Hono();

/**
 * Get polling configuration for a repository
 */
app.get('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  try {
    const config = await getPollingConfig(repositoryId);

    return c.json({
      success: true,
      data: config,
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get polling config');
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get polling config',
      },
      500
    );
  }
});

/**
 * Update polling configuration for a repository
 */
app.put('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const body = await c.req.json<Partial<PollingConfig>>();

  try {
    // Validate input
    if (body.intervalMinutes !== undefined) {
      if (body.intervalMinutes < 5 || body.intervalMinutes > 60) {
        return c.json(
          {
            success: false,
            error: 'intervalMinutes must be between 5 and 60',
          },
          400
        );
      }
    }

    if (body.mode !== undefined) {
      if (!['polling', 'webhook', 'hybrid'].includes(body.mode)) {
        return c.json(
          {
            success: false,
            error: 'mode must be polling, webhook, or hybrid',
          },
          400
        );
      }
    }

    const config = await updatePollingConfig(repositoryId, body);

    log.info({ repositoryId, enabled: config.enabled }, 'Polling config updated');

    return c.json({
      success: true,
      data: config,
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to update polling config');
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update polling config',
      },
      500
    );
  }
});

/**
 * Trigger a manual poll for a repository
 */
app.post('/poll/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  try {
    // Get repository details
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        installationId: true,
        fullName: true,
      },
    });

    if (!repository) {
      return c.json(
        {
          success: false,
          error: 'Repository not found',
        },
        404
      );
    }

    const [owner, repo] = repository.fullName.split('/');
    if (!owner || !repo) {
      return c.json(
        {
          success: false,
          error: 'Invalid repository fullName',
        },
        400
      );
    }

    // Queue polling job
    const job = await addJob(QUEUE_NAMES.POLLING, {
      repositoryId,
      installationId: repository.installationId,
      owner,
      repo,
      manual: true,
    });

    log.info({ repositoryId, jobId: job.id }, 'Manual poll queued');

    return c.json({
      success: true,
      data: {
        jobId: job.id,
        message: 'Poll has been queued',
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to queue poll');
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to queue poll',
      },
      500
    );
  }
});

/**
 * Get last poll status and results for a repository
 */
app.get('/status/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  try {
    const status = await getPollingStatus(repositoryId);

    // Get latest poll result from history
    const history = await getPollingHistory(repositoryId, 1);
    const lastPoll = history[0] || null;

    return c.json({
      success: true,
      data: {
        ...status,
        lastPoll: lastPoll
          ? {
              polledAt: lastPoll.polledAt,
              newCommitsCount: lastPoll.newCommitsCount,
              newPRsCount: lastPoll.newPRsCount,
              hasChanges: lastPoll.hasChanges,
              error: lastPoll.error,
            }
          : null,
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get polling status');
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get polling status',
      },
      500
    );
  }
});

/**
 * Get polling history for a repository
 */
app.get('/history/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const limit = parseInt(c.req.query('limit') || '20', 10);

  try {
    const history = await getPollingHistory(repositoryId, limit);

    return c.json({
      success: true,
      data: {
        history: history.map((entry) => ({
          id: entry.id,
          polledAt: entry.polledAt,
          commitSha: entry.commitSha,
          newCommitsCount: entry.newCommitsCount,
          newPRsCount: entry.newPRsCount,
          hasChanges: entry.hasChanges,
          error: entry.error,
        })),
        count: history.length,
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get polling history');
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get polling history',
      },
      500
    );
  }
});

/**
 * Get detailed poll result
 */
app.get('/history/:repositoryId/:pollId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const pollId = c.req.param('pollId');

  try {
    const history = await getPollingHistory(repositoryId, 100);
    const pollResult = history.find((entry) => entry.id === pollId);

    if (!pollResult) {
      return c.json(
        {
          success: false,
          error: 'Poll result not found',
        },
        404
      );
    }

    return c.json({
      success: true,
      data: pollResult,
    });
  } catch (error) {
    log.error({ error, repositoryId, pollId }, 'Failed to get poll result');
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get poll result',
      },
      500
    );
  }
});

/**
 * Get polling statistics for a repository
 */
app.get('/stats/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const days = parseInt(c.req.query('days') || '7', 10);

  try {
    const history = await getPollingHistory(repositoryId, 1000);
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const recentHistory = history.filter((entry) => entry.polledAt > cutoffDate);

    const stats = {
      totalPolls: recentHistory.length,
      pollsWithChanges: recentHistory.filter((entry) => entry.hasChanges).length,
      totalNewCommits: recentHistory.reduce((sum, entry) => sum + entry.newCommitsCount, 0),
      totalNewPRs: recentHistory.reduce((sum, entry) => sum + entry.newPRsCount, 0),
      errors: recentHistory.filter((entry) => entry.error).length,
      averageNewCommitsPerPoll:
        recentHistory.length > 0
          ? recentHistory.reduce((sum, entry) => sum + entry.newCommitsCount, 0) / recentHistory.length
          : 0,
      averageNewPRsPerPoll:
        recentHistory.length > 0
          ? recentHistory.reduce((sum, entry) => sum + entry.newPRsCount, 0) / recentHistory.length
          : 0,
    };

    return c.json({
      success: true,
      data: {
        period: { days, startDate: cutoffDate, endDate: new Date() },
        stats,
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to get polling stats');
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get polling stats',
      },
      500
    );
  }
});

/**
 * Test polling configuration (dry run)
 */
app.post('/test/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  try {
    // Get repository details
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        installationId: true,
        fullName: true,
      },
    });

    if (!repository) {
      return c.json(
        {
          success: false,
          error: 'Repository not found',
        },
        404
      );
    }

    const [owner, repo] = repository.fullName.split('/');
    if (!owner || !repo) {
      return c.json(
        {
          success: false,
          error: 'Invalid repository fullName',
        },
        400
      );
    }

    // Perform test poll (don't update lastPolledAt)
    const result = await pollRepository(repositoryId, repository.installationId, owner, repo);

    // Don't record in history for test polls
    return c.json({
      success: true,
      data: {
        message: 'Test poll completed successfully',
        result: {
          newCommitsCount: result.newCommits.length,
          newPRsCount: result.newPRs.length,
          hasChanges: result.hasChanges,
          newCommits: result.newCommits.slice(0, 5), // Show first 5
          newPRs: result.newPRs.slice(0, 5), // Show first 5
        },
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to test polling');
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to test polling',
      },
      500
    );
  }
});

export { app as pollingRoutes };
