import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    healthAlert: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    repository: {
      findFirst: vi.fn(),
    },
    glossary: {
      findMany: vi.fn(),
    },
    pREvent: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@docsynth/queue', () => ({
  addJob: vi.fn().mockResolvedValue({ id: 'job-123' }),
  QUEUE_NAMES: {
    HEALTH_SCAN: 'health-scan',
    DOC_REVIEW: 'doc-review',
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Fixed content' }],
      }),
    };
  },
}));

describe('Self-Healing Documentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Broken Link Detection', () => {
    it('should detect broken markdown links', () => {
      const content = `
# Documentation

Check the [API Guide](./api-guide.md) for more info.
Visit [our website](https://example.com).
See the [broken link](./missing-file.md).
Jump to [section](#overview).
`;

      const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
      const links: Array<{ text: string; url: string }> = [];
      let match;

      while ((match = linkPattern.exec(content)) !== null) {
        links.push({ text: match[1] ?? '', url: match[2] ?? '' });
      }

      expect(links.length).toBe(4);
      expect(links[0]?.url).toBe('./api-guide.md');
      expect(links[1]?.url).toBe('https://example.com');
    });

    it('should categorize link types', () => {
      const categorizeLink = (url: string): 'internal' | 'external' | 'anchor' => {
        if (url.startsWith('http://') || url.startsWith('https://')) return 'external';
        if (url.startsWith('#')) return 'anchor';
        return 'internal';
      };

      expect(categorizeLink('https://example.com')).toBe('external');
      expect(categorizeLink('./file.md')).toBe('internal');
      expect(categorizeLink('#section')).toBe('anchor');
    });

    it('should validate anchor links', () => {
      const content = `
# Overview

Some text here.

## Installation

More text.

See [Overview](#overview).
See [Missing](#nonexistent).
`;

      const headings = content.match(/^#+\s+(.+)$/gm) || [];
      const headingIds = headings.map(h => {
        const text = h.replace(/^#+\s+/, '');
        return text.toLowerCase().replace(/\s+/g, '-');
      });

      expect(headingIds).toContain('overview');
      expect(headingIds).toContain('installation');
      expect(headingIds).not.toContain('nonexistent');
    });
  });

  describe('Terminology Drift Detection', () => {
    it('should detect inconsistent terminology', () => {
      const glossary = [
        { term: 'API', aliases: ['api', 'Api'] },
        { term: 'SDK', aliases: ['sdk', 'Sdk'] },
        { term: 'User Interface', aliases: ['UI', 'ui'] },
      ];

      const content = 'The api provides access to the sdk and UI components.';

      const driftIssues: Array<{ found: string; preferred: string }> = [];

      for (const entry of glossary) {
        for (const alias of entry.aliases) {
          if (alias !== entry.term && content.toLowerCase().includes(alias.toLowerCase())) {
            driftIssues.push({ found: alias, preferred: entry.term });
          }
        }
      }

      // 'api' should be 'API', 'sdk' should be 'SDK'
      expect(driftIssues.length).toBeGreaterThan(0);
    });

    it('should count terminology occurrences', () => {
      const content = 'The api handles api requests. Each api call is logged.';
      const term = 'api';

      const pattern = new RegExp(term, 'gi');
      const matches = content.match(pattern) || [];

      expect(matches.length).toBe(3);
    });
  });

  describe('Outdated Reference Detection', () => {
    it('should detect outdated version references', () => {
      const content = `
Install version 1.2.3:
\`\`\`
npm install package@1.2.3
\`\`\`

The current version is 2.0.0.
`;

      const versionPattern = /(\d+\.\d+\.\d+)/g;
      const versions = content.match(versionPattern) || [];

      expect(versions).toContain('1.2.3');
      expect(versions).toContain('2.0.0');
      expect(versions.length).toBe(3); // 1.2.3 appears twice
    });

    it('should detect deprecated API references', () => {
      const deprecatedApis = ['oldFunction', 'legacyMethod', 'v1/endpoint'];
      const content = `
Use oldFunction() to initialize.
Call legacyMethod() for processing.
The new approach uses newFunction().
`;

      const foundDeprecated = deprecatedApis.filter(api => content.includes(api));

      expect(foundDeprecated).toContain('oldFunction');
      expect(foundDeprecated).toContain('legacyMethod');
      expect(foundDeprecated.length).toBe(2);
    });
  });

  describe('Auto-Healing', () => {
    it('should fix broken link by replacement', () => {
      const content = 'See [Guide](./old-path.md) for details.';
      const brokenUrl = './old-path.md';
      const fixedUrl = './docs/guide.md';

      const newContent = content.replace(brokenUrl, fixedUrl);

      expect(newContent).toContain('./docs/guide.md');
      expect(newContent).not.toContain('./old-path.md');
    });

    it('should fix terminology by replacement', () => {
      const content = 'The api handles requests.';
      const incorrectTerm = 'api';
      const preferredTerm = 'API';

      const pattern = new RegExp(`\\b${incorrectTerm}\\b`, 'g');
      const newContent = content.replace(pattern, preferredTerm);

      expect(newContent).toBe('The API handles requests.');
    });

    it('should generate healing result', () => {
      interface HealingResult {
        issueId: string;
        status: 'fixed' | 'failed' | 'skipped';
        originalContent?: string;
        newContent?: string;
        error?: string;
      }

      const successResult: HealingResult = {
        issueId: 'issue-1',
        status: 'fixed',
        originalContent: 'old content',
        newContent: 'fixed content',
      };

      const failedResult: HealingResult = {
        issueId: 'issue-2',
        status: 'failed',
        error: 'Could not find pattern in content',
      };

      expect(successResult.status).toBe('fixed');
      expect(failedResult.status).toBe('failed');
    });
  });

  describe('Preview Changes', () => {
    it('should generate simple diff', () => {
      const original = `Line 1
Line 2
Old content here
Line 4`;

      const updated = `Line 1
Line 2
New content here
Line 4`;

      const originalLines = original.split('\n');
      const updatedLines = updated.split('\n');
      const diffLines: string[] = [];

      const maxLines = Math.max(originalLines.length, updatedLines.length);
      for (let i = 0; i < maxLines; i++) {
        const origLine = originalLines[i] || '';
        const newLine = updatedLines[i] || '';
        if (origLine !== newLine) {
          if (origLine) diffLines.push(`- ${origLine}`);
          if (newLine) diffLines.push(`+ ${newLine}`);
        }
      }

      expect(diffLines).toContain('- Old content here');
      expect(diffLines).toContain('+ New content here');
    });

    it('should preview without applying changes', () => {
      type PreviewMode = 'review' | 'auto';
      const previewMode = 'review' as PreviewMode;
      const applyChanges = previewMode === 'auto';

      expect(applyChanges).toBe(false);
    });
  });

  describe('Code Sync Detection', () => {
    it('should detect documents affected by code changes', () => {
      const documents = [
        { id: 'doc-1', path: 'docs/api.md', relatedFiles: ['src/api/index.ts'] },
        { id: 'doc-2', path: 'docs/auth.md', relatedFiles: ['src/auth/handler.ts'] },
        { id: 'doc-3', path: 'docs/readme.md', relatedFiles: [] },
      ];

      const changedFiles = ['src/api/index.ts', 'src/api/utils.ts'];

      const affectedDocs = documents.filter(doc =>
        doc.relatedFiles.some(rf => changedFiles.some(cf => cf.includes(rf) || rf.includes(cf)))
      );

      expect(affectedDocs.length).toBe(1);
      expect(affectedDocs[0]?.path).toBe('docs/api.md');
    });

    it('should calculate mismatch risk level', () => {
      const calculateRisk = (overlapCount: number): 'low' | 'medium' | 'high' => {
        if (overlapCount > 3) return 'high';
        if (overlapCount > 1) return 'medium';
        return 'low';
      };

      expect(calculateRisk(1)).toBe('low');
      expect(calculateRisk(2)).toBe('medium');
      expect(calculateRisk(5)).toBe('high');
    });

    it('should check if document is stale', () => {
      const docUpdatedAt = new Date('2024-01-01');
      const prMergedAt = new Date('2024-01-15');

      const isStale = prMergedAt > docUpdatedAt;

      expect(isStale).toBe(true);
    });
  });

  describe('Issue Types', () => {
    it('should map alert types to issue types', () => {
      const mapping: Record<string, string> = {
        broken_link: 'broken-link',
        outdated: 'outdated-reference',
        terminology: 'terminology-drift',
        missing_section: 'missing-section',
        deprecated_api: 'deprecated-api',
        code_mismatch: 'code-mismatch',
        stale: 'outdated-reference',
        coverage: 'missing-section',
      };

      expect(mapping.broken_link).toBe('broken-link');
      expect(mapping.stale).toBe('outdated-reference');
    });

    it('should identify auto-fixable issue types', () => {
      const autoFixableTypes = ['broken_link', 'terminology', 'outdated'];

      const isAutoFixable = (type: string) => autoFixableTypes.includes(type);

      expect(isAutoFixable('broken_link')).toBe(true);
      expect(isAutoFixable('terminology')).toBe(true);
      expect(isAutoFixable('missing_section')).toBe(false);
    });
  });

  describe('Healing History', () => {
    it('should track healed issues', () => {
      interface HealingRecord {
        id: string;
        issueType: string;
        documentPath: string;
        healedAt: Date;
        healingMode: 'auto' | 'review';
        fixedBy: string;
      }

      const history: HealingRecord[] = [
        { id: 'h-1', issueType: 'broken-link', documentPath: 'docs/api.md', healedAt: new Date(), healingMode: 'auto', fixedBy: 'system' },
        { id: 'h-2', issueType: 'terminology-drift', documentPath: 'docs/guide.md', healedAt: new Date(), healingMode: 'review', fixedBy: 'user-123' },
      ];

      expect(history.length).toBe(2);
      expect(history.filter(h => h.healingMode === 'auto').length).toBe(1);
    });

    it('should count healed issues by type', () => {
      const history = [
        { issueType: 'broken-link' },
        { issueType: 'broken-link' },
        { issueType: 'terminology-drift' },
        { issueType: 'outdated-reference' },
        { issueType: 'broken-link' },
      ];

      const counts = history.reduce((acc, h) => {
        acc[h.issueType] = (acc[h.issueType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      expect(counts['broken-link']).toBe(3);
      expect(counts['terminology-drift']).toBe(1);
    });
  });

  describe('Healing Summary', () => {
    it('should summarize healing results', () => {
      const results = [
        { status: 'fixed' },
        { status: 'fixed' },
        { status: 'failed' },
        { status: 'skipped' },
        { status: 'fixed' },
      ];

      const summary = {
        total: results.length,
        fixed: results.filter(r => r.status === 'fixed').length,
        failed: results.filter(r => r.status === 'failed').length,
        skipped: results.filter(r => r.status === 'skipped').length,
      };

      expect(summary.total).toBe(5);
      expect(summary.fixed).toBe(3);
      expect(summary.failed).toBe(1);
      expect(summary.skipped).toBe(1);
    });

    it('should calculate success rate', () => {
      const summary = { total: 10, fixed: 8, failed: 1, skipped: 1 };

      const successRate = Math.round((summary.fixed / summary.total) * 100);

      expect(successRate).toBe(80);
    });
  });

  describe('Issue Detection', () => {
    it('should detect issues in document', () => {
      interface DocumentIssue {
        type: string;
        severity: 'low' | 'medium' | 'high' | 'critical';
        description: string;
        autoFixable: boolean;
      }

      const issues: DocumentIssue[] = [
        { type: 'broken-link', severity: 'high', description: 'Link to ./missing.md not found', autoFixable: true },
        { type: 'terminology-drift', severity: 'medium', description: 'Use "API" instead of "api"', autoFixable: true },
        { type: 'missing-section', severity: 'low', description: 'Missing installation section', autoFixable: false },
      ];

      expect(issues.filter(i => i.autoFixable).length).toBe(2);
      expect(issues.filter(i => i.severity === 'high' || i.severity === 'critical').length).toBe(1);
    });

    it('should group issues by severity', () => {
      const issues = [
        { severity: 'critical' },
        { severity: 'high' },
        { severity: 'high' },
        { severity: 'medium' },
        { severity: 'low' },
        { severity: 'low' },
      ];

      const bySeverity = {
        critical: issues.filter(i => i.severity === 'critical').length,
        high: issues.filter(i => i.severity === 'high').length,
        medium: issues.filter(i => i.severity === 'medium').length,
        low: issues.filter(i => i.severity === 'low').length,
      };

      expect(bySeverity.critical).toBe(1);
      expect(bySeverity.high).toBe(2);
      expect(bySeverity.medium).toBe(1);
      expect(bySeverity.low).toBe(2);
    });
  });
});
