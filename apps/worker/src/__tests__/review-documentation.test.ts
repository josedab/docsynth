import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewDocumentationService, type ReviewThread, type ReviewComment } from '../services/review-documentation.js';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    pRReviewThread: {
      upsert: vi.fn().mockResolvedValue({ id: 'thread-1' }),
    },
    pRReviewComment: {
      upsert: vi.fn().mockResolvedValue({ id: 'comment-1' }),
    },
    reviewRationale: {
      create: vi.fn().mockResolvedValue({ id: 'rationale-1' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    reviewKnowledgeBase: {
      create: vi.fn().mockResolvedValue({ id: 'knowledge-1' }),
    },
  },
}));

vi.mock('@docsynth/utils', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  getAnthropicClient: vi.fn().mockReturnValue(null),
}));

const createMockComment = (overrides: Partial<ReviewComment> = {}): ReviewComment => ({
  id: 1,
  body: 'This is a review comment.',
  user: { login: 'reviewer1' },
  created_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

const createMockThread = (overrides: Partial<ReviewThread> = {}): ReviewThread => ({
  threadId: 'thread-123',
  filePath: 'src/services/auth.ts',
  lineStart: 10,
  lineEnd: 20,
  comments: [
    createMockComment({ id: 1, body: 'First comment from reviewer' }),
    createMockComment({ id: 2, body: 'Reply from author', user: { login: 'author1' }, in_reply_to_id: 1 }),
  ],
  status: 'resolved',
  ...overrides,
});

describe('ReviewDocumentationService', () => {
  let service: ReviewDocumentationService;

  beforeEach(() => {
    service = new ReviewDocumentationService();
    vi.clearAllMocks();
  });

  describe('processReviewThread', () => {
    it('should skip threads with fewer than 2 comments', async () => {
      const thread = createMockThread({
        comments: [createMockComment()],
      });

      const result = await service.processReviewThread(
        'repo-1',
        123,
        'Fix authentication',
        thread
      );

      expect(result.isSignificant).toBe(false);
      expect(result.rationaleId).toBeNull();
    });

    it('should skip threads with minimal content', async () => {
      const thread = createMockThread({
        comments: [
          createMockComment({ body: 'ok' }),
          createMockComment({ body: 'done' }),
        ],
      });

      const result = await service.processReviewThread(
        'repo-1',
        123,
        'Minor fix',
        thread
      );

      expect(result.isSignificant).toBe(false);
      expect(result.rationaleId).toBeNull();
    });

    it('should process threads with sufficient content', async () => {
      const thread = createMockThread({
        comments: [
          createMockComment({
            id: 1,
            body: 'This authentication approach has a significant security issue. We should use JWT tokens instead of session cookies for the API endpoints.',
          }),
          createMockComment({
            id: 2,
            body: 'Good point. I will refactor to use JWT. This will also help with our microservices architecture since tokens are stateless.',
            in_reply_to_id: 1,
          }),
        ],
      });

      const result = await service.processReviewThread(
        'repo-1',
        123,
        'Implement new auth system',
        thread
      );

      // Without AI client, should return non-significant
      expect(result.threadId).toBe('thread-123');
      expect(result.isSignificant).toBe(false);
    });
  });

  describe('helper methods', () => {
    describe('determineAuthorType', () => {
      it('should identify first commenter as reviewer', () => {
        const comments = [
          createMockComment({ id: 1, user: { login: 'reviewer1' } }),
          createMockComment({ id: 2, user: { login: 'author1' } }),
        ];

        // Access private method via type assertion for testing
        const determineAuthorType = (service as unknown as {
          determineAuthorType: (comment: ReviewComment, allComments: ReviewComment[]) => string;
        }).determineAuthorType.bind(service);

        expect(determineAuthorType(comments[0]!, comments)).toBe('reviewer');
        expect(determineAuthorType(comments[1]!, comments)).toBe('author');
      });
    });

    describe('determineCommentType', () => {
      const determineCommentType = (body: string): string => {
        const service = new ReviewDocumentationService();
        return (service as unknown as {
          determineCommentType: (body: string) => string;
        }).determineCommentType(body);
      };

      it('should detect approval comments', () => {
        expect(determineCommentType('LGTM!')).toBe('approval');
        expect(determineCommentType('Looks good, approved')).toBe('approval');
      });

      it('should detect suggestion comments', () => {
        expect(determineCommentType('```suggestion\nconst x = 1;\n```')).toBe('suggestion');
        expect(determineCommentType('My suggestion would be...')).toBe('suggestion');
      });

      it('should detect change request comments', () => {
        expect(determineCommentType('Please change this to use async/await')).toBe('request_changes');
        expect(determineCommentType('This should be refactored')).toBe('request_changes');
        expect(determineCommentType('This needs to be updated')).toBe('request_changes');
      });

      it('should default to comment type', () => {
        expect(determineCommentType('Interesting approach here')).toBe('comment');
        expect(determineCommentType('Why did you choose this pattern?')).toBe('comment');
      });
    });
  });

  describe('buildKnowledgeBase', () => {
    it('should return zero entries when no rationales exist', async () => {
      const result = await service.buildKnowledgeBase('repo-1');
      expect(result.entriesCreated).toBe(0);
    });
  });
});
