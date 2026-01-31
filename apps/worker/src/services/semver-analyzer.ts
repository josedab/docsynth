import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '@docsynth/utils';
import type { FileChange } from '@docsynth/types';

const log = createLogger('semver-analyzer-service');

export type BumpType = 'major' | 'minor' | 'patch' | 'none';

export interface BreakingChange {
  type: string;
  name: string;
  description: string;
  filePath: string;
  line: number;
  migrationHint?: string;
}

export interface NewFeature {
  name: string;
  description: string;
  filePath: string;
  line: number;
}

export interface BugFix {
  name: string;
  description: string;
  filePath: string;
}

export interface SemverAnalysisResult {
  currentVersion: string;
  suggestedVersion: string;
  bumpType: BumpType;
  breakingChanges: BreakingChange[];
  newFeatures: NewFeature[];
  bugFixes: BugFix[];
  confidence: number;
  reasoning: string;
}

export interface MigrationGuide {
  fromVersion: string;
  toVersion: string;
  content: string;
  breakingItems: Array<{
    before: string;
    after: string;
    description: string;
    codeExample?: string;
  }>;
  automatedSteps: string[];
  manualSteps: string[];
}

const SEMVER_SYSTEM_PROMPT = `You are a semantic versioning expert analyzing code changes to determine the appropriate version bump.

Semantic Versioning Rules:
- MAJOR: Breaking changes (removed APIs, changed signatures, behavioral changes)
- MINOR: New features (new APIs, new options, backward-compatible additions)
- PATCH: Bug fixes (no API changes, only fixes)
- NONE: Documentation, tests, or internal refactoring only

Analyze the changes and determine:
1. What breaking changes exist (requires MAJOR bump)
2. What new features exist (requires at least MINOR bump)
3. What bug fixes exist (requires at least PATCH bump)

Output JSON in this format:
{
  "bumpType": "major|minor|patch|none",
  "breakingChanges": [
    {
      "type": "removal|signature_change|behavior_change|type_change",
      "name": "affectedItemName",
      "description": "What changed and why it's breaking",
      "migrationHint": "How to migrate"
    }
  ],
  "newFeatures": [
    {
      "name": "featureName",
      "description": "What the feature does"
    }
  ],
  "bugFixes": [
    {
      "name": "fixName",
      "description": "What was fixed"
    }
  ],
  "confidence": 85,
  "reasoning": "Brief explanation of the version bump decision"
}`;

