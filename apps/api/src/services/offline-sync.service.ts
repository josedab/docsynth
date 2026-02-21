/**
 * Offline-First Documentation Sync Service
 *
 * Prepares documentation bundles for offline access, synchronizes
 * changes between local devices and the server, and handles conflict
 * resolution when documents are edited in parallel.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('offline-sync-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface SyncBundle {
  id: string;
  userId: string;
  repositoryIds: string[];
  documents: BundledDoc[];
  createdAt: Date;
  expiresAt: Date;
  sizeBytes: number;
}

export interface BundledDoc {
  documentId: string;
  path: string;
  content: string;
  version: number;
  hash: string;
  lastModified: Date;
}

export interface SyncResult {
  userId: string;
  uploaded: number;
  downloaded: number;
  conflicts: SyncConflict[];
}

export type ConflictResolution = 'keep-local' | 'keep-server' | 'merge';

export interface SyncConflict {
  documentId: string;
  path: string;
  localVersion: number;
  serverVersion: number;
  resolution?: ConflictResolution;
}

export interface DeviceRegistration {
  deviceId: string;
  userId: string;
  platform: string;
  lastSyncAt: Date;
}

interface LocalChange {
  documentId: string;
  path: string;
  content: string;
  version: number;
  hash: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Prepare a sync bundle containing all documents for the given repositories.
 */
export async function prepareSyncBundle(
  userId: string,
  repositoryIds: string[]
): Promise<SyncBundle> {
  log.info({ userId, repositoryCount: repositoryIds.length }, 'Preparing sync bundle');

  const documents = await prisma.document.findMany({
    where: { repositoryId: { in: repositoryIds } },
    select: {
      id: true,
      path: true,
      content: true,
      updatedAt: true,
    },
  });

  const bundledDocs: BundledDoc[] = documents.map((doc) => {
    const content = doc.content ?? '';
    const version = getVersionFromTimestamp(doc.updatedAt);

    return {
      documentId: doc.id,
      path: doc.path,
      content,
      version,
      hash: computeDocHash(content),
      lastModified: doc.updatedAt,
    };
  });

  const totalSize = bundledDocs.reduce((sum, d) => sum + Buffer.byteLength(d.content, 'utf8'), 0);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const bundle = await db.syncBundle.create({
    data: {
      userId,
      repositoryIds,
      documentCount: bundledDocs.length,
      sizeBytes: totalSize,
      createdAt: new Date(),
      expiresAt,
    },
  });

  log.info(
    { bundleId: bundle.id, docCount: bundledDocs.length, sizeBytes: totalSize },
    'Sync bundle prepared'
  );

  return {
    id: bundle.id,
    userId,
    repositoryIds,
    documents: bundledDocs,
    createdAt: bundle.createdAt,
    expiresAt,
    sizeBytes: totalSize,
  };
}

/**
 * Synchronize local changes from a device with the server.
 */
export async function syncChanges(
  userId: string,
  deviceId: string,
  localChanges: LocalChange[]
): Promise<SyncResult> {
  log.info({ userId, deviceId, changeCount: localChanges.length }, 'Syncing changes');

  const conflicts: SyncConflict[] = [];
  let uploaded = 0;
  let downloaded = 0;

  for (const change of localChanges) {
    const serverDoc = await prisma.document.findUnique({
      where: { id: change.documentId },
      select: { id: true, path: true, content: true, updatedAt: true },
    });

    if (!serverDoc) {
      log.warn({ documentId: change.documentId }, 'Document not found on server, skipping');
      continue;
    }

    const serverVersion = getVersionFromTimestamp(serverDoc.updatedAt);
    const serverHash = computeDocHash(serverDoc.content ?? '');

    // Detect conflicts
    const conflict = detectConflicts(change, serverVersion, serverHash);

    if (conflict) {
      conflicts.push({
        documentId: change.documentId,
        path: change.path,
        localVersion: change.version,
        serverVersion,
      });
      continue;
    }

    // No conflict – apply the local change
    await prisma.document.update({
      where: { id: change.documentId },
      data: {
        content: change.content,
        updatedAt: new Date(),
      },
    });

    uploaded++;
  }

  // Get documents updated on server since last device sync
  const device = await db.syncDevice.findUnique({
    where: { deviceId_userId: { deviceId, userId } },
  });

  const lastSyncAt = device?.lastSyncAt ?? new Date(0);
  const serverUpdated = await prisma.document.findMany({
    where: { updatedAt: { gt: lastSyncAt } },
    select: { id: true },
  });

  downloaded = serverUpdated.length;

  // Update device sync timestamp
  await db.syncDevice.upsert({
    where: { deviceId_userId: { deviceId, userId } },
    create: { deviceId, userId, platform: 'unknown', lastSyncAt: new Date() },
    update: { lastSyncAt: new Date() },
  });

  log.info({ userId, uploaded, downloaded, conflicts: conflicts.length }, 'Sync complete');

  return { userId, uploaded, downloaded, conflicts };
}

