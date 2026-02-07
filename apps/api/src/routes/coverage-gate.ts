/**
 * Coverage Gate Routes
 *
 * API endpoints for configuring and managing documentation
 * coverage enforcement through CI/CD gates.
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';

const log = createLogger('coverage-gate-routes');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

/**
 * Get coverage gate configuration for a repository
 */
app.get('/repositories/:repositoryId/config', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  const config = await db.coverageGateConfig.findUnique({
    where: { repositoryId },
  });

  // Return defaults if no config exists
  const response = {
    enabled: config?.enabled ?? false,
    minCoveragePercent: config?.minCoveragePercent ?? 70,
    failOnDecrease: config?.failOnDecrease ?? true,
    maxDecreasePercent: config?.maxDecreasePercent ?? 5,
    blockMerge: config?.blockMerge ?? false,
    requireApproval: config?.requireApproval ?? false,
    includePaths: config?.includePaths ?? [],
    excludePaths: config?.excludePaths ?? [],
    notifyOnFail: config?.notifyOnFail ?? true,
    notifyChannels: config?.notifyChannels ?? [],
  };

  return c.json({
    success: true,
    data: response,
  });
});

/**
 * Update coverage gate configuration
 */
app.put('/repositories/:repositoryId/config', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const body = await c.req.json<{
    enabled?: boolean;
    minCoveragePercent?: number;
    failOnDecrease?: boolean;
    maxDecreasePercent?: number;
    blockMerge?: boolean;
    requireApproval?: boolean;
    includePaths?: string[];
    excludePaths?: string[];
    notifyOnFail?: boolean;
    notifyChannels?: string[];
  }>();

  // Validate thresholds
  if (body.minCoveragePercent !== undefined) {
    if (body.minCoveragePercent < 0 || body.minCoveragePercent > 100) {
      return c.json({ success: false, error: 'minCoveragePercent must be between 0 and 100' }, 400);
    }
  }

  if (body.maxDecreasePercent !== undefined) {
    if (body.maxDecreasePercent < 0 || body.maxDecreasePercent > 100) {
      return c.json({ success: false, error: 'maxDecreasePercent must be between 0 and 100' }, 400);
    }
  }

  const config = await db.coverageGateConfig.upsert({
    where: { repositoryId },
    create: {
      repositoryId,
      enabled: body.enabled ?? false,
      minCoveragePercent: body.minCoveragePercent ?? 70,
      failOnDecrease: body.failOnDecrease ?? true,
      maxDecreasePercent: body.maxDecreasePercent ?? 5,
      blockMerge: body.blockMerge ?? false,
      requireApproval: body.requireApproval ?? false,
      includePaths: body.includePaths ?? [],
      excludePaths: body.excludePaths ?? [],
      notifyOnFail: body.notifyOnFail ?? true,
      notifyChannels: body.notifyChannels ?? [],
    },
    update: {
      enabled: body.enabled,
      minCoveragePercent: body.minCoveragePercent,
      failOnDecrease: body.failOnDecrease,
      maxDecreasePercent: body.maxDecreasePercent,
      blockMerge: body.blockMerge,
      requireApproval: body.requireApproval,
      includePaths: body.includePaths,
      excludePaths: body.excludePaths,
      notifyOnFail: body.notifyOnFail,
      notifyChannels: body.notifyChannels,
    },
  });

  log.info({ repositoryId, enabled: config.enabled }, 'Coverage gate config updated');

  return c.json({
    success: true,
    data: config,
  });
});

/**
 * Get coverage reports for a repository
 */
app.get('/repositories/:repositoryId/reports', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const branch = c.req.query('branch');
  const limit = parseInt(c.req.query('limit') || '20', 10);

  const whereClause: { repositoryId: string; branch?: string } = { repositoryId };
  if (branch) {
    whereClause.branch = branch;
  }

  const reports = await db.coverageReport.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      commitSha: true,
      branch: true,
      coveragePercent: true,
      totalExports: true,
      documentedCount: true,
      passed: true,
      createdAt: true,
    },
  });

  return c.json({
    success: true,
    data: reports,
  });
});

