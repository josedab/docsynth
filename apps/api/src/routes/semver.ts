import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';

const log = createLogger('semver-routes');

// Type assertion for new Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  patch?: string;
  status: string;
}

interface SemverAnalysisResult {
  bumpType: 'major' | 'minor' | 'patch' | 'none';
  suggestedVersion: string;
  confidence: number;
  breakingChanges: Array<{ type: string; name: string; description: string; filePath: string; line: number; migrationHint?: string }>;
  newFeatures: Array<{ name: string; description: string; filePath: string; line: number }>;
  bugFixes: Array<{ name: string; description: string; filePath: string; line: number }>;
  reasoning: string;
}

// Inline semver analysis function
async function analyzeChanges(
  changes: FileChange[],
  currentVersion: string,
  prContext: { title: string; body: string | null }
): Promise<SemverAnalysisResult> {
  const prompt = `Analyze these code changes and determine the appropriate semantic version bump.

Current version: ${currentVersion}
PR Title: ${prContext.title}
PR Body: ${prContext.body || 'No description provided'}

Changes:
${changes.map(c => `- ${c.path} (${c.status}): +${c.additions}/-${c.deletions} lines`).join('\n')}

Patch content (sample):
${changes.slice(0, 5).map(c => c.patch?.substring(0, 500) || '').join('\n---\n')}

Analyze and return JSON with:
{
  "bumpType": "major" | "minor" | "patch" | "none",
  "breakingChanges": [{ "type": "removed_api|signature_change|behavior_change", "name": "...", "description": "...", "filePath": "...", "line": 0, "migrationHint": "..." }],
  "newFeatures": [{ "name": "...", "description": "...", "filePath": "...", "line": 0 }],
  "bugFixes": [{ "name": "...", "description": "...", "filePath": "...", "line": 0 }],
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}

Guidelines:
- MAJOR: Breaking API changes, removed functions, incompatible changes
- MINOR: New features, non-breaking additions
- PATCH: Bug fixes, documentation, internal refactoring
- none: No version bump needed (CI changes, comments only)`;

  try {
    const anthropic = getAnthropicClient();
    if (!anthropic) {
      throw new Error('Anthropic client not available');
    }
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const result = JSON.parse(jsonMatch[0]);
    
    // Calculate suggested version
    const versionParts = currentVersion.replace(/^v/, '').split('.').map(Number);
    const major = versionParts[0] ?? 0;
    const minor = versionParts[1] ?? 0;
    const patch = versionParts[2] ?? 0;
    let suggestedVersion = currentVersion;
    
    switch (result.bumpType) {
      case 'major': suggestedVersion = `${major + 1}.0.0`; break;
      case 'minor': suggestedVersion = `${major}.${minor + 1}.0`; break;
      case 'patch': suggestedVersion = `${major}.${minor}.${patch + 1}`; break;
    }

    return {
      bumpType: result.bumpType,
      suggestedVersion,
      confidence: result.confidence ?? 0.8,
      breakingChanges: result.breakingChanges ?? [],
      newFeatures: result.newFeatures ?? [],
      bugFixes: result.bugFixes ?? [],
      reasoning: result.reasoning ?? 'Analysis complete',
    };
  } catch (error) {
    log.error({ error }, 'LLM semver analysis failed, using heuristics');
    
    // Fallback heuristics
    const hasBreaking = changes.some(c => c.patch?.includes('BREAKING') || c.patch?.includes('@deprecated'));
    const hasNewExports = changes.some(c => c.patch?.includes('export ') && c.additions > c.deletions);
    
    let bumpType: 'major' | 'minor' | 'patch' | 'none' = 'patch';
    if (hasBreaking) bumpType = 'major';
    else if (hasNewExports) bumpType = 'minor';
    
    const versionParts = currentVersion.replace(/^v/, '').split('.').map(Number);
    const major = versionParts[0] ?? 0;
    const minor = versionParts[1] ?? 0;
    const patchNum = versionParts[2] ?? 0;
    let suggestedVersion = currentVersion;
    
    switch (bumpType) {
      case 'major': suggestedVersion = `${major + 1}.0.0`; break;
      case 'minor': suggestedVersion = `${major}.${minor + 1}.0`; break;
      case 'patch': suggestedVersion = `${major}.${minor}.${patchNum + 1}`; break;
    }

    return {
      bumpType,
      suggestedVersion,
      confidence: 0.5,
      breakingChanges: [],
      newFeatures: [],
      bugFixes: [],
      reasoning: 'Heuristic-based analysis (LLM unavailable)',
    };
  }
}

