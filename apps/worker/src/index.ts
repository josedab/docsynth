import { createLogger } from '@docsynth/utils';
import { connectDatabase, disconnectDatabase } from '@docsynth/database';
import { initializeRedis, closeAllQueues } from '@docsynth/queue';
import { initializeGitHubApp } from '@docsynth/github';

import { startChangeAnalysisWorker } from './workers/change-analysis.js';
import { startIntentInferenceWorker } from './workers/intent-inference.js';
import { startDocGenerationWorker } from './workers/doc-generation.js';
import { startDocReviewWorker } from './workers/doc-review.js';
import { startNotificationWorker } from './workers/notifications.js';
import { startPRPreviewWorker } from './workers/pr-preview.js';
import { startDriftScanWorker, schedulePeriodicDriftScans } from './workers/drift-scan.js';
import { startVectorIndexWorker } from './workers/vector-index.js';
import { startDocTestWorker } from './workers/doc-test.js';
import { startHealthScanWorker, schedulePeriodicHealthScans } from './workers/health-scan.js';
import { startExampleValidationWorker } from './workers/example-validation.js';
import { startKnowledgeGraphWorker } from './workers/knowledge-graph.js';
// New workers for features 4-10
import { startDocReviewCopilotWorker } from './workers/doc-review-copilot.js';
import { startTranslationWorker } from './workers/translation.js';
import { startDiagramGenerationWorker } from './workers/diagram-generation.js';
import { startOnboardingWorker } from './workers/onboarding.js';
import { startChatRAGWorker } from './workers/chat-rag.js';
import { startADRGenerationWorker } from './workers/adr-generation.js';
import { startBotMessageWorker } from './workers/bot-message.js';

const log = createLogger('worker');

// ============================================================================
// Constants
// ============================================================================

/** Interval for periodic drift scans (24 hours in milliseconds) */
const DRIFT_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Interval for periodic health scans (24 hours in milliseconds) */
const HEALTH_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

const workers: { close: () => Promise<void> }[] = [];

async function start() {
  try {
    // Initialize database
    log.info('Connecting to database...');
    await connectDatabase();

    // Initialize Redis
    log.info('Connecting to Redis...');
    initializeRedis(process.env.REDIS_URL ?? 'redis://localhost:6379');

    // Initialize GitHub App
    log.info('Initializing GitHub App...');
    initializeGitHubApp({
      appId: process.env.GITHUB_APP_ID ?? '',
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY ?? '',
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    });

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
    workers.push(startHealthScanWorker());
    workers.push(startExampleValidationWorker());
    workers.push(startKnowledgeGraphWorker());
    // New workers for features 4-10
    workers.push(startDocReviewCopilotWorker());
    workers.push(startTranslationWorker());
    workers.push(startDiagramGenerationWorker());
    workers.push(startOnboardingWorker());
    workers.push(startChatRAGWorker());
    workers.push(startADRGenerationWorker());
    workers.push(startBotMessageWorker());

    // Schedule periodic drift scans (runs daily)
    await schedulePeriodicDriftScans();
    setInterval(() => schedulePeriodicDriftScans(), DRIFT_SCAN_INTERVAL_MS);

    // Schedule periodic health scans (runs daily at different time)
    await schedulePeriodicHealthScans();
    setInterval(() => schedulePeriodicHealthScans(), HEALTH_SCAN_INTERVAL_MS);

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
