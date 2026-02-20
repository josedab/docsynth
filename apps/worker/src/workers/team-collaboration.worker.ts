/**
 * Team Collaboration Worker
 *
 * Manages multi-reviewer documentation workflows including review creation,
 * reviewer assignment, notifications, escalation, and thread resolution.
 */

import { createWorker, QUEUE_NAMES, type TeamCollaborationJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  createReview,
  assignReviewer,
  notifyParticipants,
  escalateReview,
  resolveThread,
} from '../../../api/src/services/team-collaboration.service.js';

const log = createLogger('team-collaboration-worker');

export function startTeamCollaborationWorker() {
  const worker = createWorker(
    QUEUE_NAMES.TEAM_COLLABORATION,
    async (job) => {
      const data = job.data as TeamCollaborationJobData;
      const { action, documentId, repositoryId, reviewId } = data;

      log.info(
        { jobId: job.id, action, documentId, repositoryId, reviewId },
        'Starting team collaboration job'
      );
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'create-review': {
            log.info({ documentId, repositoryId }, 'Creating documentation review');
            await job.updateProgress(20);
            await createReview(documentId, repositoryId, data.assignees ?? [], data.dueDate);
            await job.updateProgress(90);
            break;
          }

          case 'assign-reviewer': {
            log.info({ reviewId, assignees: data.assignees }, 'Assigning reviewer');
            await job.updateProgress(20);
            await assignReviewer(reviewId!, data.assignees ?? []);
            await job.updateProgress(90);
            break;
          }

          case 'notify': {
            log.info({ reviewId, documentId }, 'Sending notifications');
            await job.updateProgress(20);
            await notifyParticipants(reviewId!, documentId, data.comment);
            await job.updateProgress(90);
            break;
          }

          case 'escalate': {
            log.info({ reviewId }, 'Escalating overdue review');
            await job.updateProgress(20);
            await escalateReview(reviewId!);
            await job.updateProgress(90);
            break;
          }

          case 'resolve-thread': {
            log.info({ threadId: data.threadId }, 'Resolving review thread');
            await job.updateProgress(20);
            await resolveThread(data.threadId!, data.comment);
            await job.updateProgress(90);
            break;
          }

          default: {
            throw new Error(`Unknown team collaboration action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, action, documentId }, 'Team collaboration job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, action, documentId }, 'Team collaboration job failed');
        throw error;
      }
    },
    { concurrency: 5 }
  );

  log.info('Team collaboration worker started');
  return worker;
}
