/**
 * Onboarding Generator Routes
 *
 * Interactive onboarding path generation for new developers.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  analyzeTopology,
  generateOnboardingPath,
  getOnboardingPath,
  completeStep,
} from '../services/onboarding-generator.service.js';

const log = createLogger('onboarding-generator-routes');
const app = new Hono();

app.post('/topology', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  try {
    const topology = await analyzeTopology(body.repositoryId);
    return c.json({ success: true, data: topology });
  } catch (error) {
    log.error({ error, repositoryId: body.repositoryId }, 'Failed to analyze topology');
    return c.json({ success: false, error: 'Failed to analyze topology' }, 500);
  }
});

app.post('/generate', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    role: string;
    includeSetupSteps?: boolean;
    includeArchOverview?: boolean;
    includeFirstTasks?: boolean;
    maxSteps?: number;
  }>();

  if (!body.repositoryId || !body.role) {
    return c.json({ success: false, error: 'repositoryId and role are required' }, 400);
  }

  try {
    const path = await generateOnboardingPath(body.repositoryId, body.role, body);
    return c.json({ success: true, data: path });
  } catch (error) {
    log.error({ error, repositoryId: body.repositoryId }, 'Failed to generate onboarding path');
    return c.json({ success: false, error: 'Failed to generate path' }, 500);
  }
});

app.post('/generate/async', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ repositoryId: string; role: string }>();

  if (!body.repositoryId || !body.role) {
    return c.json({ success: false, error: 'repositoryId and role are required' }, 400);
  }

  try {
    await addJob(QUEUE_NAMES.ONBOARDING_GENERATOR, {
      repositoryId: body.repositoryId,
      role: body.role as 'frontend' | 'backend' | 'fullstack' | 'devops' | 'general',
      action: 'generate-path' as const,
    });
    return c.json({ success: true, data: { message: 'Onboarding path generation queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to queue onboarding generation');
    return c.json({ success: false, error: 'Failed to queue generation' }, 500);
  }
});

app.get('/path/:pathId', requireAuth, requireOrgAccess, async (c) => {
  const pathId = c.req.param('pathId');
  try {
    const path = await getOnboardingPath(pathId);
    if (!path) return c.json({ success: false, error: 'Path not found' }, 404);
    return c.json({ success: true, data: path });
  } catch (error) {
    log.error({ error, pathId }, 'Failed to get onboarding path');
    return c.json({ success: false, error: 'Failed to get path' }, 500);
  }
});

app.post('/complete-step', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{ pathId: string; stepOrder: number }>();

  if (!body.pathId || body.stepOrder === undefined) {
    return c.json({ success: false, error: 'pathId and stepOrder are required' }, 400);
  }

  try {
    const path = await completeStep(body.pathId, body.stepOrder);
    if (!path) return c.json({ success: false, error: 'Path not found' }, 404);
    return c.json({ success: true, data: path });
  } catch (error) {
    log.error({ error }, 'Failed to complete step');
    return c.json({ success: false, error: 'Failed to complete step' }, 500);
  }
});

export { app as onboardingGeneratorRoutes };
