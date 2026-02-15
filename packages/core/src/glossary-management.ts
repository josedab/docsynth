// ============================================================================
// Types
// ============================================================================

export interface GlossaryEntry {
  term: string;
  definition: string;
  translations: Record<string, string>;
  caseSensitive?: boolean;
}

export interface Glossary {
  name: string;
  sourceLanguage: string;
  entries: GlossaryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type GlossaryFormat = 'json' | 'csv' | 'tbx';

export interface TermMatch {
  term: string;
  position: number;
  length: number;
}

export interface ConsistencyIssue {
  term: string;
  language: string;
  expected: string;
  found: string;
  position: number;
}

export interface ConsistencyReport {
  language: string;
  totalTerms: number;
  consistentTerms: number;
  issues: ConsistencyIssue[];
  coveragePercent: number;
}

export interface GlossaryCoverage {
  totalTerms: number;
  coveredLanguages: Record<string, number>;
  coveragePercent: Record<string, number>;
}

// ============================================================================
// Functions
// ============================================================================

/** Create a new empty glossary. */
export function createGlossary(name: string, sourceLanguage: string): Glossary {
  const now = new Date().toISOString();
  return { name, sourceLanguage, entries: [], createdAt: now, updatedAt: now };
}

/** Add an entry to a glossary. Returns updated glossary. */
export function addEntry(glossary: Glossary, entry: GlossaryEntry): Glossary {
  const existing = glossary.entries.findIndex(
    (e) => e.term.toLowerCase() === entry.term.toLowerCase()
  );

  const entries =
    existing >= 0
      ? glossary.entries.map((e, i) => (i === existing ? entry : e))
      : [...glossary.entries, entry];

  return { ...glossary, entries, updatedAt: new Date().toISOString() };
}

/** Detect glossary terms present in source content. */
export function detectTerms(glossary: Glossary, content: string): TermMatch[] {
  const matches: TermMatch[] = [];

  for (const entry of glossary.entries) {
    const flags = entry.caseSensitive ? 'g' : 'gi';
    const escaped = escapeRegex(entry.term);
    const regex = new RegExp(`\\b${escaped}\\b`, flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      matches.push({ term: entry.term, position: match.index, length: match[0].length });
    }
  }

  return matches.sort((a, b) => a.position - b.position);
}

/** Validate that a translated document uses consistent glossary terms. */
export function validateConsistency(
  glossary: Glossary,
  translatedContent: string,
  language: string
): ConsistencyReport {
  const issues: ConsistencyIssue[] = [];
  let consistentCount = 0;
  const termsWithTranslation = glossary.entries.filter((e) => e.translations[language]);

  for (const entry of termsWithTranslation) {
    const expected = entry.translations[language] as string;
    const escapedExpected = escapeRegex(expected);
    const expectedRegex = new RegExp(`\\b${escapedExpected}\\b`, 'gi');

    if (expectedRegex.test(translatedContent)) {
      consistentCount++;
      continue;
    }

    // Check if the untranslated source term appears instead
    const escapedTerm = escapeRegex(entry.term);
    const sourceRegex = new RegExp(`\\b${escapedTerm}\\b`, 'gi');
    let match: RegExpExecArray | null;

    while ((match = sourceRegex.exec(translatedContent)) !== null) {
      issues.push({
        term: entry.term,
        language,
        expected: expected,
        found: match[0],
        position: match.index,
      });
    }
  }

  const totalTerms = termsWithTranslation.length;
  return {
    language,
    totalTerms,
    consistentTerms: consistentCount,
    issues,
    coveragePercent: totalTerms > 0 ? Math.round((consistentCount / totalTerms) * 100) : 100,
  };
}

/** Export a glossary to the specified format. */
export function exportGlossary(glossary: Glossary, format: GlossaryFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(glossary, null, 2);

    case 'csv':
      return exportAsCSV(glossary);

    case 'tbx':
      return exportAsTBX(glossary);
  }
}

