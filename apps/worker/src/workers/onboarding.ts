import { Worker, Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import { QUEUE_NAMES, getRedisConnection, type OnboardingJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { onboardingService } from '../services/onboarding.js';

const log = createLogger('onboarding-worker');

async function processOnboarding(job: Job<OnboardingJobData>): Promise<void> {
  const { repositoryId, action, role, userId } = job.data;

  log.info({ repositoryId, action, role }, 'Processing onboarding job');

  try {
    switch (action) {
      case 'generate':
        await generateJourney(job, repositoryId, role || 'new_hire');
        break;
      case 'update':
        await updateJourney(job, repositoryId, role || 'new_hire');
        break;
      case 'personalize':
        if (userId) {
          await personalizeJourney(job, repositoryId, role || 'new_hire', userId);
        }
        break;
    }
  } catch (error) {
    log.error({ error, repositoryId, action }, 'Onboarding job failed');
    throw error;
  }
}

async function generateJourney(
  job: Job<OnboardingJobData>,
  repositoryId: string,
  role: string
): Promise<void> {
  await job.updateProgress(10);

  // Get repository documents
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true, path: true, title: true, type: true, content: true },
  });

  await job.updateProgress(30);

  // Get code files (from metadata or directory listing)
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  const codeFiles = (repository?.metadata as Record<string, unknown>)?.codeFiles as Array<{
    path: string;
    language: string;
  }> || [];

  await job.updateProgress(50);

  // Generate journey
  const journey = await onboardingService.generateJourney({
    repositoryId,
    role,
    documents: documents.map((d) => ({
      id: d.id,
      path: d.path,
      title: d.title,
      type: d.type,
      content: d.content || '',
    })),
    codeFiles,
  });

  await job.updateProgress(80);

  // Save journey
  await prisma.onboardingJourney.upsert({
    where: {
      repositoryId_role: { repositoryId, role },
    },
    update: {
      title: journey.title,
      description: journey.description,
      estimatedMin: journey.estimatedMin,
      steps: journey.steps as unknown as object,
      prerequisites: journey.prerequisites,
      isPublished: true,
    },
    create: {
      repositoryId,
      role,
      title: journey.title,
      description: journey.description,
      estimatedMin: journey.estimatedMin,
      steps: journey.steps as unknown as object,
      prerequisites: journey.prerequisites,
      isPublished: true,
    },
  });

  await job.updateProgress(100);

  log.info(
    { repositoryId, role, stepCount: journey.steps.length, estimatedMin: journey.estimatedMin },
    'Onboarding journey generated'
  );
}

async function updateJourney(
  job: Job<OnboardingJobData>,
  repositoryId: string,
  role: string
): Promise<void> {
  // Check if journey exists
  const existing = await prisma.onboardingJourney.findUnique({
    where: { repositoryId_role: { repositoryId, role } },
  });

  if (!existing) {
    // Generate new if doesn't exist
    return generateJourney(job, repositoryId, role);
  }

  // Re-generate to update with latest docs
  return generateJourney(job, repositoryId, role);
}

async function personalizeJourney(
  _job: Job<OnboardingJobData>,
  repositoryId: string,
  role: string,
  userId: string
): Promise<void> {
  // Find the journey
  const journey = await prisma.onboardingJourney.findUnique({
    where: { repositoryId_role: { repositoryId, role } },
  });

  if (!journey) {
    throw new Error(`No journey found for role: ${role}`);
  }

  // Check if user already has progress
  const existingProgress = await prisma.onboardingProgress.findUnique({
    where: { journeyId_userId: { journeyId: journey.id, userId } },
  });

  if (!existingProgress) {
    // Create progress tracking
    await prisma.onboardingProgress.create({
      data: {
        journeyId: journey.id,
        userId,
        currentStep: 0,
        completed: false,
      },
    });

    log.info({ journeyId: journey.id, userId }, 'Created personalized onboarding progress');
  }
}

export function startOnboardingWorker(): Worker<OnboardingJobData> {
  const worker = new Worker<OnboardingJobData>(QUEUE_NAMES.ONBOARDING, processOnboarding, {
    connection: getRedisConnection(),
    concurrency: 2,
  });

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Onboarding job completed');
  });

  worker.on('failed', (job, error) => {
    log.error({ jobId: job?.id, error: error.message }, 'Onboarding job failed');
  });

  log.info('Onboarding worker started');
  return worker;
}
