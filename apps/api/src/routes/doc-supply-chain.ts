/**
 * Doc Supply Chain Routes
 *
 * API endpoints for documentation supply chain security including
 * signing, verification, attestation history, SBOM generation, and audit logs.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  signDocument,
  verifyDocument,
  getAttestationHistory,
  getAuditLog,
} from '../services/doc-supply-chain.service.js';

const log = createLogger('doc-supply-chain-routes');
const app = new Hono();

/**
 * POST /sign - Sign a document for provenance
 */
app.post('/sign', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ repositoryId: string; documentId: string }>();

    if (!body.repositoryId || !body.documentId) {
      return c.json({ success: false, error: 'repositoryId and documentId are required' }, 400);
    }

    const result = await signDocument(body.repositoryId, body.documentId);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to sign document');
    return c.json({ success: false, error: 'Failed to sign document' }, 500);
  }
});

/**
 * POST /verify - Verify a document's signature and provenance
 */
app.post('/verify', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      documentId: string;
      signature?: string;
    }>();

    if (!body.repositoryId || !body.documentId) {
      return c.json({ success: false, error: 'repositoryId and documentId are required' }, 400);
    }

    const result = await verifyDocument(body.repositoryId, body.documentId, body.signature);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to verify document');
    return c.json({ success: false, error: 'Failed to verify document' }, 500);
  }
});

/**
 * GET /attestations/:documentId - Get attestation history for a document
 */
app.get('/attestations/:documentId', requireAuth, async (c) => {
  try {
    const history = await getAttestationHistory(c.req.param('documentId'));
    return c.json({ success: true, data: history });
  } catch (error) {
    log.error({ error }, 'Failed to get attestation history');
    return c.json({ success: false, error: 'Failed to get attestation history' }, 500);
  }
});

/**
 * POST /sbom - Generate a Software Bill of Materials for documentation
 */
app.post('/sbom', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ repositoryId: string }>();

    if (!body.repositoryId) {
      return c.json({ success: false, error: 'repositoryId is required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.DOC_SUPPLY_CHAIN, {
      repositoryId: body.repositoryId,
      action: 'sbom' as const,
    });

    return c.json({ success: true, data: { jobId: job.id, message: 'SBOM generation queued' } });
  } catch (error) {
    log.error({ error }, 'Failed to generate SBOM');
    return c.json({ success: false, error: 'Failed to generate SBOM' }, 500);
  }
});

/**
 * GET /audit/:repositoryId - Get audit log for a repository
 */
app.get('/audit/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  try {
    const auditLog = await getAuditLog(c.req.param('repositoryId'));
    return c.json({ success: true, data: auditLog });
  } catch (error) {
    log.error({ error }, 'Failed to get audit log');
    return c.json({ success: false, error: 'Failed to get audit log' }, 500);
  }
});

export { app as docSupplyChainRoutes };
