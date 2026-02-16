/**
 * Doc Linter Worker
 *
 * Processes documentation lint jobs from the queue.
 */

import { createWorker, QUEUE_NAMES, type DocLintJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { lint, loadConfig } from '@docsynth/lint';

const log = createLogger('doc-linter-worker');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export function startDocLinterWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_LINT,
    async (job) => {
      const data = job.data as DocLintJobData;
      const { repositoryId } = data;

      log.info({ repositoryId }, 'Processing doc lint job');

      await job.updateProgress(10);

      // Load config for the repository
      let config = loadConfig();
      try {
        const repoConfig = await db.repositoryLintConfig?.findUnique({
          where: { repositoryId },
        });
        if (repoConfig?.config) {
          config = loadConfig(repoConfig.config);
        }
      } catch {
        // Table may not exist yet
      }

      await job.updateProgress(20);

      // Fetch documents for the repository
      const documents = await prisma.document.findMany({
        where: { repositoryId },
        select: { id: true, path: true, content: true },
      });

      await job.updateProgress(40);

      // Lint each document
      const results = [];
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i]!;
        if (!doc.content) continue;

        const result = lint(doc.path, doc.content, config);
        results.push(result);

        const progress = 40 + Math.round((i / documents.length) * 50);
        await job.updateProgress(progress);
      }

      await job.updateProgress(95);

      const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
      const averageScore =
        results.length > 0
          ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
          : 100;

      log.info(
        { repositoryId, filesLinted: results.length, totalIssues, averageScore },
        'Doc lint job complete'
      );

      await job.updateProgress(100);
    },
    {
      concurrency: 3,
      limiter: { max: 10, duration: 60_000 },
    }
  );

  return worker;
}
