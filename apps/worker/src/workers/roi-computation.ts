/**
 * ROI Computation Worker
 *
 * Periodically computes ROI metrics and aggregates documentation
 * analytics for organizations.
 */

import { createWorker, addJob, QUEUE_NAMES } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import {
  calculateROIMetrics,
  getTopSearchGaps,
  getSatisfactionScore,
} from '../../../api/src/services/roi-analytics.service.js';

const log = createLogger('roi-computation-worker');

// Job data interface
interface ROIComputationJobData {
  organizationId: string;
  period: 'daily' | 'weekly' | 'monthly';
  startDate?: string;
  endDate?: string;
  sendEmail?: boolean;
}

export function startROIComputationWorker() {
  const worker = createWorker(
    QUEUE_NAMES.ROI_COMPUTATION,
    async (job) => {
      const data = job.data as ROIComputationJobData;
      const { organizationId, period, startDate, endDate, sendEmail = false } = data;

      log.info({ jobId: job.id, organizationId, period }, 'Starting ROI computation');

      await job.updateProgress(10);

      try {
        // Calculate period bounds
        const now = new Date();
        let periodStart: Date;
        let periodEnd: Date;

        if (startDate && endDate) {
          periodStart = new Date(startDate);
          periodEnd = new Date(endDate);
        } else {
          switch (period) {
            case 'daily':
              periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
              periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              break;
            case 'weekly':
              periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
              periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              break;
            case 'monthly':
              periodStart = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
              periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              break;
            default:
              periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
              periodEnd = now;
          }
        }

        await job.updateProgress(20);

        // Calculate comprehensive ROI metrics
        log.info({ organizationId, periodStart, periodEnd }, 'Calculating ROI metrics');
        const metrics = await calculateROIMetrics(organizationId, {
          start: periodStart,
          end: periodEnd,
        });

        await job.updateProgress(50);

        // Get additional insights
        const [searchGaps, satisfaction] = await Promise.all([
          getTopSearchGaps(organizationId, 10),
          getSatisfactionScore(organizationId),
        ]);

        await job.updateProgress(70);

        // Store ROI summary in database
        const summary = {
          organizationId,
          period,
          periodStart,
          periodEnd,
          metrics: {
            usage: metrics.usage,
            productivity: metrics.productivity,
            roi: metrics.roi,
            searchGaps,
            satisfaction,
          },
          generatedAt: now,
        };

        // Store in a ROI summaries table (would need to be added to schema)
        // For now, we'll log it
        log.info(
          {
            organizationId,
            period,
            roi: metrics.roi.roiPercent,
            hoursSaved: metrics.roi.totalReturn.hoursSaved,
            totalCost: metrics.roi.totalInvestment.totalCost,
          },
          'ROI computation completed'
        );

        await job.updateProgress(90);

        // Send email notification if requested
        if (sendEmail) {
          await sendROIEmail(organizationId, summary);
        }

        await job.updateProgress(100);

        return {
          organizationId,
          period,
          roi: metrics.roi.roiPercent,
          hoursSaved: metrics.roi.totalReturn.hoursSaved,
          dollarsSaved: metrics.roi.totalReturn.dollarsSaved,
          totalCost: metrics.roi.totalInvestment.totalCost,
        };
      } catch (error) {
        log.error({ error, organizationId }, 'ROI computation failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('ROI computation worker started');
  return worker;
}

/**
 * Schedule weekly ROI computation for all organizations
 */
export async function scheduleWeeklyROIComputation(): Promise<void> {
  log.info('Scheduling weekly ROI computation');

  // Get all organizations
  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true, subscriptionTier: true },
  });

  let scheduled = 0;

  for (const org of organizations) {
    // Skip FREE tier organizations (they might not want automated reports)
    if (org.subscriptionTier === 'FREE') {
      continue;
    }

    try {
      await addJob(QUEUE_NAMES.ROI_COMPUTATION, {
        organizationId: org.id,
        period: 'weekly',
        sendEmail: true, // Send email for weekly reports
      });

      scheduled++;
      log.debug({ organizationId: org.id, orgName: org.name }, 'Scheduled weekly ROI computation');
    } catch (error) {
      log.error({ error, organizationId: org.id }, 'Failed to schedule weekly ROI computation');
    }
  }

  log.info({ count: scheduled, total: organizations.length }, 'Scheduled weekly ROI computations');
}

/**
 * Schedule daily ROI computation for a specific organization
 */
export async function scheduleDailyROIComputation(organizationId: string): Promise<void> {
  log.info({ organizationId }, 'Scheduling daily ROI computation');

  await addJob(QUEUE_NAMES.ROI_COMPUTATION, {
    organizationId,
    period: 'daily',
    sendEmail: false, // Don't send email for daily reports
  });
}

/**
 * Compute ROI for a custom period
 */
export async function computeCustomROI(
  organizationId: string,
  startDate: Date,
  endDate: Date
): Promise<void> {
  log.info({ organizationId, startDate, endDate }, 'Computing custom ROI');

  await addJob(QUEUE_NAMES.ROI_COMPUTATION, {
    organizationId,
    period: 'custom' as 'daily', // Type assertion for custom period
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    sendEmail: false,
  });
}

/**
 * Send ROI summary email to organization admins
 */
async function sendROIEmail(
  organizationId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summary: any
): Promise<void> {
  log.info({ organizationId }, 'Sending ROI summary email');

  try {
    // Get organization details
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        users: {
          where: {
            role: { in: ['OWNER', 'ADMIN'] },
            email: { not: null },
          },
          select: {
            email: true,
            githubUsername: true,
          },
        },
      },
    });

    if (!organization || organization.users.length === 0) {
      log.warn({ organizationId }, 'No admin users with email found');
      return;
    }

    const metrics = summary.metrics;
    const roi = metrics.roi;

    // Format email content
    const subject = `DocSynth ROI Report - ${summary.period} (${organization.name})`;
    const body = `
# DocSynth ROI Report

**Organization:** ${organization.name}
**Period:** ${summary.period} (${summary.periodStart.toISOString().split('T')[0]} to ${summary.periodEnd.toISOString().split('T')[0]})

## Key Metrics

### ROI Summary
- **ROI:** ${roi.roiPercent.toFixed(2)}%
- **Total Investment:** $${roi.totalInvestment.totalCost.toFixed(2)}
- **Total Return:** $${roi.totalReturn.dollarsSaved.toFixed(2)}
- **Payback Period:** ${roi.paybackPeriodDays.toFixed(0)} days

### Productivity
- **Hours Saved:** ${roi.totalReturn.hoursSaved.toFixed(2)}
- **Docs Generated:** ${metrics.productivity.docsGeneratedAutomatically}
- **Automation Rate:** ${metrics.productivity.automationRate.toFixed(2)}%
- **Search Deflection Rate:** ${metrics.productivity.searchDeflectionRate.toFixed(2)}%

### Usage
- **Doc Views:** ${metrics.usage.totalDocViews.toLocaleString()}
- **Unique Viewers:** ${metrics.usage.uniqueViewers.toLocaleString()}
- **Search Queries:** ${metrics.usage.searchQueries.toLocaleString()}
- **Chat Interactions:** ${metrics.usage.chatInteractions.toLocaleString()}

### Satisfaction
- **Overall Score:** ${metrics.satisfaction.overall.toFixed(1)}%
- **Helpful:** ${metrics.satisfaction.helpful}
- **Not Helpful:** ${metrics.satisfaction.notHelpful}

## Top Search Gaps

${
  metrics.searchGaps.length > 0
    ? metrics.searchGaps
        .slice(0, 5)
        .map(
          (gap: { query: string; searchCount: number }) =>
            `- **${gap.query}** (${gap.searchCount} searches)`
        )
        .join('\n')
    : 'No significant search gaps identified.'
}

---

View your full ROI dashboard at: https://app.docsynth.dev/analytics/roi

*This is an automated report from DocSynth.*
    `.trim();

    // Send email to all admins
    for (const user of organization.users) {
      if (user.email) {
        try {
          await addJob(QUEUE_NAMES.NOTIFICATIONS, {
            type: 'email',
            recipient: user.email,
            subject,
            body,
            metadata: {
              organizationId,
              period: summary.period,
              username: user.githubUsername,
            },
          });

          log.debug({ email: user.email }, 'ROI email queued');
        } catch (error) {
          log.error({ error, email: user.email }, 'Failed to queue ROI email');
        }
      }
    }

    log.info({ organizationId, recipientCount: organization.users.length }, 'ROI emails queued');
  } catch (error) {
    log.error({ error, organizationId }, 'Failed to send ROI email');
    // Don't throw - email failure shouldn't fail the whole job
  }
}

