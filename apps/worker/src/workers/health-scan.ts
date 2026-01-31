import { Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { createWorker, QUEUE_NAMES, HealthScanJobData, addJob } from '@docsynth/queue';
import { docHealthScorerService, DocHealthInput } from '../services/doc-health-scorer.js';
import type { DocumentType } from '@docsynth/types';

const log = createLogger('health-scan-worker');

const SCORE_DROP_THRESHOLD = 15; // Alert if score drops by more than 15 points
const CRITICAL_SCORE_THRESHOLD = 30; // Alert if any doc falls below this

async function processHealthScan(job: Job<HealthScanJobData>): Promise<void> {
  const { organizationId, repositoryId, scheduled, createAlerts = true } = job.data;

  log.info({ organizationId, repositoryId, scheduled }, 'Starting health scan');

  // Get repositories to scan
  const whereClause = repositoryId
    ? { id: repositoryId, enabled: true }
    : organizationId
      ? { organizationId, enabled: true }
      : { enabled: true };

  const repositories = await prisma.repository.findMany({
    where: whereClause,
    include: {
      documents: true,
      organization: { select: { id: true, name: true } },
    },
  });

  log.info({ count: repositories.length }, 'Found repositories to scan');

  for (const repo of repositories) {
    try {
      await job.updateProgress(Math.floor((repositories.indexOf(repo) / repositories.length) * 100));

      // Get recent PR events for code change dates
      const prEvents = await prisma.pREvent.findMany({
        where: { repositoryId: repo.id, mergedAt: { not: null } },
        orderBy: { mergedAt: 'desc' },
        take: 50,
        select: { mergedAt: true },
      });

      const codeChangeDates = prEvents
        .filter((pr): pr is typeof pr & { mergedAt: Date } => pr.mergedAt !== null)
        .map((pr) => pr.mergedAt);

      const existingDocTypes = [...new Set(repo.documents.map((d) => d.type))] as DocumentType[];

      // Calculate health scores for all documents
      const docScores = repo.documents.map((doc) => {
        const input: DocHealthInput = {
          document: {
            ...doc,
            type: doc.type as DocumentType,
          },
          repositoryLastActivity: repo.lastActivityAt,
          codeChangeDates,
          existingDocTypes,
        };
        return docHealthScorerService.calculateHealthScore(input);
      });

      // Calculate repository-level scores
      const repoHealth = docHealthScorerService.calculateRepositoryHealth(
        repo.id,
        repo.name,
        docScores,
        existingDocTypes
      );

      // Calculate average scores
      const avgFreshness = docScores.length > 0
        ? Math.round(docScores.reduce((sum, d) => sum + d.scores.freshness, 0) / docScores.length)
        : 0;
      const avgCompleteness = docScores.length > 0
        ? Math.round(docScores.reduce((sum, d) => sum + d.scores.completeness, 0) / docScores.length)
        : 0;
      const avgAccuracy = docScores.length > 0
        ? Math.round(docScores.reduce((sum, d) => sum + d.scores.accuracy, 0) / docScores.length)
        : 0;

      // Get previous snapshot for comparison
      const previousSnapshot = await prisma.healthScoreSnapshot.findFirst({
        where: { repositoryId: repo.id },
        orderBy: { snapshotDate: 'desc' },
      });

      // Create health score snapshot
      await prisma.healthScoreSnapshot.create({
        data: {
          repositoryId: repo.id,
          organizationId: repo.organizationId,
          overallScore: repoHealth.overallScore,
          freshnessScore: avgFreshness,
          completenessScore: avgCompleteness,
          accuracyScore: avgAccuracy,
          documentCount: docScores.length,
          healthyCount: repoHealth.healthDistribution.healthy,
          needsAttentionCount: repoHealth.healthDistribution.needsAttention,
          criticalCount: repoHealth.healthDistribution.critical,
          coverageGaps: repoHealth.coverageGaps,
        },
      });

      log.info(
        { repositoryId: repo.id, overallScore: repoHealth.overallScore },
        'Health snapshot created'
      );

      // Create alerts if enabled
      if (createAlerts) {
        const alerts: Array<{
          alertType: string;
          severity: string;
          title: string;
          message: string;
          documentId?: string;
          metadata: object;
        }> = [];

        // Check for score drop
        if (previousSnapshot) {
          const scoreDrop = previousSnapshot.overallScore - repoHealth.overallScore;
          if (scoreDrop >= SCORE_DROP_THRESHOLD) {
            alerts.push({
              alertType: 'score-drop',
              severity: 'warning',
              title: `Documentation health dropped for ${repo.name}`,
              message: `Health score dropped by ${scoreDrop} points (from ${previousSnapshot.overallScore} to ${repoHealth.overallScore})`,
              metadata: {
                previousScore: previousSnapshot.overallScore,
                currentScore: repoHealth.overallScore,
                drop: scoreDrop,
              },
            });
          }
        }

        // Check for critical documents
        const criticalDocs = docScores.filter((d) => d.scores.overall < CRITICAL_SCORE_THRESHOLD);
        for (const doc of criticalDocs) {
          alerts.push({
            alertType: 'critical-doc',
            severity: 'critical',
            title: `Critical documentation health: ${doc.path}`,
            message: `Document "${doc.path}" has a health score of ${doc.scores.overall}. ${doc.recommendations[0] || 'Review required.'}`,
            documentId: doc.documentId,
            metadata: {
              scores: doc.scores,
              recommendations: doc.recommendations,
            },
          });
        }

        // Check for coverage gaps
        if (repoHealth.coverageGaps.length > 0) {
          const existingGapAlert = await prisma.healthAlert.findFirst({
            where: {
              repositoryId: repo.id,
              alertType: 'coverage-gap',
              acknowledged: false,
              createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Within last week
            },
          });

          if (!existingGapAlert) {
            alerts.push({
              alertType: 'coverage-gap',
              severity: 'info',
              title: `Missing documentation types in ${repo.name}`,
              message: `The following documentation types are missing: ${repoHealth.coverageGaps.join(', ')}`,
              metadata: { gaps: repoHealth.coverageGaps },
            });
          }
        }

        // Create alerts in database
        for (const alert of alerts) {
          await prisma.healthAlert.create({
            data: {
              organizationId: repo.organizationId,
              repositoryId: repo.id,
              documentId: alert.documentId,
              alertType: alert.alertType,
              severity: alert.severity,
              title: alert.title,
              message: alert.message,
              metadata: alert.metadata,
            },
          });
        }

        // Queue notifications for critical alerts
        const criticalAlerts = alerts.filter((a) => a.severity === 'critical');
        if (criticalAlerts.length > 0) {
          await addJob(QUEUE_NAMES.NOTIFICATIONS, {
            type: 'slack',
            recipient: repo.organizationId,
            subject: `DocSynth Alert: ${criticalAlerts.length} critical documentation issues`,
            body: criticalAlerts.map((a) => `• ${a.title}`).join('\n'),
            metadata: { alerts: criticalAlerts, repositoryId: repo.id },
          });
        }

        log.info({ repositoryId: repo.id, alertCount: alerts.length }, 'Alerts created');
      }

      // Update leaderboard
      await updateLeaderboard(repo.organizationId, repo.id, repo.name, repoHealth.overallScore);
    } catch (error) {
      log.error({ error, repositoryId: repo.id }, 'Failed to scan repository');
    }
  }

  await job.updateProgress(100);
  log.info({ organizationId, repositoryId }, 'Health scan completed');
}

async function updateLeaderboard(
  organizationId: string,
  repositoryId: string,
  repositoryName: string,
  score: number
): Promise<void> {
  const now = new Date();

  // Weekly period
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  // Get previous entry for score change calculation
  const previousEntry = await prisma.teamLeaderboard.findFirst({
    where: {
      organizationId,
      repositoryId,
      period: 'weekly',
      periodStart: { lt: weekStart },
    },
    orderBy: { periodStart: 'desc' },
  });

  const scoreChange = previousEntry ? score - previousEntry.score : 0;

  // Upsert weekly entry
  await prisma.teamLeaderboard.upsert({
    where: {
      organizationId_repositoryId_period_periodStart: {
        organizationId,
        repositoryId,
        period: 'weekly',
        periodStart: weekStart,
      },
    },
    update: {
      score,
      scoreChange,
      updatedAt: now,
    },
    create: {
      organizationId,
      repositoryId,
      repositoryName,
      period: 'weekly',
      periodStart: weekStart,
      periodEnd: weekEnd,
      rank: 0, // Will be calculated when fetching
      score,
      scoreChange,
    },
  });

  // Monthly period
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  await prisma.teamLeaderboard.upsert({
    where: {
      organizationId_repositoryId_period_periodStart: {
        organizationId,
        repositoryId,
        period: 'monthly',
        periodStart: monthStart,
      },
    },
    update: {
      score,
      updatedAt: now,
    },
    create: {
      organizationId,
      repositoryId,
      repositoryName,
      period: 'monthly',
      periodStart: monthStart,
      periodEnd: monthEnd,
      rank: 0,
      score,
    },
  });
}

export function startHealthScanWorker() {
  return createWorker(QUEUE_NAMES.HEALTH_SCAN, processHealthScan, {
    concurrency: 2,
    limiter: { max: 10, duration: 60000 },
  });
}

export async function schedulePeriodicHealthScans(): Promise<void> {
  log.info('Scheduling periodic health scans');
  
  // Get all organizations with enabled repositories
  const organizations = await prisma.organization.findMany({
    where: {
      repositories: { some: { enabled: true } },
    },
    select: { id: true },
  });

  for (const org of organizations) {
    await addJob(
      QUEUE_NAMES.HEALTH_SCAN,
      {
        organizationId: org.id,
        scheduled: true,
        createAlerts: true,
      },
      { jobId: `health-scan-${org.id}-${Date.now()}` }
    );
  }

  log.info({ count: organizations.length }, 'Scheduled health scans');
}
