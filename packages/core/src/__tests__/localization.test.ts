import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectChanges,
  calculateStaleness,
  prioritizeUpdates,
  generateStalenessReport,
  type TranslationChange,
  type StalenessInfo,
} from '../translation-change-detector.js';
import {
  triggerCascade,
  getCascadeStatus,
  updateCascadeItem,
  generateCascadeReport,
  clearCascades,
  type CascadeConfig,
} from '../translation-cascade.js';
import {
  createGlossary,
  addEntry,
  detectTerms,
  validateConsistency,
  exportGlossary,
  importGlossary,
  getGlossaryCoverage,
  type GlossaryEntry,
} from '../glossary-management.js';

// ============================================================================
// translation-change-detector
// ============================================================================

describe('translation-change-detector', () => {
  describe('detectChanges', () => {
    it('returns empty for identical sections', () => {
      const sections = [{ sectionId: 's1', content: 'hello world' }];
      expect(detectChanges(sections, sections)).toEqual([]);
    });

    it('detects a minor edit', () => {
      const old = [
        {
          sectionId: 's1',
          content: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10',
        },
      ];
      const updated = [
        {
          sectionId: 's1',
          content: 'line1\nline2-changed\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10',
        },
      ];
      const changes = detectChanges(old, updated);
      expect(changes).toHaveLength(1);
      expect(changes[0].magnitude).toBe('minor');
      expect(changes[0].changedLines).toBe(1);
    });

    it('detects a rewrite', () => {
      const old = [{ sectionId: 's1', content: 'a\nb\nc\nd' }];
      const updated = [{ sectionId: 's1', content: 'w\nx\ny\nz' }];
      const changes = detectChanges(old, updated);
      expect(changes).toHaveLength(1);
      expect(changes[0].magnitude).toBe('rewrite');
    });

    it('ignores new sections without a previous version', () => {
      const old = [{ sectionId: 's1', content: 'old' }];
      const updated = [{ sectionId: 's2', content: 'new' }];
      expect(detectChanges(old, updated)).toEqual([]);
    });
  });

  describe('calculateStaleness', () => {
    it('identifies stale translations', () => {
      const records = [
        {
          sectionId: 's1',
          language: 'es',
          sourceUpdatedAt: new Date('2024-06-15'),
          translationUpdatedAt: new Date('2024-06-10'),
        },
      ];
      const changes: TranslationChange[] = [
        {
          sectionId: 's1',
          oldContent: '',
          newContent: '',
          magnitude: 'moderate',
          changedLines: 5,
          totalLines: 10,
        },
      ];
      const stale = calculateStaleness(records, changes);
      expect(stale).toHaveLength(1);
      expect(stale[0].staleDays).toBe(5);
      expect(stale[0].magnitude).toBe('moderate');
    });

    it('excludes up-to-date translations', () => {
      const records = [
        {
          sectionId: 's1',
          language: 'fr',
          sourceUpdatedAt: new Date('2024-06-01'),
          translationUpdatedAt: new Date('2024-06-05'),
        },
      ];
      expect(calculateStaleness(records, [])).toEqual([]);
    });
  });

  describe('prioritizeUpdates', () => {
    it('sorts by composite score descending', () => {
      const stale: StalenessInfo[] = [
        {
          sectionId: 's1',
          language: 'es',
          sourceUpdatedAt: new Date(),
          translationUpdatedAt: new Date(),
          staleDays: 5,
          magnitude: 'minor',
        },
        {
          sectionId: 's2',
          language: 'de',
          sourceUpdatedAt: new Date(),
          translationUpdatedAt: new Date(),
          staleDays: 10,
          magnitude: 'major',
        },
      ];
      const traffic = [
        { sectionId: 's1', dailyViews: 500 },
        { sectionId: 's2', dailyViews: 800 },
      ];
      const langWeights = [
        { language: 'es', importance: 0.9 },
        { language: 'de', importance: 0.7 },
      ];
      const result = prioritizeUpdates(stale, traffic, langWeights);
      expect(result).toHaveLength(2);
      expect(result[0].sectionId).toBe('s2');
      expect(result[0].score).toBeGreaterThan(result[1].score);
    });
  });

  describe('generateStalenessReport', () => {
    it('generates a report for a language', () => {
      const items: StalenessInfo[] = [
        {
          sectionId: 's1',
          language: 'ja',
          sourceUpdatedAt: new Date(),
          translationUpdatedAt: new Date(),
          staleDays: 3,
          magnitude: 'minor',
        },
        {
          sectionId: 's2',
          language: 'ja',
          sourceUpdatedAt: new Date(),
          translationUpdatedAt: new Date(),
          staleDays: 7,
          magnitude: 'major',
        },
        {
          sectionId: 's3',
          language: 'ko',
          sourceUpdatedAt: new Date(),
          translationUpdatedAt: new Date(),
          staleDays: 1,
          magnitude: 'minor',
        },
      ];
      const report = generateStalenessReport('ja', items, 10);
      expect(report.language).toBe('ja');
      expect(report.staleSections).toBe(2);
      expect(report.totalSections).toBe(10);
      expect(report.averageStaleDays).toBe(5);
      expect(report.generatedAt).toBeTruthy();
    });
  });
});

