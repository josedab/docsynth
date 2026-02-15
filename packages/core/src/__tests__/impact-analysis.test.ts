import { describe, it, expect } from 'vitest';
import {
  calculateImpactScore,
  classifyChange,
  scoreSeverity,
  createCodeDocMapping,
  findAffectedSections,
  generateBatchImpactReport,
  prioritiseSections,
  type ChangeEntry,
  type CodeEntity,
  type DocSection,
  type CodeDocMapping,
} from '../impact-analysis.js';
import {
  formatNotification,
  formatGitHubComment,
  formatSlackMessage,
  formatEmailBody,
  digestResults,
  severityTemplate,
  type NotificationOptions,
} from '../impact-notifications.js';

// ============================================================================
// Fixtures
// ============================================================================

function entity(name: string, kind: CodeEntity['kind'] = 'function'): CodeEntity {
  return { name, kind, filePath: `src/${name}.ts` };
}

function section(id: string, title: string, traffic?: number): DocSection {
  return { id, title, path: `/docs/${id}.md`, traffic };
}

function change(name: string, classification: ChangeEntry['classification']): ChangeEntry {
  return { entity: entity(name), classification };
}

function mappings(): CodeDocMapping[] {
  return [
    createCodeDocMapping(entity('createUser'), [section('api-users', 'Users API', 5000)]),
    createCodeDocMapping(entity('deleteUser'), [
      section('api-users', 'Users API', 5000),
      section('guide-admin', 'Admin Guide', 200),
    ]),
  ];
}

// ============================================================================
// Impact Scoring
// ============================================================================

