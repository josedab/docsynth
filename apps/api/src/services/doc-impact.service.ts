/**
 * Doc Impact Analysis Service
 *
 * Analyzes which documentation sections will become stale when a PR is merged,
 * providing proactive alerts to maintain documentation quality.
 */

import { prisma } from '@docsynth/database';
import { getAnthropicClient } from '@docsynth/utils';

// ============================================================================
// Types
// ============================================================================

export interface DocImpactAnalysis {
  repositoryId: string;
  prNumber: number;
  impactedDocs: ImpactedDocument[];
  overallRisk: 'low' | 'medium' | 'high';
  summary: string;
}

export interface ImpactedDocument {
  documentId: string;
  documentPath: string;
  documentTitle: string;
  impactedSections: string[];
  confidenceScore: number; // 0-1
  stalenessRisk: 'low' | 'medium' | 'high';
  suggestedUpdate: string;
}

export interface ChangedFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface ImpactConfig {
  enabled: boolean;
  confidenceThreshold: number; // Minimum confidence to report (0-1)
  autoComment: boolean;
  riskThreshold: 'low' | 'medium' | 'high'; // Minimum risk level to report
  includePaths: string[];
  excludePaths: string[];
}

// ============================================================================
// Doc Impact Analysis
// ============================================================================

/**
 * Analyze which docs are affected by PR changes
 */
export async function analyzeDocImpact(
  repositoryId: string,
  prNumber: number,
  changedFiles: ChangedFile[]
): Promise<DocImpactAnalysis> {
  // Map changed files to related documents
  const docFileMapping = await mapFilesToDocs(repositoryId, changedFiles);

  const impactedDocs: ImpactedDocument[] = [];
  const anthropic = getAnthropicClient();

  for (const { document, relatedFiles } of docFileMapping) {
    // Get document content
    const doc = await prisma.document.findUnique({
      where: { id: document.id },
      select: { content: true },
    });

    if (!doc?.content) continue;

    // Extract changed code from related files
    const changedCode = relatedFiles
      .map((file) => `File: ${file.filename}\n${file.patch || 'No patch available'}`)
      .join('\n\n');

    // Use LLM to assess impact
    if (!anthropic) {
      // Fallback: basic heuristic analysis
      const impactedSections = extractHeadingsFromContent(doc.content);
      const risk = calculateRiskFromChanges(relatedFiles);

      impactedDocs.push({
        documentId: document.id,
        documentPath: document.path,
        documentTitle: document.title,
        impactedSections: impactedSections.slice(0, 3),
        confidenceScore: 0.6,
        stalenessRisk: risk,
        suggestedUpdate: `Review and update based on changes in: ${relatedFiles.map((f) => f.filename).join(', ')}`,
      });
      continue;
    }

    try {
      const prompt = `Analyze how the following code changes might impact this documentation.

Documentation: ${document.title}
Path: ${document.path}

Code Changes:
${changedCode.substring(0, 3000)}

Documentation Content:
${doc.content.substring(0, 3000)}

Provide a JSON response with:
{
  "impactedSections": ["section title 1", "section title 2"],
  "confidenceScore": 0.0-1.0,
  "stalenessRisk": "low" | "medium" | "high",
  "suggestedUpdate": "Brief description of what needs updating"
}`;

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: `You are a documentation analysis expert. Analyze code changes and determine their impact on documentation.
Return ONLY valid JSON, no explanations.`,
        messages: [{ role: 'user', content: prompt }],
      });

      const textContent = response.content[0];
      if (!textContent || textContent.type !== 'text') continue;

      const analysisText = (textContent as { type: 'text'; text: string }).text;
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const analysis = JSON.parse(jsonMatch[0]);

      // Validate and add to results
      if (analysis.confidenceScore > 0.3) {
        impactedDocs.push({
          documentId: document.id,
          documentPath: document.path,
          documentTitle: document.title,
          impactedSections: analysis.impactedSections || [],
          confidenceScore: analysis.confidenceScore || 0.5,
          stalenessRisk: analysis.stalenessRisk || 'medium',
          suggestedUpdate: analysis.suggestedUpdate || 'Review and update as needed',
        });
      }
    } catch (error) {
      // Fallback to basic analysis
      const impactedSections = extractHeadingsFromContent(doc.content);
      const risk = calculateRiskFromChanges(relatedFiles);

      impactedDocs.push({
        documentId: document.id,
        documentPath: document.path,
        documentTitle: document.title,
        impactedSections: impactedSections.slice(0, 3),
        confidenceScore: 0.5,
        stalenessRisk: risk,
        suggestedUpdate: `Review and update based on changes in: ${relatedFiles.map((f) => f.filename).join(', ')}`,
      });
    }
  }

  // Calculate overall risk
  const overallRisk = calculateOverallRisk(impactedDocs);

  // Generate summary
  const summary = generateSummary(impactedDocs, changedFiles.length);

  return {
    repositoryId,
    prNumber,
    impactedDocs,
    overallRisk,
    summary,
  };
}

