import { describe, it, expect } from 'vitest';
import { docHealthScorerService, type DocHealthInput } from '../services/doc-health-scorer.js';
import type { Document, DocumentType } from '@docsynth/types';

const createMockDocument = (overrides: Partial<Document> = {}): Document => ({
  id: 'doc-1',
  repositoryId: 'repo-1',
  type: 'README' as DocumentType,
  path: 'README.md',
  title: 'Test Document',
  content: `# My Project

This is a test project with some documentation.

## Features

- Feature 1
- Feature 2
- Feature 3

## Installation

\`\`\`bash
npm install my-project
\`\`\`

## API Reference

The main function is \`doSomething()\`.

## Examples

\`\`\`javascript
import { doSomething } from 'my-project';
doSomething();
\`\`\`
`,
  version: 1,
  generatedFromPR: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
  ...overrides,
});

describe('DocHealthScorerService', () => {
  describe('calculateHealthScore', () => {
    it('should return healthy status for fresh documentation', () => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago

      const input: DocHealthInput = {
        document: createMockDocument({ updatedAt: recentDate }),
        repositoryLastActivity: now,
        codeChangeDates: [new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)], // Code changed 7 days ago
        existingDocTypes: ['README', 'API_REFERENCE'] as DocumentType[],
      };

      const result = docHealthScorerService.calculateHealthScore(input);

      expect(result.status).toBe('healthy');
      expect(result.scores.freshness).toBeGreaterThanOrEqual(90);
      expect(result.scores.overall).toBeGreaterThanOrEqual(70);
    });

    it('should return needs-attention status for moderately outdated docs', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000); // 45 days ago

      const input: DocHealthInput = {
        document: createMockDocument({ updatedAt: oldDate }),
        repositoryLastActivity: now,
        codeChangeDates: [new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)], // Code changed 5 days ago
        existingDocTypes: ['README'] as DocumentType[],
      };

      const result = docHealthScorerService.calculateHealthScore(input);

      expect(result.status).toBe('needs-attention');
      expect(result.scores.freshness).toBeLessThan(70);
    });

    it('should return critical status for very outdated docs', () => {
      const now = new Date();
      const veryOldDate = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000); // 120 days ago

      const input: DocHealthInput = {
        document: createMockDocument({
          updatedAt: veryOldDate,
          content: 'Minimal content',
        }),
        repositoryLastActivity: now,
        codeChangeDates: [now],
        existingDocTypes: ['README'] as DocumentType[],
      };

      const result = docHealthScorerService.calculateHealthScore(input);

      expect(result.status).toBe('critical');
      expect(result.scores.overall).toBeLessThan(40);
    });

    it('should score completeness based on content analysis', () => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

      // Document with good content
      const goodDoc = createMockDocument({ updatedAt: recentDate });
      const goodInput: DocHealthInput = {
        document: goodDoc,
        repositoryLastActivity: now,
        codeChangeDates: [],
        existingDocTypes: ['README'] as DocumentType[],
      };

      // Document with minimal content
      const minimalDoc = createMockDocument({
        updatedAt: recentDate,
        content: 'Short content.',
      });
      const minimalInput: DocHealthInput = {
        document: minimalDoc,
        repositoryLastActivity: now,
        codeChangeDates: [],
        existingDocTypes: ['README'] as DocumentType[],
      };

      const goodResult = docHealthScorerService.calculateHealthScore(goodInput);
      const minimalResult = docHealthScorerService.calculateHealthScore(minimalInput);

      expect(goodResult.scores.completeness).toBeGreaterThan(minimalResult.scores.completeness);
      expect(goodResult.factors.hasExamples).toBe(true);
      expect(minimalResult.factors.hasExamples).toBe(false);
    });

    it('should generate appropriate recommendations for outdated docs', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);

      const input: DocHealthInput = {
        document: createMockDocument({
          updatedAt: oldDate,
          content: 'Minimal content without examples.',
        }),
        repositoryLastActivity: now,
        codeChangeDates: [new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)],
        existingDocTypes: ['README'] as DocumentType[],
      };

      const result = docHealthScorerService.calculateHealthScore(input);

      expect(result.recommendations).toContain('Update documentation to reflect recent code changes');
      expect(result.recommendations).toContain('Consider a comprehensive documentation review');
    });

    it('should recommend adding code examples when missing', () => {
      const now = new Date();

      const input: DocHealthInput = {
        document: createMockDocument({
          updatedAt: now,
          content: `# Project

This is a project without code examples. It has some text but no code blocks at all.
Just paragraphs of text explaining things without actual code.
`,
        }),
        repositoryLastActivity: now,
        codeChangeDates: [],
        existingDocTypes: ['README'] as DocumentType[],
      };

      const result = docHealthScorerService.calculateHealthScore(input);

      expect(result.factors.hasExamples).toBe(false);
      expect(result.factors.codeBlockCount).toBe(0);
    });

    it('should correctly count code blocks', () => {
      const now = new Date();

      const input: DocHealthInput = {
        document: createMockDocument({ updatedAt: now }),
        repositoryLastActivity: now,
        codeChangeDates: [],
        existingDocTypes: ['README'] as DocumentType[],
      };

      const result = docHealthScorerService.calculateHealthScore(input);

      expect(result.factors.codeBlockCount).toBe(2); // Two code blocks in mock document
    });
  });

  describe('calculateRepositoryHealth', () => {
    it('should calculate repository health from multiple documents', () => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const doc1Input: DocHealthInput = {
        document: createMockDocument({ id: 'doc-1', updatedAt: recentDate }),
        repositoryLastActivity: now,
        codeChangeDates: [],
        existingDocTypes: ['README', 'API_REFERENCE'] as DocumentType[],
      };

      const doc2Input: DocHealthInput = {
        document: createMockDocument({
          id: 'doc-2',
          type: 'API_REFERENCE',
          updatedAt: recentDate,
        }),
        repositoryLastActivity: now,
        codeChangeDates: [],
        existingDocTypes: ['README', 'API_REFERENCE'] as DocumentType[],
      };

      const score1 = docHealthScorerService.calculateHealthScore(doc1Input);
      const score2 = docHealthScorerService.calculateHealthScore(doc2Input);

      const repoHealth = docHealthScorerService.calculateRepositoryHealth(
        'repo-1',
        'test-repo',
        [score1, score2],
        ['README', 'API_REFERENCE'] as DocumentType[]
      );

      expect(repoHealth.documentCount).toBe(2);
      expect(repoHealth.overallScore).toBeGreaterThanOrEqual(70);
      expect(repoHealth.healthDistribution.healthy).toBe(2);
      expect(repoHealth.healthDistribution.needsAttention).toBe(0);
      expect(repoHealth.healthDistribution.critical).toBe(0);
    });

    it('should identify coverage gaps', () => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const input: DocHealthInput = {
        document: createMockDocument({ updatedAt: recentDate }),
        repositoryLastActivity: now,
        codeChangeDates: [],
        existingDocTypes: ['README'] as DocumentType[],
      };

      const score = docHealthScorerService.calculateHealthScore(input);

      const repoHealth = docHealthScorerService.calculateRepositoryHealth(
        'repo-1',
        'test-repo',
        [score],
        ['README'] as DocumentType[] // Only README exists
      );

      // Should detect missing expected doc types
      expect(repoHealth.coverageGaps).toContain('API_REFERENCE');
      expect(repoHealth.coverageGaps).toContain('CHANGELOG');
      expect(repoHealth.coverageGaps).toContain('ARCHITECTURE');
    });

    it('should generate top issues for unhealthy repos', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);

      const input: DocHealthInput = {
        document: createMockDocument({
          updatedAt: oldDate,
          content: 'Minimal.',
        }),
        repositoryLastActivity: now,
        codeChangeDates: [now],
        existingDocTypes: ['README'] as DocumentType[],
      };

      const score = docHealthScorerService.calculateHealthScore(input);

      const repoHealth = docHealthScorerService.calculateRepositoryHealth(
        'repo-1',
        'test-repo',
        [score],
        ['README'] as DocumentType[]
      );

      expect(repoHealth.topIssues.length).toBeGreaterThan(0);
      // Should mention coverage gaps
      expect(repoHealth.topIssues.some((issue) => issue.includes('Missing'))).toBe(true);
    });

    it('should handle empty document list', () => {
      const repoHealth = docHealthScorerService.calculateRepositoryHealth(
        'repo-1',
        'test-repo',
        [],
        [] as DocumentType[]
      );

      expect(repoHealth.documentCount).toBe(0);
      expect(repoHealth.overallScore).toBe(0);
      expect(repoHealth.healthDistribution.healthy).toBe(0);
    });
  });
});
