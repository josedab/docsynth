import { describe, it, expect, vi } from 'vitest';
import type { PRPreviewInput } from '../services/pr-preview.js';

// Mock Anthropic before importing the service
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [
      {
        type: 'text',
        text: 'This PR adds new user authentication features. Documentation will be updated to reflect the new API endpoints and authentication flow.',
      },
    ],
  });
  
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
      };
    },
  };
});

// Import service after mock is set up
const { prPreviewService } = await import('../services/pr-preview.js');

const createMockPRInput = (overrides: Partial<PRPreviewInput> = {}): PRPreviewInput => ({
  prNumber: 123,
  prTitle: 'Add user authentication',
  prBody: 'This PR adds user authentication with JWT tokens.',
  authorUsername: 'developer',
  changes: [
    {
      path: 'src/auth/login.ts',
      changeType: 'added',
      additions: 100,
      deletions: 0,
      semanticChanges: [
        {
          type: 'new-function',
          name: 'login',
          location: { file: 'src/auth/login.ts', startLine: 1, endLine: 50 },
          description: 'New login function',
          breaking: false,
        },
        {
          type: 'new-export',
          name: 'LoginService',
          location: { file: 'src/auth/login.ts', startLine: 52, endLine: 100 },
          description: 'New login service class',
          breaking: false,
        },
      ],
    },
  ],
  documentationImpact: {
    affectedDocs: ['docs/api.md'],
    newDocsNeeded: ['API_REFERENCE'],
    updatePriority: 'high',
  },
  repositoryName: 'my-project',
  existingDocs: ['README.md', 'docs/api.md'],
  ...overrides,
});

describe('PRPreviewService', () => {
  describe('generatePreview', () => {
    it('should generate a preview with suggested doc types', async () => {
      const input = createMockPRInput();
      const result = await prPreviewService.generatePreview(input);

      expect(result.suggestedDocTypes).toContain('API_REFERENCE');
      expect(result.previewComment).toContain('DocSynth Documentation Preview');
      expect(result.previewComment).toContain('Planned Documentation Changes');
    });

    it('should detect API changes and suggest API_REFERENCE', async () => {
      const input = createMockPRInput({
        changes: [
          {
            path: 'src/api/users.ts',
            changeType: 'modified',
            additions: 50,
            deletions: 10,
            semanticChanges: [
              {
                type: 'api-change',
                name: 'updateUser',
                location: { file: 'src/api/users.ts', startLine: 10, endLine: 30 },
                description: 'Changed API signature',
                breaking: true,
              },
            ],
          },
        ],
        documentationImpact: {
          affectedDocs: [],
          newDocsNeeded: [],
          updatePriority: 'medium',
        },
      });

      const result = await prPreviewService.generatePreview(input);

      expect(result.suggestedDocTypes).toContain('API_REFERENCE');
      expect(result.suggestedDocTypes).toContain('CHANGELOG');
    });

    it('should detect breaking changes and include in preview', async () => {
      const input = createMockPRInput({
        changes: [
          {
            path: 'src/api/users.ts',
            changeType: 'modified',
            additions: 20,
            deletions: 30,
            semanticChanges: [
              {
                type: 'removal',
                name: 'deleteUserV1',
                location: { file: 'src/api/users.ts', startLine: 1, endLine: 10 },
                description: 'Removed deprecated endpoint',
                breaking: true,
              },
            ],
          },
        ],
      });

      const result = await prPreviewService.generatePreview(input);

      expect(result.previewComment).toContain('Breaking Changes Detected');
      expect(result.suggestedDocTypes).toContain('CHANGELOG');
    });

    it('should suggest README for significant changes', async () => {
      const input = createMockPRInput({
        changes: [
          {
            path: 'src/core/engine.ts',
            changeType: 'added',
            additions: 200,
            deletions: 0,
            semanticChanges: [
              {
                type: 'new-class',
                name: 'CoreEngine',
                location: { file: 'src/core/engine.ts', startLine: 1, endLine: 200 },
                description: 'New core engine',
                breaking: false,
              },
              {
                type: 'new-function',
                name: 'initEngine',
                location: { file: 'src/core/engine.ts', startLine: 50, endLine: 80 },
                description: 'Initialize engine',
                breaking: false,
              },
              {
                type: 'new-export',
                name: 'EngineConfig',
                location: { file: 'src/core/engine.ts', startLine: 85, endLine: 100 },
                description: 'Engine configuration',
                breaking: false,
              },
            ],
          },
        ],
        documentationImpact: {
          affectedDocs: [],
          newDocsNeeded: [],
          updatePriority: 'high',
        },
      });

      const result = await prPreviewService.generatePreview(input);

      expect(result.suggestedDocTypes).toContain('README');
    });

    it('should count creates and updates correctly', async () => {
      const input = createMockPRInput({
        documentationImpact: {
          affectedDocs: ['docs/api.md', 'docs/new-feature.md'],
          newDocsNeeded: ['TUTORIAL', 'GUIDE'],
          updatePriority: 'high',
        },
        existingDocs: ['docs/api.md'], // Only api.md exists
      });

      const result = await prPreviewService.generatePreview(input);

      // 2 from newDocsNeeded + 1 new from affectedDocs (new-feature.md)
      expect(result.estimatedChanges.creates).toBeGreaterThanOrEqual(2);
      // 1 existing doc updated
      expect(result.estimatedChanges.updates).toBeGreaterThanOrEqual(1);
    });

    it('should include affected docs in preview', async () => {
      const input = createMockPRInput({
        documentationImpact: {
          affectedDocs: ['docs/api.md', 'docs/guide.md'],
          newDocsNeeded: [],
          updatePriority: 'medium',
        },
      });

      const result = await prPreviewService.generatePreview(input);

      expect(result.affectedDocs).toContain('docs/api.md');
      expect(result.affectedDocs).toContain('docs/guide.md');
      expect(result.previewComment).toContain('Affected Documentation Files');
    });

    it('should format preview comment with emoji and tables', async () => {
      const input = createMockPRInput();
      const result = await prPreviewService.generatePreview(input);

      // Check for markdown formatting
      expect(result.previewComment).toContain('## 📚');
      expect(result.previewComment).toContain('| Type | Count |');
      expect(result.previewComment).toContain('🆕 New Docs');
      expect(result.previewComment).toContain('✏️ Updates');
    });

    it('should include help section with commands', async () => {
      const input = createMockPRInput();
      const result = await prPreviewService.generatePreview(input);

      expect(result.previewComment).toContain('/docsynth skip');
      expect(result.previewComment).toContain('/docsynth include');
      expect(result.previewComment).toContain('/docsynth exclude');
    });

    it('should include docsynth marker comment for identification', async () => {
      const input = createMockPRInput();
      const result = await prPreviewService.generatePreview(input);

      expect(result.previewComment).toContain('<!-- docsynth-preview -->');
    });

    it('should handle deprecations', async () => {
      const input = createMockPRInput({
        changes: [
          {
            path: 'src/api/v1.ts',
            changeType: 'modified',
            additions: 5,
            deletions: 50,
            semanticChanges: [
              {
                type: 'deprecation',
                name: 'oldEndpoint',
                location: { file: 'src/api/v1.ts', startLine: 1, endLine: 50 },
                description: 'Deprecated old endpoint',
                breaking: false,
              },
            ],
          },
        ],
        documentationImpact: {
          affectedDocs: [],
          newDocsNeeded: [],
          updatePriority: 'low',
        },
      });

      const result = await prPreviewService.generatePreview(input);

      expect(result.suggestedDocTypes).toContain('CHANGELOG');
    });
  });
});
