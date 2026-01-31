import { createWorker, QUEUE_NAMES, addJob, type DriftScanJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { driftDetectorService } from '../services/drift-detector.js';

const log = createLogger('drift-scan-worker');

export function startDriftScanWorker() {
  const worker = createWorker(
    QUEUE_NAMES.DRIFT_SCAN,
    async (job) => {
      const data = job.data as DriftScanJobData;

      log.info(
        { jobId: job.id, repositoryId: data.repositoryId, scheduled: data.scheduled },
        'Starting drift scan'
      );

      await job.updateProgress(10);

      try {
        if (!data.repositoryId) {
          log.warn('No repositoryId provided for drift scan');
          return;
        }

        const result = await driftDetectorService.scanRepository(
          data.repositoryId,
          data.installationId,
          data.owner,
          data.repo
        );

        await job.updateProgress(80);

        // Store scan results in database
        await prisma.repository.update({
          where: { id: data.repositoryId },
          data: {
            lastDriftScanAt: result.scannedAt,
            metadata: {
              lastDriftScan: {
                scannedAt: result.scannedAt,
                documentsScanned: result.documentsScanned,
                driftsDetected: result.driftsDetected.length,
                summary: result.summary,
              },
            },
          },
        });

        // If critical drifts found, send notifications
        if (result.summary.criticalDrift > 0) {
          const repository = await prisma.repository.findUnique({
            where: { id: data.repositoryId },
            include: { organization: true },
          });

          if (repository?.organization) {
            await addJob(QUEUE_NAMES.NOTIFICATIONS, {
              type: 'webhook',
              recipient: repository.organization.id,
              subject: `Critical documentation drift detected in ${result.repositoryName}`,
              body: `${result.summary.criticalDrift} document(s) have critical drift and need immediate attention.`,
              metadata: {
                repositoryId: data.repositoryId,
                driftCount: result.summary.criticalDrift,
                scan: result,
              },
            });
          }
        }

        await job.updateProgress(100);

        log.info(
          {
            repositoryId: data.repositoryId,
            documentsScanned: result.documentsScanned,
            driftsFound: result.driftsDetected.length,
            critical: result.summary.criticalDrift,
          },
          'Drift scan completed'
        );
      } catch (error) {
        log.error({ error, repositoryId: data.repositoryId }, 'Drift scan failed');
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('Drift scan worker started');

  return worker;
}

// Schedule periodic drift scans for all enabled repositories
export async function schedulePeriodicDriftScans(): Promise<void> {
  log.info('Scheduling periodic drift scans');

  const repositories = await prisma.repository.findMany({
    where: { enabled: true },
    select: {
      id: true,
      githubFullName: true,
      installationId: true,
      lastDriftScanAt: true,
    },
  });

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let scheduled = 0;

  for (const repo of repositories) {
    // Skip if scanned within last 24 hours
    if (repo.lastDriftScanAt && repo.lastDriftScanAt > oneDayAgo) {
      continue;
    }

    const [owner, repoName] = repo.githubFullName.split('/');
    if (!owner || !repoName) continue;

    await addJob(
      QUEUE_NAMES.DRIFT_SCAN,
      {
        repositoryId: repo.id,
        installationId: repo.installationId,
        owner,
        repo: repoName,
        scheduled: true,
      },
      {
        // Stagger jobs to avoid rate limits
        delay: scheduled * 60 * 1000, // 1 minute apart
      }
    );

    scheduled++;
  }

  log.info({ scheduledCount: scheduled }, 'Periodic drift scans scheduled');
}
