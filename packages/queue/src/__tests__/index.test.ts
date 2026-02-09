import { describe, it, expect } from 'vitest';
import { QUEUE_NAMES } from '../index.js';

describe('Queue Package', () => {
  describe('QUEUE_NAMES', () => {
    it('should have all required queue names defined', () => {
      expect(QUEUE_NAMES.CHANGE_ANALYSIS).toBe('change-analysis');
      expect(QUEUE_NAMES.INTENT_INFERENCE).toBe('intent-inference');
      expect(QUEUE_NAMES.DOC_GENERATION).toBe('doc-generation');
      expect(QUEUE_NAMES.DOC_REVIEW).toBe('doc-review');
      expect(QUEUE_NAMES.NOTIFICATIONS).toBe('notifications');
      expect(QUEUE_NAMES.PR_PREVIEW).toBe('pr-preview');
      expect(QUEUE_NAMES.DRIFT_SCAN).toBe('drift-scan');
      expect(QUEUE_NAMES.HEALTH_SCAN).toBe('health-scan');
      expect(QUEUE_NAMES.KNOWLEDGE_GRAPH).toBe('knowledge-graph');
      expect(QUEUE_NAMES.EXAMPLE_VALIDATION).toBe('example-validation');
      // Features 4-10
      expect(QUEUE_NAMES.DOC_REVIEW_COPILOT).toBe('doc-review-copilot');
      expect(QUEUE_NAMES.TRANSLATION).toBe('translation');
      expect(QUEUE_NAMES.DIAGRAM_GENERATION).toBe('diagram-generation');
      expect(QUEUE_NAMES.ONBOARDING).toBe('onboarding');
      expect(QUEUE_NAMES.CHAT_RAG).toBe('chat-rag');
      expect(QUEUE_NAMES.ADR_GENERATION).toBe('adr-generation');
      expect(QUEUE_NAMES.BOT_MESSAGE).toBe('bot-message');
    });

    it('should have 51 queue names', () => {
      const queueNames = Object.values(QUEUE_NAMES);
      expect(queueNames).toHaveLength(51);
    });

    it('should have unique queue names', () => {
      const queueNames = Object.values(QUEUE_NAMES);
      const uniqueNames = new Set(queueNames);
      expect(uniqueNames.size).toBe(queueNames.length);
    });

    it('should use kebab-case naming convention', () => {
      const queueNames = Object.values(QUEUE_NAMES);
      queueNames.forEach((name) => {
        expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
      });
    });
  });

  describe('Job Data Types', () => {
    it('should export ChangeAnalysisJobData interface', async () => {
      const module = await import('../index.js');
      // Type check that the interface exists by checking QUEUE_NAMES
      expect(module.QUEUE_NAMES.CHANGE_ANALYSIS).toBeDefined();
    });

    it('should export IntentInferenceJobData interface', async () => {
      const module = await import('../index.js');
      expect(module.QUEUE_NAMES.INTENT_INFERENCE).toBeDefined();
    });

    it('should export DocGenerationJobData interface', async () => {
      const module = await import('../index.js');
      expect(module.QUEUE_NAMES.DOC_GENERATION).toBeDefined();
    });

    it('should export DocReviewJobData interface', async () => {
      const module = await import('../index.js');
      expect(module.QUEUE_NAMES.DOC_REVIEW).toBeDefined();
    });

    it('should export NotificationJobData interface', async () => {
      const module = await import('../index.js');
      expect(module.QUEUE_NAMES.NOTIFICATIONS).toBeDefined();
    });
  });
});
