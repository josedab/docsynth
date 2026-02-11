import { createLogger } from '@docsynth/utils';
import { connectDatabase, disconnectDatabase } from '@docsynth/database';
import { initializeRedis, closeAllQueues } from '@docsynth/queue';
import { initializeGitHubApp } from '@docsynth/github';
import { isDemoMode } from '@docsynth/config';

import { startChangeAnalysisWorker } from './workers/change-analysis.js';
import { startIntentInferenceWorker } from './workers/intent-inference.js';
import { startDocGenerationWorker } from './workers/doc-generation.js';
import { startDocReviewWorker } from './workers/doc-review.js';
import { startNotificationWorker } from './workers/notifications.js';
import { startPRPreviewWorker } from './workers/pr-preview.js';
import { startDriftScanWorker, schedulePeriodicDriftScans } from './workers/drift-scan.js';
import { startVectorIndexWorker } from './workers/vector-index.js';
import { startDocTestWorker } from './workers/doc-test.js';
import { startDocTestingWorker } from './workers/doc-testing.js';
import { startHealthScanWorker, schedulePeriodicHealthScans } from './workers/health-scan.js';
import { startExampleValidationWorker } from './workers/example-validation.js';
import { startKnowledgeGraphWorker } from './workers/knowledge-graph.js';
// New workers for features 4-10
import { startDocReviewCopilotWorker } from './workers/doc-review-copilot.js';
import { startTranslationWorker } from './workers/translation.js';
import { startDiagramGenerationWorker } from './workers/diagram-generation.js';
import { startOnboardingWorker } from './workers/onboarding.js';
import { startOnboardingPathsWorker } from './workers/onboarding-paths.js';
import { startChatRAGWorker } from './workers/chat-rag.js';
import { startADRGenerationWorker } from './workers/adr-generation.js';
import { startBotMessageWorker } from './workers/bot-message.js';
// Next-gen features (from planning)
import { startReviewDocumentationWorker } from './workers/review-documentation.js';
import { startCoverageGateWorker } from './workers/coverage-gate.js';
import { startComplianceAssessmentWorker } from './workers/compliance-assessment.js';
// Follow-up feature workers
import { startSelfHealingWorker, schedulePeriodicSelfHealing } from './workers/self-healing.js';
import {
  startAnalyticsComputationWorker,
  scheduleDailyAnalytics,
} from './workers/analytics-computation.js';
import {
  startLLMUsageAggregationWorker,
  scheduleHourlyLLMUsageAggregation,
} from './workers/llm-usage-aggregation.js';
import { startCommunityBadgeCheckWorker } from './workers/community-badge-check.js';
import { startMigrationWorker } from './workers/migration.js';
import { startDocImpactWorker, scheduleUnanalyzedPRs } from './workers/doc-impact.js';
import { startPollingWorker, schedulePeriodicPolling } from './workers/polling.js';
import { startNLEditorWorker } from './workers/nl-editor.js';
import { startOrgGraphBuilderWorker } from './workers/org-graph-builder.js';
import {
  startROIComputationWorker,
  scheduleWeeklyROIComputation,
} from './workers/roi-computation.js';
// Next-gen v2 feature workers
import { startPRDocReviewWorker } from './workers/pr-doc-review.js';
import { startFederatedHubWorker } from './workers/federated-hub.js';
import { startAPIChangelogWorker } from './workers/api-changelog.js';
import { startExecutiveReportWorker } from './workers/executive-report.js';
import { startSDKDocsGenerationWorker } from './workers/sdk-docs-generation.js';

const log = createLogger('worker');

// ============================================================================
// Constants
// ============================================================================

/** Interval for periodic drift scans (24 hours in milliseconds) */
const DRIFT_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Interval for periodic health scans (24 hours in milliseconds) */
const HEALTH_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Interval for periodic polling checks (5 minutes in milliseconds) */
const POLLING_CHECK_INTERVAL_MS = 5 * 60 * 1000;

const workers: { close: () => Promise<void> }[] = [];

