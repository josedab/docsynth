import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { getJobStatus, QUEUE_NAMES, getQueueMetrics } from '@docsynth/queue';
import { requireAuth } from '../middleware/auth.js';
import { NotFoundError } from '@docsynth/utils';

const app = new Hono();

// List generation jobs
app.get('/', requireAuth, async (c) => {
  const repositoryId = c.req.query('repositoryId');
  const status = c.req.query('status');
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const perPage = Math.min(parseInt(c.req.query('perPage') ?? '20', 10), 100);

  const where = {
    ...(repositoryId && {
      changeAnalysis: {
        prEvent: {
          repositoryId,
        },
      },
    }),
    ...(status && { status: status.toUpperCase() as 'PENDING' | 'ANALYZING' | 'INFERRING' | 'GENERATING' | 'REVIEWING' | 'COMPLETED' | 'FAILED' }),
  };

  const [jobs, total] = await Promise.all([
    prisma.generationJob.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
      include: {
        changeAnalysis: {
          include: {
            prEvent: {
              select: {
                prNumber: true,
                title: true,
                repository: {
                  select: {
                    name: true,
                    githubFullName: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.generationJob.count({ where }),
  ]);

  return c.json({
    success: true,
    data: jobs.map((job) => ({
      id: job.id,
      status: job.status,
      progress: job.progress,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      prNumber: job.changeAnalysis.prEvent.prNumber,
      prTitle: job.changeAnalysis.prEvent.title,
      repository: job.changeAnalysis.prEvent.repository,
      result: job.result,
      createdAt: job.createdAt,
    })),
    meta: {
      page,
      perPage,
      total,
      hasMore: page * perPage < total,
    },
  });
});

// Get single job
app.get('/:jobId', requireAuth, async (c) => {
  const jobId = c.req.param('jobId');

  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    include: {
      changeAnalysis: {
        include: {
          prEvent: {
            include: {
              repository: true,
            },
          },
          intentContext: true,
        },
      },
      docVersions: {
        include: {
          document: true,
        },
      },
    },
  });

  if (!job) {
    throw new NotFoundError('GenerationJob', jobId);
  }

  return c.json({
    success: true,
    data: job,
  });
});

// Get job queue status
app.get('/:jobId/queue-status', requireAuth, async (c) => {
  const jobId = c.req.param('jobId');

  // Check each queue for this job
  const queues = [
    QUEUE_NAMES.CHANGE_ANALYSIS,
    QUEUE_NAMES.INTENT_INFERENCE,
    QUEUE_NAMES.DOC_GENERATION,
    QUEUE_NAMES.DOC_REVIEW,
  ];

  for (const queueName of queues) {
    const status = await getJobStatus(queueName, jobId);
    if (status) {
      return c.json({
        success: true,
        data: {
          queue: queueName,
          ...status,
        },
      });
    }
  }

  return c.json({
    success: true,
    data: null,
  });
});

// Get queue metrics (admin only)
app.get('/metrics/queues', requireAuth, async (c) => {
  const queues = [
    QUEUE_NAMES.CHANGE_ANALYSIS,
    QUEUE_NAMES.INTENT_INFERENCE,
    QUEUE_NAMES.DOC_GENERATION,
    QUEUE_NAMES.DOC_REVIEW,
    QUEUE_NAMES.NOTIFICATIONS,
  ];

  const metrics = await Promise.all(
    queues.map(async (name) => ({
      name,
      ...(await getQueueMetrics(name)),
    }))
  );

  return c.json({
    success: true,
    data: metrics,
  });
});

// Retry failed job
app.post('/:jobId/retry', requireAuth, async (c) => {
  const jobId = c.req.param('jobId');

  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    include: {
      changeAnalysis: {
        include: {
          prEvent: {
            include: {
              repository: true,
            },
          },
        },
      },
    },
  });

  if (!job) {
    throw new NotFoundError('GenerationJob', jobId);
  }

  if (job.status !== 'FAILED') {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_STATE', message: 'Can only retry failed jobs' },
      },
      400
    );
  }

  // Reset job status
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: 'PENDING',
      progress: 0,
      error: null,
      startedAt: null,
      completedAt: null,
    },
  });

  // Re-queue
  const { addJob } = await import('@docsynth/queue');
  await addJob(QUEUE_NAMES.DOC_GENERATION, {
    changeAnalysisId: job.changeAnalysisId,
    intentContextId: job.intentContextId,
    repositoryId: job.changeAnalysis.prEvent.repositoryId,
    installationId: job.changeAnalysis.prEvent.repository.installationId,
  });

  return c.json({
    success: true,
    data: { message: 'Job queued for retry' },
  });
});

export { app as jobRoutes };
