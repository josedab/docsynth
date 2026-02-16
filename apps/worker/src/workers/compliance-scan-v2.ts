/**
 * Compliance & Security Scanner V2 Worker
 */

import { createWorker, QUEUE_NAMES, type ComplianceScanV2JobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { runComplianceScan } from '../../../api/src/services/compliance-scan-v2.service.js';

const log = createLogger('compliance-scan-v2-worker');

export function startComplianceScanV2Worker() {
  const worker = createWorker(
    QUEUE_NAMES.COMPLIANCE_SCAN_V2,
    async (job) => {
      const data = job.data as ComplianceScanV2JobData;
      const { repositoryId, frameworks, blockOnCritical } = data;

      log.info({ jobId: job.id, repositoryId, frameworks }, 'Starting compliance scan');
      await job.updateProgress(10);

      try {
        const result = await runComplianceScan(repositoryId, frameworks as any);
        await job.updateProgress(90);

        if (blockOnCritical && result.blockers > 0) {
          log.warn(
            { repositoryId, blockers: result.blockers },
            'Compliance scan found critical violations'
          );
        }

        await job.updateProgress(100);
        log.info(
          { repositoryId, violations: result.violations.length, passRate: result.passRate },
          'Compliance scan completed'
        );
      } catch (error) {
        log.error({ error, repositoryId }, 'Compliance scan failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Compliance scan V2 worker started');
  return worker;
}
