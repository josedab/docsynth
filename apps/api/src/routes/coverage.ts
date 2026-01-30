import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('coverage-routes');

// Type assertion for models with expected field names
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export const coverageRoutes = new Hono();

// Get coverage report for a repository
coverageRoutes.get('/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();
  const { branch, limit } = c.req.query();

  try {
    const reports = await db.coverageReport.findMany({
      where: {
        repositoryId,
        ...(branch && { branch }),
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit ?? '10', 10),
    });

    return c.json({ success: true, data: reports });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch coverage reports');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch coverage reports' } }, 500);
  }
});

// Get latest coverage report
coverageRoutes.get('/:repositoryId/latest', async (c) => {
  const { repositoryId } = c.req.param();
  const { branch } = c.req.query();

  try {
    const report = await db.coverageReport.findFirst({
      where: {
        repositoryId,
        ...(branch && { branch }),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!report) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'No coverage reports found' } }, 404);
    }

    return c.json({ success: true, data: report });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch latest coverage report');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch coverage report' } }, 500);
  }
});

// Get coverage badge SVG
coverageRoutes.get('/badge/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();

  try {
    const badge = await db.coverageBadge.findUnique({
      where: { repositoryId },
    });

    if (!badge) {
      // Return a default "unknown" badge
      const defaultSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="20">
        <rect width="88" height="20" rx="3" fill="#9f9f9f"/>
        <text x="44" y="14" fill="#fff" text-anchor="middle" font-family="sans-serif" font-size="11">docs: ?</text>
      </svg>`;
      c.header('Content-Type', 'image/svg+xml');
      c.header('Cache-Control', 'no-cache');
      return c.body(defaultSvg);
    }

    c.header('Content-Type', 'image/svg+xml');
    c.header('Cache-Control', 'max-age=300'); // Cache for 5 minutes
    return c.body(badge.badgeSvg);
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch coverage badge');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch badge' } }, 500);
  }
});

// Trigger coverage scan
coverageRoutes.post('/:repositoryId/scan', async (c) => {
  const { repositoryId } = c.req.param();

  try {
    const body = await c.req.json();
    const { branch, commitSha } = body;

    // Get repository details
    const repo = await db.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repo) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404);
    }

    const [owner, repoName] = repo.fullName.split('/');
    if (!owner || !repoName) {
      return c.json({ success: false, error: { code: 'INVALID_REPO', message: 'Invalid repository name' } }, 400);
    }

    // In production, would queue a coverage scan job
    // For now, return a pending status
    log.info({ repositoryId, branch, commitSha }, 'Coverage scan requested');

    return c.json({
      success: true,
      data: {
        jobId: `coverage-${Date.now()}`,
        status: 'queued',
        message: 'Coverage scan has been queued',
      },
    }, 202);
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to trigger coverage scan');
    return c.json({ success: false, error: { code: 'SCAN_FAILED', message: 'Failed to trigger coverage scan' } }, 500);
  }
});

// Get coverage trend
coverageRoutes.get('/:repositoryId/trend', async (c) => {
  const { repositoryId } = c.req.param();
  const { days = '30', branch } = c.req.query();

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days, 10));

    const reports = await db.coverageReport.findMany({
      where: {
        repositoryId,
        createdAt: { gte: startDate },
        ...(branch && { branch }),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        coveragePercent: true,
        totalExports: true,
        documentedCount: true,
        branch: true,
        commitSha: true,
      },
    });

    if (reports.length === 0) {
      return c.json({ success: true, data: { trend: 'unknown', dataPoints: [] } });
    }

    const first = reports[0];
    const last = reports[reports.length - 1];

    if (!first || !last) {
      return c.json({ success: true, data: { trend: 'unknown', dataPoints: [] } });
    }

    const change = last.coveragePercent - first.coveragePercent;
    const trend = change > 1 ? 'improving' : change < -1 ? 'declining' : 'stable';

    return c.json({
      success: true,
      data: {
        trend,
        change: Math.round(change * 100) / 100,
        startCoverage: first.coveragePercent,
        endCoverage: last.coveragePercent,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dataPoints: reports.map((r: any) => ({
          date: r.createdAt,
          coverage: r.coveragePercent,
          total: r.totalExports,
          documented: r.documentedCount,
        })),
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch coverage trend');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch coverage trend' } }, 500);
  }
});

// Get undocumented items summary
coverageRoutes.get('/:repositoryId/undocumented', async (c) => {
  const { repositoryId } = c.req.param();

  try {
    const latestReport = await db.coverageReport.findFirst({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestReport) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'No coverage reports found' } }, 404);
    }

    const undocumented = latestReport.undocumented as Array<{
      name: string;
      type: string;
      file: string;
      line: number;
    }>;

    // Group by file
    const byFile: Record<string, typeof undocumented> = {};
    for (const item of undocumented) {
      const fileKey = item.file ?? 'unknown';
      if (!byFile[fileKey]) {
        byFile[fileKey] = [];
      }
      byFile[fileKey].push(item);
    }

    return c.json({
      success: true,
      data: {
        total: undocumented.length,
        byFile,
        items: undocumented.slice(0, 100), // Limit for API response
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch undocumented items');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch undocumented items' } }, 500);
  }
});

// Configure coverage thresholds
coverageRoutes.put('/:repositoryId/config', async (c) => {
  const { repositoryId } = c.req.param();

  try {
    const body = await c.req.json();
    const { threshold, blockPR, excludePaths } = body;

    const repo = await db.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repo) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404);
    }

    // Update repository config
    const currentConfig = repo.config as Record<string, unknown>;
    const updatedConfig = {
      ...currentConfig,
      coverage: {
        threshold: threshold ?? 70,
        blockPR: blockPR ?? false,
        excludePaths: excludePaths ?? [],
      },
    };

    await db.repository.update({
      where: { id: repositoryId },
      data: { config: updatedConfig },
    });

    log.info({ repositoryId, threshold, blockPR }, 'Coverage config updated');

    return c.json({ success: true, data: updatedConfig.coverage });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to update coverage config');
    return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update coverage config' } }, 500);
  }
});

// Get leaderboard for an organization
coverageRoutes.get('/leaderboard/:organizationId', async (c) => {
  const { organizationId } = c.req.param();

  try {
    // Get latest coverage for all repos in the organization
    const repos = await prisma.repository.findMany({
      where: { organizationId },
      select: { id: true, name: true, fullName: true },
    });

    const leaderboard = await Promise.all(
      repos.map(async (repo) => {
        const latestReport = await db.coverageReport.findFirst({
          where: { repositoryId: repo.id },
          orderBy: { createdAt: 'desc' },
        });

        return {
          repositoryId: repo.id,
          repositoryName: repo.name,
          fullName: repo.fullName,
          coverage: latestReport?.coveragePercent ?? 0,
          totalExports: latestReport?.totalExports ?? 0,
          documentedCount: latestReport?.documentedCount ?? 0,
          lastScan: latestReport?.createdAt,
        };
      })
    );

    // Sort by coverage descending
    leaderboard.sort((a, b) => b.coverage - a.coverage);

    return c.json({
      success: true,
      data: leaderboard.map((item, index) => ({
        rank: index + 1,
        ...item,
      })),
    });
  } catch (error) {
    log.error({ error, organizationId }, 'Failed to fetch coverage leaderboard');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch leaderboard' } }, 500);
  }
});
