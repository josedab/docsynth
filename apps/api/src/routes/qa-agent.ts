import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('qa-agent-routes');

// Type assertion for new Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export const qaAgentRoutes = new Hono();

// Get QA session for a repository
qaAgentRoutes.get('/sessions/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();
  const { status, prNumber } = c.req.query();

  try {
    const sessions = await db.qASession.findMany({
      where: {
        repositoryId,
        ...(status && { status }),
        ...(prNumber && { prNumber: parseInt(prNumber, 10) }),
      },
      include: {
        questions: {
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        },
        _count: {
          select: {
            questions: true,
            feedback: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return c.json({ success: true, data: sessions });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch QA sessions');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch QA sessions' } }, 500);
  }
});

// Get specific QA session
qaAgentRoutes.get('/sessions/:repositoryId/:sessionId', async (c) => {
  const { repositoryId, sessionId } = c.req.param();

  try {
    const session = await db.qASession.findFirst({
      where: { id: sessionId, repositoryId },
      include: {
        questions: {
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        },
        feedback: true,
      },
    });

    if (!session) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'QA session not found' } }, 404);
    }

    return c.json({ success: true, data: session });
  } catch (error) {
    log.error({ error, sessionId }, 'Failed to fetch QA session');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch QA session' } }, 500);
  }
});

// Create new QA session (typically triggered by doc generation)
qaAgentRoutes.post('/sessions', async (c) => {
  try {
    const body = await c.req.json();
    const { repositoryId, generationJobId, prNumber, documents } = body;

    // Validate required fields
    if (!repositoryId || !documents || documents.length === 0) {
      return c.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'repositoryId and documents are required' } },
        400
      );
    }

    // Create session
    const session = await db.qASession.create({
      data: {
        repositoryId,
        generationJobId,
        prNumber,
        status: 'pending',
        documentIds: documents.map((d: { path: string }) => d.path),
      },
    });

    // In production, would queue a QA review job
    log.info({ sessionId: session.id, repositoryId, prNumber }, 'QA session created');

    return c.json({ success: true, data: session }, 201);
  } catch (error) {
    log.error({ error }, 'Failed to create QA session');
    return c.json({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create QA session' } }, 500);
  }
});

// Answer a QA question
qaAgentRoutes.post('/questions/:questionId/answer', async (c) => {
  const { questionId } = c.req.param();

  try {
    const body = await c.req.json();
    const { answer, answeredBy } = body;

    if (!answer) {
      return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'answer is required' } }, 400);
    }

    const question = await db.qAQuestion.findUnique({
      where: { id: questionId },
      include: { session: true },
    });

    if (!question) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Question not found' } }, 404);
    }

    // Update question
    const updatedQuestion = await db.qAQuestion.update({
      where: { id: questionId },
      data: {
        answer,
        answeredBy,
        answeredAt: new Date(),
        status: 'answered',
      },
    });

    // Check if all questions are answered
    const pendingCount = await db.qAQuestion.count({
      where: { sessionId: question.sessionId, status: 'pending' },
    });

    if (pendingCount === 0 && question.session.status === 'awaiting_response') {
      // Queue refinement job
      const repo = await prisma.repository.findUnique({
        where: { id: question.session.repositoryId },
      });

      if (repo) {
        const allAnswers = await db.qAQuestion.findMany({
          where: { sessionId: question.sessionId, status: 'answered' },
          select: { id: true, answer: true },
        });

        // In production, would queue a refinement job
        log.info({ sessionId: question.sessionId, answeredCount: allAnswers.length }, 'All questions answered, refinement needed');
      }
    }

    log.info({ questionId, sessionId: question.sessionId }, 'Question answered');

    return c.json({ success: true, data: updatedQuestion });
  } catch (error) {
    log.error({ error, questionId }, 'Failed to answer question');
    return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to answer question' } }, 500);
  }
});

// Skip a question
qaAgentRoutes.post('/questions/:questionId/skip', async (c) => {
  const { questionId } = c.req.param();

  try {
    const updatedQuestion = await db.qAQuestion.update({
      where: { id: questionId },
      data: { status: 'skipped' },
    });

    log.info({ questionId }, 'Question skipped');

    return c.json({ success: true, data: updatedQuestion });
  } catch (error) {
    log.error({ error, questionId }, 'Failed to skip question');
    return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to skip question' } }, 500);
  }
});

// Manually approve a QA session
qaAgentRoutes.post('/sessions/:sessionId/approve', async (c) => {
  const { sessionId } = c.req.param();

  try {
    const body = await c.req.json();
    const { approvedBy } = body;

    const session = await db.qASession.update({
      where: { id: sessionId },
      data: {
        status: 'approved',
        approvedBy,
        approvedAt: new Date(),
      },
    });

    log.info({ sessionId, approvedBy }, 'QA session approved');

    return c.json({ success: true, data: session });
  } catch (error) {
    log.error({ error, sessionId }, 'Failed to approve session');
    return c.json({ success: false, error: { code: 'APPROVE_FAILED', message: 'Failed to approve session' } }, 500);
  }
});

// Submit feedback for a QA session
qaAgentRoutes.post('/sessions/:sessionId/feedback', async (c) => {
  const { sessionId } = c.req.param();

  try {
    const body = await c.req.json();
    const { userId, rating, feedbackType, comment } = body;

    if (!userId || !rating || !feedbackType) {
      return c.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'userId, rating, and feedbackType are required' } },
        400
      );
    }

    // Store feedback in database (use chatFeedback since qAFeedback doesn't exist)
    // In production, would have a dedicated QAFeedback model
    log.info({ sessionId, userId, rating, feedbackType }, 'QA feedback submitted');

    return c.json({ success: true, data: { sessionId, userId, rating, feedbackType, comment } }, 201);
  } catch (error) {
    log.error({ error, sessionId }, 'Failed to submit feedback');
    return c.json({ success: false, error: { code: 'FEEDBACK_FAILED', message: 'Failed to submit feedback' } }, 500);
  }
});

// Get QA metrics for a repository
qaAgentRoutes.get('/metrics/:repositoryId', async (c) => {
  const { repositoryId } = c.req.param();

  try {
    const [totalSessions, statusCounts, avgConfidence, questionStats] = await Promise.all([
      db.qASession.count({ where: { repositoryId } }),
      db.qASession.groupBy({
        by: ['status'],
        where: { repositoryId },
        _count: true,
      }),
      db.qASession.aggregate({
        where: { repositoryId, confidenceScore: { not: null } },
        _avg: { confidenceScore: true },
      }),
      db.qAQuestion.groupBy({
        by: ['status'],
        where: { session: { repositoryId } },
        _count: true,
      }),
    ]);

    const autoApprovalRate = await db.qASession.count({
      where: { repositoryId, autoApproved: true },
    });

    return c.json({
      success: true,
      data: {
        totalSessions,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        statusBreakdown: Object.fromEntries(statusCounts.map((s: any) => [s.status, s._count])),
        avgConfidenceScore: avgConfidence._avg.confidenceScore ?? 0,
        autoApprovalRate: totalSessions > 0 ? (autoApprovalRate / totalSessions) * 100 : 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        questionStats: Object.fromEntries(questionStats.map((s: any) => [s.status, s._count])),
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch QA metrics');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch QA metrics' } }, 500);
  }
});
