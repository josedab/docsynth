/**
 * Cross-Organization Documentation Federation Service
 *
 * Enables multi-org documentation sharing with trust management,
 * live cross-references, federated search, and synchronized indexes.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-federation-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface FederationTrust {
  id: string;
  sourceOrgId: string;
  targetOrgId: string;
  accessLevel: 'public' | 'federated' | 'private';
  status: 'active' | 'pending' | 'revoked';
  createdAt: Date;
}

export interface FederatedReference {
  reference: string;
  resolvedPath: string;
  resolvedContent?: string;
  sourceOrg: string;
  targetOrg: string;
  valid: boolean;
  lastResolved: Date;
}

export interface TrustedOrg {
  orgId: string;
  orgName: string;
  accessLevel: 'public' | 'federated' | 'private';
  docCount: number;
  lastSynced: Date;
}

export interface FederatedIndex {
  organizationId: string;
  trustedOrgs: TrustedOrg[];
  sharedDocCount: number;
  lastSynced: Date;
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Establish a federation trust between two organizations.
 */
export async function establishTrust(
  sourceOrgId: string,
  targetOrgId: string,
  accessLevel: FederationTrust['accessLevel']
): Promise<FederationTrust> {
  log.info({ sourceOrgId, targetOrgId, accessLevel }, 'Establishing federation trust');
  const [sourceOrg, targetOrg] = await Promise.all([
    db.organization.findUnique({ where: { id: sourceOrgId } }),
    db.organization.findUnique({ where: { id: targetOrgId } }),
  ]);
  if (!sourceOrg) throw new Error(`Source organization ${sourceOrgId} not found`);
  if (!targetOrg) throw new Error(`Target organization ${targetOrgId} not found`);

  const existing = await db.federationTrust.findFirst({
    where: { sourceOrgId, targetOrgId, status: { not: 'revoked' } },
  });
  if (existing) {
    const updated = await db.federationTrust.update({
      where: { id: existing.id },
      data: { accessLevel, status: 'active', updatedAt: new Date() },
    });
    return {
      id: updated.id,
      sourceOrgId,
      targetOrgId,
      accessLevel,
      status: 'active',
      createdAt: updated.createdAt,
    };
  }

  const trust = await db.federationTrust.create({
    data: {
      sourceOrgId,
      targetOrgId,
      accessLevel,
      status: accessLevel === 'public' ? 'active' : 'pending',
      createdAt: new Date(),
    },
  });
  log.info({ trustId: trust.id, status: trust.status }, 'Federation trust established');
  return {
    id: trust.id,
    sourceOrgId,
    targetOrgId,
    accessLevel,
    status: trust.status,
    createdAt: trust.createdAt,
  };
}

/**
 * Revoke an existing federation trust.
 */
export async function revokeTrust(trustId: string): Promise<void> {
  log.info({ trustId }, 'Revoking federation trust');
  const trust = await db.federationTrust.findUnique({ where: { id: trustId } });
  if (!trust) throw new Error(`Federation trust ${trustId} not found`);

  await db.federationTrust.update({
    where: { id: trustId },
    data: { status: 'revoked', revokedAt: new Date() },
  });
  try {
    await db.federatedReferenceCache.deleteMany({
      where: {
        OR: [
          { sourceOrgId: trust.sourceOrgId, targetOrgId: trust.targetOrgId },
          { sourceOrgId: trust.targetOrgId, targetOrgId: trust.sourceOrgId },
        ],
      },
    });
  } catch (error) {
    log.warn({ error }, 'Failed to clean up federated reference cache');
  }
  log.info({ trustId }, 'Federation trust revoked');
}

/**
 * Resolve a federated cross-reference (e.g. @org/repo/path#section).
 */