/**
 * Get a specific coverage report
 */
app.get('/reports/:reportId', requireAuth, async (c) => {
  const reportId = c.req.param('reportId');

  const report = await db.coverageReport.findUnique({
    where: { id: reportId },
  });

  if (!report) {
    return c.json({ success: false, error: 'Report not found' }, 404);
  }

  return c.json({
    success: true,
    data: report,
  });
});

/**
 * Trigger a coverage check manually
 */
app.post('/repositories/:repositoryId/check', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const body = await c.req.json<{ commitSha: string; branch: string; prNumber?: number }>();

  if (!body.commitSha || !body.branch) {
    return c.json({ success: false, error: 'commitSha and branch are required' }, 400);
  }

  // Get repository
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    return c.json({ success: false, error: 'Repository not found' }, 404);
  }

  // Parse owner/repo from fullName
  const [owner, repo] = repository.fullName.split('/');

  // Queue coverage check
  const job = await addJob(QUEUE_NAMES.COVERAGE_GATE, {
    repositoryId,
    installationId: repository.installationId,
    owner: owner || '',
    repo: repo || '',
    commitSha: body.commitSha,
    branch: body.branch,
    prNumber: body.prNumber,
  });

  log.info({ repositoryId, commitSha: body.commitSha, jobId: job.id }, 'Coverage check queued');

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Coverage check has been queued',
    },
  });
});

/**
 * Get coverage trend for a repository
 */
app.get('/repositories/:repositoryId/trend', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const branch = c.req.query('branch') || 'main';
  const days = parseInt(c.req.query('days') || '30', 10);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const reports = await db.coverageReport.findMany({
    where: {
      repositoryId,
      branch,
      createdAt: { gte: startDate },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      coveragePercent: true,
      createdAt: true,
    },
  });

  return c.json({
    success: true,
    data: {
      branch,
      startDate,
      endDate: new Date(),
      dataPoints: reports.map((r: { coveragePercent: number; createdAt: Date }) => ({
        date: r.createdAt,
        coverage: r.coveragePercent,
      })),
    },
  });
});

/**
 * Generate coverage badge SVG
 */