/**
 * Resolve sync conflicts with explicit resolutions.
 */
export async function resolveConflicts(
  userId: string,
  resolutions: Array<{ documentId: string; resolution: ConflictResolution; localContent?: string }>
): Promise<number> {
  let resolved = 0;

  for (const res of resolutions) {
    const serverDoc = await prisma.document.findUnique({
      where: { id: res.documentId },
      select: { id: true, content: true },
    });

    if (!serverDoc) continue;

    switch (res.resolution) {
      case 'keep-local':
        if (res.localContent) {
          await prisma.document.update({
            where: { id: res.documentId },
            data: { content: res.localContent, updatedAt: new Date() },
          });
        }
        resolved++;
        break;

      case 'keep-server':
        // No changes needed – server version stays
        resolved++;
        break;

      case 'merge': {
        const merged = mergeContent(res.localContent ?? '', serverDoc.content ?? '');
        await prisma.document.update({
          where: { id: res.documentId },
          data: { content: merged, updatedAt: new Date() },
        });
        resolved++;
        break;
      }
    }
  }

  log.info({ userId, resolved }, 'Conflicts resolved');
  return resolved;
}

/**
 * Register a device for offline sync.
 */
export async function registerDevice(
  userId: string,
  deviceId: string,
  platform: string
): Promise<DeviceRegistration> {
  const device = await db.syncDevice.upsert({
    where: { deviceId_userId: { deviceId, userId } },
    create: {
      deviceId,
      userId,
      platform,
      lastSyncAt: new Date(),
    },
    update: {
      platform,
      lastSyncAt: new Date(),
    },
  });

  log.info({ userId, deviceId, platform }, 'Device registered');

  return {
    deviceId: device.deviceId,
    userId: device.userId,
    platform: device.platform,
    lastSyncAt: device.lastSyncAt,
  };
}

/**
 * Get all registered devices for a user.
 */
export async function getDevices(userId: string): Promise<DeviceRegistration[]> {
  const devices = await db.syncDevice.findMany({
    where: { userId },
    orderBy: { lastSyncAt: 'desc' },
  });

  return devices.map((d: any) => ({
    deviceId: d.deviceId,
    userId: d.userId,
    platform: d.platform,
    lastSyncAt: d.lastSyncAt,
  }));
}

/**
 * Evict stale sync content for a user (expired bundles and inactive devices).
 */
export async function evictStaleContent(
  userId: string
): Promise<{ bundles: number; devices: number }> {
  const now = new Date();
  const staleThreshold = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days

  const bundleResult = await db.syncBundle.deleteMany({
    where: { userId, expiresAt: { lt: now } },
  });

  const deviceResult = await db.syncDevice.deleteMany({
    where: { userId, lastSyncAt: { lt: staleThreshold } },
  });

  log.info(
    { userId, staleBundles: bundleResult.count, staleDevices: deviceResult.count },
    'Stale content evicted'
  );

  return { bundles: bundleResult.count, devices: deviceResult.count };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute a deterministic hash for document content.
 */
function computeDocHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36).padStart(10, '0');
}

/**
 * Detect if a local change conflicts with the server version.
 */
function detectConflicts(
  localChange: LocalChange,
  serverVersion: number,
  serverHash: string
): boolean {
  // If the local version is behind the server, there's a conflict
  if (localChange.version < serverVersion) {
    return true;
  }

  // If versions match but hashes differ, the server was updated independently
  if (localChange.version === serverVersion && localChange.hash !== serverHash) {
    return true;
  }

  return false;
}

function mergeContent(localContent: string, serverContent: string): string {
  const localLines = localContent.split('\n');
  const serverLines = serverContent.split('\n');
  const merged: string[] = [];

  for (let i = 0; i < Math.max(localLines.length, serverLines.length); i++) {
    const local = localLines[i];
    const server = serverLines[i];
    if (local === undefined) merged.push(server);
    else if (server === undefined) merged.push(local);
    else if (local === server) merged.push(local);
    else merged.push('<<<<<<< LOCAL', local, '=======', server, '>>>>>>> SERVER');
  }

  return merged.join('\n');
}

/**
 * Derive a numeric version from a timestamp for comparison.
 */
function getVersionFromTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
