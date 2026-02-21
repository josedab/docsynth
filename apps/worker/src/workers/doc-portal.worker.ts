/**
 * Doc Portal Worker
 *
 * Processes documentation portal jobs: building portals, deploying,
 * updating configuration, invalidating caches, and generating sitemaps.
 */

import { createWorker, QUEUE_NAMES, type DocPortalJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { buildPortal } from '../../../api/src/services/doc-portal.service.js';

const log = createLogger('doc-portal-worker');

export function startDocPortalWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_PORTAL,
    async (job) => {
      const data = job.data as DocPortalJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc portal job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'build': {
            await job.updateProgress(10);
            const result = await buildPortal(repositoryId, data.options);
            await job.updateProgress(80);

            log.info({ repositoryId, pages: result.pages?.length ?? 0 }, 'Portal build complete');
            break;
          }

          case 'deploy': {
            await job.updateProgress(10);
            await buildPortal(repositoryId, { ...data.options, deploy: true });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Portal deployed');
            break;
          }

          case 'update-config': {
            await job.updateProgress(10);
            await buildPortal(repositoryId, { ...data.options, configOnly: true });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Portal configuration updated');
            break;
          }

          case 'invalidate-cache': {
            await job.updateProgress(10);
            await buildPortal(repositoryId, { ...data.options, invalidateCache: true });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Portal cache invalidated');
            break;
          }

          case 'generate-sitemap': {
            await job.updateProgress(10);
            await buildPortal(repositoryId, { ...data.options, sitemapOnly: true });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Sitemap generated');
            break;
          }

          default: {
            throw new Error(`Unknown doc portal action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc portal job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc portal job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Doc portal worker started');
  return worker;
}
