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
// Next-gen v3 feature workers
import { startSmartDiffWorker } from './workers/smart-diff.js';
import { startDocQualityScoreWorker } from './workers/doc-quality-score.js';
import { startAutoHealingWorker, schedulePeriodicAutoHealing } from './workers/auto-healing.js';
import { startMultiRepoGraphV2Worker } from './workers/multi-repo-graph-v2.js';
import {
  startROIDashboardV2Worker,
  schedulePeriodicROIDashboard,
} from './workers/roi-dashboard-v2.js';
import { startInteractiveExampleV2Worker } from './workers/interactive-examples-v2.js';
import { startComplianceScanV2Worker } from './workers/compliance-scan-v2.js';
import { startMultiLangDocWorker } from './workers/multi-lang-doc.js';
import { startDocDrivenDevWorker } from './workers/doc-driven-dev.js';
import { startDocChatbotWorker } from './workers/doc-chatbot.js';
// Feature #9: Enhanced Documentation Impact Scoring
import { startImpactScoringWorker } from './workers/impact-scoring.worker.js';
// Feature #7: LLM Cost Optimizer & Budget Controls
import { startLlmCostOptimizerWorker } from './workers/llm-cost-optimizer.worker.js';
// Feature #2: AI Documentation Linter
import { startDocLinterWorker } from './workers/doc-linter.worker.js';
// Feature #10: OpenAPI/GraphQL Spec-Aware Generation
import { startSpecAwareDocsWorker } from './workers/spec-aware-docs.worker.js';
// Feature #4: Documentation-as-Tests
import { startDocAsTestsWorker } from './workers/doc-as-tests.worker.js';
// Feature #5: Smart Monorepo Documentation Hub
import { startMonorepoHubWorker } from './workers/monorepo-hub.worker.js';
// Feature #6: Real-Time Collaborative Documentation Editor
import { startRealtimeEditorWorker } from './workers/realtime-editor.worker.js';
// Feature #8: Embeddable Documentation Widget
import { startWidgetAnalyticsWorker } from './workers/widget-analytics.worker.js';
// Next-gen v4 feature workers
import { startAutopilotWorker } from './workers/autopilot.worker.js';
import { startPRReviewBotWorker } from './workers/pr-review-bot.worker.js';
import { startCoverageCIGateWorker } from './workers/coverage-ci-gate.worker.js';
import { startOnboardingGeneratorWorker } from './workers/onboarding-generator.worker.js';
import { startTranslationSyncWorker } from './workers/translation-sync.worker.js';
import { startDocTestsRuntimeWorker } from './workers/doc-tests-runtime.worker.js';
import { startSelfHealingAutoWorker } from './workers/self-healing-auto.worker.js';
import { startWidgetContextualWorker } from './workers/widget-contextual.worker.js';
import { startROIExecutiveWorker } from './workers/roi-executive.worker.js';
import { startFederatedSearchWorker } from './workers/federated-search.worker.js';
// Next-gen v5 feature workers
import { startDocAgentWorker } from './workers/doc-agent.worker.js';
import { startCopilotExtensionWorker } from './workers/copilot-extension.worker.js';
import { startDocDiffStagingWorker } from './workers/doc-diff-staging.worker.js';
import { startKnowledgeBaseRAGWorker } from './workers/knowledge-base-rag.worker.js';
import { startTeamCollaborationWorker } from './workers/team-collaboration.worker.js';
import { startDocAnalyticsInsightsWorker } from './workers/doc-analytics-insights.worker.js';
import { startFrameworkTemplatesWorker } from './workers/framework-templates.worker.js';
import { startDocGovernanceWorker } from './workers/doc-governance.worker.js';
import { startDocMigrationEngineWorker } from './workers/doc-migration-engine.worker.js';
import { startOnboardingIntelligenceWorker } from './workers/onboarding-intelligence.worker.js';
// Next-gen v6 feature workers
import { startDocsGitOpsWorker } from './workers/docs-gitops.worker.js';
import { startPairWritingWorker } from './workers/pair-writing.worker.js';
import { startDocSupplyChainWorker } from './workers/doc-supply-chain.worker.js';
import { startDocPortalWorker } from './workers/doc-portal.worker.js';
import { startImpactAttributionWorker } from './workers/impact-attribution.worker.js';
import { startDocQualityBenchmarkWorker } from './workers/doc-quality-benchmark.worker.js';
import { startDocWebhooksWorker } from './workers/doc-webhooks.worker.js';
import { startDocABTestingWorker } from './workers/doc-ab-testing.worker.js';
import { startOfflineSyncWorker } from './workers/offline-sync.worker.js';
import { startDocGamificationWorker } from './workers/doc-gamification.worker.js';
// Next-gen v7 feature workers
import { startDocLSPWorker } from './workers/doc-lsp.worker.js';
import { startDocDepGraphWorker } from './workers/doc-dep-graph.worker.js';
import { startDocSemverWorker } from './workers/doc-semver.worker.js';
import { startDocQLWorker } from './workers/doc-ql.worker.js';
import { startDocFederationWorker } from './workers/doc-federation.worker.js';
import { startDocRegressionWorker } from './workers/doc-regression.worker.js';
import { startDocContextTranslationWorker } from './workers/doc-context-translation.worker.js';
import { startDocHealthBadgeWorker } from './workers/doc-health-badge.worker.js';
import { startDocPlaygroundWorker } from './workers/doc-playground.worker.js';
import { startDocForecastWorker } from './workers/doc-forecast.worker.js';

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
    // Next-gen v3 feature workers
    workers.push(startSmartDiffWorker());
    workers.push(startDocQualityScoreWorker());
    workers.push(startAutoHealingWorker());
    workers.push(startMultiRepoGraphV2Worker());
    workers.push(startROIDashboardV2Worker());
    workers.push(startInteractiveExampleV2Worker());
    workers.push(startComplianceScanV2Worker());
    workers.push(startMultiLangDocWorker());
    workers.push(startDocDrivenDevWorker());
    workers.push(startDocChatbotWorker());
    // Feature #9: Enhanced Documentation Impact Scoring
    workers.push(startImpactScoringWorker());
    // Feature #7: LLM Cost Optimizer & Budget Controls
    workers.push(startLlmCostOptimizerWorker());
    // Feature #2: AI Documentation Linter
    workers.push(startDocLinterWorker());
    // Feature #4: Documentation-as-Tests
    workers.push(startDocAsTestsWorker());
    // Feature #10: OpenAPI/GraphQL Spec-Aware Generation
    workers.push(startSpecAwareDocsWorker());
    // Feature #5: Smart Monorepo Documentation Hub
    workers.push(startMonorepoHubWorker());
    // Feature #6: Real-Time Collaborative Documentation Editor
    workers.push(startRealtimeEditorWorker());
    // Feature #8: Embeddable Documentation Widget
    workers.push(startWidgetAnalyticsWorker());
    // Next-gen v4 feature workers
    workers.push(startAutopilotWorker());
    workers.push(startPRReviewBotWorker());
    workers.push(startCoverageCIGateWorker());
    workers.push(startOnboardingGeneratorWorker());
    workers.push(startTranslationSyncWorker());
    workers.push(startDocTestsRuntimeWorker());
    workers.push(startSelfHealingAutoWorker());
    workers.push(startWidgetContextualWorker());
    workers.push(startROIExecutiveWorker());
    workers.push(startFederatedSearchWorker());
    // Next-gen v5 feature workers
    workers.push(startDocAgentWorker());
    workers.push(startCopilotExtensionWorker());
    workers.push(startDocDiffStagingWorker());
    workers.push(startKnowledgeBaseRAGWorker());
    workers.push(startTeamCollaborationWorker());
    workers.push(startDocAnalyticsInsightsWorker());
    workers.push(startFrameworkTemplatesWorker());
    workers.push(startDocGovernanceWorker());
    workers.push(startDocMigrationEngineWorker());
    workers.push(startOnboardingIntelligenceWorker());
    // Next-gen v6 feature workers
    workers.push(startDocsGitOpsWorker());
    workers.push(startPairWritingWorker());
    workers.push(startDocSupplyChainWorker());
    workers.push(startDocPortalWorker());
    workers.push(startImpactAttributionWorker());
    workers.push(startDocQualityBenchmarkWorker());
    workers.push(startDocWebhooksWorker());
    workers.push(startDocABTestingWorker());
    workers.push(startOfflineSyncWorker());
    workers.push(startDocGamificationWorker());
    // Next-gen v7 feature workers
    workers.push(startDocLSPWorker());
    workers.push(startDocDepGraphWorker());
    workers.push(startDocSemverWorker());
    workers.push(startDocQLWorker());
    workers.push(startDocFederationWorker());
    workers.push(startDocRegressionWorker());
    workers.push(startDocContextTranslationWorker());
    workers.push(startDocHealthBadgeWorker());
    workers.push(startDocPlaygroundWorker());
    workers.push(startDocForecastWorker());

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

    // Schedule periodic auto-healing scans (runs daily)
    await schedulePeriodicAutoHealing();
    setInterval(() => schedulePeriodicAutoHealing(), DRIFT_SCAN_INTERVAL_MS);

    // Schedule periodic ROI dashboard computation (runs weekly)
    await schedulePeriodicROIDashboard();
    setInterval(() => schedulePeriodicROIDashboard(), 7 * DRIFT_SCAN_INTERVAL_MS);

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