/**
 * Generate markdown comment for GitHub PR
 */
export async function generateImpactComment(analysis: DocImpactAnalysis): Promise<string> {
  const { impactedDocs, overallRisk, summary, prNumber } = analysis;

  const riskEmoji = {
    low: '🟢',
    medium: '🟡',
    high: '🔴',
  };

  let comment = `## 📚 Documentation Impact Analysis\n\n`;
  comment += `${riskEmoji[overallRisk]} **Overall Risk: ${overallRisk.toUpperCase()}**\n\n`;
  comment += `${summary}\n\n`;

  if (impactedDocs.length === 0) {
    comment += `✅ No documentation appears to be impacted by this PR.\n`;
    return comment;
  }

  comment += `### Impacted Documentation\n\n`;

  for (const doc of impactedDocs.slice(0, 10)) {
    const riskIcon = riskEmoji[doc.stalenessRisk];
    const confidence = Math.round(doc.confidenceScore * 100);

    comment += `#### ${riskIcon} [${doc.documentTitle}](${doc.documentPath}) (${confidence}% confidence)\n\n`;

    if (doc.impactedSections.length > 0) {
      comment += `**Sections that may need updates:**\n`;
      for (const section of doc.impactedSections) {
        comment += `- ${section}\n`;
      }
      comment += `\n`;
    }

    comment += `**Suggested action:** ${doc.suggestedUpdate}\n\n`;
  }

  if (impactedDocs.length > 10) {
    comment += `\n_...and ${impactedDocs.length - 10} more documents_\n\n`;
  }

  comment += `---\n`;
  comment += `<sub>Generated by DocSynth | [View Full Report](#) | [Approve Updates](#)</sub>\n`;

  return comment;
}

/**
 * Get past impact analyses for a repository
 */
export async function getImpactHistory(
  repositoryId: string,
  limit: number = 20
): Promise<DocImpactAnalysis[]> {
  // Type assertion for extended Prisma models
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  const analyses = await db.docImpactAnalysis.findMany({
    where: { repositoryId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return analyses.map((a: {
    repositoryId: string;
    prNumber: number;
    impactedDocs: unknown;
    overallRisk: 'low' | 'medium' | 'high';
    summary: string;
  }) => ({
    repositoryId: a.repositoryId,
    prNumber: a.prNumber,
    impactedDocs: (a.impactedDocs as ImpactedDocument[]) || [],
    overallRisk: a.overallRisk,
    summary: a.summary,
  }));
}

/**
 * Map changed code files to related documentation
 */
export async function mapFilesToDocs(
  repositoryId: string,
  changedFiles: ChangedFile[]
): Promise<Array<{ document: { id: string; path: string; title: string }; relatedFiles: ChangedFile[] }>> {
  // Get all documents for the repository
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: {
      id: true,
      path: true,
      title: true,
      metadata: true,
    },
  });

  const mapping: Array<{ document: { id: string; path: string; title: string }; relatedFiles: ChangedFile[] }> = [];

  for (const doc of documents) {
    const relatedFiles: ChangedFile[] = [];

    for (const file of changedFiles) {
      // Skip non-code files
      if (!isCodeFile(file.filename)) continue;

      // Check if file is related to document by:
      // 1. Path patterns (e.g., docs/api.md relates to src/api/)
      const docBaseName = getBaseName(doc.path);
      const fileBaseName = getBaseName(file.filename);

      if (fileBaseName.includes(docBaseName) || docBaseName.includes(fileBaseName)) {
        relatedFiles.push(file);
        continue;
      }

      // 2. Metadata relatedFiles field
      const metadata = doc.metadata as { relatedFiles?: string[] } | null;
      if (metadata?.relatedFiles?.some((pattern: string) => file.filename.includes(pattern))) {
        relatedFiles.push(file);
        continue;
      }

      // 3. Path proximity (same directory or parent)
      if (arePathsRelated(doc.path, file.filename)) {
        relatedFiles.push(file);
        continue;
      }
    }

    if (relatedFiles.length > 0) {
      mapping.push({
        document: {
          id: doc.id,
          path: doc.path,
          title: doc.title,
        },
        relatedFiles,
      });
    }
  }

  return mapping;
}

// ============================================================================
// Utility Functions
// ============================================================================

function extractHeadingsFromContent(content: string): string[] {
  const headings: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push(match[2] || '');
    }
  }

  return headings;
}

