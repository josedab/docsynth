/**
 * Doc Supply Chain Worker
 *
 * Processes documentation supply chain jobs: signing documents,
 * verifying integrity, auditing provenance, and generating SBOMs.
 */

import { createWorker, QUEUE_NAMES, type DocSupplyChainJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  signDocument,
  verifyDocument,
  generateSBOM,
} from '../../../api/src/services/doc-supply-chain.service.js';

const log = createLogger('doc-supply-chain-worker');

export function startDocSupplyChainWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_SUPPLY_CHAIN,
    async (job) => {
      const data = job.data as DocSupplyChainJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc supply chain job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'sign': {
            await job.updateProgress(10);
            const signature = await signDocument(repositoryId, data.documentId!);
            await job.updateProgress(90);

            log.info({ repositoryId, signed: !!signature }, 'Document signed');
            break;
          }

          case 'verify': {
            await job.updateProgress(10);
            const verification = await verifyDocument(repositoryId, data.documentId!);
            await job.updateProgress(90);

            log.info({ repositoryId, valid: verification.valid }, 'Document verification complete');
            break;
          }

          case 'audit': {
            await job.updateProgress(10);
            await verifyDocument(repositoryId, data.documentId!, { fullAudit: true });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Supply chain audit complete');
            break;
          }

          case 'generate-sbom': {
            await job.updateProgress(10);
            const sbom = await generateSBOM(repositoryId);
            await job.updateProgress(90);

            log.info({ repositoryId, components: sbom.components?.length ?? 0 }, 'SBOM generated');
            break;
          }

          default: {
            throw new Error(`Unknown doc supply chain action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc supply chain job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc supply chain job failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Doc supply chain worker started');
  return worker;
}
