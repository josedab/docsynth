import { describe, it, expect, vi, beforeEach } from 'vitest';

// Only mock @docsynth/utils (chunking.ts doesn't use database)
vi.mock('@docsynth/utils', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Chunking Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('chunkDocument', () => {
    it('should chunk a document into smaller pieces', async () => {
      const { chunkDocument, CHUNK_SIZE } = await import('../../services/chunking.js');

      const input = {
        content: 'A'.repeat(CHUNK_SIZE * 2 + 100),
        documentId: 'doc-1',
        repositoryId: 'repo-1',
        documentPath: 'README.md',
        documentType: 'README' as const,
        documentTitle: 'README',
      };

      const chunks = chunkDocument(input);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toHaveProperty('documentId', 'doc-1');
      expect(chunks[0]).toHaveProperty('repositoryId', 'repo-1');
      expect(chunks[0]).toHaveProperty('chunkIndex', 0);
      expect(chunks[0]).toHaveProperty('content');
      expect(chunks[0]).toHaveProperty('metadata');
    });

    it('should not chunk content smaller than chunk size', async () => {
      const { chunkDocument, CHUNK_SIZE } = await import('../../services/chunking.js');

      const input = {
        content: 'A'.repeat(CHUNK_SIZE - 100),
        documentId: 'doc-1',
        repositoryId: 'repo-1',
        documentPath: 'small.md',
        documentType: 'GUIDE' as const,
        documentTitle: 'Small Doc',
      };

      const chunks = chunkDocument(input);

      expect(chunks.length).toBe(1);
    });

    it('should split by markdown sections', async () => {
      const { chunkDocument } = await import('../../services/chunking.js');

      const content = `# Section 1

Content for section 1.

# Section 2

Content for section 2.`;

      const input = {
        content,
        documentId: 'doc-1',
        repositoryId: 'repo-1',
        documentPath: 'docs/guide.md',
        documentType: 'GUIDE' as const,
        documentTitle: 'Guide',
      };

      const chunks = chunkDocument(input);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]?.metadata).toHaveProperty('sectionHeading');
    });
  });

  describe('estimateTokenCount', () => {
    it('should estimate token count based on character length', async () => {
      const { estimateTokenCount } = await import('../../services/chunking.js');

      // Roughly 4 characters per token for English text
      const text = 'Hello world!'; // 12 characters
      const estimate = estimateTokenCount(text);

      expect(estimate).toBe(3); // ceil(12/4)
    });
  });

  describe('extractHighlights', () => {
    it('should extract sentences containing query terms', async () => {
      const { extractHighlights } = await import('../../services/chunking.js');

      const content = 'The quick brown fox jumps over the lazy dog. The cat sleeps. The fox runs fast.';
      const highlights = extractHighlights(content, 'fox jumps');

      expect(highlights.length).toBeGreaterThan(0);
      expect(highlights.some((h) => h.includes('fox'))).toBe(true);
    });

    it('should return empty array when no matches', async () => {
      const { extractHighlights } = await import('../../services/chunking.js');

      const content = 'The quick brown fox.';
      const highlights = extractHighlights(content, 'xyz abc');

      expect(highlights.length).toBe(0);
    });
  });

  describe('CHUNK constants', () => {
    it('should export expected constants', async () => {
      const { CHUNK_SIZE, CHUNK_OVERLAP } = await import('../../services/chunking.js');

      expect(CHUNK_SIZE).toBe(1000);
      expect(CHUNK_OVERLAP).toBe(200);
    });
  });
});
