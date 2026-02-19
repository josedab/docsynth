/**
 * ROI Executive Worker
 *
 * Processes ROI metric computation and executive report generation.
 */

import { createWorker, QUEUE_NAMES, type ROIExecutiveJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  computeROIMetrics,
  generateExecutiveReport,
} from '../../../api/src/services/roi-executive.service.js';

const log = createLogger('roi-executive-worker');

export function startROIExecutiveWorker() {
  const worker = createWorker(
    QUEUE_NAMES.ROI_EXECUTIVE,
    async (job) => {
      const data = job.data as ROIExecutiveJobData;
      const { organizationId, action, period, format } = data;

      log.info({ jobId: job.id, organizationId, action, period }, 'Starting ROI executive job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'compute-metrics': {
            const metrics = await computeROIMetrics(
              organizationId,
              period,
              data.startDate,
              data.endDate
            );
            await job.updateProgress(80);

            log.info({ organizationId, roi: metrics.overallROI }, 'ROI metrics computed');
            break;
          }

          case 'generate-report': {
            const report = await generateExecutiveReport(organizationId, period, format ?? 'json');
            await job.updateProgress(80);

            log.info({ organizationId, reportId: report.id, format }, 'Executive report generated');
            break;
          }

          case 'schedule-digest': {
            const report = await generateExecutiveReport(organizationId, period, 'slack-digest');
            await job.updateProgress(80);

            log.info({ organizationId, reportId: report.id }, 'Digest scheduled');
            break;
          }
        }

        await job.updateProgress(100);
        log.info({ organizationId, action }, 'ROI executive job completed');
      } catch (error) {
        log.error({ error, organizationId, action }, 'ROI executive job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('ROI executive worker started');
  return worker;
}
