import { describe, it, expect } from 'vitest';
import { ADRGeneratorService } from '../services/adr-generator.js';
import { TutorialGeneratorService } from '../services/tutorial-generator.js';
import { ArchitectureGeneratorService } from '../services/architecture-generator.js';
import { InlineCommentsGeneratorService } from '../services/inline-comments-generator.js';
import type { FileChange, SemanticChange } from '@docsynth/types';

describe('Documentation Generators', () => {
  describe('ADRGeneratorService', () => {
    const service = new ADRGeneratorService();

    it('should determine ADR is needed for breaking changes', () => {
      const changes: FileChange[] = [
        {
          path: 'src/api.ts',
          changeType: 'modified',
          additions: 50,
          deletions: 20,
          semanticChanges: [
            {
              type: 'api-change',
              name: 'updateUser',
              location: { file: 'src/api.ts', startLine: 10, endLine: 20 },
              description: 'Changed API signature',
              breaking: true,
            },
          ],
        },
      ];

      expect(service.shouldGenerateADR(changes)).toBe(true);
    });

    it('should not require ADR for minor changes', () => {
      const changes: FileChange[] = [
        {
          path: 'src/utils.ts',
          changeType: 'modified',
          additions: 5,
          deletions: 2,
          semanticChanges: [
            {
              type: 'logic-change',
              name: 'formatDate',
              location: { file: 'src/utils.ts', startLine: 10, endLine: 12 },
              description: 'Fixed date formatting',
              breaking: false,
            },
          ],
        },
      ];

      expect(service.shouldGenerateADR(changes)).toBe(false);
    });

    it('should calculate next ADR number correctly', () => {
      const existingADRs = ['0001-initial-architecture.md', '0002-database-choice.md', '0003-api-design.md'];
      expect(service.getNextADRNumber(existingADRs)).toBe(4);
    });

    it('should return 1 for empty ADR list', () => {
      expect(service.getNextADRNumber([])).toBe(1);
    });
  });

  describe('TutorialGeneratorService', () => {
    const service = new TutorialGeneratorService();

    it('should determine tutorial is needed for new features', () => {
      const changes: FileChange[] = [
        {
          path: 'src/api/routes.ts',
          changeType: 'added',
          additions: 100,
          deletions: 0,
          semanticChanges: [
            {
              type: 'new-export',
              name: 'createUser',
              location: { file: 'src/api/routes.ts', startLine: 1, endLine: 50 },
              description: 'New user creation endpoint',
              breaking: false,
            },
          ],
        },
      ];

      expect(service.shouldGenerateTutorial(changes)).toBe(true);
    });

    it('should not require tutorial for internal changes', () => {
      const changes: FileChange[] = [
        {
          path: 'src/internal/helper.ts',
          changeType: 'modified',
          additions: 10,
          deletions: 5,
          semanticChanges: [
            {
              type: 'logic-change',
              name: 'internalHelper',
              location: { file: 'src/internal/helper.ts', startLine: 1, endLine: 10 },
              description: 'Refactored internal helper',
              breaking: false,
            },
          ],
        },
      ];

      expect(service.shouldGenerateTutorial(changes)).toBe(false);
    });

    it('should extract code examples from changes', () => {
      const changes: FileChange[] = [
        {
          path: 'src/index.ts',
          changeType: 'modified',
          additions: 50,
          deletions: 0,
          semanticChanges: [
            {
              type: 'new-export',
              name: 'MyClass',
              location: { file: 'src/index.ts', startLine: 1, endLine: 30 },
              description: 'New class for handling data',
              breaking: false,
            },
            {
              type: 'new-function',
              name: 'processData',
              location: { file: 'src/index.ts', startLine: 35, endLine: 50 },
              description: 'Function to process data',
              breaking: false,
            },
          ],
        },
      ];

      const examples = service.extractCodeExamples(changes);
      expect(examples).toHaveLength(2);
      expect(examples[0]?.language).toBe('typescript');
    });
  });

  describe('ArchitectureGeneratorService', () => {
    const service = new ArchitectureGeneratorService();

    it('should detect structural changes requiring arch doc update', () => {
      const changes: FileChange[] = [
        {
          path: 'package.json',
          changeType: 'modified',
          additions: 5,
          deletions: 2,
          semanticChanges: [],
        },
      ];

      expect(service.shouldUpdateArchDocs(changes)).toBe(true);
    });

    it('should detect new module changes', () => {
      const changes: FileChange[] = [
        {
          path: 'src/new-module/index.ts',
          changeType: 'added',
          additions: 100,
          deletions: 0,
          semanticChanges: [
            {
              type: 'new-module' as SemanticChange['type'],
              name: 'new-module',
              location: { file: 'src/new-module/index.ts', startLine: 1, endLine: 100 },
              description: 'New module added',
              breaking: false,
            },
          ],
        },
      ];

      expect(service.shouldUpdateArchDocs(changes)).toBe(true);
    });

    it('should not require update for minor changes', () => {
      const changes: FileChange[] = [
        {
          path: 'src/utils/format.ts',
          changeType: 'modified',
          additions: 3,
          deletions: 2,
          semanticChanges: [
            {
              type: 'logic-change',
              name: 'format',
              location: { file: 'src/utils/format.ts', startLine: 5, endLine: 10 },
              description: 'Minor formatting fix',
              breaking: false,
            },
          ],
        },
      ];

      expect(service.shouldUpdateArchDocs(changes)).toBe(false);
    });
  });

  describe('InlineCommentsGeneratorService', () => {
    const service = new InlineCommentsGeneratorService();

    it('should detect files needing comments', () => {
      const change: FileChange = {
        path: 'src/algorithm.ts',
        changeType: 'modified',
        additions: 50,
        deletions: 10,
        semanticChanges: [
          {
            type: 'logic-change',
            name: 'complexAlgorithm',
            location: { file: 'src/algorithm.ts', startLine: 1, endLine: 50 },
            description: 'Complex algorithm implementation',
            breaking: false,
          },
        ],
      };

      expect(service.shouldGenerateComments(change)).toBe(true);
    });

    it('should skip test files', () => {
      const change: FileChange = {
        path: 'src/algorithm.test.ts',
        changeType: 'modified',
        additions: 50,
        deletions: 10,
        semanticChanges: [
          {
            type: 'new-function',
            name: 'testFunction',
            location: { file: 'src/algorithm.test.ts', startLine: 1, endLine: 50 },
            description: 'Test function',
            breaking: false,
          },
        ],
      };

      expect(service.shouldGenerateComments(change)).toBe(false);
    });

    it('should detect language from file extension', () => {
      expect(service.detectLanguage('file.ts')).toBe('typescript');
      expect(service.detectLanguage('file.tsx')).toBe('typescript');
      expect(service.detectLanguage('file.js')).toBe('javascript');
      expect(service.detectLanguage('file.py')).toBe('python');
      expect(service.detectLanguage('file.go')).toBe('go');
      expect(service.detectLanguage('file.rs')).toBe('rust');
      expect(service.detectLanguage('file.unknown')).toBe('text');
    });

    it('should get correct comment syntax for languages', () => {
      const tsSyntax = service.getCommentSyntax('typescript');
      expect(tsSyntax.single).toBe('//');
      expect(tsSyntax.multiStart).toBe('/**');

      const pySyntax = service.getCommentSyntax('python');
      expect(pySyntax.single).toBe('#');
      expect(pySyntax.multiStart).toBe('"""');
    });
  });
});
