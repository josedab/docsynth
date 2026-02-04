import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Killer Features Tests
 * 
 * Tests for the utility methods of the new killer documentation features.
 * Note: These tests focus on pure utility functions that don't require
 * external client initialization to avoid mocking complexity.
 */

// Mock dependencies before any imports
vi.mock('@docsynth/database', () => ({
  prisma: {
    driftPrediction: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    document: { findMany: vi.fn(), findUnique: vi.fn() },
    repository: { findUnique: vi.fn() },
  },
}));

vi.mock('@docsynth/utils', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@docsynth/queue', () => ({
  addJob: vi.fn().mockResolvedValue(undefined),
  QUEUE_NAMES: {},
}));

vi.mock('../../services/embeddings', () => ({
  generateEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
}));

describe('Drift Prediction Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateProbability', () => {
    it('should return low probability for recently updated docs', async () => {
      const { driftPredictionService } = await import('../../services/drift-prediction.service.js');
      
      const signals = {
        codeChanges: 0,
        apiChanges: 0,
        dependencyChanges: 0,
        timeSinceUpdate: 1,
      };

      const probability = driftPredictionService.calculateProbability(signals);
      
      expect(probability).toBeLessThan(0.2);
    });

    it('should return high probability for stale docs with many changes', async () => {
      const { driftPredictionService } = await import('../../services/drift-prediction.service.js');
      
      const signals = {
        codeChanges: 50,
        apiChanges: 20,
        dependencyChanges: 10,
        timeSinceUpdate: 90,
      };

      const probability = driftPredictionService.calculateProbability(signals);
      
      expect(probability).toBeGreaterThan(0.5);
    });
  });

  describe('categorizeRisk', () => {
    it('should categorize as high risk for probability >= 0.7', async () => {
      const { driftPredictionService } = await import('../../services/drift-prediction.service.js');
      
      expect(driftPredictionService.categorizeRisk(0.85)).toBe('high');
      expect(driftPredictionService.categorizeRisk(0.7)).toBe('high');
    });

    it('should categorize as medium risk for 0.4 <= probability < 0.7', async () => {
      const { driftPredictionService } = await import('../../services/drift-prediction.service.js');
      
      expect(driftPredictionService.categorizeRisk(0.5)).toBe('medium');
      expect(driftPredictionService.categorizeRisk(0.4)).toBe('medium');
    });

    it('should categorize as low risk for probability < 0.4', async () => {
      const { driftPredictionService } = await import('../../services/drift-prediction.service.js');
      
      expect(driftPredictionService.categorizeRisk(0.2)).toBe('low');
      expect(driftPredictionService.categorizeRisk(0.0)).toBe('low');
    });
  });
});

describe('Citation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', async () => {
      const { citationService } = await import('../../services/citation.service.js');
      
      const vec = [0.5, 0.5, 0.5];
      const similarity = citationService.cosineSimilarity(vec, vec);
      
      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', async () => {
      const { citationService } = await import('../../services/citation.service.js');
      
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];
      const similarity = citationService.cosineSimilarity(vec1, vec2);
      
      expect(similarity).toBeCloseTo(0, 5);
    });

    it('should return value between 0 and 1 for similar vectors', async () => {
      const { citationService } = await import('../../services/citation.service.js');
      
      const vec1 = [0.8, 0.3, 0.5];
      const vec2 = [0.7, 0.4, 0.6];
      const similarity = citationService.cosineSimilarity(vec1, vec2);
      
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });
  });

  describe('formatCitation', () => {
    it('should format citation with document path and line numbers', async () => {
      const { citationService } = await import('../../services/citation.service.js');
      
      const citation = citationService.formatCitation({
        documentPath: 'docs/api.md',
        lineStart: 10,
        lineEnd: 15,
        relevanceScore: 0.85,
      });
      
      expect(citation).toContain('docs/api.md');
      expect(citation).toContain('10');
    });

    it('should handle citations without line numbers', async () => {
      const { citationService } = await import('../../services/citation.service.js');
      
      const citation = citationService.formatCitation({
        documentPath: 'README.md',
        relevanceScore: 0.9,
      });
      
      expect(citation).toContain('README.md');
    });
  });
});