async function start() {
  try {
    // Initialize database
    log.info('Connecting to database...');
    await connectDatabase();

    // Initialize Redis
    log.info('Connecting to Redis...');
    initializeRedis(process.env.REDIS_URL ?? 'redis://localhost:6379');

    // Initialize GitHub App (skipped in demo mode)
    if (isDemoMode()) {
      log.info('Running in DEMO MODE — GitHub App initialization skipped');
    } else {
      log.info('Initializing GitHub App...');
      initializeGitHubApp({
        appId: process.env.GITHUB_APP_ID ?? '',
        privateKey: process.env.GITHUB_APP_PRIVATE_KEY ?? '',
        clientId: process.env.GITHUB_CLIENT_ID ?? '',
        clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
      });
    }

    // Start workers
    log.info('Starting workers...');

    workers.push(startChangeAnalysisWorker());
    workers.push(startIntentInferenceWorker());
    workers.push(startDocGenerationWorker());
    workers.push(startDocReviewWorker());
    workers.push(startNotificationWorker());
    workers.push(startPRPreviewWorker());
    workers.push(startDriftScanWorker());
    workers.push(startVectorIndexWorker());
    workers.push(startDocTestWorker());
    workers.push(startDocTestingWorker());
    workers.push(startHealthScanWorker());
    workers.push(startExampleValidationWorker());
    workers.push(startKnowledgeGraphWorker());
    // New workers for features 4-10
    workers.push(startDocReviewCopilotWorker());
    workers.push(startTranslationWorker());
    workers.push(startDiagramGenerationWorker());
    workers.push(startOnboardingWorker());
    workers.push(startOnboardingPathsWorker());
    workers.push(startChatRAGWorker());
    workers.push(startADRGenerationWorker());
    workers.push(startBotMessageWorker());
    // Next-gen features (from planning)
    workers.push(startReviewDocumentationWorker());
    workers.push(startCoverageGateWorker());
    workers.push(startComplianceAssessmentWorker());
    // Follow-up feature workers
    workers.push(startSelfHealingWorker());
    workers.push(startAnalyticsComputationWorker());
    workers.push(startLLMUsageAggregationWorker());
    workers.push(startCommunityBadgeCheckWorker());
    workers.push(startMigrationWorker());
    workers.push(startDocImpactWorker());
    workers.push(startPollingWorker());
    workers.push(startOrgGraphBuilderWorker());
    workers.push(startNLEditorWorker());
    workers.push(startROIComputationWorker());
    // Next-gen v2 feature workers
    workers.push(startPRDocReviewWorker());
    workers.push(startFederatedHubWorker());
    workers.push(startAPIChangelogWorker());
    workers.push(startExecutiveReportWorker());
    workers.push(startSDKDocsGenerationWorker());

    // Schedule periodic drift scans (runs daily)
    await schedulePeriodicDriftScans();
    setInterval(() => schedulePeriodicDriftScans(), DRIFT_SCAN_INTERVAL_MS);

    // Schedule periodic health scans (runs daily at different time)
    await schedulePeriodicHealthScans();
    setInterval(() => schedulePeriodicHealthScans(), HEALTH_SCAN_INTERVAL_MS);

    // Schedule periodic self-healing runs (runs daily)
    await schedulePeriodicSelfHealing();
    setInterval(() => schedulePeriodicSelfHealing(), DRIFT_SCAN_INTERVAL_MS);

    // Schedule daily analytics computation
    await scheduleDailyAnalytics();
    setInterval(() => scheduleDailyAnalytics(), DRIFT_SCAN_INTERVAL_MS);

    // Schedule hourly LLM usage aggregation
    await scheduleHourlyLLMUsageAggregation();
    setInterval(() => scheduleHourlyLLMUsageAggregation(), 60 * 60 * 1000); // Every hour

    // Schedule doc impact analysis for unanalyzed PRs (runs daily)
    await scheduleUnanalyzedPRs();
    setInterval(() => scheduleUnanalyzedPRs(), DRIFT_SCAN_INTERVAL_MS);

    // Schedule periodic polling (checks every 5 minutes for repos that need polling)
    await schedulePeriodicPolling();
    setInterval(() => schedulePeriodicPolling(), POLLING_CHECK_INTERVAL_MS);

    // Schedule weekly ROI computation
    await scheduleWeeklyROIComputation();
    setInterval(() => scheduleWeeklyROIComputation(), 7 * DRIFT_SCAN_INTERVAL_MS); // Weekly

    log.info('🚀 DocSynth workers running');
  } catch (error) {
    log.error({ error }, 'Failed to start workers');
    process.exit(1);
  }
}

async function shutdown() {
  log.info('Shutting down workers...');

  try {
    // Close all workers
    await Promise.all(workers.map((w) => w.close()));

    // Close queues and connections
    await closeAllQueues();
    await disconnectDatabase();

    log.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    log.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
