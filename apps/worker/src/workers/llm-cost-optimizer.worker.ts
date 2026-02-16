/**
 * LLM Cost Optimizer Worker
 *
 * Periodically checks budget status for all organizations,
 * sends alerts when thresholds are crossed, and updates cost projections.
 */

import { createWorker, QUEUE_NAMES, type LLMCostCheckJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { llmCostOptimizerService } from '../../../api/src/services/llm-cost-optimizer.service.js';

const log = createLogger('llm-cost-optimizer-worker');

export function startLlmCostOptimizerWorker() {
  const worker = createWorker(
    QUEUE_NAMES.LLM_COST_CHECK,
    async (job) => {
      const data = job.data as LLMCostCheckJobData;
      const { organizationId } = data;

      log.info({ jobId: job.id, organizationId }, 'Starting LLM cost check job');

      await job.updateProgress(10);

      try {
        if (organizationId) {
          // Check a specific org
          const status = await llmCostOptimizerService.getBudgetStatus(organizationId);

          log.info(
            {
              organizationId,
              status: status.status,
              percentUsed: status.percentUsed,
              alertCount: status.alerts.length,
            },
            'Budget check completed for organization'
          );

          await job.updateProgress(100);
          return;
        }

        // Check all orgs
        await job.updateProgress(20);

        const results = await llmCostOptimizerService.checkAllOrgBudgets();

        await job.updateProgress(80);

        for (const result of results) {
          if (result.status.alerts.length > 0) {
            log.warn(
              {
                orgId: result.orgId,
                status: result.status.status,
                percentUsed: result.status.percentUsed,
                alertCount: result.status.alerts.length,
              },
              'Budget alert triggered'
            );
          }
        }

        await job.updateProgress(100);

        log.info(
          {
            orgsChecked: results.length,
            alertsTriggered: results.filter((r) => r.status.alerts.length > 0).length,
          },
          'Bulk budget check completed'
        );
      } catch (error) {
        log.error({ error, organizationId }, 'LLM cost check job failed');
        throw error;
      }
    },
    { concurrency: 1 }
  );

  log.info('LLM cost optimizer worker started');
  return worker;
}
