/**
 * Smart Documentation Diff & Staging Service
 *
 * Computes section-level diffs for generated docs, supports per-section
 * accept/reject, inline editing, and staged PR creation.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-diff-staging-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface DocDiff {
  id: string;
  repositoryId: string;
  documentPath: string;
  sections: SectionDiff[];
  summary: DiffSummary;
  createdAt: Date;
}

export interface SectionDiff {
  sectionId: string;
  title: string;
  changeType: 'addition' | 'modification' | 'deletion' | 'reorganization' | 'unchanged';
  originalContent: string;
  proposedContent: string;
  confidence: number;
  lineStart: number;
  lineEnd: number;
  staged: boolean;
  action: 'pending' | 'accepted' | 'rejected' | 'edited';
  editedContent?: string;
}

export interface DiffSummary {
  totalSections: number;
  additions: number;
  modifications: number;
  deletions: number;
  unchanged: number;
  overallConfidence: number;
}

export interface StagingSession {
  id: string;
  repositoryId: string;
  diffId: string;
  decisions: Record<string, 'accepted' | 'rejected' | 'edited'>;
  editedContent: Record<string, string>;
  status: 'in-progress' | 'ready' | 'applied';
  createdAt: Date;
}

export interface PreviewResult {
  documentPath: string;
  finalContent: string;
  appliedSections: number;
  rejectedSections: number;
  editedSections: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Compute section-level diff between current and proposed doc
 */
export async function computeDiff(
  repositoryId: string,
  documentPath: string,
  proposedContent: string
): Promise<DocDiff> {
  const existing = await prisma.document.findFirst({
    where: { repositoryId, path: documentPath },
    select: { content: true },
  });

  const originalContent = existing?.content ?? '';
  const originalSections = parseSections(originalContent);
  const proposedSections = parseSections(proposedContent);

  const sections: SectionDiff[] = [];
  let sectionNum = 0;

  // Match sections by title
  const originalMap = new Map(originalSections.map((s) => [s.title, s]));
  const proposedMap = new Map(proposedSections.map((s) => [s.title, s]));

  // Additions and modifications
  for (const proposed of proposedSections) {
    const original = originalMap.get(proposed.title);
    sectionNum++;

    if (!original) {
      sections.push({
        sectionId: `sec-${sectionNum}`,
        title: proposed.title,
        changeType: 'addition',
        originalContent: '',
        proposedContent: proposed.content,
        confidence: 0.85,
        lineStart: proposed.lineStart,
        lineEnd: proposed.lineEnd,
        staged: false,
        action: 'pending',
      });
    } else if (original.content.trim() !== proposed.content.trim()) {
      sections.push({
        sectionId: `sec-${sectionNum}`,
        title: proposed.title,
        changeType: 'modification',
        originalContent: original.content,
        proposedContent: proposed.content,
        confidence: 0.8,
        lineStart: proposed.lineStart,
        lineEnd: proposed.lineEnd,
        staged: false,
        action: 'pending',
      });
    } else {
      sections.push({
        sectionId: `sec-${sectionNum}`,
        title: proposed.title,
        changeType: 'unchanged',
        originalContent: original.content,
        proposedContent: proposed.content,
        confidence: 1.0,
        lineStart: proposed.lineStart,
        lineEnd: proposed.lineEnd,
        staged: true,
        action: 'accepted',
      });
    }
  }

  // Deletions
  for (const original of originalSections) {
    if (!proposedMap.has(original.title)) {
      sectionNum++;
      sections.push({
        sectionId: `sec-${sectionNum}`,
        title: original.title,
        changeType: 'deletion',
        originalContent: original.content,
        proposedContent: '',
        confidence: 0.7,
        lineStart: original.lineStart,
        lineEnd: original.lineEnd,
        staged: false,
        action: 'pending',
      });
    }
  }

  const summary = computeSummary(sections);

  const diff: DocDiff = {
    id: `diff-${repositoryId}-${Date.now()}`,
    repositoryId,
    documentPath,
    sections,
    summary,
    createdAt: new Date(),
  };

  await db.docDiffSession.create({
    data: {
      id: diff.id,
      repositoryId,
      documentPath,
      sections: JSON.parse(JSON.stringify(sections)),
      summary: JSON.parse(JSON.stringify(summary)),
      createdAt: new Date(),
    },
  });

  log.info({ repositoryId, documentPath, ...summary }, 'Diff computed');
  return diff;
}

/**
 * Apply staging decisions to a diff
 */