/**
 * Generate monthly ROI reports for all organizations
 * This can be called from a cron job
 */
export async function generateMonthlyReports(): Promise<void> {
  log.info('Generating monthly ROI reports');

  const organizations = await prisma.organization.findMany({
    where: {
      subscriptionTier: { not: 'FREE' },
    },
    select: { id: true, name: true },
  });

  let scheduled = 0;

  for (const org of organizations) {
    try {
      await addJob(QUEUE_NAMES.ROI_COMPUTATION, {
        organizationId: org.id,
        period: 'monthly',
        sendEmail: true,
      });

      scheduled++;
      log.debug({ organizationId: org.id }, 'Scheduled monthly ROI report');
    } catch (error) {
      log.error({ error, organizationId: org.id }, 'Failed to schedule monthly report');
    }
  }

  log.info({ scheduled, total: organizations.length }, 'Monthly ROI reports scheduled');
}

/**
 * Cleanup old ROI computation data
 * Remove data older than retention period (e.g., 90 days for detailed events)
 */
export async function cleanupOldROIData(retentionDays: number = 90): Promise<void> {
  log.info({ retentionDays }, 'Cleaning up old ROI data');

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  try {
    // Delete old page views (keep aggregated summaries)
    const deletedViews = await prisma.docPageView.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    // Delete old search queries
    const deletedSearches = await prisma.docSearchQuery.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    // Delete old feedback (keep recent for analysis)
    const deletedFeedback = await prisma.docFeedback.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    log.info(
      {
        deletedViews: deletedViews.count,
        deletedSearches: deletedSearches.count,
        deletedFeedback: deletedFeedback.count,
        retentionDays,
      },
      'ROI data cleanup completed'
    );
  } catch (error) {
    log.error({ error, retentionDays }, 'Failed to cleanup ROI data');
    throw error;
  }
}