export async function resolveReference(
  organizationId: string,
  reference: string
): Promise<FederatedReference> {
  log.info({ organizationId, reference }, 'Resolving federated reference');
  const parsed = parseReference(reference);
  const baseFail = {
    reference,
    resolvedPath: '',
    sourceOrg: organizationId,
    targetOrg: '',
    valid: false,
    lastResolved: new Date(),
  };
  if (!parsed) return baseFail;

  const hasAccess = await validateOrgAccess(organizationId, parsed.orgId);
  if (!hasAccess) {
    log.warn({ organizationId, targetOrg: parsed.orgId }, 'No federation trust');
    return { ...baseFail, resolvedPath: parsed.path, targetOrg: parsed.orgId };
  }

  try {
    const targetRepo = await db.repository.findFirst({
      where: { organizationId: parsed.orgId, name: parsed.repo },
    });
    if (!targetRepo) return { ...baseFail, resolvedPath: parsed.path, targetOrg: parsed.orgId };

    const targetDoc = await db.document.findFirst({
      where: { repositoryId: targetRepo.id, filePath: parsed.path },
      select: { filePath: true, content: true },
    });
    let resolvedContent: string | undefined;
    if (targetDoc?.content && parsed.section)
      resolvedContent = extractSection(targetDoc.content, parsed.section);
    else if (targetDoc?.content) resolvedContent = targetDoc.content.slice(0, 500);

    try {
      await db.federatedReferenceCache.upsert({
        where: { sourceOrgId_reference: { sourceOrgId: organizationId, reference } },
        create: {
          sourceOrgId: organizationId,
          targetOrgId: parsed.orgId,
          reference,
          resolvedPath: parsed.path,
          valid: !!targetDoc,
          resolvedAt: new Date(),
        },
        update: { valid: !!targetDoc, resolvedAt: new Date() },
      });
    } catch {
      /* cache miss is non-critical */
    }

    return {
      reference,
      resolvedPath: targetDoc?.filePath ?? parsed.path,
      resolvedContent,
      sourceOrg: organizationId,
      targetOrg: parsed.orgId,
      valid: !!targetDoc,
      lastResolved: new Date(),
    };
  } catch (error) {
    log.error({ error, reference }, 'Failed to resolve federated reference');
    return { ...baseFail, resolvedPath: parsed.path, targetOrg: parsed.orgId };
  }
}

/**
 * Sync the federated documentation index across all trusted organizations.
 */
export async function syncFederatedIndex(organizationId: string): Promise<FederatedIndex> {
  log.info({ organizationId }, 'Syncing federated index');
  const trusts = await db.federationTrust.findMany({
    where: {
      OR: [
        { sourceOrgId: organizationId, status: 'active' },
        { targetOrgId: organizationId, status: 'active' },
      ],
    },
  });
  const trustedOrgs: TrustedOrg[] = [];
  let totalShared = 0;

  for (const trust of trusts) {
    const peerId = trust.sourceOrgId === organizationId ? trust.targetOrgId : trust.sourceOrgId;
    try {
      const org = await db.organization.findUnique({
        where: { id: peerId },
        select: { id: true, name: true },
      });
      if (!org) continue;
      const docCount = await db.document.count({
        where: buildDocAccessFilter(trust.accessLevel, peerId),
      });
      trustedOrgs.push({
        orgId: org.id,
        orgName: org.name,
        accessLevel: trust.accessLevel,
        docCount,
        lastSynced: new Date(),
      });
      totalShared += docCount;
    } catch (error) {
      log.warn({ error, peerId }, 'Failed to sync peer org');
    }
  }

  try {
    await db.federatedIndex.upsert({
      where: { organizationId },
      create: {
        organizationId,
        trustedOrgCount: trustedOrgs.length,
        sharedDocCount: totalShared,
        syncedAt: new Date(),
      },
      update: {
        trustedOrgCount: trustedOrgs.length,
        sharedDocCount: totalShared,
        syncedAt: new Date(),
      },
    });
  } catch (error) {
    log.warn({ error }, 'Failed to persist federated index');
  }

  log.info(
    { organizationId, trustedCount: trustedOrgs.length, sharedDocs: totalShared },
    'Federated index synced'
  );
  return { organizationId, trustedOrgs, sharedDocCount: totalShared, lastSynced: new Date() };
}

/**
 * List all organizations trusted by the given organization.
 */
export async function listTrustedOrgs(organizationId: string): Promise<TrustedOrg[]> {
  log.info({ organizationId }, 'Listing trusted organizations');
  const trusts = await db.federationTrust.findMany({
    where: {
      OR: [
        { sourceOrgId: organizationId, status: 'active' },
        { targetOrgId: organizationId, status: 'active' },
      ],
    },
  });
  const result: TrustedOrg[] = [];

  for (const trust of trusts) {
    const peerId = trust.sourceOrgId === organizationId ? trust.targetOrgId : trust.sourceOrgId;
    try {
      const org = await db.organization.findUnique({
        where: { id: peerId },
        select: { id: true, name: true },
      });
      if (!org) continue;
      const docCount = await db.document.count({
        where: buildDocAccessFilter(trust.accessLevel, peerId),
      });
      result.push({
        orgId: org.id,
        orgName: org.name,
        accessLevel: trust.accessLevel,
        docCount,
        lastSynced: trust.updatedAt ?? trust.createdAt,
      });
    } catch (error) {
      log.warn({ error, peerId }, 'Failed to fetch trusted org');
    }
  }
  return result;
}