describe('impact-analysis', () => {
  describe('calculateImpactScore', () => {
    it('should return 0 for no changes', () => {
      expect(calculateImpactScore([])).toBe(0);
    });

    it('should return 100 for all breaking changes', () => {
      const changes = [change('a', 'breaking'), change('b', 'breaking')];
      expect(calculateImpactScore(changes)).toBe(100);
    });

    it('should return lower score for internal changes', () => {
      const changes = [change('a', 'internal')];
      expect(calculateImpactScore(changes)).toBeLessThan(20);
    });

    it('should blend weights for mixed changes', () => {
      const changes = [change('a', 'breaking'), change('b', 'internal')];
      const score = calculateImpactScore(changes);
      expect(score).toBeGreaterThan(10);
      expect(score).toBeLessThan(100);
    });
  });

  // ============================================================================
  // Change Classification
  // ============================================================================

  describe('classifyChange', () => {
    it('should classify breaking changes', () => {
      expect(classifyChange('removed export function foo')).toBe('breaking');
      expect(classifyChange('BREAKING change in API')).toBe('breaking');
    });

    it('should classify deprecation', () => {
      expect(classifyChange('@deprecated use bar instead')).toBe('deprecation');
    });

    it('should classify bugfix', () => {
      expect(classifyChange('fix: resolve null pointer')).toBe('bugfix');
    });

    it('should classify enhancement', () => {
      expect(classifyChange('add new feature for export')).toBe('enhancement');
    });

    it('should default to internal', () => {
      expect(classifyChange('refactor variable naming')).toBe('internal');
    });
  });

  // ============================================================================
  // Severity
  // ============================================================================

  describe('scoreSeverity', () => {
    it('should return critical for score >= 80', () => {
      expect(scoreSeverity(80)).toBe('critical');
      expect(scoreSeverity(100)).toBe('critical');
    });

    it('should return high for score >= 60', () => {
      expect(scoreSeverity(60)).toBe('high');
    });

    it('should return medium for score >= 30', () => {
      expect(scoreSeverity(30)).toBe('medium');
    });

    it('should return low for score < 30', () => {
      expect(scoreSeverity(10)).toBe('low');
      expect(scoreSeverity(0)).toBe('low');
    });
  });

  // ============================================================================
  // Mapping & Affected Sections
  // ============================================================================

  describe('findAffectedSections', () => {
    it('should find sections mapped to changed entities', () => {
      const changes = [change('deleteUser', 'breaking')];
      const sections = findAffectedSections(changes, mappings());
      expect(sections).toHaveLength(2);
      expect(sections.map((s) => s.id)).toContain('api-users');
      expect(sections.map((s) => s.id)).toContain('guide-admin');
    });

    it('should return empty when no mappings match', () => {
      const changes = [change('unknownFn', 'enhancement')];
      expect(findAffectedSections(changes, mappings())).toHaveLength(0);
    });

    it('should deduplicate sections', () => {
      const changes = [change('createUser', 'enhancement'), change('deleteUser', 'breaking')];
      const sections = findAffectedSections(changes, mappings());
      const ids = sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ============================================================================
  // Batch Report
  // ============================================================================

  describe('generateBatchImpactReport', () => {
    it('should generate a report with results per section', () => {
      const changes = [change('createUser', 'enhancement'), change('deleteUser', 'breaking')];
      const report = generateBatchImpactReport(changes, mappings());

      expect(report.totalChanges).toBe(2);
      expect(report.results.length).toBeGreaterThan(0);
      expect(report.summary).toContain('impacted');
      expect(report.generatedAt).toBeTruthy();
    });

    it('should report no impact when no mappings match', () => {
      const changes = [change('unknown', 'internal')];
      const report = generateBatchImpactReport(changes, mappings());
      expect(report.results).toHaveLength(0);
      expect(report.summary).toContain('No documentation impact');
    });
  });

  // ============================================================================
  // Prioritisation
  // ============================================================================

  describe('prioritiseSections', () => {
    it('should sort by score and traffic', () => {
      const results = [
        {
          section: section('low', 'Low Traffic', 100),
          score: 50,
          severity: 'medium' as const,
          changes: [],
        },
        {
          section: section('high', 'High Traffic', 10000),
          score: 50,
          severity: 'medium' as const,
          changes: [],
        },
      ];
      const sorted = prioritiseSections(results);
      expect(sorted[0]!.section.id).toBe('high');
    });
  });
});

// ============================================================================
// Notification Formatting
// ============================================================================

describe('impact-notifications', () => {
  const sampleReport = () =>
    generateBatchImpactReport(
      [change('createUser', 'enhancement'), change('deleteUser', 'breaking')],
      mappings()
    );

  describe('formatGitHubComment', () => {
    it('should produce markdown with table', () => {
      const report = sampleReport();
      const md = formatGitHubComment(report.results, report, {
        channel: 'github',
        repoFullName: 'acme/docs',
        prNumber: 42,
      });

      expect(md).toContain('## 📄 Documentation Impact Analysis');
      expect(md).toContain('| Section');
      expect(md).toContain('acme/docs#42');
    });
  });

  describe('formatSlackMessage', () => {
    it('should produce Block Kit structure', () => {
      const report = sampleReport();
      const msg = formatSlackMessage(report.results, report, {
        channel: 'slack',
        prNumber: 7,
      });

      expect(msg.blocks[0]!.type).toBe('header');
      expect(msg.blocks.length).toBeGreaterThan(1);
    });
  });

  describe('formatEmailBody', () => {
    it('should produce plain text email', () => {
      const report = sampleReport();
      const email = formatEmailBody(report.results, report, {
        channel: 'email',
        repoFullName: 'acme/docs',
        prNumber: 10,
      });

      expect(email).toContain('Documentation Impact Analysis');
      expect(email).toContain('#10');
    });
  });

  describe('formatNotification', () => {
    it('should dispatch to the correct channel formatter', () => {
      const report = sampleReport();
      const opts: NotificationOptions = { channel: 'github' };
      const result = formatNotification(report, opts);
      expect(result).toContain('Documentation Impact Analysis');
    });
  });

  describe('digestResults', () => {
    it('should return all results when 5 or fewer', () => {
      const results = [
        { section: section('a', 'A'), score: 10, severity: 'low' as const, changes: [] },
      ];
      expect(digestResults(results)).toHaveLength(1);
    });

    it('should trim to top 5 by severity when more than 5', () => {
      const results = Array.from({ length: 8 }, (_, i) => ({
        section: section(`s${i}`, `Section ${i}`),
        score: 50,
        severity: (i < 2 ? 'critical' : 'low') as const,
        changes: [],
      }));
      const digested = digestResults(results);
      expect(digested).toHaveLength(5);
      expect(digested[0]!.severity).toBe('critical');
    });
  });

  describe('severityTemplate', () => {
    it('should return template for each level', () => {
      expect(severityTemplate('critical')).toContain('CRITICAL');
      expect(severityTemplate('low')).toContain('LOW');
    });
  });
});
