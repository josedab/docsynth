/**
 * Doc-as-Tests Worker
 *
 * Processes doc-as-tests jobs from queue, running documentation
 * code examples as executable tests for a repository.
 */

import { createWorker, QUEUE_NAMES, type DocAsTestsJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import {
  extractCodeBlocks,
  runDocTests,
  type DocTestSuite,
} from '../../../api/src/services/doc-as-tests.service.js';

const log = createLogger('doc-as-tests-worker');
export function startDocAsTestsWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DOC_AS_TESTS,
    async (job) => {
      const data = job.data as DocAsTestsJobData;
      const { repositoryId } = data;

      log.info({ jobId: job.id, repositoryId }, 'Starting doc-as-tests job');

      await job.updateProgress(5);

      try {
        // Get repository
        const repository = await prisma.repository.findUnique({
          where: { id: repositoryId },
        });

        if (!repository) {
          throw new Error(`Repository not found: ${repositoryId}`);
        }

        await job.updateProgress(10);

        // Get all documents for the repository
        const documents = await prisma.document.findMany({
          where: { repositoryId },
          select: { id: true, path: true, content: true },
          take: 50,
        });

        log.info({ repositoryId, documentCount: documents.length }, 'Found documents to test');

        await job.updateProgress(20);

        const allSuites: DocTestSuite[] = [];
        const progressPerDoc = documents.length > 0 ? 60 / documents.length : 60;

        for (let i = 0; i < documents.length; i++) {
          const doc = documents[i]!;
          const content = doc.content || '';

          if (!content.trim()) continue;

          const blocks = extractCodeBlocks(content);
          if (blocks.length === 0) continue;

          try {
            const suite = await runDocTests(doc.path, content);
            allSuites.push(suite);

            // Store individual results
            await storeTestRun(repositoryId, suite);
          } catch (error) {
            log.warn({ error, documentPath: doc.path }, 'Failed to run tests for document');
          }

          await job.updateProgress(20 + Math.round(progressPerDoc * (i + 1)));
        }

        await job.updateProgress(90);

        // Calculate aggregate stats
        const totalBlocks = allSuites.reduce((sum, s) => sum + s.codeBlocks.length, 0);
        const totalPassed = allSuites.reduce(
          (sum, s) => sum + s.results.filter((r) => r.passed).length,
          0
        );
        const totalResults = allSuites.reduce((sum, s) => sum + s.results.length, 0);
        const overallPassRate = totalResults > 0 ? (totalPassed / totalResults) * 100 : 100;

        await job.updateProgress(100);

        log.info(
          {
            repositoryId,
            documentsProcessed: allSuites.length,
            totalBlocks,
            totalPassed,
            overallPassRate: overallPassRate.toFixed(1),
          },
          'Doc-as-tests job completed'
        );
      } catch (error) {
        log.error({ error, repositoryId }, 'Doc-as-tests job failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Doc-as-tests worker started');
  return worker;
}

/**
 * Store test run results in database.
 */
async function storeTestRun(repositoryId: string, suite: DocTestSuite): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO doc_as_test_runs (
        id, repository_id, file_path, total_blocks, pass_rate,
        total_time, executed_at, results, code_blocks, created_at
      ) VALUES (
        gen_random_uuid(), ${repositoryId}, ${suite.filePath},
        ${suite.codeBlocks.length}, ${suite.passRate},
        ${suite.totalTime}, NOW(),
        ${JSON.stringify(suite.results)}::jsonb,
        ${JSON.stringify(suite.codeBlocks)}::jsonb,
        NOW()
      )
    `;
  } catch (error) {
    log.warn({ error }, 'Failed to store test run (table may not exist yet)');
  }
}