app.get('/repositories/:repositoryId/badge', async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const branch = c.req.query('branch') || 'main';

  // Get latest coverage
  const report = await db.coverageReport.findFirst({
    where: { repositoryId, branch },
    orderBy: { createdAt: 'desc' },
    select: { coveragePercent: true },
  });

  const coverage = report?.coveragePercent ?? 0;

  // Determine color
  let color = '#e05d44'; // red
  if (coverage >= 80) {
    color = '#4c1'; // green
  } else if (coverage >= 60) {
    color = '#dfb317'; // yellow
  } else if (coverage >= 40) {
    color = '#fe7d37'; // orange
  }

  // Generate SVG badge
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="a">
    <rect width="108" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#a)">
    <path fill="#555" d="M0 0h37v20H0z"/>
    <path fill="${color}" d="M37 0h71v20H37z"/>
    <path fill="url(#b)" d="M0 0h108v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="18.5" y="15" fill="#010101" fill-opacity=".3">docs</text>
    <text x="18.5" y="14">docs</text>
    <text x="71.5" y="15" fill="#010101" fill-opacity=".3">${coverage}%</text>
    <text x="71.5" y="14">${coverage}%</text>
  </g>
</svg>`;

  return c.body(svg, 200, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'no-cache',
  });
});

/**
 * Generate GitHub Actions workflow for coverage gate
 */
app.get('/repositories/:repositoryId/workflow', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: { name: true },
  });

  if (!repository) {
    return c.json({ success: false, error: 'Repository not found' }, 404);
  }

  const config = await db.coverageGateConfig.findUnique({
    where: { repositoryId },
  });

  const workflow = `# DocSynth Documentation Coverage Gate
# Auto-generated workflow for ${repository.name}

name: DocSynth Coverage Gate

on:
  pull_request:
    types: [opened, synchronize, reopened]
  push:
    branches: [main, master]

jobs:
  coverage-check:
    name: Documentation Coverage
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Run DocSynth Coverage Check
        uses: docsynth/coverage-action@v1
        with:
          docsynth-token: \${{ secrets.DOCSYNTH_TOKEN }}
          min-coverage: ${config?.minCoveragePercent ?? 70}
          fail-on-decrease: ${config?.failOnDecrease ?? true}
          max-decrease-percent: ${config?.maxDecreasePercent ?? 5}

      - name: Comment PR with coverage report
        if: github.event_name == 'pull_request'
        uses: docsynth/coverage-comment-action@v1
        with:
          docsynth-token: \${{ secrets.DOCSYNTH_TOKEN }}
          github-token: \${{ secrets.GITHUB_TOKEN }}
`;

  return c.body(workflow, 200, {
    'Content-Type': 'text/yaml',
    'Content-Disposition': 'attachment; filename="docsynth-coverage.yml"',
  });
});

/**
 * Get undocumented exports that are blocking merge
 */
app.get('/repositories/:repositoryId/blocking', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const branch = c.req.query('branch') || 'main';

  // Get latest failed report
  const report = await db.coverageReport.findFirst({
    where: { repositoryId, branch, passed: false },
    orderBy: { createdAt: 'desc' },
  });

  if (!report) {
    return c.json({
      success: true,
      data: {
        blocking: false,
        message: 'No blocking issues',
      },
    });
  }

  const undocumented = (report.undocumented as Array<{ name: string; type: string; file: string; suggestion?: string }>) || [];

  return c.json({
    success: true,
    data: {
      blocking: true,
      coveragePercent: report.coveragePercent,
      threshold: report.threshold,
      blockingExports: undocumented.slice(0, 20),
      totalUndocumented: undocumented.length,
      suggestions: undocumented.filter((e) => e.suggestion).slice(0, 5),
    },
  });
});

/**
 * Get coverage comparison between two commits/branches
 */
app.get('/repositories/:repositoryId/compare', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const base = c.req.query('base') || 'main';
  const head = c.req.query('head');

  if (!head) {
    return c.json({ success: false, error: 'head parameter is required' }, 400);
  }

  const baseReport = await db.coverageReport.findFirst({
    where: { repositoryId, branch: base },
    orderBy: { createdAt: 'desc' },
    select: { coveragePercent: true, totalExports: true, documentedCount: true },
  });

  const headReport = await db.coverageReport.findFirst({
    where: { repositoryId, branch: head },
    orderBy: { createdAt: 'desc' },
    select: { coveragePercent: true, totalExports: true, documentedCount: true, undocumented: true },
  });

  if (!baseReport || !headReport) {
    return c.json({
      success: true,
      data: {
        available: false,
        message: 'Coverage data not available for comparison',
      },
    });
  }

  const coverageChange = headReport.coveragePercent - baseReport.coveragePercent;
  const newExports = headReport.totalExports - baseReport.totalExports;
  const newDocumented = headReport.documentedCount - baseReport.documentedCount;

  return c.json({
    success: true,
    data: {
      available: true,
      base: {
        branch: base,
        coverage: baseReport.coveragePercent,
        total: baseReport.totalExports,
        documented: baseReport.documentedCount,
      },
      head: {
        branch: head,
        coverage: headReport.coveragePercent,
        total: headReport.totalExports,
        documented: headReport.documentedCount,
      },
      comparison: {
        coverageChange,
        newExports,
        newDocumented,
        improved: coverageChange >= 0,
        newUndocumented: (headReport.undocumented as unknown[])?.slice(0, 10) || [],
      },
    },
  });
});

export { app as coverageGateRoutes };