export class SemverAnalyzerService {
  private anthropic: Anthropic | null = null;

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
  }

  async analyzeChanges(
    changes: FileChange[],
    currentVersion: string,
    prContext: { title: string; body: string | null }
  ): Promise<SemverAnalysisResult> {
    log.info({ currentVersion, changeCount: changes.length }, 'Analyzing changes for semver');

    // First pass: Analyze semantic changes from code diff
    const semanticChanges = changes.flatMap((c) => c.semanticChanges);
    
    // Quick heuristics for obvious cases
    const hasBreaking = semanticChanges.some((s) => s.breaking);
    const hasNewExports = semanticChanges.some((s) =>
      ['new-export', 'new-function', 'new-class', 'new-interface'].includes(s.type)
    );
    const hasRemovals = semanticChanges.some((s) => s.type === 'removal');
    const hasSignatureChanges = semanticChanges.some((s) => s.type === 'signature-change');

    if (!this.anthropic) {
      // Fallback to heuristic-based analysis
      return this.heuristicAnalysis(changes, currentVersion, hasBreaking, hasNewExports);
    }

    // Use LLM for detailed analysis
    const changesDescription = changes.map((c) => {
      const changeList = c.semanticChanges.map((s) => 
        `  - [${s.type}${s.breaking ? ' BREAKING' : ''}] ${s.name}: ${s.description}`
      ).join('\n');
      return `File: ${c.path}\n${changeList}`;
    }).join('\n\n');

    const prompt = `Analyze these code changes and determine the appropriate semantic version bump:

Current Version: ${currentVersion}

PR Title: ${prContext.title}
PR Description: ${prContext.body ?? 'No description'}

## Code Changes
${changesDescription}

## Detected Patterns
- Has explicit breaking changes: ${hasBreaking}
- Has new exports/features: ${hasNewExports}
- Has removed exports: ${hasRemovals}
- Has signature changes: ${hasSignatureChanges}

Determine the version bump and categorize all changes.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: SEMVER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        log.warn('Could not parse semver response');
        return this.heuristicAnalysis(changes, currentVersion, hasBreaking, hasNewExports);
      }

      const result = JSON.parse(jsonMatch[0]);
      const suggestedVersion = this.bumpVersion(currentVersion, result.bumpType);

      return {
        currentVersion,
        suggestedVersion,
        bumpType: result.bumpType,
        breakingChanges: (result.breakingChanges ?? []).map((b: BreakingChange, i: number) => ({
          ...b,
          filePath: changes[0]?.path ?? '',
          line: i + 1,
        })),
        newFeatures: (result.newFeatures ?? []).map((f: NewFeature) => ({
          ...f,
          filePath: changes.find((c) => 
            c.semanticChanges.some((s) => s.name === f.name)
          )?.path ?? '',
          line: 1,
        })),
        bugFixes: result.bugFixes ?? [],
        confidence: result.confidence ?? 70,
        reasoning: result.reasoning ?? '',
      };
    } catch (error) {
      log.error({ error }, 'LLM semver analysis failed');
      return this.heuristicAnalysis(changes, currentVersion, hasBreaking, hasNewExports);
    }
  }

  async generateMigrationGuide(
    analysis: SemverAnalysisResult,
    changes: FileChange[]
  ): Promise<MigrationGuide> {
    log.info({ from: analysis.currentVersion, to: analysis.suggestedVersion }, 'Generating migration guide');

    if (analysis.breakingChanges.length === 0) {
      return {
        fromVersion: analysis.currentVersion,
        toVersion: analysis.suggestedVersion,
        content: `# Migration Guide: ${analysis.currentVersion} → ${analysis.suggestedVersion}\n\nNo breaking changes in this release.`,
        breakingItems: [],
        automatedSteps: [],
        manualSteps: [],
      };
    }

    if (!this.anthropic) {
      return this.generateBasicMigrationGuide(analysis);
    }

    const prompt = `Generate a detailed migration guide for upgrading from ${analysis.currentVersion} to ${analysis.suggestedVersion}.

## Breaking Changes
${analysis.breakingChanges.map((b) => `- ${b.name}: ${b.description}${b.migrationHint ? ` (Hint: ${b.migrationHint})` : ''}`).join('\n')}

## Code Context
${changes.slice(0, 5).map((c) => `File: ${c.path}\nChanges: ${c.semanticChanges.map((s) => s.description).join(', ')}`).join('\n\n')}

Generate:
1. A clear markdown migration guide
2. Before/after code examples for each breaking change
3. Steps that could potentially be automated (e.g., search-replace patterns)
4. Steps that require manual intervention

Output JSON:
{
  "content": "# Migration Guide markdown content...",
  "breakingItems": [
    {
      "before": "old code example",
      "after": "new code example",
      "description": "explanation",
      "codeExample": "full example with context"
    }
  ],
  "automatedSteps": ["step1", "step2"],
  "manualSteps": ["step1", "step2"]
}`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        return this.generateBasicMigrationGuide(analysis);
      }

      const result = JSON.parse(jsonMatch[0]);

      return {
        fromVersion: analysis.currentVersion,
        toVersion: analysis.suggestedVersion,
        content: result.content,
        breakingItems: result.breakingItems ?? [],
        automatedSteps: result.automatedSteps ?? [],
        manualSteps: result.manualSteps ?? [],
      };
    } catch (error) {
      log.error({ error }, 'Migration guide generation failed');
      return this.generateBasicMigrationGuide(analysis);
    }
  }

  private heuristicAnalysis(
    changes: FileChange[],
    currentVersion: string,
    hasBreaking: boolean,
    hasNewExports: boolean
  ): SemverAnalysisResult {
    const semanticChanges = changes.flatMap((c) => c.semanticChanges);
    
    let bumpType: BumpType = 'patch';
    if (hasBreaking || semanticChanges.some((s) => s.type === 'removal')) {
      bumpType = 'major';
    } else if (hasNewExports) {
      bumpType = 'minor';
    }

    // If no meaningful changes, no bump needed
    if (semanticChanges.length === 0) {
      bumpType = 'none';
    }

    return {
      currentVersion,
      suggestedVersion: this.bumpVersion(currentVersion, bumpType),
      bumpType,
      breakingChanges: semanticChanges
        .filter((s) => s.breaking || s.type === 'removal')
        .map((s) => ({
          type: s.type,
          name: s.name,
          description: s.description,
          filePath: changes.find((c) => c.semanticChanges.includes(s))?.path ?? '',
          line: s.location.startLine,
        })),
      newFeatures: semanticChanges
        .filter((s) => ['new-export', 'new-function', 'new-class'].includes(s.type))
        .map((s) => ({
          name: s.name,
          description: s.description,
          filePath: changes.find((c) => c.semanticChanges.includes(s))?.path ?? '',
          line: s.location.startLine,
        })),
      bugFixes: [],
      confidence: 60,
      reasoning: 'Heuristic-based analysis (LLM unavailable)',
    };
  }

  private generateBasicMigrationGuide(analysis: SemverAnalysisResult): MigrationGuide {
    const breakingList = analysis.breakingChanges
      .map((b) => `### ${b.name}\n\n${b.description}\n\n${b.migrationHint ? `**Migration:** ${b.migrationHint}` : ''}`)
      .join('\n\n');

    const content = `# Migration Guide: ${analysis.currentVersion} → ${analysis.suggestedVersion}

## Overview

This release includes ${analysis.breakingChanges.length} breaking change(s).

## Breaking Changes

${breakingList || 'No breaking changes documented.'}

## New Features

${analysis.newFeatures.map((f) => `- **${f.name}**: ${f.description}`).join('\n') || 'No new features.'}

## Bug Fixes

${analysis.bugFixes.map((f) => `- **${f.name}**: ${f.description}`).join('\n') || 'No bug fixes documented.'}

---
*Generated by DocSynth*`;

    return {
      fromVersion: analysis.currentVersion,
      toVersion: analysis.suggestedVersion,
      content,
      breakingItems: analysis.breakingChanges.map((b) => ({
        before: '// Old code',
        after: '// New code (see migration hint)',
        description: b.description,
      })),
      automatedSteps: [],
      manualSteps: analysis.breakingChanges.map((b) => 
        `Update usages of ${b.name}: ${b.migrationHint ?? b.description}`
      ),
    };
  }

  private bumpVersion(version: string, bumpType: BumpType): string {
    const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
      return version;
    }

    const [, major, minor, patch] = match.map(Number);
    if (major === undefined || minor === undefined || patch === undefined) {
      return version;
    }

    switch (bumpType) {
      case 'major':
        return `${major + 1}.0.0`;
      case 'minor':
        return `${major}.${minor + 1}.0`;
      case 'patch':
        return `${major}.${minor}.${patch + 1}`;
      default:
        return version;
    }
  }

  parseVersion(version: string): { major: number; minor: number; patch: number } | null {
    const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    
    const [, major, minor, patch] = match;
    if (major === undefined || minor === undefined || patch === undefined) return null;
    
    return {
      major: parseInt(major, 10),
      minor: parseInt(minor, 10),
      patch: parseInt(patch, 10),
    };
  }
}

export const semverAnalyzerService = new SemverAnalyzerService();