// Generate migration guide
async function generateMigrationGuide(
  analysis: SemverAnalysisResult,
  _changes: FileChange[]
): Promise<string> {
  if (analysis.breakingChanges.length === 0) {
    return `# Migration Guide to ${analysis.suggestedVersion}\n\nNo breaking changes. Update your dependency version to upgrade.`;
  }

  const prompt = `Generate a migration guide for upgrading to version ${analysis.suggestedVersion}.

Breaking changes:
${analysis.breakingChanges.map(bc => `- ${bc.type}: ${bc.name} - ${bc.description}${bc.migrationHint ? ` (Hint: ${bc.migrationHint})` : ''}`).join('\n')}

Write a clear, developer-friendly migration guide in Markdown format with:
1. Overview of changes
2. Step-by-step migration instructions
3. Code examples for each breaking change
4. Common gotchas`;

  try {
    const anthropic = getAnthropicClient();
    if (!anthropic) {
      throw new Error('Anthropic client not available');
    }
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    return content && content.type === 'text' ? content.text : 'Migration guide generation failed';
  } catch (error) {
    log.error({ error }, 'Migration guide generation failed');
    
    // Fallback simple guide
    return `# Migration Guide to ${analysis.suggestedVersion}

## Breaking Changes

${analysis.breakingChanges.map(bc => `### ${bc.name}
- **Type**: ${bc.type}
- **Description**: ${bc.description}
- **File**: ${bc.filePath}
${bc.migrationHint ? `- **Migration**: ${bc.migrationHint}` : ''}`).join('\n\n')}

## Steps

1. Update your package.json to use version ${analysis.suggestedVersion}
2. Review the breaking changes above
3. Update your code accordingly
4. Run your tests to verify the migration`;
  }
}

export const semverRoutes = new Hono();

// Get semver analysis for a PR
semverRoutes.get('/:repositoryId/analysis/:prNumber', async (c) => {
  const { repositoryId, prNumber } = c.req.param();

  try {
    const analysis = await db.semverAnalysis.findFirst({
      where: {
        repositoryId,
        prNumber: parseInt(prNumber, 10),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!analysis) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'No analysis found for this PR' } }, 404);
    }

    return c.json({ success: true, data: analysis });
  } catch (error) {
    log.error({ error, repositoryId, prNumber }, 'Failed to fetch semver analysis');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch analysis' } }, 500);
  }
});

// Trigger semver analysis for a PR
semverRoutes.post('/:repositoryId/analyze', async (c) => {
  const { repositoryId } = c.req.param();

  try {
    const body = await c.req.json();
    const { prNumber, changes, currentVersion, prTitle, prBody } = body;

    if (!prNumber || !changes || !currentVersion) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'prNumber, changes, and currentVersion are required' },
      }, 400);
    }

    // Analyze changes
    const result = await analyzeChanges(
      changes,
      currentVersion,
      { title: prTitle ?? '', body: prBody ?? null }
    );

    // Store analysis
    const analysis = await db.semverAnalysis.create({
      data: {
        repositoryId,
        prNumber,
        currentVersion,
        suggestedVersion: result.suggestedVersion,
        bumpType: result.bumpType,
        breakingChanges: result.breakingChanges,
        newFeatures: result.newFeatures,
        bugFixes: result.bugFixes,
        confidence: result.confidence,
        reasoning: result.reasoning,
      },
    });

    log.info({
      repositoryId,
      prNumber,
      currentVersion,
      suggestedVersion: result.suggestedVersion,
      bumpType: result.bumpType,
    }, 'Semver analysis complete');

    return c.json({ success: true, data: { ...analysis, ...result } }, 201);
  } catch (error) {
    log.error({ error, repositoryId }, 'Semver analysis failed');
    return c.json({ success: false, error: { code: 'ANALYSIS_FAILED', message: 'Failed to analyze changes' } }, 500);
  }
});

