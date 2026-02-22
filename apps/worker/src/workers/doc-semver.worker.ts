/**
 * Doc Semver Worker
 *
 * Manages documentation versioning using semantic versioning: change
 * classification, version bumping, release tagging, and version queries.
 */

import { createWorker, QUEUE_NAMES, type DocSemverJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import {
  classifyChange,
  bumpVersion,
  tagRelease,
} from '../../../api/src/services/doc-semver.service.js';

const log = createLogger('doc-semver-worker');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export function startDocSemverWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_SEMVER,
    async (job) => {
      const data = job.data as DocSemverJobData;
      const { repositoryId, action } = data;

      log.info({ jobId: job.id, repositoryId, action }, 'Starting doc semver job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'classify-change': {
            log.info({ repositoryId }, 'Classifying documentation change');
            await job.updateProgress(20);
            await classifyChange(repositoryId, data.changeSet);
            await job.updateProgress(90);
            break;
          }

          case 'bump-version': {
            log.info({ repositoryId }, 'Bumping documentation version');
            await job.updateProgress(20);
            await bumpVersion(repositoryId, data.bumpType);
            await job.updateProgress(90);
            break;
          }

          case 'tag-release': {
            log.info({ repositoryId }, 'Tagging documentation release');
            await job.updateProgress(20);
            await tagRelease(repositoryId, data.version);
            await job.updateProgress(90);
            break;
          }

          case 'query-version': {
            log.info({ repositoryId }, 'Querying documentation version');
            await job.updateProgress(20);
            const version = await db.docVersion?.findFirst({
              where: { repositoryId },
              orderBy: { createdAt: 'desc' },
            });
            log.info({ repositoryId, version: version?.version }, 'Version query result');
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown doc semver action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc semver job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc semver job failed');
        throw error;
      }
    },
    { concurrency: 3 }
  );

  log.info('Doc semver worker started');
  return worker;
}
