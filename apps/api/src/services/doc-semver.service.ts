/**
 * Semantic Documentation Versioning Service
 *
 * Auto-classifies documentation changes as patch/minor/major,
 * stores versioned snapshots, and enables time-travel queries.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-semver-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface DocVersion {
  id: string;
  repositoryId: string;
  documentPath: string;
  version: string;
  changeType: 'patch' | 'minor' | 'major';
  diff: string;
  codeVersion?: string;
  createdAt: Date;
}

export interface VersionHistory {
  documentPath: string;
  versions: DocVersion[];
  currentVersion: string;
  totalVersions: number;
}

export interface ClassificationDetail {
  section: string;
  type: 'typo' | 'rewording' | 'new-section' | 'removed-section' | 'restructure' | 'api-change';
  severity: number;
}

export interface ChangeClassification {
  changeType: 'patch' | 'minor' | 'major';
  confidence: number;
  reason: string;
  details: ClassificationDetail[];
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Classify a documentation diff as patch, minor, or major change.
 */
export async function classifyChange(
  oldContent: string,
  newContent: string
): Promise<ChangeClassification> {
  log.info('Classifying documentation change');
  const stats = computeDiffStats(oldContent, newContent);
  const details: ClassificationDetail[] = [];

  const oldSections = extractSections(oldContent);
  const newSections = extractSections(newContent);
  const oldHeadings = new Set(oldSections.map((s) => s.heading));
  const newHeadings = new Set(newSections.map((s) => s.heading));

  for (const h of oldHeadings)
    if (!newHeadings.has(h)) details.push({ section: h, type: 'removed-section', severity: 8 });
  for (const h of newHeadings)
    if (!oldHeadings.has(h)) details.push({ section: h, type: 'new-section', severity: 5 });

  for (const ns of newSections) {
    const os = oldSections.find((s) => s.heading === ns.heading);
    if (os) {
      const sc = classifySectionChange(os.content, ns.content);
      if (sc) details.push({ section: ns.heading, ...sc });
    }
  }

  const hasApi = details.some((d) => d.type === 'api-change');
  const hasRemoved = details.some((d) => d.type === 'removed-section');
  const hasNew = details.some((d) => d.type === 'new-section');
  const maxSev = Math.max(0, ...details.map((d) => d.severity));

  let changeType: ChangeClassification['changeType'];
  let confidence: number;
  let reason: string;

  if (hasApi || hasRemoved || stats.changeRatio > 0.5) {
    changeType = 'major';
    confidence = Math.min(0.95, 0.7 + maxSev * 0.03);
    reason = hasApi
      ? 'API documentation changed'
      : hasRemoved
        ? 'Sections removed'
        : 'Over 50% content changed';
  } else if (hasNew || stats.changeRatio > 0.15) {
    changeType = 'minor';
    confidence = Math.min(0.95, 0.65 + maxSev * 0.03);
    reason = hasNew ? 'New sections added' : 'Significant content changes';
  } else {
    changeType = 'patch';
    confidence = Math.min(0.95, 0.8 + (1 - stats.changeRatio) * 0.15);
    reason = stats.changeRatio < 0.02 ? 'Minor typo or formatting fix' : 'Small corrections';
  }

  log.info({ changeType, confidence }, 'Classification complete');
  return { changeType, confidence, reason, details };
}

/**
 * Create a new versioned snapshot of a document.
 */
export async function bumpVersion(
  repositoryId: string,
  documentPath: string,
  content: string,
  previousContent?: string
): Promise<DocVersion> {
  log.info({ repositoryId, documentPath }, 'Bumping document version');
  const latest = await db.docVersion.findFirst({
    where: { repositoryId, documentPath },
    orderBy: { createdAt: 'desc' },
  });
  const currentVersion = latest?.version ?? '0.0.0';
  const oldContent = previousContent ?? latest?.content ?? '';

  const classification = await classifyChange(oldContent, content);
  const newVersion = incrementVersion(currentVersion, classification.changeType);
  const diff = generateDiff(oldContent, content);

  const version = await db.docVersion.create({
    data: {
      repositoryId,
      documentPath,
      version: newVersion,
      changeType: classification.changeType,
      diff,
      content,
      confidence: classification.confidence,
      reason: classification.reason,
      createdAt: new Date(),
    },
  });

  log.info({ repositoryId, documentPath, version: newVersion }, 'Version bumped');
  return {
    id: version.id,
    repositoryId,
    documentPath,
    version: newVersion,
    changeType: classification.changeType,
    diff,
    createdAt: version.createdAt,
  };
}

/**
 * Tag all current document versions with a code release version.
 */
export async function tagRelease(repositoryId: string, codeVersion: string): Promise<number> {
  log.info({ repositoryId, codeVersion }, 'Tagging release');
  const documents = await db.document.findMany({
    where: { repositoryId },
    select: { filePath: true },
  });
  let tagged = 0;

  for (const doc of documents) {
    const v = await db.docVersion.findFirst({
      where: { repositoryId, documentPath: doc.filePath },
      orderBy: { createdAt: 'desc' },
    });
    if (v) {
      await db.docVersion.update({ where: { id: v.id }, data: { codeVersion } });
      tagged++;
    }
  }

  try {
    await db.docRelease.create({
      data: { repositoryId, codeVersion, docCount: tagged, releasedAt: new Date() },
    });
  } catch (error) {
    log.warn({ error }, 'Failed to create release record');
  }

  log.info({ repositoryId, codeVersion, tagged }, 'Release tagged');
  return tagged;
}

/**
 * Get the version history for a specific document.
 */
