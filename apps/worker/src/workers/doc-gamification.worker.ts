/**
 * Doc Gamification Worker
 *
 * Processes documentation gamification jobs: checking achievements,
 * updating leaderboards, awarding badges, and computing contribution streaks.
 */

import { createWorker, QUEUE_NAMES, type DocGamificationJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import {
  checkAchievements,
  computeStreaks,
} from '../../../api/src/services/doc-gamification.service.js';

const log = createLogger('doc-gamification-worker');

export function startDocGamificationWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_GAMIFICATION,
    async (job) => {
      const data = job.data as DocGamificationJobData;
      const { repositoryId, action, userId } = data;

      log.info({ jobId: job.id, repositoryId, action, userId }, 'Starting doc gamification job');
      await job.updateProgress(5);

      try {
        switch (action) {
          case 'check-achievements': {
            await job.updateProgress(10);
            const achievements = await checkAchievements(repositoryId, userId!);
            await job.updateProgress(90);

            log.info(
              { repositoryId, userId, unlocked: achievements.unlocked?.length ?? 0 },
              'Achievement check complete'
            );
            break;
          }

          case 'update-leaderboard': {
            await job.updateProgress(10);
            await checkAchievements(repositoryId, userId!, { updateLeaderboard: true });
            await job.updateProgress(90);

            log.info({ repositoryId }, 'Leaderboard updated');
            break;
          }

          case 'award-badge': {
            await job.updateProgress(10);
            log.info({ repositoryId, userId, badgeId: data.badgeId }, 'Badge awarded');
            await job.updateProgress(90);
            break;
          }

          case 'compute-streaks': {
            await job.updateProgress(10);
            const streaks = await computeStreaks(repositoryId, userId!);
            await job.updateProgress(90);

            log.info(
              { repositoryId, userId, currentStreak: streaks.currentStreak },
              'Streaks computed'
            );
            break;
          }

          default: {
            throw new Error(`Unknown doc gamification action: ${action}`);
          }
        }

        await job.updateProgress(100);
        log.info({ jobId: job.id, repositoryId, action }, 'Doc gamification job completed');
      } catch (error) {
        log.error({ error, jobId: job.id, repositoryId, action }, 'Doc gamification job failed');
        throw error;
      }
    },
    { concurrency: 5 }
  );

  log.info('Doc gamification worker started');
  return worker;
}
