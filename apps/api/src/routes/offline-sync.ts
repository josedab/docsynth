/**
 * Offline Sync Routes
 *
 * API endpoints for offline documentation access including sync bundle
 * preparation, change synchronization, conflict resolution, and device management.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import {
  syncChanges,
  resolveConflicts,
  registerDevice,
  getDevices,
} from '../services/offline-sync.service.js';

const log = createLogger('offline-sync-routes');
const app = new Hono();

/**
 * POST /bundle - Prepare a sync bundle for offline use
 */
app.post('/bundle', requireAuth, requireOrgAccess, async (c) => {
  try {
    const body = await c.req.json<{ repositoryId: string; scope?: string[] }>();

    if (!body.repositoryId) {
      return c.json({ success: false, error: 'repositoryId is required' }, 400);
    }

    const job = await addJob(QUEUE_NAMES.OFFLINE_SYNC, {
      repositoryId: body.repositoryId,
      action: 'bundle' as const,
      scope: body.scope,
    });

    return c.json({
      success: true,
      data: { jobId: job.id, message: 'Sync bundle preparation queued' },
    });
  } catch (error) {
    log.error({ error }, 'Failed to prepare sync bundle');
    return c.json({ success: false, error: 'Failed to prepare sync bundle' }, 500);
  }
});

/**
 * POST /sync - Sync offline changes back to the server
 */
app.post('/sync', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      deviceId: string;
      changes: unknown[];
    }>();

    if (!body.repositoryId || !body.deviceId || !body.changes) {
      return c.json(
        { success: false, error: 'repositoryId, deviceId, and changes are required' },
        400
      );
    }

    const result = await syncChanges(body.repositoryId, body.deviceId, body.changes);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to sync changes');
    return c.json({ success: false, error: 'Failed to sync changes' }, 500);
  }
});

/**
 * POST /resolve - Resolve sync conflicts
 */
app.post('/resolve', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{
      repositoryId: string;
      conflictIds: string[];
      resolutions: Record<string, string>;
    }>();

    if (!body.repositoryId || !body.conflictIds || !body.resolutions) {
      return c.json(
        { success: false, error: 'repositoryId, conflictIds, and resolutions are required' },
        400
      );
    }

    const result = await resolveConflicts(body.repositoryId, body.conflictIds, body.resolutions);
    return c.json({ success: true, data: result });
  } catch (error) {
    log.error({ error }, 'Failed to resolve conflicts');
    return c.json({ success: false, error: 'Failed to resolve conflicts' }, 500);
  }
});

/**
 * POST /device - Register a device for offline sync
 */
app.post('/device', requireAuth, async (c) => {
  try {
    const body = await c.req.json<{ userId: string; deviceName: string; platform: string }>();

    if (!body.userId || !body.deviceName) {
      return c.json({ success: false, error: 'userId and deviceName are required' }, 400);
    }

    const device = await registerDevice(body.userId, body.deviceName, body.platform);
    return c.json({ success: true, data: device });
  } catch (error) {
    log.error({ error }, 'Failed to register device');
    return c.json({ success: false, error: 'Failed to register device' }, 500);
  }
});

/**
 * GET /devices/:userId - List registered devices for a user
 */
app.get('/devices/:userId', requireAuth, async (c) => {
  try {
    const devices = await getDevices(c.req.param('userId'));
    return c.json({ success: true, data: devices });
  } catch (error) {
    log.error({ error }, 'Failed to get devices');
    return c.json({ success: false, error: 'Failed to get devices' }, 500);
  }
});

export { app as offlineSyncRoutes };