// Generate migration guide for an analysis
semverRoutes.post('/:repositoryId/migration-guide/:analysisId', async (c) => {
  const { repositoryId, analysisId } = c.req.param();

  try {
    const body = await c.req.json();
    const { changes } = body;

    const analysis = await db.semverAnalysis.findFirst({
      where: { id: analysisId, repositoryId },
    });

    if (!analysis) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Analysis not found' } }, 404);
    }

    // Generate migration guide
    const guideContent = await generateMigrationGuide(
      {
        bumpType: analysis.bumpType as 'major' | 'minor' | 'patch' | 'none',
        suggestedVersion: analysis.suggestedVersion,
        confidence: analysis.confidence,
        breakingChanges: analysis.breakingChanges as Array<{
          type: string;
          name: string;
          description: string;
          filePath: string;
          line: number;
          migrationHint?: string;
        }>,
        newFeatures: analysis.newFeatures as Array<{
          name: string;
          description: string;
          filePath: string;
          line: number;
        }>,
        bugFixes: analysis.bugFixes as Array<{
          name: string;
          description: string;
          filePath: string;
          line: number;
        }>,
        reasoning: analysis.reasoning ?? '',
      },
      changes ?? []
    );

    const guide = {
      fromVersion: analysis.currentVersion,
      toVersion: analysis.suggestedVersion,
      content: guideContent,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      breakingItems: (analysis.breakingChanges as any[]).map((bc) => ({
        name: bc.name,
        description: bc.description,
        migrationSteps: bc.migrationHint ? [bc.migrationHint] : [],
      })),
    };

    // Store migration guide
    const migrationGuide = await db.migrationGuide.upsert({
      where: { analysisId },
      create: {
        analysisId,
        fromVersion: guide.fromVersion,
        toVersion: guide.toVersion,
        content: guide.content,
        breakingItems: guide.breakingItems,
        codeExamples: [],
        automatedSteps: [],
        manualSteps: [],
      },
      update: {
        content: guide.content,
        breakingItems: guide.breakingItems,
        updatedAt: new Date(),
      },
    });

    log.info({ analysisId, fromVersion: guide.fromVersion, toVersion: guide.toVersion }, 'Migration guide generated');

    return c.json({ success: true, data: migrationGuide });
  } catch (error) {
    log.error({ error, analysisId }, 'Migration guide generation failed');
    return c.json({ success: false, error: { code: 'GENERATION_FAILED', message: 'Failed to generate migration guide' } }, 500);
  }
});

// Get migration guide
semverRoutes.get('/:repositoryId/migration-guide/:analysisId', async (c) => {
  const { repositoryId, analysisId } = c.req.param();

  try {
    const guide = await db.migrationGuide.findFirst({
      where: {
        analysisId,
        analysis: { repositoryId },
      },
    });

    if (!guide) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Migration guide not found' } }, 404);
    }

    return c.json({ success: true, data: guide });
  } catch (error) {
    log.error({ error, analysisId }, 'Failed to fetch migration guide');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch migration guide' } }, 500);
  }
});

// Approve version bump and update package.json
semverRoutes.post('/:repositoryId/approve/:analysisId', async (c) => {
  const { repositoryId, analysisId } = c.req.param();

  try {
    const body = await c.req.json();
    const { approvedBy, createTag = false, createRelease = false } = body;

    const analysis = await db.semverAnalysis.findFirst({
      where: { id: analysisId, repositoryId },
    });

    if (!analysis) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Analysis not found' } }, 404);
    }

    // Update analysis as approved
    await db.semverAnalysis.update({
      where: { id: analysisId },
      data: {
        approved: true,
        appliedAt: new Date(),
      },
    });

    // Version bump would be queued in production
    // For now, just log the approval
    log.info({ analysisId, approvedBy, newVersion: analysis.suggestedVersion, createTag, createRelease }, 'Version bump approved');

    return c.json({
      success: true,
      data: {
        analysisId,
        suggestedVersion: analysis.suggestedVersion,
        approved: true,
        createTag,
        createRelease,
      },
    });
  } catch (error) {
    log.error({ error, analysisId }, 'Version approval failed');
    return c.json({ success: false, error: { code: 'APPROVAL_FAILED', message: 'Failed to approve version' } }, 500);
  }
});

// Get version history for a repository
semverRoutes.get('/:repositoryId/history', async (c) => {
  const { repositoryId } = c.req.param();
  const { limit = '20' } = c.req.query();

  try {
    const analyses = await db.semverAnalysis.findMany({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
      include: {
        migrationGuide: {
          select: { id: true, fromVersion: true, toVersion: true },
        },
      },
    });

    return c.json({ success: true, data: analyses });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch version history');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch version history' } }, 500);
  }
});

// Detect current version from package.json or similar
semverRoutes.get('/:repositoryId/current-version', async (c) => {
  const { repositoryId } = c.req.param();

  try {
    const repo = await prisma.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repo) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404);
    }

    // Try to get version from metadata or return a default
    const metadata = repo.metadata as Record<string, unknown>;
    const currentVersion = (metadata?.version as string) ?? '0.0.0';

    return c.json({
      success: true,
      data: {
        version: currentVersion,
        source: metadata?.version ? 'metadata' : 'default',
      },
    });
  } catch (error) {
    log.error({ error, repositoryId }, 'Failed to fetch current version');
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch current version' } }, 500);
  }
});