export async function getVersionHistory(
  repositoryId: string,
  documentPath: string,
  limit?: number
): Promise<VersionHistory> {
  log.info({ repositoryId, documentPath }, 'Getting version history');
  const versions = await db.docVersion.findMany({
    where: { repositoryId, documentPath },
    orderBy: { createdAt: 'desc' },
    take: limit ?? 50,
  });
  const totalCount = await db.docVersion.count({ where: { repositoryId, documentPath } });

  const mapped: DocVersion[] = versions.map(
    (v: {
      id: string;
      version: string;
      changeType: string;
      diff: string;
      codeVersion?: string;
      createdAt: Date;
    }) => ({
      id: v.id,
      repositoryId,
      documentPath,
      version: v.version,
      changeType: v.changeType as DocVersion['changeType'],
      diff: v.diff,
      codeVersion: v.codeVersion,
      createdAt: v.createdAt,
    })
  );

  return {
    documentPath,
    versions: mapped,
    currentVersion: mapped[0]?.version ?? '0.0.0',
    totalVersions: totalCount,
  };
}

/**
 * Retrieve a document's content at a specific version (time-travel).
 */
export async function getDocAtVersion(
  repositoryId: string,
  documentPath: string,
  version: string
): Promise<{ content: string; version: string } | null> {
  log.info({ repositoryId, documentPath, version }, 'Getting doc at version');
  const v = await db.docVersion.findFirst({
    where: { repositoryId, documentPath, version },
    select: { content: true, version: true },
  });
  if (!v) {
    log.warn({ documentPath, version }, 'Version not found');
    return null;
  }
  return { content: v.content ?? '', version: v.version };
}

/**
 * Generate a diff between two specific versions of a document.
 */
export async function diffVersions(
  repositoryId: string,
  documentPath: string,
  fromVersion: string,
  toVersion: string
): Promise<string> {
  log.info({ repositoryId, documentPath, fromVersion, toVersion }, 'Diffing versions');
  const [from, to] = await Promise.all([
    db.docVersion.findFirst({
      where: { repositoryId, documentPath, version: fromVersion },
      select: { content: true },
    }),
    db.docVersion.findFirst({
      where: { repositoryId, documentPath, version: toVersion },
      select: { content: true },
    }),
  ]);
  if (!from || !to) return `Error: version ${!from ? fromVersion : toVersion} not found`;
  return generateDiff(from.content ?? '', to.content ?? '');
}

// ============================================================================
// Helpers
// ============================================================================

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const p = version.split('.').map(Number);
  return { major: p[0] ?? 0, minor: p[1] ?? 0, patch: p[2] ?? 0 };
}

function incrementVersion(current: string, changeType: 'patch' | 'minor' | 'major'): string {
  const v = parseVersion(current);
  if (changeType === 'major') return `${v.major + 1}.0.0`;
  if (changeType === 'minor') return `${v.major}.${v.minor + 1}.0`;
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}

function classifySectionChange(
  old: string,
  cur: string
): { type: ClassificationDetail['type']; severity: number } | null {
  const ot = old.replace(/\s+/g, ' ').trim();
  const ct = cur.replace(/\s+/g, ' ').trim();
  if (ot === ct) return null;

  const apiPatterns = [/```[\s\S]*?```/g, /`[^`]+\([^)]*\)`/g, /\bAPI\b/, /\bEndpoint\b/i];
  if (apiPatterns.some((p) => p.test(old) || p.test(cur))) {
    const oldBlocks = (old.match(/```[\s\S]*?```/g) ?? []).join('');
    const newBlocks = (cur.match(/```[\s\S]*?```/g) ?? []).join('');
    if (oldBlocks !== newBlocks) return { type: 'api-change', severity: 9 };
  }

  const ratio = Math.abs(ot.length - ct.length) / Math.max(ot.length, ct.length, 1);
  if (ratio > 0.4) return { type: 'restructure', severity: 6 };
  if (Math.abs(ot.length - ct.length) < 10 && Math.max(ot.length, ct.length) > 50)
    return { type: 'typo', severity: 1 };
  return { type: 'rewording', severity: 3 };
}

function computeDiffStats(
  old: string,
  cur: string
): { changeRatio: number; addedLines: number; removedLines: number } {
  const oldLines = old.split('\n');
  const newLines = cur.split('\n');
  const oldSet = new Set(oldLines.map((l) => l.trim()));
  const newSet = new Set(newLines.map((l) => l.trim()));
  const added = newLines.filter((l) => !oldSet.has(l.trim()) && l.trim().length > 0).length;
  const removed = oldLines.filter((l) => !newSet.has(l.trim()) && l.trim().length > 0).length;
  return {
    changeRatio: (added + removed) / Math.max(oldLines.length, newLines.length, 1),
    addedLines: added,
    removedLines: removed,
  };
}

function extractSections(content: string): Array<{ heading: string; content: string }> {
  const sections: Array<{ heading: string; content: string }> = [];
  let heading = '(preamble)';
  let lines: string[] = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^#{1,6}\s+(.+)$/);
    if (m) {
      if (lines.length) sections.push({ heading, content: lines.join('\n') });
      heading = m[1]!.trim();
      lines = [];
    } else lines.push(line);
  }
  if (lines.length) sections.push({ heading, content: lines.join('\n') });
  return sections;
}

function generateDiff(old: string, cur: string): string {
  const oldLines = old.split('\n');
  const newLines = cur.split('\n');
  const diff: string[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    if (oldLines[i] === undefined) diff.push(`+ ${newLines[i]}`);
    else if (newLines[i] === undefined) diff.push(`- ${oldLines[i]}`);
    else if (oldLines[i] !== newLines[i]) {
      diff.push(`- ${oldLines[i]}`);
      diff.push(`+ ${newLines[i]}`);
    }
  }
  return diff.join('\n');
}
