/**
 * Doc Federation Routes
 *
 * API endpoints for cross-organization documentation federation including
 * trust management, reference resolution, index synchronization, and federated search.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  establishTrust,
  revokeTrust,
  resolveReference,
  syncFederatedIndex,
  listTrustedOrgs,
  searchFederated,
} from '../services/doc-federation.service.js';

const log = createLogger('doc-federation-routes');
const app = new Hono();

/**
 * POST /trust - Establish trust with another organization
 */
app.post('/trust', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      organizationId: string;
      targetOrganizationId: string;
      scope?: string[];
    }>();

    if (!body.organizationId || !body.targetOrganizationId) {
      return c.json(
        { success: false, error: 'organizationId and targetOrganizationId are required' },
        400
      );
    }

    const trust = await establishTrust(body.organizationId, body.targetOrganizationId, body.scope);
    log.info(
      { organizationId: body.organizationId, target: body.targetOrganizationId },
      'Trust established'
    );
    return c.json({ success: true, data: trust });
  } catch (error) {
    log.error({ error }, 'Failed to establish trust');
    return c.json({ success: false, error: 'Failed to establish trust' }, 500);
  }
});

/**
 * DELETE /trust/:trustId - Revoke trust
 */
app.delete('/trust/:trustId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const trustId = c.req.param('trustId');
    await revokeTrust(trustId);
    log.info({ trustId }, 'Trust revoked');
    return c.json({ success: true, data: { revoked: true } });
  } catch (error) {
    log.error({ error }, 'Failed to revoke trust');
    return c.json({ success: false, error: 'Failed to revoke trust' }, 500);
  }
});

/**
 * POST /resolve - Resolve a federated documentation reference
 */
app.post('/resolve', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      organizationId: string;
      reference: string;
    }>();

    if (!body.organizationId || !body.reference) {
      return c.json({ success: false, error: 'organizationId and reference are required' }, 400);
    }

    const resolved = await resolveReference(body.organizationId, body.reference);
    return c.json({ success: true, data: resolved });
  } catch (error) {
    log.error({ error }, 'Failed to resolve federated reference');
    return c.json({ success: false, error: 'Failed to resolve federated reference' }, 500);
  }
});

/**
 * POST /sync - Sync the federated index
 */
app.post('/sync', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      organizationId: string;
    }>();

    if (!body.organizationId) {
      return c.json({ success: false, error: 'organizationId is required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.DOC_FEDERATION, {
      organizationId: body.organizationId,
      action: 'sync',
    });

    const result = await syncFederatedIndex(body.organizationId);

    log.info(
      { organizationId: body.organizationId, jobId: job.id },
      'Federated index sync started'
    );
    return c.json({ success: true, data: { jobId: job.id, result } });
  } catch (error) {
    log.error({ error }, 'Failed to sync federated index');
    return c.json({ success: false, error: 'Failed to sync federated index' }, 500);
  }
});

/**
 * GET /trusted/:organizationId - List trusted organizations
 */
app.get('/trusted/:organizationId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const organizationId = c.req.param('organizationId');
    const trusted = await listTrustedOrgs(organizationId);
    return c.json({ success: true, data: trusted });
  } catch (error) {
    log.error({ error }, 'Failed to list trusted organizations');
    return c.json({ success: false, error: 'Failed to list trusted organizations' }, 500);
  }
});

/**
 * POST /search - Search across federated documentation
 */
app.post('/search', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      organizationId: string;
      query: string;
      limit?: number;
    }>();

    if (!body.organizationId || !body.query) {
      return c.json({ success: false, error: 'organizationId and query are required' }, 400);
    }

    const results = await searchFederated(body.organizationId, body.query, body.limit);
    return c.json({ success: true, data: results });
  } catch (error) {
    log.error({ error }, 'Failed to search federated docs');
    return c.json({ success: false, error: 'Failed to search federated docs' }, 500);
  }
});

export { app as docFederationRoutes };
