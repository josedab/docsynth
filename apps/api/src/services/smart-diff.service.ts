/**
 * Smart Documentation Diff Viewer Service
 *
 * Provides semantic diff analysis between code changes and documentation changes,
 * enabling granular section-level review with inline commenting.
 */

import { prisma } from '@docsynth/database';
import { getAnthropicClient } from '@docsynth/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface SemanticDiffSection {
  id: string;
  changeType: 'added' | 'removed' | 'modified' | 'moved' | 'renamed';
  conceptName: string;
  oldContent?: string;
  newContent?: string;
  confidence: number;
  comments: Array<{
    id: string;
    author: string;
    content: string;
    createdAt: string;
    parentId?: string;
  }>;
  approved: boolean | null;
}

export interface SmartDiffResult {
  repositoryId: string;
  prNumber: number;
  codeDiffSummary: string;
  docDiffSections: SemanticDiffSection[];
  overallApprovalStatus: 'pending' | 'partial' | 'approved' | 'rejected';
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Analyze code changes and produce semantic doc diff sections
 */
export async function analyzeSmartDiff(
  repositoryId: string,
  prNumber: number,
  changedFiles: Array<{ filename: string; patch?: string; status: string }>
): Promise<SmartDiffResult> {
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true, path: true, title: true, content: true },
  });

  const codeSummary = changedFiles.map((f) => `${f.status}: ${f.filename}`).join('\n');

  const sections: SemanticDiffSection[] = [];
  const anthropic = getAnthropicClient();

  for (const doc of documents) {
    if (!doc.content) continue;

    const relevantFiles = changedFiles.filter((f) => areRelated(doc.path, f.filename));
    if (relevantFiles.length === 0) continue;

    const patchText = relevantFiles
      .map((f) => `File: ${f.filename}\n${f.patch || '(no patch)'}`)
      .join('\n\n');

    if (anthropic) {
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: `You are a documentation analyst. Given code changes, identify which documentation sections are affected and how. Return ONLY valid JSON array.`,
          messages: [
            {
              role: 'user',
              content: `Code changes:\n${patchText.substring(0, 3000)}\n\nDocumentation (${doc.title}):\n${doc.content.substring(0, 3000)}\n\nReturn JSON array of affected sections: [{"changeType":"modified","conceptName":"section name","oldContent":"brief old","newContent":"brief new","confidence":0.8}]`,
            },
          ],
        });

        const text = response.content[0];
        if (text && text.type === 'text') {
          const match = (text as { type: 'text'; text: string }).text.match(/\[[\s\S]*\]/);
          if (match) {
            const parsed = JSON.parse(match[0]) as Array<{
              changeType: string;
              conceptName: string;
              oldContent?: string;
              newContent?: string;
              confidence: number;
            }>;
            for (const item of parsed) {
              sections.push({
                id: `${doc.id}-${sections.length}`,
                changeType: (item.changeType as SemanticDiffSection['changeType']) || 'modified',
                conceptName: item.conceptName || doc.title,
                oldContent: item.oldContent,
                newContent: item.newContent,
                confidence: item.confidence || 0.7,
                comments: [],
                approved: null,
              });
            }
          }
        }
      } catch {
        // Fallback to heuristic
        sections.push(createHeuristicSection(doc, relevantFiles));
      }
    } else {
      sections.push(createHeuristicSection(doc, relevantFiles));
    }
  }

  return {
    repositoryId,
    prNumber,
    codeDiffSummary: codeSummary,
    docDiffSections: sections,
    overallApprovalStatus: 'pending',
  };
}

/**
 * Add a comment to a diff section
 */
export async function addDiffComment(
  smartDiffId: string,
  sectionId: string,
  author: string,
  content: string,
  parentId?: string
): Promise<{ id: string }> {
  const comment = await db.diffComment.create({
    data: { smartDiffId, sectionId, author, content, parentId },
  });
  return { id: comment.id };
}

/**
 * Approve or reject a diff section
 */
export async function updateSectionApproval(
  smartDiffId: string,
  sectionId: string,
  approved: boolean
): Promise<void> {
  const diff = await db.smartDiff.findUnique({ where: { id: smartDiffId } });
  if (!diff) return;

  const sections = (diff.docDiffSections as SemanticDiffSection[]).map((s) =>
    s.id === sectionId ? { ...s, approved } : s
  );

  const allApproved = sections.every((s) => s.approved === true);
  const anyRejected = sections.some((s) => s.approved === false);
  const approvalStatus = anyRejected ? 'rejected' : allApproved ? 'approved' : 'partial';

  await db.smartDiff.update({
    where: { id: smartDiffId },
    data: { docDiffSections: sections, approvalStatus },
  });
}

/**
 * Get a smart diff with its comments
 */
export async function getSmartDiff(smartDiffId: string) {
  const diff = await db.smartDiff.findUnique({ where: { id: smartDiffId } });
  if (!diff) return null;

  const comments = await db.diffComment.findMany({
    where: { smartDiffId },
    orderBy: { createdAt: 'asc' },
  });

  return { ...diff, comments };
}

// ============================================================================
// Utility Functions
// ============================================================================

function areRelated(docPath: string, filePath: string): boolean {
  const docBase =
    docPath
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '')
      .toLowerCase() || '';
  const fileBase =
    filePath
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '')
      .toLowerCase() || '';
  return fileBase.includes(docBase) || docBase.includes(fileBase);
}

function createHeuristicSection(
  doc: { id: string; title: string },
  files: Array<{ filename: string }>
): SemanticDiffSection {
  return {
    id: `${doc.id}-heuristic`,
    changeType: 'modified',
    conceptName: doc.title,
    oldContent: undefined,
    newContent: `May need updates based on changes in: ${files.map((f) => f.filename).join(', ')}`,
    confidence: 0.5,
    comments: [],
    approved: null,
  };
}
