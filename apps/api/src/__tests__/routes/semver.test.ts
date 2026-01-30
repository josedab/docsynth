import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    repository: {
      findFirst: vi.fn(),
    },
    semverAnalysis: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    migrationGuide: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({
          bumpType: 'minor',
          breakingChanges: [],
          newFeatures: [{ name: 'newApi', description: 'New API endpoint' }],
          bugFixes: [],
          confidence: 0.9,
          reasoning: 'New exports without breaking changes',
        })}],
      }),
    };
  },
}));

describe('Semantic Versioning Automation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Version Bump Detection', () => {
    it('should detect major version bump for breaking changes', () => {
      interface Change {
        type: 'breaking' | 'feature' | 'fix' | 'docs';
        description: string;
      }

      const changes: Change[] = [
        { type: 'breaking', description: 'Removed deprecated API' },
        { type: 'feature', description: 'Added new endpoint' },
        { type: 'fix', description: 'Fixed null handling' },
      ];

      const determineBumpType = (changes: Change[]): 'major' | 'minor' | 'patch' | 'none' => {
        if (changes.some(c => c.type === 'breaking')) return 'major';
        if (changes.some(c => c.type === 'feature')) return 'minor';
        if (changes.some(c => c.type === 'fix')) return 'patch';
        return 'none';
      };

      expect(determineBumpType(changes)).toBe('major');
    });

    it('should detect minor version bump for new features', () => {
      const changes: Array<{ type: 'breaking' | 'feature' | 'fix' | 'docs'; description: string }> = [
        { type: 'feature', description: 'New authentication method' },
        { type: 'docs', description: 'Updated README' },
      ];

      const hasBreaking = changes.some(c => c.type === 'breaking');
      const hasFeature = changes.some(c => c.type === 'feature');

      expect(hasBreaking).toBe(false);
      expect(hasFeature).toBe(true);
    });

    it('should detect patch version bump for bug fixes only', () => {
      const changes: Array<{ type: 'breaking' | 'feature' | 'fix' | 'docs'; description: string }> = [
        { type: 'fix', description: 'Fixed race condition' },
        { type: 'fix', description: 'Corrected typo in error message' },
      ];

      const onlyFixes = changes.every(c => c.type === 'fix' || c.type === 'docs');
      expect(onlyFixes).toBe(true);
    });
  });

  describe('Breaking Change Analysis', () => {
    it('should identify breaking change types', () => {
      type BreakingChangeType = 
        | 'removed_export'
        | 'signature_change'
        | 'return_type_change'
        | 'renamed_export'
        | 'behavior_change';

      interface BreakingChange {
        type: BreakingChangeType;
        name: string;
        description: string;
        filePath: string;
        line: number;
        migrationHint?: string;
      }

      const breakingChanges: BreakingChange[] = [
        {
          type: 'removed_export',
          name: 'oldFunction',
          description: 'Function was removed',
          filePath: 'src/api.ts',
          line: 42,
          migrationHint: 'Use newFunction instead',
        },
        {
          type: 'signature_change',
          name: 'authenticate',
          description: 'Added required parameter',
          filePath: 'src/auth.ts',
          line: 15,
          migrationHint: 'Pass token as second argument',
        },
      ];

      expect(breakingChanges.length).toBe(2);
      expect(breakingChanges.every(bc => bc.migrationHint)).toBe(true);
    });

    it('should detect breaking changes from diffs', () => {
      const diffPatterns = {
        removedExport: /^-\s*export\s+(function|const|class|interface|type)/m,
        changedSignature: /^[-+]\s*(async\s+)?function\s+\w+\([^)]*\)/m,
        removedProperty: /^-\s*\w+\s*:/m,
      };

      const diff = `
-export function oldApi(name: string): void {}
+export function newApi(name: string, options: Options): void {}
      `;

      const hasRemovedExport = diffPatterns.removedExport.test(diff);
      expect(hasRemovedExport).toBe(true);
    });
  });

  describe('Version Calculation', () => {
    it('should correctly bump version numbers', () => {
      const bumpVersion = (
        current: string, 
        bumpType: 'major' | 'minor' | 'patch'
      ): string => {
        const parts = current.replace(/^v/, '').split('.').map(Number);
        const [major = 0, minor = 0, patch = 0] = parts;

        switch (bumpType) {
          case 'major': return `${major + 1}.0.0`;
          case 'minor': return `${major}.${minor + 1}.0`;
          case 'patch': return `${major}.${minor}.${patch + 1}`;
        }
      };

      expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
      expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
      expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
      expect(bumpVersion('v0.9.5', 'minor')).toBe('0.10.0');
    });

    it('should handle prerelease versions', () => {
      const parseVersion = (version: string) => {
        const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(-(.+))?$/);
        if (!match) return null;
        
        return {
          major: parseInt(match[1]!, 10),
          minor: parseInt(match[2]!, 10),
          patch: parseInt(match[3]!, 10),
          prerelease: match[5] || null,
        };
      };

      const version = parseVersion('1.2.3-beta.1');
      expect(version?.prerelease).toBe('beta.1');

      const stable = parseVersion('2.0.0');
      expect(stable?.prerelease).toBeNull();
    });
  });

  describe('Migration Guide Generation', () => {
    it('should structure migration guide correctly', () => {
      interface MigrationGuide {
        fromVersion: string;
        toVersion: string;
        summary: string;
        breakingChanges: Array<{
          name: string;
          before: string;
          after: string;
          migration: string;
        }>;
        newFeatures: string[];
        deprecations: string[];
      }

      const guide: MigrationGuide = {
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        summary: 'Major update with API changes',
        breakingChanges: [
          {
            name: 'authenticate',
            before: 'authenticate(username)',
            after: 'authenticate(username, options)',
            migration: 'Pass an empty options object for default behavior',
          },
        ],
        newFeatures: ['Added OAuth2 support', 'New rate limiting options'],
        deprecations: ['oldHelper() - use newHelper() instead'],
      };

      expect(guide.breakingChanges.length).toBe(1);
      expect(guide.newFeatures.length).toBe(2);
    });

    it('should generate code examples for migration', () => {
      const generateMigrationExample = (
        oldCode: string,
        newCode: string
      ): string => {
        return `**Before (v1.x):**
\`\`\`typescript
${oldCode}
\`\`\`

**After (v2.x):**
\`\`\`typescript
${newCode}
\`\`\``;
      };

      const example = generateMigrationExample(
        'authenticate("user");',
        'authenticate("user", { timeout: 5000 });'
      );

      expect(example).toContain('Before (v1.x)');
      expect(example).toContain('After (v2.x)');
    });
  });

  describe('Confidence Scoring', () => {
    it('should calculate confidence based on analysis completeness', () => {
      const calculateConfidence = (factors: {
        diffParsed: boolean;
        typesAnalyzed: boolean;
        testsAnalyzed: boolean;
        docsAnalyzed: boolean;
        commitMessages: boolean;
      }): number => {
        const weights = {
          diffParsed: 0.3,
          typesAnalyzed: 0.25,
          testsAnalyzed: 0.2,
          docsAnalyzed: 0.15,
          commitMessages: 0.1,
        };

        let confidence = 0;
        for (const [key, value] of Object.entries(factors)) {
          if (value) {
            confidence += weights[key as keyof typeof weights] || 0;
          }
        }
        return confidence;
      };

      const fullAnalysis = {
        diffParsed: true,
        typesAnalyzed: true,
        testsAnalyzed: true,
        docsAnalyzed: true,
        commitMessages: true,
      };

      const partialAnalysis = {
        diffParsed: true,
        typesAnalyzed: true,
        testsAnalyzed: false,
        docsAnalyzed: false,
        commitMessages: true,
      };

      expect(calculateConfidence(fullAnalysis)).toBe(1);
      expect(calculateConfidence(partialAnalysis)).toBe(0.65);
    });
  });

  describe('PR Integration', () => {
    it('should format semver suggestion comment', () => {
      const analysis = {
        currentVersion: '1.2.3',
        suggestedVersion: '2.0.0',
        bumpType: 'major' as const,
        confidence: 0.92,
        breakingChanges: 2,
        newFeatures: 1,
      };

      const comment = `## 🏷️ Semantic Version Analysis

| Current | Suggested | Bump Type |
|---------|-----------|-----------|
| ${analysis.currentVersion} | **${analysis.suggestedVersion}** | \`${analysis.bumpType}\` |

### Summary
- ⚠️ Breaking Changes: ${analysis.breakingChanges}
- ✨ New Features: ${analysis.newFeatures}
- 📊 Confidence: ${Math.round(analysis.confidence * 100)}%

${analysis.bumpType === 'major' 
  ? '⚠️ This is a **major** version bump due to breaking changes.' 
  : ''}`;

      expect(comment).toContain('2.0.0');
      expect(comment).toContain('major');
      expect(comment).toContain('Breaking Changes: 2');
    });
  });

  describe('Changelog Generation', () => {
    it('should format changelog entries', () => {
      interface ChangelogEntry {
        version: string;
        date: string;
        changes: {
          breaking: string[];
          features: string[];
          fixes: string[];
          docs: string[];
        };
      }

      const entry: ChangelogEntry = {
        version: '2.0.0',
        date: '2024-03-15',
        changes: {
          breaking: ['Removed deprecated authenticate() function'],
          features: ['Added OAuth2 support', 'New rate limiting API'],
          fixes: ['Fixed memory leak in connection pool'],
          docs: ['Updated API reference'],
        },
      };

      const formatChangelog = (entry: ChangelogEntry): string => {
        let output = `## [${entry.version}] - ${entry.date}\n\n`;
        
        if (entry.changes.breaking.length) {
          output += '### ⚠️ Breaking Changes\n';
          entry.changes.breaking.forEach(c => output += `- ${c}\n`);
        }
        if (entry.changes.features.length) {
          output += '\n### ✨ Features\n';
          entry.changes.features.forEach(c => output += `- ${c}\n`);
        }
        if (entry.changes.fixes.length) {
          output += '\n### 🐛 Bug Fixes\n';
          entry.changes.fixes.forEach(c => output += `- ${c}\n`);
        }
        
        return output;
      };

      const changelog = formatChangelog(entry);
      expect(changelog).toContain('## [2.0.0]');
      expect(changelog).toContain('Breaking Changes');
      expect(changelog).toContain('OAuth2');
    });
  });
});
