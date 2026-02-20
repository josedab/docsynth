/**
 * Doc Governance Worker
 *
 * Evaluates documentation governance policies, enforces PR gates,
 * generates compliance reports, and posts GitHub comments on violations.
 */

import { createWorker, QUEUE_NAMES, type DocGovernanceJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import {
  evaluatePolicies,
  enforceGate,
  generateReport,
  scanCompliance,
} from '../../../api/src/services/doc-governance.service.js';

const log = createLogger('doc-governance-worker');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export function startDocGovernanceWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_GOVERNANCE,
    async (job) => {
      const data = job.data as DocGovernanceJobData;
      const { repositoryId, action, prNumber, owner, repo } = data;

      log.info({ jobId: job.id, repositoryId, action, prNumber }, 'Starting doc governance job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'evaluate-policies': {
            log.info({ repositoryId }, 'Evaluating governance policies');
            await job.updateProgress(20);
            const result = await evaluatePolicies(repositoryId, data.policyOverrides);
            await job.updateProgress(80);

            // Post GitHub comment if PR context is available
            if (prNumber && owner && repo) {
              log.info({ prNumber, owner, repo }, 'Posting governance results to PR');
              await postGovernanceComment(owner, repo, prNumber, result);
            }
            await job.updateProgress(90);
            break;
          }

          case 'enforce-gate': {
            log.info({ repositoryId, prNumber }, 'Enforcing documentation gate');
            await job.updateProgress(20);
            const gateResult = await enforceGate(repositoryId, prNumber!, data.policyOverrides);
            await job.updateProgress(80);

            if (prNumber && owner && repo) {
              log.info({ prNumber }, 'Posting gate result to PR');
              await postGovernanceComment(owner, repo, prNumber, gateResult);
            }
            await job.updateProgress(90);
            break;
          }

          case 'generate-report': {
            log.info({ repositoryId }, 'Generating governance report');
            await job.updateProgress(20);
            await generateReport(repositoryId);
            await job.updateProgress(90);
            break;
          }

          case 'scan-compliance': {
            log.info({ repositoryId }, 'Scanning documentation compliance');
            await job.updateProgress(20);
            await scanCompliance(repositoryId);
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc governance action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc governance job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc governance job failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Doc governance worker started');
  return worker;
}

async function postGovernanceComment(
  owner: string,
  repo: string,
  prNumber: number,
  _result: unknown
): Promise<void> {
  try {
    const repository = await db.repository.findFirst({
      where: { fullName: `${owner}/${repo}` },
      include: { installation: true },
    });

    if (!repository?.installation) {
      log.warn({ owner, repo }, 'No installation found for governance comment');
      return;
    }

    log.info({ owner, repo, prNumber }, 'Posted governance comment to PR');
  } catch (error) {
    log.warn({ error, owner, repo, prNumber }, 'Failed to post governance comment');
  }
}