function calculateRiskFromChanges(files: ChangedFile[]): 'low' | 'medium' | 'high' {
  const totalChanges = files.reduce((sum, f) => sum + f.changes, 0);

  if (totalChanges > 200) return 'high';
  if (totalChanges > 50) return 'medium';
  return 'low';
}

function calculateOverallRisk(impactedDocs: ImpactedDocument[]): 'low' | 'medium' | 'high' {
  if (impactedDocs.length === 0) return 'low';

  const highRiskCount = impactedDocs.filter((d) => d.stalenessRisk === 'high').length;
  const mediumRiskCount = impactedDocs.filter((d) => d.stalenessRisk === 'medium').length;

  if (highRiskCount > 2 || impactedDocs.length > 10) return 'high';
  if (highRiskCount > 0 || mediumRiskCount > 3) return 'medium';
  return 'low';
}

function generateSummary(impactedDocs: ImpactedDocument[], changedFilesCount: number): string {
  if (impactedDocs.length === 0) {
    return `This PR changes ${changedFilesCount} file(s) but does not appear to impact any documentation.`;
  }

  const highRisk = impactedDocs.filter((d) => d.stalenessRisk === 'high').length;
  const mediumRisk = impactedDocs.filter((d) => d.stalenessRisk === 'medium').length;
  const lowRisk = impactedDocs.filter((d) => d.stalenessRisk === 'low').length;

  let summary = `This PR may impact **${impactedDocs.length} documentation file(s)**. `;

  if (highRisk > 0) {
    summary += `${highRisk} require immediate attention (high risk). `;
  }
  if (mediumRisk > 0) {
    summary += `${mediumRisk} should be reviewed (medium risk). `;
  }
  if (lowRisk > 0) {
    summary += `${lowRisk} have minor impacts (low risk). `;
  }

  return summary;
}

function isCodeFile(filename: string): boolean {
  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp'];
  return codeExtensions.some((ext) => filename.endsWith(ext));
}

function getBaseName(path: string): string {
  const parts = path.split('/');
  const filename = parts[parts.length - 1] || '';
  return filename.replace(/\.[^/.]+$/, '').toLowerCase();
}

function arePathsRelated(docPath: string, codePath: string): boolean {
  const docParts = docPath.split('/').filter((p) => p);
  const codeParts = codePath.split('/').filter((p) => p);

  // Check if they share common directory prefixes
  for (let i = 0; i < Math.min(docParts.length - 1, codeParts.length - 1); i++) {
    if (docParts[i] === codeParts[i]) {
      return true;
    }
  }

  return false;
}

/**
 * Get configuration for doc impact analysis
 */
export async function getImpactConfig(repositoryId: string): Promise<ImpactConfig> {
  // Type assertion for extended Prisma models
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  const config = await db.docImpactConfig.findUnique({
    where: { repositoryId },
  });

  return {
    enabled: config?.enabled ?? true,
    confidenceThreshold: config?.confidenceThreshold ?? 0.5,
    autoComment: config?.autoComment ?? true,
    riskThreshold: config?.riskThreshold ?? 'low',
    includePaths: config?.includePaths ?? [],
    excludePaths: config?.excludePaths ?? [],
  };
}

/**
 * Update configuration for doc impact analysis
 */
export async function updateImpactConfig(
  repositoryId: string,
  config: Partial<ImpactConfig>
): Promise<ImpactConfig> {
  // Type assertion for extended Prisma models
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  const updated = await db.docImpactConfig.upsert({
    where: { repositoryId },
    create: {
      repositoryId,
      enabled: config.enabled ?? true,
      confidenceThreshold: config.confidenceThreshold ?? 0.5,
      autoComment: config.autoComment ?? true,
      riskThreshold: config.riskThreshold ?? 'low',
      includePaths: config.includePaths ?? [],
      excludePaths: config.excludePaths ?? [],
    },
    update: {
      enabled: config.enabled,
      confidenceThreshold: config.confidenceThreshold,
      autoComment: config.autoComment,
      riskThreshold: config.riskThreshold,
      includePaths: config.includePaths,
      excludePaths: config.excludePaths,
    },
  });

  return {
    enabled: updated.enabled,
    confidenceThreshold: updated.confidenceThreshold,
    autoComment: updated.autoComment,
    riskThreshold: updated.riskThreshold,
    includePaths: updated.includePaths,
    excludePaths: updated.excludePaths,
  };
}
