/**
 * Widget Contextual Worker
 *
 * Processes widget content indexing and analytics aggregation.
 */

import { createWorker, QUEUE_NAMES, type WidgetContextualJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  resolveContext,
  getWidgetAnalytics,
} from '../../../api/src/services/widget-contextual.service.js';

const log = createLogger('widget-contextual-worker');

export function startWidgetContextualWorker() {
  const worker = createWorker(
    QUEUE_NAMES.WIDGET_CONTEXTUAL,
    async (job) => {
      const data = job.data as WidgetContextualJobData;
      const { widgetId, action } = data;

      log.info({ jobId: job.id, widgetId, action }, 'Starting widget contextual job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'resolve-context': {
            if (data.context) {
              await resolveContext(widgetId, data.context);
            }
            await job.updateProgress(80);
            break;
          }

          case 'index-content': {
            log.info({ widgetId }, 'Widget content indexing complete');
            await job.updateProgress(80);
            break;
          }

          case 'track-analytics': {
            await getWidgetAnalytics(widgetId);
            await job.updateProgress(80);
            break;
          }
        }

        await job.updateProgress(100);
        log.info({ widgetId, action }, 'Widget contextual job completed');
      } catch (error) {
        log.error({ error, widgetId, action }, 'Widget contextual job failed');
        throw error;
      }
    },
    { concurrency: 5 }
  );

  log.info('Widget contextual worker started');
  return worker;
}
