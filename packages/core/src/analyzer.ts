// ============================================================================
// Types
// ============================================================================

export interface FileChange {
  path: string;
  type: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  isPublicAPI: boolean;
  isBreaking: boolean;
}

export interface ChangeAnalysisResult {
  changedFiles: FileChange[];
  impactScore: number;
  suggestedDocTypes: string[];
  summary: string;
}

export interface GenerationResult {
  content: string;
  type: string;
  path: string;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Constants
// ============================================================================

const PUBLIC_API_PATTERNS = [
  /^src\/index\.[jt]sx?$/,
  /\/index\.[jt]sx?$/,
  /\.d\.ts$/,
  /^api\//,
  /openapi|swagger/i,
];

const BREAKING_PATTERNS = [/^export\s/, /^-export\s/, /interface\s+\w+/, /type\s+\w+/];

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Parse and analyze a unified git diff string.
 */
export function analyzeChanges(diff: string): ChangeAnalysisResult {
  const changedFiles = parseDiff(diff);
  const impactScore = calculateImpactScore(changedFiles);
  const suggestedDocTypes = suggestDocumentTypes({
    changedFiles,
    impactScore,
    suggestedDocTypes: [],
    summary: '',
  });

  const summary = buildSummary(changedFiles, impactScore);

  return { changedFiles, impactScore, suggestedDocTypes, summary };
}

/**
 * Filter to only public API changes.
 */
export function detectPublicAPIChanges(files: FileChange[]): FileChange[] {
  return files.filter((f) => f.isPublicAPI);
}

/**
 * Suggest which documentation types should be updated based on the analysis.
 */
export function suggestDocumentTypes(analysis: ChangeAnalysisResult): string[] {
  const types: Set<string> = new Set();

  const hasPublicAPI = analysis.changedFiles.some((f) => f.isPublicAPI);
  const hasBreaking = analysis.changedFiles.some((f) => f.isBreaking);
  const hasNewFiles = analysis.changedFiles.some((f) => f.type === 'added');

  if (hasPublicAPI) types.add('api-reference');
  if (hasBreaking) types.add('migration-guide');
  if (hasNewFiles) types.add('readme');

  // Always suggest changelog for non-trivial changes
  if (analysis.changedFiles.length > 0) types.add('changelog');

  return Array.from(types);
}

// ============================================================================
// Internal Helpers
// ============================================================================

function parseDiff(diff: string): FileChange[] {
  const files: FileChange[] = [];
  const diffSections = diff.split(/^diff --git /m).filter(Boolean);

  for (const section of diffSections) {
    const file = parseDiffSection(section);
    if (file) files.push(file);
  }

  return files;
}

function parseDiffSection(section: string): FileChange | null {
  const headerMatch = section.match(/a\/(.+?)\s+b\/(.+)/);
  if (!headerMatch) return null;

  const oldPath = headerMatch[1]!;
  const newPath = headerMatch[2]!;

  const type = detectChangeType(section, oldPath, newPath);
  const path = type === 'deleted' ? oldPath : newPath;
  const { additions, deletions } = countChanges(section);
  const isPublicAPI = PUBLIC_API_PATTERNS.some((p) => p.test(path));
  const isBreaking = detectBreakingChange(section);

  return { path, type, additions, deletions, isPublicAPI, isBreaking };
}

function detectChangeType(section: string, oldPath: string, newPath: string): FileChange['type'] {
  if (section.includes('new file mode')) return 'added';
  if (section.includes('deleted file mode')) return 'deleted';
  if (oldPath !== newPath) return 'renamed';
  return 'modified';
}

function countChanges(section: string): { additions: number; deletions: number } {
  const lines = section.split('\n');
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }

  return { additions, deletions };
}

function detectBreakingChange(section: string): boolean {
  const removedLines = section.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));

  return removedLines.some((line) => BREAKING_PATTERNS.some((p) => p.test(line)));
}

function calculateImpactScore(files: FileChange[]): number {
  if (files.length === 0) return 0;

  let score = 0;

  for (const file of files) {
    // Base score per file
    score += 5;
    // Public API changes carry more weight
    if (file.isPublicAPI) score += 20;
    // Breaking changes carry even more
    if (file.isBreaking) score += 15;
    // Size of change
    score += Math.min(file.additions + file.deletions, 20);
  }

  return Math.min(score, 100);
}

function buildSummary(files: FileChange[], impactScore: number): string {
  const added = files.filter((f) => f.type === 'added').length;
  const modified = files.filter((f) => f.type === 'modified').length;
  const deleted = files.filter((f) => f.type === 'deleted').length;
  const publicAPI = files.filter((f) => f.isPublicAPI).length;

  const parts: string[] = [];
  parts.push(`${files.length} file(s) changed`);
  if (added) parts.push(`${added} added`);
  if (modified) parts.push(`${modified} modified`);
  if (deleted) parts.push(`${deleted} deleted`);
  if (publicAPI) parts.push(`${publicAPI} public API`);
  parts.push(`impact score: ${impactScore}/100`);

  return parts.join(', ');
}