export async function applyStagingDecisions(
  diffId: string,
  decisions: Array<{
    sectionId: string;
    action: 'accept' | 'reject' | 'edit';
    editedContent?: string;
  }>
): Promise<StagingSession> {
  const stored = await db.docDiffSession.findUnique({ where: { id: diffId } });
  if (!stored) throw new Error(`Diff not found: ${diffId}`);

  const decisionMap: Record<string, 'accepted' | 'rejected' | 'edited'> = {};
  const editedContent: Record<string, string> = {};

  for (const d of decisions) {
    decisionMap[d.sectionId] =
      d.action === 'edit' ? 'edited' : d.action === 'accept' ? 'accepted' : 'rejected';
    if (d.editedContent) editedContent[d.sectionId] = d.editedContent;
  }

  const session: StagingSession = {
    id: `stage-${diffId}-${Date.now()}`,
    repositoryId: stored.repositoryId,
    diffId,
    decisions: decisionMap,
    editedContent,
    status: 'ready',
    createdAt: new Date(),
  };

  await db.docStagingSession.create({
    data: {
      id: session.id,
      diffId,
      repositoryId: stored.repositoryId,
      decisions: JSON.parse(JSON.stringify(decisionMap)),
      editedContent: JSON.parse(JSON.stringify(editedContent)),
      status: 'ready',
      createdAt: new Date(),
    },
  });

  log.info(
    {
      diffId,
      sessionId: session.id,
      accepted: Object.values(decisionMap).filter((v) => v === 'accepted').length,
    },
    'Staging decisions applied'
  );
  return session;
}

/**
 * Preview final document after staging
 */
export async function previewStagedDocument(sessionId: string): Promise<PreviewResult> {
  const session = await db.docStagingSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const diff = await db.docDiffSession.findUnique({ where: { id: session.diffId } });
  if (!diff) throw new Error(`Diff not found: ${session.diffId}`);

  const sections = diff.sections as unknown as SectionDiff[];
  const decisions = session.decisions as Record<string, string>;
  const edits = session.editedContent as Record<string, string>;

  const finalParts: string[] = [];
  let applied = 0;
  let rejected = 0;
  let edited = 0;

  for (const section of sections) {
    const decision = decisions[section.sectionId] ?? 'accepted';

    if (decision === 'rejected') {
      if (section.changeType !== 'addition') finalParts.push(section.originalContent);
      rejected++;
    } else if (decision === 'edited') {
      finalParts.push(edits[section.sectionId] ?? section.proposedContent);
      edited++;
    } else {
      finalParts.push(section.changeType === 'deletion' ? '' : section.proposedContent);
      applied++;
    }
  }

  return {
    documentPath: diff.documentPath,
    finalContent: finalParts.filter(Boolean).join('\n\n'),
    appliedSections: applied,
    rejectedSections: rejected,
    editedSections: edited,
  };
}

/**
 * Get diff by ID
 */
export async function getDiff(diffId: string): Promise<DocDiff | null> {
  const stored = await db.docDiffSession.findUnique({ where: { id: diffId } });
  if (!stored) return null;
  return {
    id: stored.id,
    repositoryId: stored.repositoryId,
    documentPath: stored.documentPath,
    sections: stored.sections as unknown as SectionDiff[],
    summary: stored.summary as unknown as DiffSummary,
    createdAt: stored.createdAt,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

interface ParsedSection {
  title: string;
  content: string;
  lineStart: number;
  lineEnd: number;
}

function parseSections(markdown: string): ParsedSection[] {
  const lines = markdown.split('\n');
  const sections: ParsedSection[] = [];
  let currentTitle = '';
  let currentContent: string[] = [];
  let sectionStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.match(/^#{1,3}\s+/)) {
      if (currentTitle) {
        sections.push({
          title: currentTitle,
          content: currentContent.join('\n'),
          lineStart: sectionStart,
          lineEnd: i - 1,
        });
      }
      currentTitle = line.replace(/^#{1,3}\s+/, '').trim();
      currentContent = [line];
      sectionStart = i;
    } else {
      currentContent.push(line);
    }
  }

  if (currentTitle) {
    sections.push({
      title: currentTitle,
      content: currentContent.join('\n'),
      lineStart: sectionStart,
      lineEnd: lines.length - 1,
    });
  }

  return sections;
}

function computeSummary(sections: SectionDiff[]): DiffSummary {
  return {
    totalSections: sections.length,
    additions: sections.filter((s) => s.changeType === 'addition').length,
    modifications: sections.filter((s) => s.changeType === 'modification').length,
    deletions: sections.filter((s) => s.changeType === 'deletion').length,
    unchanged: sections.filter((s) => s.changeType === 'unchanged').length,
    overallConfidence:
      sections.length > 0
        ? Math.round((sections.reduce((sum, s) => sum + s.confidence, 0) / sections.length) * 100) /
          100
        : 0,
  };
}