// ============================================================================
// translation-cascade
// ============================================================================

describe('translation-cascade', () => {
  beforeEach(() => clearCascades());

  const defaultConfig: CascadeConfig = {
    strategy: 'immediate',
    priorityLanguages: ['es'],
    batchIntervalHours: 24,
    partialUpdates: true,
  };

  describe('triggerCascade', () => {
    it('creates a cascade with in_progress items for immediate strategy', () => {
      const cascade = triggerCascade(
        'doc-1',
        [{ sectionId: 's1', content: 'hello' }],
        ['es', 'fr'],
        defaultConfig
      );
      expect(cascade.cascadeId).toMatch(/^cascade-/);
      expect(cascade.items).toHaveLength(2);
      expect(cascade.items.every((i) => i.status === 'in_progress')).toBe(true);
    });

    it('priority languages appear first', () => {
      const cascade = triggerCascade(
        'doc-1',
        [{ sectionId: 's1', content: 'hello' }],
        ['fr', 'es', 'de'],
        { ...defaultConfig, priorityLanguages: ['es'] }
      );
      expect(cascade.items[0].language).toBe('es');
    });

    it('manual strategy keeps all items pending', () => {
      const cascade = triggerCascade(
        'doc-1',
        [{ sectionId: 's1', content: 'hello' }],
        ['es', 'fr'],
        { ...defaultConfig, strategy: 'manual' }
      );
      expect(cascade.items.every((i) => i.status === 'pending')).toBe(true);
    });

    it('batched strategy starts only priority languages', () => {
      const cascade = triggerCascade(
        'doc-1',
        [{ sectionId: 's1', content: 'hello' }],
        ['es', 'fr'],
        { ...defaultConfig, strategy: 'batched', priorityLanguages: ['es'] }
      );
      const es = cascade.items.find((i) => i.language === 'es')!;
      const fr = cascade.items.find((i) => i.language === 'fr')!;
      expect(es.status).toBe('in_progress');
      expect(fr.status).toBe('pending');
    });
  });

  describe('getCascadeStatus', () => {
    it('returns undefined for unknown cascade', () => {
      expect(getCascadeStatus('nope')).toBeUndefined();
    });

    it('returns the cascade after creation', () => {
      const cascade = triggerCascade(
        'doc-1',
        [{ sectionId: 's1', content: '' }],
        ['es'],
        defaultConfig
      );
      expect(getCascadeStatus(cascade.cascadeId)).toBeDefined();
    });
  });

  describe('updateCascadeItem', () => {
    it('updates item status', () => {
      const cascade = triggerCascade(
        'doc-1',
        [{ sectionId: 's1', content: '' }],
        ['es'],
        defaultConfig
      );
      const ok = updateCascadeItem(cascade.cascadeId, 's1', 'es', 'completed');
      expect(ok).toBe(true);
      const updated = getCascadeStatus(cascade.cascadeId)!;
      expect(updated.items[0].status).toBe('completed');
      expect(updated.items[0].completedAt).toBeInstanceOf(Date);
    });

    it('returns false for unknown cascade', () => {
      expect(updateCascadeItem('nope', 's1', 'es', 'completed')).toBe(false);
    });
  });

  describe('generateCascadeReport', () => {
    it('computes per-language stats and overall progress', () => {
      const cascade = triggerCascade(
        'doc-1',
        [
          { sectionId: 's1', content: '' },
          { sectionId: 's2', content: '' },
        ],
        ['es', 'fr'],
        defaultConfig
      );
      updateCascadeItem(cascade.cascadeId, 's1', 'es', 'completed');

      const report = generateCascadeReport(cascade.cascadeId)!;
      expect(report.languages).toHaveLength(2);
      const esLang = report.languages.find((l) => l.language === 'es')!;
      expect(esLang.completed).toBe(1);
      expect(esLang.inProgress).toBe(1);
      expect(report.overallProgress).toBe(25);
    });

    it('returns undefined for unknown cascade', () => {
      expect(generateCascadeReport('nope')).toBeUndefined();
    });
  });
});

// ============================================================================
// glossary-management
// ============================================================================

