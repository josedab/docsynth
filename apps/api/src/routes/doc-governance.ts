/**
 * Doc Governance Routes
 *
 * API endpoints for evaluating documentation against governance policies,
 * managing policies, and generating compliance reports.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  evaluatePolicies,
  getPolicy,
  updatePolicy,
  generateComplianceReport,
} from '../services/doc-governance.service.js';

const log = createLogger('doc-governance-routes');
const app = new Hono();

/**
 * POST /evaluate - Evaluate documentation against governance policies
 */
app.post('/evaluate', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      documentPaths?: string[];
      policyId?: string;
    }>();

    if (!body.repositoryId) {
      return c.json({ success: false, error: 'repositoryId is required' }, 400);
    }

    const result = await evaluatePolicies(body.repositoryId, body.documentPaths, body.policyId);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to evaluate policies');
    return c.json({ success: false, error: 'Failed to evaluate policies' }, 500);
  }
});

/**
 * GET /policy/:repositoryId - Get governance policy for a repository
 */
app.get('/policy/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const repositoryId = c.req.param('repositoryId');
    const policy = await getPolicy(repositoryId);
    return c.json({ success: true, data: policy });
  } catch (error) {
    log.error({ error }, 'Failed to get policy');
    return c.json({ success: false, error: 'Failed to get policy' }, 500);
  }
});

/**
 * POST /policy - Update governance policy
 */
app.post('/policy', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      rules: Array<{ ruleId: string; enabled: boolean; config?: Record<string, unknown> }>;
    }>();

    if (!body.repositoryId || !body.rules) {
      return c.json({ success: false, error: 'repositoryId and rules are required' }, 400);
    }

    const policy = await updatePolicy(body.repositoryId, body.rules);
    return c.json({ success: true, data: policy });
  } catch (error) {
    log.error({ error }, 'Failed to update policy');
    return c.json({ success: false, error: 'Failed to update policy' }, 500);
  }
});

/**
 * POST /compliance-report - Generate a compliance report
 */
app.post('/compliance-report', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId?: string;
      organizationId?: string;
      format?: string;
    }>();

    if (!body.repositoryId && !body.organizationId) {
      return c.json({ success: false, error: 'repositoryId or organizationId is required' }, 400);
    }

    const report = await generateComplianceReport(
      body.repositoryId,
      body.organizationId,
      body.format
    );
    return c.json({ success: true, data: report });
  } catch (error) {
    log.error({ error }, 'Failed to generate compliance report');
    return c.json({ success: false, error: 'Failed to generate compliance report' }, 500);
  }
});

/**
 * POST /evaluate/async - Queue an asynchronous policy evaluation
 */
app.post('/evaluate/async', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      documentPaths?: string[];
      policyId?: string;
    }>();

    if (!body.repositoryId) {
      return c.json({ success: false, error: 'repositoryId is required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.DOC_GOVERNANCE, {
      repositoryId: body.repositoryId,
      documentPaths: body.documentPaths,
      policyId: body.policyId,
    });

    return c.json({ success: true, data: { jobId: job.id, message: 'Policy evaluation queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to queue policy evaluation');
    return c.json({ success: false, error: 'Failed to queue policy evaluation' }, 500);
  }
});

export { app as docGovernanceRoutes };
