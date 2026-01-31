import { Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { GitHubClient } from '@docsynth/github';
import { coverageAnalyzerService } from '../services/coverage-analyzer.js';

const log = createLogger('coverage-scan-worker');

// Type assertion for models with expected field names
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface CoverageScanJobData {
  repositoryId: string;
  owner: string;
  repo: string;
  branch: string;
  commitSha: string;
  installationId: number;
  threshold?: number;
  createCheckRun?: boolean;
}

export async function processCoverageScan(job: Job<CoverageScanJobData>): Promise<void> {
  const { repositoryId, owner, repo, branch, commitSha, installationId, threshold = 70 } =
    job.data;

  log.info({ repositoryId, owner, repo, branch, commitSha }, 'Starting coverage scan');

  try {
    const client = GitHubClient.forInstallation(installationId);

    // Analyze coverage
    const result = await coverageAnalyzerService.analyzeRepository(client, owner, repo, branch, {
      minimum: threshold,
      target: 80,
      exportedOnly: true,
    });

    const passed = result.coveragePercent >= threshold;

    // Store report in database
    const report = await db.coverageReport.create({
      data: {
        repositoryId,
        commitSha,
        branch,
        totalExports: result.totalExports,
        documentedCount: result.documentedCount,
        coveragePercent: result.coveragePercent,
        undocumented: result.undocumented.map((i) => ({
          name: i.name,
          type: i.type,
          file: i.filePath,
          line: i.line,
        })),
        partiallyDoc: result.partiallyDocumented.map((i) => ({
          name: i.name,
          type: i.type,
          file: i.filePath,
          line: i.line,
          quality: i.documentationQuality,
        })),
        fullyDoc: result.fullyDocumented.map((i) => ({
          name: i.name,
          type: i.type,
          file: i.filePath,
        })),
        byFileType: result.byFileType,
        byModule: Object.fromEntries(
          Object.entries(result.byModule).map(([k, v]) => [k, { total: v.total, documented: v.documented }])
        ),
        threshold,
        passed,
      },
    });

    // Generate and store badge
    const badgeSvg = coverageAnalyzerService.generateBadgeSvg(result.coveragePercent);
    await db.coverageBadge.upsert({
      where: { repositoryId },
      create: {
        repositoryId,
        badgeUrl: `/api/coverage/badge/${repositoryId}`,
        badgeSvg,
        coverage: result.coveragePercent,
      },
      update: {
        badgeSvg,
        coverage: result.coveragePercent,
        lastUpdated: new Date(),
      },
    });

    log.info({
      repositoryId,
      coverage: result.coveragePercent,
      passed,
      reportId: report.id,
    }, 'Coverage scan complete');
  } catch (error) {
    log.error({ error, repositoryId }, 'Coverage scan failed');
    throw error;
  }
}

export interface CoverageTrendJobData {
  repositoryId: string;
  days?: number;
}

export async function processCoverageTrend(job: Job<CoverageTrendJobData>): Promise<void> {
  const { repositoryId, days = 30 } = job.data;

  log.info({ repositoryId, days }, 'Calculating coverage trend');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const reports = await db.coverageReport.findMany({
    where: {
      repositoryId,
      createdAt: { gte: startDate },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      createdAt: true,
      coveragePercent: true,
      totalExports: true,
      documentedCount: true,
    },
  });

  if (reports.length < 2) {
    log.info({ repositoryId }, 'Not enough data for trend analysis');
    return;
  }

  const firstReport = reports[0];
  const lastReport = reports[reports.length - 1];

  if (!firstReport || !lastReport) {
    log.info({ repositoryId }, 'Missing reports for trend analysis');
    return;
  }

  const coverageChange = lastReport.coveragePercent - firstReport.coveragePercent;
  const trend = coverageChange > 0 ? 'improving' : coverageChange < 0 ? 'declining' : 'stable';

  log.info({
    repositoryId,
    startCoverage: firstReport.coveragePercent,
    endCoverage: lastReport.coveragePercent,
    change: coverageChange,
    trend,
  }, 'Coverage trend calculated');
}