describe('Review Workflow Service Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test standalone utility functions that don't require Anthropic client
  describe('calculateStatus', () => {
    it('should return approved if all reviewers approved', async () => {
      const { reviewWorkflowService } = await import('../../services/review-workflow.service.js');
      
      const assignments = [
        { decision: 'approve', status: 'completed' },
        { decision: 'approve', status: 'completed' },
      ];
      
      const status = reviewWorkflowService.calculateStatus(assignments);
      
      expect(status).toBe('approved');
    });

    it('should return changes_requested if any reviewer requested changes', async () => {
      const { reviewWorkflowService } = await import('../../services/review-workflow.service.js');
      
      const assignments = [
        { decision: 'approve', status: 'completed' },
        { decision: 'request_changes', status: 'completed' },
      ];
      
      const status = reviewWorkflowService.calculateStatus(assignments);
      
      expect(status).toBe('changes_requested');
    });

    it('should return in_review if reviews are pending', async () => {
      const { reviewWorkflowService } = await import('../../services/review-workflow.service.js');
      
      const assignments = [
        { decision: 'approve', status: 'completed' },
        { decision: null, status: 'pending' },
      ];
      
      const status = reviewWorkflowService.calculateStatus(assignments);
      
      expect(status).toBe('in_review');
    });
  });

  describe('validateReviewType', () => {
    it('should accept valid review types', async () => {
      const { reviewWorkflowService } = await import('../../services/review-workflow.service.js');
      
      expect(reviewWorkflowService.isValidReviewType('content')).toBe(true);
      expect(reviewWorkflowService.isValidReviewType('technical')).toBe(true);
      expect(reviewWorkflowService.isValidReviewType('style')).toBe(true);
      expect(reviewWorkflowService.isValidReviewType('all')).toBe(true);
    });

    it('should reject invalid review types', async () => {
      const { reviewWorkflowService } = await import('../../services/review-workflow.service.js');
      
      expect(reviewWorkflowService.isValidReviewType('invalid')).toBe(false);
      expect(reviewWorkflowService.isValidReviewType('')).toBe(false);
    });
  });
});

describe('Playground Service Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDefaultFiles', () => {
    it('should return appropriate default files for javascript runtime', async () => {
      const { playgroundService } = await import('../../services/playground.service.js');
      
      const files = playgroundService.getDefaultFiles('javascript', 'blank');
      
      expect(files).toHaveProperty('index.js');
      expect(typeof files['index.js']).toBe('string');
    });

    it('should return appropriate default files for python runtime', async () => {
      const { playgroundService } = await import('../../services/playground.service.js');
      
      const files = playgroundService.getDefaultFiles('python', 'blank');
      
      expect(files).toHaveProperty('main.py');
    });

    it('should return HTML template files', async () => {
      const { playgroundService } = await import('../../services/playground.service.js');
      
      const files = playgroundService.getDefaultFiles('html', 'blank');
      
      expect(files).toHaveProperty('index.html');
    });
  });

  describe('validateRuntime', () => {
    it('should accept valid runtimes', async () => {
      const { playgroundService } = await import('../../services/playground.service.js');
      
      expect(playgroundService.isValidRuntime('javascript')).toBe(true);
      expect(playgroundService.isValidRuntime('typescript')).toBe(true);
      expect(playgroundService.isValidRuntime('python')).toBe(true);
      expect(playgroundService.isValidRuntime('html')).toBe(true);
    });

    it('should reject invalid runtimes', async () => {
      const { playgroundService } = await import('../../services/playground.service.js');
      
      expect(playgroundService.isValidRuntime('java')).toBe(false);
      expect(playgroundService.isValidRuntime('ruby')).toBe(false);
    });
  });
});

// Note: Tests for OnboardingService and MultiAgentDocService are skipped
// because they require mocking the Anthropic client which is initialized
// at class instantiation time. Consider refactoring these services to
// use dependency injection for better testability.
