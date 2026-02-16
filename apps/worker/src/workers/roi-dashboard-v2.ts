/**
 * Documentation ROI Dashboard V2 Worker
 */

import { createWorker, QUEUE_NAMES, addJob, type ROIDashboardJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { computeROIDashboard } from '../../../api/src/services/roi-dashboard-v2.service.js';

const log = createLogger('roi-dashboard-v2-worker');

export function startROIDashboardV2Worker() {
  const worker = createWorker(
    QUEUE_NAMES.ROI_DASHBOARD,
    async (job) => {
      const data = job.data as ROIDashboardJobData;
      const { organizationId, periodDays } = data;

      log.info({ jobId: job.id, organizationId, periodDays }, 'Starting ROI computation');
      await job.updateProgress(10);

      try {
        const result = await computeROIDashboard(organizationId, periodDays);
        await job.updateProgress(100);

        log.info(
          {
            organizationId,
            hoursSaved: result.totalHoursSaved,
            costSaved: result.totalCostSavedUSD,
          },
          'ROI computation completed'
        );
      } catch (error) {
        log.error({ error, organizationId }, 'ROI computation failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('ROI dashboard V2 worker started');
  return worker;
}

/**
 * Schedule periodic ROI computation for all organizations
 */
export async function schedulePeriodicROIDashboard(): Promise<void> {
  log.info('Scheduling periodic ROI dashboard computation');

  const orgs = await prisma.organization.findMany({
    select: { id: true },
  });

  for (const org of orgs) {
    try {
      await addJob(
        QUEUE_NAMES.ROI_DASHBOARD,
        {
          organizationId: org.id,
          periodDays: 30,
        },
        { jobId: `roi-periodic-${org.id}` }
      );
    } catch (error) {
      log.error({ error, orgId: org.id }, 'Failed to schedule ROI computation');
    }
  }

  log.info({ count: orgs.length }, 'Scheduled ROI computations');
}
