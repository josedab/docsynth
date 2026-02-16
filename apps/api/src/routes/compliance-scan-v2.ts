/**
 * Compliance & Security Scanner V2 Routes
 *
 * API endpoints for scanning documentation for compliance violations.
 */

import { Hono } from 'hono';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  runComplianceScan,
  getComplianceScanHistory,
  getComplianceRules,
  remediateViolation,
  type ComplianceFramework,
} from '../services/compliance-scan-v2.service.js';

const log = createLogger('compliance-scan-v2-routes');

const app = new Hono();

/**
 * POST /scan - Run compliance scan
 */
app.post('/scan', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    frameworks?: ComplianceFramework[];
    blockOnCritical?: boolean;
    async?: boolean;
  }>();

  if (!body.repositoryId) {
    return c.json({ success: false, error: 'repositoryId is required' }, 400);
  }

  if (body.async) {
    const job = await addJob(QUEUE_NAMES.COMPLIANCE_SCAN_V2, {
      repositoryId: body.repositoryId,
      frameworks: body.frameworks || ['soc2', 'hipaa', 'gdpr', 'pci_dss'],
      blockOnCritical: body.blockOnCritical ?? true,
    });
    return c.json({ success: true, data: { jobId: job.id, message: 'Compliance scan queued' } });
  }

  try {
    const result = await runComplianceScan(body.repositoryId, body.frameworks);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Compliance scan failed');
    return c.json({ success: false, error: 'Scan failed' }, 500);
  }
});

/**
 * GET /history/:repositoryId - Get scan history
 */
app.get('/history/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const history = await getComplianceScanHistory(c.req.param('repositoryId'), limit);
  return c.json({ success: true, data: history });
});

/**
 * GET /rules/:framework - Get compliance rules for a framework
 */
app.get('/rules/:framework', requireAuth, async (c) => {
  const rules = await getComplianceRules(c.req.param('framework') as ComplianceFramework);
  return c.json({ success: true, data: rules });
});

/**
 * POST /remediate - Auto-remediate a violation
 */
app.post('/remediate', requireAuth, async (c) => {
  const body = await c.req.json<{ violationId: string; violation: any }>();

  try {
    const result = await remediateViolation(body.violationId, body.violation);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Remediation failed');
    return c.json({ success: false, error: 'Remediation failed' }, 500);
  }
});

export { app as complianceScanV2Routes };
