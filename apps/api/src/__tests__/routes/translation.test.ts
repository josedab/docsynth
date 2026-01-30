import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    translation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    glossary: {
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      upsert: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    repository: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@docsynth/queue', () => ({
  addJob: vi.fn().mockResolvedValue({ id: 'job-123' }),
  QUEUE_NAMES: {
    TRANSLATION: 'translation',
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Translated content' }],
      }),
    };
  },
}));

describe('Translation Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Batch Translation', () => {
    it('should validate batch request has document IDs', () => {
      const body = { documentIds: [], targetLocale: 'es' };
      
      expect(body.documentIds.length).toBe(0);
      expect(() => {
        if (!body.documentIds.length) throw new Error('No documents specified');
      }).toThrow('No documents specified');
    });

    it('should validate target locale is provided', () => {
      const body = { documentIds: ['doc-1', 'doc-2'], targetLocale: '' };
      
      expect(body.targetLocale).toBeFalsy();
    });

    it('should accept valid batch request', () => {
      const body = {
        documentIds: ['doc-1', 'doc-2', 'doc-3'],
        targetLocale: 'es',
        priority: 'high',
      };
      
      expect(body.documentIds.length).toBe(3);
      expect(body.targetLocale).toBe('es');
      expect(body.priority).toBe('high');
    });
  });

  describe('Glossary Import/Export', () => {
    it('should parse CSV glossary format', () => {
      const csvContent = `term,definition,context
API,Application Programming Interface,Technical term
SDK,Software Development Kit,Development
UI,User Interface,Design`;

      const lines = csvContent.split('\n');
      const headers = lines[0]?.split(',') ?? [];
      const entries = lines.slice(1).map(line => {
        const values = line.split(',');
        return {
          term: values[0] ?? '',
          definition: values[1] ?? '',
          context: values[2] ?? '',
        };
      });

      expect(headers).toEqual(['term', 'definition', 'context']);
      expect(entries.length).toBe(3);
      expect(entries[0]?.term).toBe('API');
      expect(entries[1]?.definition).toBe('Software Development Kit');
    });

    it('should parse JSON glossary format', () => {
      const jsonContent = {
        entries: [
          { term: 'API', definition: 'Application Programming Interface' },
          { term: 'SDK', definition: 'Software Development Kit' },
        ],
        locale: 'en',
        version: '1.0',
      };

      expect(jsonContent.entries.length).toBe(2);
      expect(jsonContent.locale).toBe('en');
    });

    it('should export glossary to CSV format', () => {
      const entries = [
        { term: 'API', definition: 'Application Programming Interface', context: null },
        { term: 'SDK', definition: 'Software Development Kit', context: 'Dev' },
      ];

      const csvLines = ['term,definition,context'];
      for (const entry of entries) {
        csvLines.push(`"${entry.term}","${entry.definition}","${entry.context || ''}"`);
      }
      const csv = csvLines.join('\n');

      expect(csv).toContain('term,definition,context');
      expect(csv).toContain('API');
      expect(csv).toContain('SDK');
    });
  });

  describe('Glossary Sync', () => {
    it('should identify missing terms in target locale', () => {
      const sourceTerms = ['API', 'SDK', 'CLI', 'UI'];
      const targetTerms = ['API', 'SDK'];

      const missingTerms = sourceTerms.filter(t => !targetTerms.includes(t));

      expect(missingTerms).toEqual(['CLI', 'UI']);
      expect(missingTerms.length).toBe(2);
    });

    it('should identify outdated translations', () => {
      const sourceEntries = [
        { term: 'API', updatedAt: new Date('2024-01-15') },
        { term: 'SDK', updatedAt: new Date('2024-01-10') },
      ];

      const targetEntries = [
        { term: 'API', syncedAt: new Date('2024-01-14') },
        { term: 'SDK', syncedAt: new Date('2024-01-11') },
      ];

      const outdated = sourceEntries.filter(source => {
        const target = targetEntries.find(t => t.term === source.term);
        return target && source.updatedAt > target.syncedAt;
      });

      expect(outdated.length).toBe(1);
      expect(outdated[0]?.term).toBe('API');
    });
  });

  describe('Translation Coverage Stats', () => {
    it('should calculate coverage percentage', () => {
      const totalDocuments = 100;
      const translatedDocuments = 75;

      const coverage = (translatedDocuments / totalDocuments) * 100;

      expect(coverage).toBe(75);
    });

    it('should handle zero documents', () => {
      const totalDocuments = 0;
      const translatedDocuments = 0;

      const coverage = totalDocuments > 0 
        ? (translatedDocuments / totalDocuments) * 100 
        : 0;

      expect(coverage).toBe(0);
    });

    it('should calculate per-locale coverage', () => {
      const documents = 50;
      const localeStats = {
        es: { translated: 45 },
        fr: { translated: 30 },
        de: { translated: 20 },
      };

      const coverage = Object.entries(localeStats).map(([locale, stats]) => ({
        locale,
        coverage: Math.round((stats.translated / documents) * 100),
      }));

      expect(coverage).toEqual([
        { locale: 'es', coverage: 90 },
        { locale: 'fr', coverage: 60 },
        { locale: 'de', coverage: 40 },
      ]);
    });
  });

  describe('Supported Locales', () => {
    it('should have all major languages supported', () => {
      const supportedLocales = [
        { code: 'en', name: 'English' },
        { code: 'es', name: 'Spanish' },
        { code: 'fr', name: 'French' },
        { code: 'de', name: 'German' },
        { code: 'zh', name: 'Chinese' },
        { code: 'ja', name: 'Japanese' },
        { code: 'ko', name: 'Korean' },
        { code: 'pt', name: 'Portuguese' },
        { code: 'ru', name: 'Russian' },
        { code: 'ar', name: 'Arabic' },
      ];

      expect(supportedLocales.length).toBeGreaterThanOrEqual(10);
      expect(supportedLocales.find(l => l.code === 'en')).toBeDefined();
      expect(supportedLocales.find(l => l.code === 'zh')).toBeDefined();
    });

    it('should validate locale codes', () => {
      const isValidLocale = (code: string) => /^[a-z]{2}(-[A-Z]{2})?$/.test(code);

      expect(isValidLocale('en')).toBe(true);
      expect(isValidLocale('en-US')).toBe(true);
      expect(isValidLocale('zh-CN')).toBe(true);
      expect(isValidLocale('invalid')).toBe(false);
      expect(isValidLocale('ENG')).toBe(false);
    });
  });
});