/**
 * Search across all federated organizations' documentation.
 */
export async function searchFederated(
  organizationId: string,
  query: string
): Promise<
  Array<{ orgName: string; path: string; title: string; excerpt: string; score: number }>
> {
  log.info({ organizationId, query }, 'Searching federated docs');
  const orgs = await listTrustedOrgs(organizationId);
  const results: Array<{
    orgName: string;
    path: string;
    title: string;
    excerpt: string;
    score: number;
  }> = [];
  const terms = buildFederatedSearchIndex(query);

  for (const org of orgs) {
    try {
      const docs = await db.document.findMany({
        where: {
          ...buildDocAccessFilter(org.accessLevel, org.orgId),
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { content: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { filePath: true, title: true, content: true },
        take: 10,
      });
      for (const doc of docs) {
        const content = doc.content ?? '';
        const title = doc.title ?? doc.filePath.split('/').pop() ?? '';
        const score = computeScore(content, title, terms);
        results.push({
          orgName: org.orgName,
          path: doc.filePath,
          title,
          excerpt: extractExcerpt(content, query),
          score,
        });
      }
    } catch (error) {
      log.warn({ error, orgId: org.orgId }, 'Failed to search org docs');
    }
  }

  results.sort((a, b) => b.score - a.score);
  log.info({ organizationId, resultCount: results.length }, 'Federated search complete');
  return results;
}

// ============================================================================
// Helpers
// ============================================================================

function parseReference(
  ref: string
): { orgId: string; repo: string; path: string; section?: string } | null {
  const m = ref.match(/^@([^/]+)\/([^/]+)\/(.+?)(?:#(.+))?$/);
  if (m) return { orgId: m[1]!, repo: m[2]!, path: m[3]!, section: m[4] };
  const s = ref.match(/^@([^/]+)\/(.+?)(?:#(.+))?$/);
  if (s) return { orgId: s[1]!, repo: '', path: s[2]!, section: s[3] };
  return null;
}

async function validateOrgAccess(sourceOrgId: string, targetOrgId: string): Promise<boolean> {
  if (sourceOrgId === targetOrgId) return true;
  const trust = await db.federationTrust.findFirst({
    where: {
      OR: [
        { sourceOrgId, targetOrgId, status: 'active' },
        { sourceOrgId: targetOrgId, targetOrgId: sourceOrgId, status: 'active' },
      ],
    },
  });
  return !!trust;
}

function buildDocAccessFilter(accessLevel: string, orgId: string): Record<string, unknown> {
  const base = { repository: { organizationId: orgId } };
  if (accessLevel === 'public') return { ...base, visibility: 'public' };
  if (accessLevel === 'federated') return { ...base, visibility: { in: ['public', 'internal'] } };
  return base;
}

function buildFederatedSearchIndex(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function computeScore(content: string, title: string, terms: string[]): number {
  let score = 0;
  const lc = content.toLowerCase();
  const lt = title.toLowerCase();
  for (const t of terms) {
    if (lt.includes(t)) score += 10;
    const matches = (lc.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? [])
      .length;
    score += Math.min(matches, 5);
  }
  return Math.round(score * 100) / 100;
}

function extractExcerpt(content: string, query: string): string {
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return content.slice(0, 150).trim() + '...';
  const start = Math.max(0, idx - 60);
  const end = Math.min(content.length, idx + query.length + 60);
  return (
    (start > 0 ? '...' : '') +
    content.slice(start, end).trim() +
    (end < content.length ? '...' : '')
  );
}

function extractSection(content: string, sectionName: string): string | undefined {
  const lines = content.split('\n');
  let inSection = false;
  let level = 0;
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      if (inSection && m[1]!.length <= level) break;
      if (m[2]!.trim().toLowerCase() === sectionName.toLowerCase()) {
        inSection = true;
        level = m[1]!.length;
        out.push(line);
        continue;
      }
    }
    if (inSection) out.push(line);
  }
  return out.length > 0 ? out.join('\n') : undefined;
}