/** Import a glossary from JSON string. */
export function importGlossary(data: string, format: GlossaryFormat): Glossary {
  switch (format) {
    case 'json':
      return JSON.parse(data) as Glossary;

    case 'csv':
      return importFromCSV(data);

    case 'tbx':
      return importFromTBX(data);
  }
}

/** Calculate glossary coverage across languages. */
export function getGlossaryCoverage(glossary: Glossary): GlossaryCoverage {
  const langCounts: Record<string, number> = {};

  for (const entry of glossary.entries) {
    for (const lang of Object.keys(entry.translations)) {
      langCounts[lang] = (langCounts[lang] ?? 0) + 1;
    }
  }

  const total = glossary.entries.length || 1;
  const coveragePercent: Record<string, number> = {};
  for (const [lang, count] of Object.entries(langCounts)) {
    coveragePercent[lang] = Math.round((count / total) * 100);
  }

  return { totalTerms: glossary.entries.length, coveredLanguages: langCounts, coveragePercent };
}

// ============================================================================
// Helpers
// ============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exportAsCSV(glossary: Glossary): string {
  const allLangs = new Set<string>();
  for (const entry of glossary.entries) {
    for (const lang of Object.keys(entry.translations)) allLangs.add(lang);
  }
  const langs = [...allLangs].sort();
  const header = ['term', 'definition', ...langs].join(',');

  const rows = glossary.entries.map((e) => {
    const values = [
      csvEscape(e.term),
      csvEscape(e.definition),
      ...langs.map((l) => csvEscape(e.translations[l] ?? '')),
    ];
    return values.join(',');
  });

  return [header, ...rows].join('\n');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportAsTBX(glossary: Glossary): string {
  const entries = glossary.entries
    .map((e) => {
      const langSections = Object.entries(e.translations)
        .map(
          ([lang, text]) =>
            `      <langSet xml:lang="${lang}"><tig><term>${xmlEscape(text)}</term></tig></langSet>`
        )
        .join('\n');
      return `    <termEntry id="${xmlEscape(e.term)}">\n      <langSet xml:lang="${glossary.sourceLanguage}"><tig><term>${xmlEscape(e.term)}</term></tig></langSet>\n${langSections}\n    </termEntry>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<tbx type="TBX-Basic">\n  <text>\n    <body>\n${entries}\n    </body>\n  </text>\n</tbx>`;
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function importFromCSV(data: string): Glossary {
  const lines = data.split('\n').filter((l) => l.trim());
  if (lines.length < 1) return createGlossary('imported', 'en');

  const headers = lines[0]!.split(',');
  const langs = headers.slice(2);
  const entries: GlossaryEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',');
    const translations: Record<string, string> = {};
    for (let j = 0; j < langs.length; j++) {
      const val = (cols[j + 2] ?? '').replace(/^"|"$/g, '');
      if (val) translations[langs[j]!] = val;
    }
    entries.push({
      term: (cols[0] ?? '').replace(/^"|"$/g, ''),
      definition: (cols[1] ?? '').replace(/^"|"$/g, ''),
      translations,
    });
  }

  const glossary = createGlossary('imported', 'en');
  glossary.entries = entries;
  return glossary;
}

function importFromTBX(data: string): Glossary {
  const glossary = createGlossary('imported', 'en');
  const termEntryRegex = /<termEntry[^>]*>([\s\S]*?)<\/termEntry>/g;
  const langSetRegex = /<langSet xml:lang="([^"]*)">\s*<tig>\s*<term>([\s\S]*?)<\/term>/g;
  let entryMatch: RegExpExecArray | null;

  while ((entryMatch = termEntryRegex.exec(data)) !== null) {
    const block = entryMatch[1]!;
    const translations: Record<string, string> = {};
    let term = '';
    let isFirst = true;
    let langMatch: RegExpExecArray | null;

    langSetRegex.lastIndex = 0;
    while ((langMatch = langSetRegex.exec(block)) !== null) {
      const lang = langMatch[1]!;
      const text = langMatch[2]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      if (isFirst) {
        term = text;
        isFirst = false;
      } else {
        translations[lang] = text;
      }
    }

    if (term) {
      glossary.entries.push({ term, definition: '', translations });
    }
  }

  return glossary;
}
