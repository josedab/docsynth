/**
 * ROI Executive Routes
 *
 * Executive ROI reports and metrics.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  computeROIMetrics,
  generateExecutiveReport,
  getReportHistory,
  formatSlackDigest,
} from '../services/roi-executive.service.js';

const log = createLogger('roi-executive-routes');
const app = new Hono();

app.post('/metrics', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    organizationId: string;
    period: 'weekly' | 'monthly' | 'quarterly';
    startDate?: string;
    endDate?: string;
  }>();

  if (!body.organizationId || !body.period) {
    return c.json({ success: false, error: 'organizationId and period are required' }, 400);
  }

  try {
    const metrics = await computeROIMetrics(
      body.organizationId,
      body.period,
      body.startDate,
      body.endDate
    );
    return c.json({ success: true, data: metrics });
  } catch (error) {
    log.error({ error }, 'Failed to compute ROI metrics');
    return c.json({ success: false, error: 'Failed to compute metrics' }, 500);
  }
});

app.post('/report', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    organizationId: string;
    period: 'weekly' | 'monthly' | 'quarterly';
    format?: 'json' | 'pdf' | 'csv' | 'slack-digest';
  }>();

  if (!body.organizationId || !body.period) {
    return c.json({ success: false, error: 'organizationId and period are required' }, 400);
  }

  try {
    const report = await generateExecutiveReport(body.organizationId, body.period, body.format);
    return c.json({ success: true, data: report });
  } catch (error) {
    log.error({ error }, 'Failed to generate report');
    return c.json({ success: false, error: 'Failed to generate report' }, 500);
  }
});

app.post('/report/async', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    organizationId: string;
    period: 'weekly' | 'monthly' | 'quarterly';
    format?: 'json' | 'pdf' | 'csv' | 'slack-digest';
    recipients?: string[];
  }>();

  if (!body.organizationId || !body.period) {
    return c.json({ success: false, error: 'organizationId and period are required' }, 400);
  }

  try {
    await addJob(QUEUE_NAMES.ROI_EXECUTIVE, {
      organizationId: body.organizationId,
      action: 'generate-report' as const,
      period: body.period,
      format: body.format,
      recipients: body.recipients,
    });
    return c.json({ success: true, data: { message: 'Report generation queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to queue report');
    return c.json({ success: false, error: 'Failed to queue report' }, 500);
  }
});

app.post('/slack-digest', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    organizationId: string;
    period: 'weekly' | 'monthly' | 'quarterly';
  }>();

  if (!body.organizationId || !body.period) {
    return c.json({ success: false, error: 'organizationId and period are required' }, 400);
  }

  try {
    const report = await generateExecutiveReport(body.organizationId, body.period, 'slack-digest');
    const digest = formatSlackDigest(report);
    return c.json({ success: true, data: { digest, report } });
  } catch (error) {
    log.error({ error }, 'Failed to generate Slack digest');
    return c.json({ success: false, error: 'Failed to generate digest' }, 500);
  }
});

app.get('/history/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  const organizationId = c.req.param('organizationId');
  const limit = parseInt(c.req.query('limit') || '10', 10);

  try {
    const history = await getReportHistory(organizationId, limit);
    return c.json({ success: true, data: history });
  } catch (error) {
    log.error({ error, organizationId }, 'Failed to get report history');
    return c.json({ success: false, error: 'Failed to get history' }, 500);
  }
});

export { app as roiExecutiveRoutes };
