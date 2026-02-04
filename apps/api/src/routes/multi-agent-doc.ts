/**
 * Multi-Agent Documentation Generation API Routes
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@docsynth/database';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { multiAgentDocService } from '../services/multi-agent-doc.service.js';

const router = new Hono();

router.use('*', requireAuth);

// Generate documentation using multi-agent system
const generateSchema = z.object({
  fileId: z.string().optional(),
  filePath: z.string().optional(),
  content: z.string().optional(),
  docType: z.enum(['api', 'overview', 'tutorial', 'reference', 'changelog']).default('api'),
  includeExamples: z.boolean().default(true),
  maxLength: z.number().min(500).max(50000).optional(),
  targetAudience: z.enum(['beginner', 'intermediate', 'expert']).optional(),
  async: z.boolean().default(false),
});

router.post('/generate/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const body = await c.req.json();

  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
  }

  // Must have either fileId, filePath, or content
  if (!parsed.data.fileId && !parsed.data.filePath && !parsed.data.content) {
    return c.json({ error: 'Must provide fileId, filePath, or content' }, 400);
  }

  // Verify repository exists
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  // If async, queue job and return immediately
  if (parsed.data.async) {
    // Get repository details for job data
    const repoDetails = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { installationId: true, githubFullName: true },
    });

    const [owner = '', repo = ''] = repoDetails?.githubFullName?.split('/') || [];

    const job = await addJob(
      QUEUE_NAMES.MULTI_AGENT_DOC,
      {
        repositoryId,
        installationId: repoDetails?.installationId ?? 0,
        owner,
        repo,
        runType: 'generation',
        targetPaths: parsed.data.filePath ? [parsed.data.filePath] : undefined,
      },
      {
        jobId: `multi-agent-${repositoryId}-${Date.now()}`,
      }
    );

    return c.json({
      message: 'Documentation generation queued',
      jobId: job.id,
      async: true,
    });
  }

  // Synchronous generation
  try {
    const result = await multiAgentDocService.generateDocumentation(repositoryId, {
      fileId: parsed.data.fileId,
      filePath: parsed.data.filePath ?? '',
      content: parsed.data.content,
      docType: parsed.data.docType,
      includeExamples: parsed.data.includeExamples,
      maxLength: parsed.data.maxLength,
      targetAudience: parsed.data.targetAudience,
    });

    return c.json({
      runId: result.id,
      status: result.status,
      qualityScore: result.qualityScore,
      documentation: result.finalOutput,
      tasks: result.tasks.map((t) => ({
        agent: t.agentType,
        status: t.status,
        durationMs: t.durationMs,
      })),
    });
  } catch (error) {
    console.error('Multi-agent generation failed:', error);
    return c.json({ error: 'Documentation generation failed' }, 500);
  }
});

// Get agent run status and results
router.get('/run/:runId', async (c) => {
  const { runId } = c.req.param();

  const run = await multiAgentDocService.getAgentRun(runId);

  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  return c.json(run);
});

// List agent runs for repository
router.get('/runs/:repositoryId', requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const { limit = '20' } = c.req.query();

  const runs = await multiAgentDocService.listAgentRuns(repositoryId, parseInt(limit, 10));

  return c.json({
    runs: runs.map((r) => ({
      id: r.id,
      filePath: r.filePath,
      status: r.status,
      qualityScore: r.qualityScore,
      taskCount: r.tasks.length,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    })),
  });
});

// Get available agent types
router.get('/agents', async (c) => {
  return c.json({
    agents: [
      {
        type: 'reader',
        description: 'Parses and understands code semantically',
        capabilities: ['language detection', 'symbol extraction', 'complexity analysis'],
      },
      {
        type: 'searcher',
        description: 'Finds related docs, PRs, and issues for context',
        capabilities: ['document search', 'PR history', 'issue tracking'],
      },
      {
        type: 'writer',
        description: 'Generates documentation drafts',
        capabilities: ['api docs', 'tutorials', 'overviews', 'examples'],
      },
      {
        type: 'verifier',
        description: 'Fact-checks against actual code behavior',
        capabilities: ['accuracy scoring', 'issue detection', 'suggestions'],
      },
      {
        type: 'orchestrator',
        description: 'Coordinates workflow and resolves conflicts',
        capabilities: ['task coordination', 'quality assurance', 'final merge'],
      },
    ],
  });
});

// Cancel a running agent job
router.post('/cancel/:runId', async (c) => {
  const { runId } = c.req.param();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  try {
    await db.agentRun.update({
      where: { id: runId },
      data: { status: 'cancelled' },
    });

    return c.json({ message: 'Run cancelled' });
  } catch (error) {
    return c.json({ error: 'Failed to cancel run' }, 500);
  }
});

export default router;
