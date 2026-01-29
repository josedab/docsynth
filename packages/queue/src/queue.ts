import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { createLogger } from '@docsynth/utils';
import { getConnectionOptions, closeRedisConnection } from './redis.js';
import type { QueueName, JobDataMap } from './types.js';

const log = createLogger('queue');

// ============================================================================
// Queue Factory
// ============================================================================

const queues = new Map<string, Queue>();

export function getQueue<T extends QueueName>(name: T): Queue<JobDataMap[T]> {
  let queue = queues.get(name);

  if (!queue) {
    queue = new Queue(name, {
      connection: getConnectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          count: 1000,
          age: 24 * 60 * 60,
        },
        removeOnFail: {
          count: 5000,
          age: 7 * 24 * 60 * 60,
        },
      },
    });

    queues.set(name, queue);
  }

  return queue as Queue<JobDataMap[T]>;
}

// ============================================================================
// Job Scheduling
// ============================================================================

export interface AddJobOptions {
  priority?: number;
  delay?: number;
  jobId?: string;
}

export async function addJob<T extends QueueName>(
  queueName: T,
  data: JobDataMap[T],
  options: AddJobOptions = {}
): Promise<Job<JobDataMap[T]>> {
  const queue = getQueue(queueName);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const job = await queue.add(queueName as any, data as any, {
    priority: options.priority,
    delay: options.delay,
    jobId: options.jobId,
  });

  log.info({ queueName, jobId: job.id }, 'Job added to queue');
  return job;
}

export async function getJobStatus(
  queueName: QueueName,
  jobId: string
): Promise<{
  state: string;
  progress: number;
  attemptsMade: number;
  failedReason?: string;
} | null> {
  const queue = getQueue(queueName);
  const job = await queue.getJob(jobId);

  if (!job) {
    return null;
  }

  const state = await job.getState();

  return {
    state,
    progress: job.progress as number,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
  };
}

// ============================================================================
// Worker Factory
// ============================================================================

export type JobProcessor<T extends QueueName> = (
  job: Job<JobDataMap[T]>
) => Promise<void>;

export function createWorker<T extends QueueName>(
  queueName: T,
  processor: JobProcessor<T>,
  options: {
    concurrency?: number;
    limiter?: { max: number; duration: number };
  } = {}
): Worker<JobDataMap[T]> {
  const worker = new Worker<JobDataMap[T]>(
    queueName,
    async (job) => {
      log.info({ queueName, jobId: job.id }, 'Processing job');
      try {
        await processor(job);
        log.info({ queueName, jobId: job.id }, 'Job completed');
      } catch (error) {
        log.error({ queueName, jobId: job.id, error }, 'Job failed');
        throw error;
      }
    },
    {
      connection: getConnectionOptions(),
      concurrency: options.concurrency ?? 1,
      limiter: options.limiter,
    }
  );

  worker.on('failed', (job, error) => {
    log.error(
      { queueName, jobId: job?.id, error: error.message },
      'Job failed'
    );
  });

  worker.on('error', (error) => {
    log.error({ queueName, error: error.message }, 'Worker error');
  });

  return worker;
}

// ============================================================================
// Queue Events
// ============================================================================

export function createQueueEvents(queueName: QueueName): QueueEvents {
  return new QueueEvents(queueName, {
    connection: getConnectionOptions(),
  });
}

// ============================================================================
// Queue Management
// ============================================================================

export async function closeAllQueues(): Promise<void> {
  const closePromises = Array.from(queues.values()).map((queue) => queue.close());
  await Promise.all(closePromises);
  queues.clear();

  await closeRedisConnection();
}

export async function getQueueMetrics(queueName: QueueName): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const queue = getQueue(queueName);

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

export async function drainQueue(queueName: QueueName): Promise<void> {
  const queue = getQueue(queueName);
  await queue.drain();
}

export async function pauseQueue(queueName: QueueName): Promise<void> {
  const queue = getQueue(queueName);
  await queue.pause();
}

export async function resumeQueue(queueName: QueueName): Promise<void> {
  const queue = getQueue(queueName);
  await queue.resume();
}
