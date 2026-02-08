/**
 * Executive Report Generation Worker
 *
 * Aggregates ROI metrics, computes hours saved, and generates
 * formatted reports in JSON, CSV, or PDF format.
 */

import { createWorker } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('executive-report-worker');

// Job data interface - will be moved to @docsynth/queue types as ExecutiveReportJobData
interface ExecutiveReportJobData {
  organizationId: string;
  reportId: string;
  period: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  startDate: string;
  endDate: string;
  format: 'json' | 'csv' | 'pdf';
  recipientEmails: string[];
  includeBreakdown: boolean;
}

export function startExecutiveReportWorker() {
  // TODO: Add 'executive-report' to QUEUE_NAMES constant in @docsynth/queue
  const worker = createWorker(
    'executive-report' as any,
    async (job) => {
      const data = job.data as ExecutiveReportJobData;

      log.info(
        {
          jobId: job.id,
          organizationId: data.organizationId,
          period: data.period,
          format: data.format,
        },
        'Starting executive report generation'
      );

      await job.updateProgress(10);

      try {
        const periodStart = new Date(data.startDate);
        const periodEnd = new Date(data.endDate);

        // Fetch organization details
        const organization = await prisma.organization.findUnique({
          where: { id: data.organizationId },
          select: {
            id: true,
            name: true,
            subscriptionTier: true,
            repositories: {
              where: { enabled: true },
              select: { id: true, githubFullName: true },
            },
          },
        });

        if (!organization) {
          throw new Error(`Organization not found: ${data.organizationId}`);
        }

        await job.updateProgress(30);

        // Aggregate ROI metrics across all repositories
        const repositoryIds = organization.repositories.map((r) => r.id);

        const analyticsSummaries = await prisma.analyticsSummary.findMany({
          where: {
            repositoryId: { in: repositoryIds },
            periodStart: { gte: periodStart },
            periodEnd: { lte: periodEnd },
          },
        });

        const totalViews = analyticsSummaries.reduce((sum, s) => sum + s.totalViews, 0);
        const totalUniqueVisitors = analyticsSummaries.reduce(
          (sum, s) => sum + s.uniqueVisitors,
          0
        );
        const totalSearches = analyticsSummaries.reduce((sum, s) => sum + s.searchCount, 0);

        await job.updateProgress(50);

        // Compute hours saved estimation
        // Assumptions: Each doc view saves ~5 min of searching, each search saves ~3 min
        const minutesSavedFromViews = totalViews * 5;
        const minutesSavedFromSearches = totalSearches * 3;
        const totalMinutesSaved = minutesSavedFromViews + minutesSavedFromSearches;
        const totalHoursSaved = totalMinutesSaved / 60;

        // Estimate cost savings (average developer hourly rate assumption)
        const avgHourlyRate = 75; // USD
        const estimatedCostSavings = totalHoursSaved * avgHourlyRate;

        // Count generated documents in the period
        const documentsGenerated = await prisma.document.count({
          where: {
            repositoryId: { in: repositoryIds },
            createdAt: { gte: periodStart, lte: periodEnd },
          },
        });

        await job.updateProgress(70);

        // Build report data structure
        const reportData: ExecutiveReportData = {
          organizationName: organization.name,
          period: data.period,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          summary: {
            totalRepositories: organization.repositories.length,
            documentsGenerated,
            totalViews,
            totalUniqueVisitors,
            totalSearches,
            totalHoursSaved: Math.round(totalHoursSaved * 100) / 100,
            estimatedCostSavings: Math.round(estimatedCostSavings * 100) / 100,
          },
          breakdown: data.includeBreakdown
            ? buildRepositoryBreakdown(organization.repositories, analyticsSummaries)
            : undefined,
          generatedAt: new Date().toISOString(),
        };

        await job.updateProgress(90);

        // Format the report in the requested format
        let formattedReport: string;
        switch (data.format) {
          case 'csv':
            formattedReport = formatAsCSV(reportData);
            break;
          case 'pdf':
            // PDF generation would be handled by a dedicated service
            // For now, generate a markdown representation for PDF conversion
            formattedReport = formatAsMarkdown(reportData);
            break;
          case 'json':
          default:
            formattedReport = JSON.stringify(reportData, null, 2);
            break;
        }

        await job.updateProgress(100);

        log.info(
          {
            jobId: job.id,
            organizationId: data.organizationId,
            period: data.period,
            format: data.format,
            hoursSaved: totalHoursSaved.toFixed(2),
            costSavings: estimatedCostSavings.toFixed(2),
          },
          'Executive report generation completed'
        );

      } catch (error) {
        log.error(
          { error, jobId: job.id, organizationId: data.organizationId },
          'Executive report generation failed'
        );
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Executive report generation worker started');
  return worker;
}

interface ExecutiveReportData {
  organizationName: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  summary: {
    totalRepositories: number;
    documentsGenerated: number;
    totalViews: number;
    totalUniqueVisitors: number;
    totalSearches: number;
    totalHoursSaved: number;
    estimatedCostSavings: number;
  };
  breakdown?: Array<{
    repositoryName: string;
    views: number;
    searches: number;
    hoursSaved: number;
  }>;
  generatedAt: string;
}

function buildRepositoryBreakdown(
  repositories: Array<{ id: string; githubFullName: string }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summaries: any[]
): Array<{
  repositoryName: string;
  views: number;
  searches: number;
  hoursSaved: number;
}> {
  return repositories.map((repo) => {
    const repoSummaries = summaries.filter(
      (s: { repositoryId: string }) => s.repositoryId === repo.id
    );
    const views = repoSummaries.reduce(
      (sum: number, s: { totalViews: number }) => sum + s.totalViews,
      0
    );
    const searches = repoSummaries.reduce(
      (sum: number, s: { searchCount: number }) => sum + s.searchCount,
      0
    );
    const minutesSaved = views * 5 + searches * 3;

    return {
      repositoryName: repo.githubFullName,
      views,
      searches,
      hoursSaved: Math.round((minutesSaved / 60) * 100) / 100,
    };
  });
}

function formatAsCSV(report: ExecutiveReportData): string {
  const lines: string[] = [];

  // Header
  lines.push('Metric,Value');
  lines.push(`Organization,${report.organizationName}`);
  lines.push(`Period,${report.period}`);
  lines.push(`Start Date,${report.periodStart}`);
  lines.push(`End Date,${report.periodEnd}`);
  lines.push(`Total Repositories,${report.summary.totalRepositories}`);
  lines.push(`Documents Generated,${report.summary.documentsGenerated}`);
  lines.push(`Total Views,${report.summary.totalViews}`);
  lines.push(`Unique Visitors,${report.summary.totalUniqueVisitors}`);
  lines.push(`Total Searches,${report.summary.totalSearches}`);
  lines.push(`Hours Saved,${report.summary.totalHoursSaved}`);
  lines.push(`Estimated Cost Savings (USD),${report.summary.estimatedCostSavings}`);

  if (report.breakdown && report.breakdown.length > 0) {
    lines.push('');
    lines.push('Repository,Views,Searches,Hours Saved');
    for (const repo of report.breakdown) {
      lines.push(`${repo.repositoryName},${repo.views},${repo.searches},${repo.hoursSaved}`);
    }
  }

  return lines.join('\n');
}

function formatAsMarkdown(report: ExecutiveReportData): string {
  const lines: string[] = [];

  lines.push(`# Executive Report - ${report.organizationName}`);
  lines.push('');
  lines.push(`**Period:** ${report.period} (${report.periodStart.split('T')[0]} to ${report.periodEnd.split('T')[0]})`);
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Repositories | ${report.summary.totalRepositories} |`);
  lines.push(`| Documents Generated | ${report.summary.documentsGenerated} |`);
  lines.push(`| Total Views | ${report.summary.totalViews.toLocaleString()} |`);
  lines.push(`| Unique Visitors | ${report.summary.totalUniqueVisitors.toLocaleString()} |`);
  lines.push(`| Total Searches | ${report.summary.totalSearches.toLocaleString()} |`);
  lines.push(`| Hours Saved | ${report.summary.totalHoursSaved} |`);
  lines.push(`| Est. Cost Savings | $${report.summary.estimatedCostSavings.toLocaleString()} |`);

  if (report.breakdown && report.breakdown.length > 0) {
    lines.push('');
    lines.push('## Repository Breakdown');
    lines.push('');
    lines.push('| Repository | Views | Searches | Hours Saved |');
    lines.push('| --- | --- | --- | --- |');
    for (const repo of report.breakdown) {
      lines.push(`| ${repo.repositoryName} | ${repo.views} | ${repo.searches} | ${repo.hoursSaved} |`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('*Generated by DocSynth*');

  return lines.join('\n');
}