describe('glossary-management', () => {
  const sampleEntry: GlossaryEntry = {
    term: 'API',
    definition: 'Application Programming Interface',
    translations: { es: 'API', fr: 'API', de: 'API' },
  };

  describe('createGlossary / addEntry', () => {
    it('creates an empty glossary', () => {
      const g = createGlossary('tech', 'en');
      expect(g.entries).toHaveLength(0);
      expect(g.sourceLanguage).toBe('en');
    });

    it('adds an entry', () => {
      let g = createGlossary('tech', 'en');
      g = addEntry(g, sampleEntry);
      expect(g.entries).toHaveLength(1);
      expect(g.entries[0].term).toBe('API');
    });

    it('replaces an existing entry with same term (case-insensitive)', () => {
      let g = createGlossary('tech', 'en');
      g = addEntry(g, sampleEntry);
      const updated = { ...sampleEntry, definition: 'Updated definition' };
      g = addEntry(g, updated);
      expect(g.entries).toHaveLength(1);
      expect(g.entries[0].definition).toBe('Updated definition');
    });
  });

  describe('detectTerms', () => {
    it('finds glossary terms in content', () => {
      let g = createGlossary('tech', 'en');
      g = addEntry(g, sampleEntry);
      g = addEntry(g, { term: 'endpoint', definition: '', translations: { es: 'punto final' } });
      const matches = detectTerms(g, 'Call the API endpoint to get data');
      expect(matches).toHaveLength(2);
      expect(matches[0].term).toBe('API');
      expect(matches[1].term).toBe('endpoint');
    });

    it('returns empty for no matches', () => {
      const g = createGlossary('tech', 'en');
      expect(detectTerms(g, 'nothing here')).toEqual([]);
    });
  });

  describe('validateConsistency', () => {
    it('detects inconsistent translations', () => {
      let g = createGlossary('tech', 'en');
      g = addEntry(g, { term: 'endpoint', definition: '', translations: { es: 'punto final' } });
      const report = validateConsistency(g, 'El endpoint devuelve datos', 'es');
      expect(report.issues).toHaveLength(1);
      expect(report.issues[0].expected).toBe('punto final');
      expect(report.issues[0].found).toBe('endpoint');
    });

    it('reports consistent when correct terms are used', () => {
      let g = createGlossary('tech', 'en');
      g = addEntry(g, { term: 'endpoint', definition: '', translations: { es: 'punto final' } });
      const report = validateConsistency(g, 'El punto final devuelve datos', 'es');
      expect(report.consistentTerms).toBe(1);
      expect(report.issues).toHaveLength(0);
      expect(report.coveragePercent).toBe(100);
    });
  });

  describe('exportGlossary / importGlossary', () => {
    it('round-trips JSON', () => {
      let g = createGlossary('tech', 'en');
      g = addEntry(g, sampleEntry);
      const json = exportGlossary(g, 'json');
      const imported = importGlossary(json, 'json');
      expect(imported.entries).toHaveLength(1);
      expect(imported.entries[0].term).toBe('API');
    });

    it('exports as CSV', () => {
      let g = createGlossary('tech', 'en');
      g = addEntry(g, sampleEntry);
      const csv = exportGlossary(g, 'csv');
      expect(csv).toContain('term,definition');
      expect(csv).toContain('API');
    });

    it('exports as TBX', () => {
      let g = createGlossary('tech', 'en');
      g = addEntry(g, sampleEntry);
      const tbx = exportGlossary(g, 'tbx');
      expect(tbx).toContain('<tbx type="TBX-Basic">');
      expect(tbx).toContain('API');
    });

    it('round-trips CSV', () => {
      let g = createGlossary('tech', 'en');
      g = addEntry(g, { term: 'API', definition: 'desc', translations: { es: 'API' } });
      const csv = exportGlossary(g, 'csv');
      const imported = importGlossary(csv, 'csv');
      expect(imported.entries).toHaveLength(1);
      expect(imported.entries[0].translations['es']).toBe('API');
    });

    it('round-trips TBX', () => {
      let g = createGlossary('tech', 'en');
      g = addEntry(g, { term: 'API', definition: '', translations: { es: 'API' } });
      const tbx = exportGlossary(g, 'tbx');
      const imported = importGlossary(tbx, 'tbx');
      expect(imported.entries.length).toBeGreaterThanOrEqual(1);
      expect(imported.entries[0].term).toBe('API');
    });
  });

  describe('getGlossaryCoverage', () => {
    it('computes coverage per language', () => {
      let g = createGlossary('tech', 'en');
      g = addEntry(g, sampleEntry);
      g = addEntry(g, { term: 'SDK', definition: '', translations: { es: 'SDK' } });
      const cov = getGlossaryCoverage(g);
      expect(cov.totalTerms).toBe(2);
      expect(cov.coveragePercent['es']).toBe(100);
      expect(cov.coveragePercent['fr']).toBe(50);
    });
  });
});
