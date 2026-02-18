/**
 * Documentation Autopilot Service
 *
 * Zero-config documentation baseline generation. Analyzes a repository's
 * structure, learns its style, and auto-generates a complete doc baseline.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('autopilot-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface RepoAnalysis {
  repositoryId: string;
  languages: LanguageBreakdown[];
  frameworks: string[];
  entryPoints: string[];
  publicAPIs: PublicAPIEntry[];
  existingDocs: ExistingDocInfo[];
  docPlan: DocPlan;
  styleProfile: StyleProfile;
}

export interface LanguageBreakdown {
  language: string;
  percentage: number;
  fileCount: number;
}

export interface PublicAPIEntry {
  filePath: string;
  exportName: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'constant';
  hasJSDoc: boolean;
  complexity: 'low' | 'medium' | 'high';
}

export interface ExistingDocInfo {
  path: string;
  type: 'readme' | 'api-reference' | 'guide' | 'architecture' | 'changelog' | 'other';
  wordCount: number;
  lastUpdated: Date;
  freshnessScore: number;
}

export interface DocPlan {
  sections: DocPlanSection[];
  estimatedWordCount: number;
  estimatedGenerationTime: string;
  confidence: number;
}

export interface DocPlanSection {
  title: string;
  type: 'readme' | 'api-reference' | 'setup-guide' | 'architecture' | 'contributing';
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimatedWords: number;
  basedOn: string[];
}

export interface StyleProfile {
  tone: 'formal' | 'conversational' | 'technical' | 'friendly';
  headingStyle: 'sentence-case' | 'title-case' | 'lowercase';
  codeExampleFrequency: 'high' | 'medium' | 'low';
  averageSectionLength: number;
  usesAdmonitions: boolean;
}

export interface AutopilotStatus {
  repositoryId: string;
  phase: 'idle' | 'observing' | 'analyzing' | 'generating' | 'ready' | 'completed';
  progress: number;
  startedAt?: Date;
  analysis?: RepoAnalysis;
  generatedDocs?: GeneratedDoc[];
  error?: string;
}

export interface GeneratedDoc {
  path: string;
  title: string;
  content: string;
  type: string;
  confidence: number;
  wordCount: number;
}

export interface AutopilotConfig {
  repositoryId: string;
  observationDays: number;
  autoGenerate: boolean;
  generateReadme: boolean;
  generateApiDocs: boolean;
  generateArchOverview: boolean;
  generateSetupGuide: boolean;
  excludePatterns: string[];
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Analyze a repository to build a documentation plan
 */
export async function analyzeRepository(
  repositoryId: string,
  options?: {
    depth: 'shallow' | 'deep';
    includePatterns?: string[];
    excludePatterns?: string[];
  }
): Promise<RepoAnalysis> {
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    throw new Error(`Repository not found: ${repositoryId}`);
  }

  const depth = options?.depth ?? 'shallow';

  // Analyze language breakdown
  const languages = await detectLanguages(repositoryId);

  // Detect frameworks from dependencies
  const frameworks = await detectFrameworks(repositoryId);

  // Scan for public APIs
  const publicAPIs = await scanPublicAPIs(repositoryId, depth);

  // Catalog existing documentation
  const existingDocs = await catalogExistingDocs(repositoryId);

  // Build a doc plan based on analysis
  const docPlan = buildDocPlan(languages, frameworks, publicAPIs, existingDocs);

  // Learn style from existing docs
  const styleProfile = await learnStyleProfile(existingDocs);

  // Find entry points
  const entryPoints = detectEntryPoints(languages, frameworks);

  const analysis: RepoAnalysis = {
    repositoryId,
    languages,
    frameworks,
    entryPoints,
    publicAPIs,
    existingDocs,
    docPlan,
    styleProfile,
  };

  // Store analysis result
  await db.autopilotAnalysis.upsert({
    where: { repositoryId },
    create: {
      repositoryId,
      analysis: JSON.parse(JSON.stringify(analysis)),
      status: 'analyzed',
      createdAt: new Date(),
    },
    update: {
      analysis: JSON.parse(JSON.stringify(analysis)),
      status: 'analyzed',
      updatedAt: new Date(),
    },
  });

  log.info(
    {
      repositoryId,
      languageCount: languages.length,
      apiCount: publicAPIs.length,
      existingDocCount: existingDocs.length,
      planSections: docPlan.sections.length,
    },
    'Repository analysis complete'
  );

  return analysis;
}

/**
 * Generate documentation baseline from analysis
 */
export async function generateBaseline(repositoryId: string): Promise<GeneratedDoc[]> {
  const stored = await db.autopilotAnalysis.findUnique({
    where: { repositoryId },
  });

  if (!stored) {
    throw new Error('Repository must be analyzed before generating baseline');
  }

  const analysis = stored.analysis as unknown as RepoAnalysis;
  const generatedDocs: GeneratedDoc[] = [];

  for (const section of analysis.docPlan.sections) {
    const doc = await generateSection(repositoryId, section, analysis);
    generatedDocs.push(doc);
  }

  await db.autopilotAnalysis.update({
    where: { repositoryId },
    data: {
      status: 'generated',
      generatedDocs: JSON.parse(JSON.stringify(generatedDocs)),
      updatedAt: new Date(),
    },
  });

  log.info({ repositoryId, docCount: generatedDocs.length }, 'Documentation baseline generated');

  return generatedDocs;
}

/**
 * Get autopilot status for a repository
 */
export async function getAutopilotStatus(repositoryId: string): Promise<AutopilotStatus> {
  const stored = await db.autopilotAnalysis.findUnique({
    where: { repositoryId },
  });

  if (!stored) {
    return {
      repositoryId,
      phase: 'idle',
      progress: 0,
    };
  }

  const phase = stored.status as AutopilotStatus['phase'];
  const progress =
    phase === 'completed' ? 100 : phase === 'generated' ? 80 : phase === 'analyzed' ? 50 : 20;

  return {
    repositoryId,
    phase,
    progress,
    startedAt: stored.createdAt,
    analysis: stored.analysis as unknown as RepoAnalysis,
    generatedDocs: stored.generatedDocs as unknown as GeneratedDoc[],
  };
}

/**
 * Get or update autopilot configuration
 */
export async function getAutopilotConfig(repositoryId: string): Promise<AutopilotConfig> {
  const config = await db.autopilotConfig.findUnique({
    where: { repositoryId },
  });

  return {
    repositoryId,
    observationDays: config?.observationDays ?? 7,
    autoGenerate: config?.autoGenerate ?? false,
    generateReadme: config?.generateReadme ?? true,
    generateApiDocs: config?.generateApiDocs ?? true,
    generateArchOverview: config?.generateArchOverview ?? true,
    generateSetupGuide: config?.generateSetupGuide ?? true,
    excludePatterns: config?.excludePatterns ?? [],
  };
}

export async function updateAutopilotConfig(
  repositoryId: string,
  updates: Partial<AutopilotConfig>
): Promise<AutopilotConfig> {
  await db.autopilotConfig.upsert({
    where: { repositoryId },
    create: {
      repositoryId,
      observationDays: updates.observationDays ?? 7,
      autoGenerate: updates.autoGenerate ?? false,
      generateReadme: updates.generateReadme ?? true,
      generateApiDocs: updates.generateApiDocs ?? true,
      generateArchOverview: updates.generateArchOverview ?? true,
      generateSetupGuide: updates.generateSetupGuide ?? true,
      excludePatterns: updates.excludePatterns ?? [],
    },
    update: {
      ...updates,
      updatedAt: new Date(),
    },
  });

  return getAutopilotConfig(repositoryId);
}

// ============================================================================
// Helper Functions
// ============================================================================

async function detectLanguages(repositoryId: string): Promise<LanguageBreakdown[]> {
  const docs = await prisma.document.findMany({
    where: { repositoryId },
    select: { path: true },
  });

  const extensionMap: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.py': 'Python',
    '.go': 'Go',
    '.rs': 'Rust',
    '.java': 'Java',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.cs': 'C#',
    '.cpp': 'C++',
  };

  const counts: Record<string, number> = {};
  let total = 0;

  for (const doc of docs) {
    const ext = doc.path.substring(doc.path.lastIndexOf('.'));
    const lang = extensionMap[ext];
    if (lang) {
      counts[lang] = (counts[lang] ?? 0) + 1;
      total++;
    }
  }

  return Object.entries(counts)
    .map(([language, fileCount]) => ({
      language,
      percentage: total > 0 ? Math.round((fileCount / total) * 100) : 0,
      fileCount,
    }))
    .sort((a, b) => b.percentage - a.percentage);
}

async function detectFrameworks(repositoryId: string): Promise<string[]> {
  const frameworks: string[] = [];
  const docs = await prisma.document.findMany({
    where: { repositoryId, path: { contains: 'package.json' } },
    select: { content: true },
    take: 1,
  });

  if (docs.length > 0 && docs[0]?.content) {
    try {
      const pkg = JSON.parse(docs[0].content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const frameworkMap: Record<string, string> = {
        react: 'React',
        next: 'Next.js',
        vue: 'Vue',
        angular: 'Angular',
        express: 'Express',
        hono: 'Hono',
        fastify: 'Fastify',
        prisma: 'Prisma',
        typeorm: 'TypeORM',
      };
      for (const [dep, name] of Object.entries(frameworkMap)) {
        if (deps[dep]) frameworks.push(name);
      }
    } catch {
      log.debug({ repositoryId }, 'Could not parse package.json');
    }
  }

  return frameworks;
}

async function scanPublicAPIs(
  repositoryId: string,
  _depth: 'shallow' | 'deep'
): Promise<PublicAPIEntry[]> {
  const apis: PublicAPIEntry[] = [];
  const docs = await prisma.document.findMany({
    where: {
      repositoryId,
      path: { endsWith: '.ts' },
      NOT: { path: { contains: '.test.' } },
    },
    select: { path: true, content: true },
    take: 100,
  });

  for (const doc of docs) {
    if (!doc.content) continue;
    const exportMatches = doc.content.matchAll(
      /export\s+(async\s+)?(?:function|class|const|interface|type)\s+(\w+)/g
    );
    for (const match of exportMatches) {
      const type = doc.content.includes(`class ${match[2]}`)
        ? 'class'
        : doc.content.includes(`interface ${match[2]}`)
          ? 'interface'
          : doc.content.includes(`type ${match[2]}`)
            ? 'type'
            : doc.content.includes(`const ${match[2]}`)
              ? 'constant'
              : 'function';

      apis.push({
        filePath: doc.path,
        exportName: match[2]!,
        type,
        hasJSDoc:
          doc.content.includes(`/** `) &&
          doc.content.indexOf(`/** `) < doc.content.indexOf(match[0]),
        complexity: doc.content.length > 500 ? 'high' : doc.content.length > 200 ? 'medium' : 'low',
      });
    }
  }

  return apis;
}

async function catalogExistingDocs(repositoryId: string): Promise<ExistingDocInfo[]> {
  const docs = await prisma.document.findMany({
    where: {
      repositoryId,
      OR: [{ path: { endsWith: '.md' } }, { path: { endsWith: '.mdx' } }],
    },
    select: { path: true, title: true, content: true, updatedAt: true },
  });

  return docs.map((doc) => {
    const wordCount = doc.content ? doc.content.split(/\s+/).length : 0;
    const daysSinceUpdate = Math.floor(
      (Date.now() - new Date(doc.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      path: doc.path,
      type: classifyDocType(doc.path, doc.title),
      wordCount,
      lastUpdated: doc.updatedAt,
      freshnessScore: Math.max(0, 100 - daysSinceUpdate),
    };
  });
}

function classifyDocType(path: string, title: string | null): ExistingDocInfo['type'] {
  const lower = (path + (title ?? '')).toLowerCase();
  if (lower.includes('readme')) return 'readme';
  if (lower.includes('api') || lower.includes('reference')) return 'api-reference';
  if (lower.includes('guide') || lower.includes('tutorial')) return 'guide';
  if (lower.includes('architect')) return 'architecture';
  if (lower.includes('changelog') || lower.includes('changes')) return 'changelog';
  return 'other';
}

function buildDocPlan(
  languages: LanguageBreakdown[],
  frameworks: string[],
  publicAPIs: PublicAPIEntry[],
  existingDocs: ExistingDocInfo[]
): DocPlan {
  const sections: DocPlanSection[] = [];
  const existingTypes = new Set(existingDocs.map((d) => d.type));

  if (!existingTypes.has('readme')) {
    sections.push({
      title: 'README',
      type: 'readme',
      priority: 'critical',
      estimatedWords: 500,
      basedOn: ['repository metadata', 'framework detection'],
    });
  }

  if (publicAPIs.length > 0 && !existingTypes.has('api-reference')) {
    sections.push({
      title: 'API Reference',
      type: 'api-reference',
      priority: 'high',
      estimatedWords: publicAPIs.length * 80,
      basedOn: publicAPIs.slice(0, 5).map((a) => a.filePath),
    });
  }

  sections.push({
    title: 'Getting Started',
    type: 'setup-guide',
    priority: 'high',
    estimatedWords: 400,
    basedOn: ['package.json', ...frameworks],
  });

  if (languages.length > 1 || frameworks.length > 2) {
    sections.push({
      title: 'Architecture Overview',
      type: 'architecture',
      priority: 'medium',
      estimatedWords: 600,
      basedOn: languages.map((l) => l.language),
    });
  }

  sections.push({
    title: 'Contributing Guide',
    type: 'contributing',
    priority: 'low',
    estimatedWords: 300,
    basedOn: ['repository conventions'],
  });

  const estimatedWordCount = sections.reduce((sum, s) => sum + s.estimatedWords, 0);

  return {
    sections,
    estimatedWordCount,
    estimatedGenerationTime: `${Math.ceil(estimatedWordCount / 500)} minutes`,
    confidence: Math.min(0.95, 0.5 + publicAPIs.length * 0.01 + existingDocs.length * 0.05),
  };
}

async function learnStyleProfile(existingDocs: ExistingDocInfo[]): Promise<StyleProfile> {
  if (existingDocs.length === 0) {
    return {
      tone: 'technical',
      headingStyle: 'sentence-case',
      codeExampleFrequency: 'medium',
      averageSectionLength: 150,
      usesAdmonitions: false,
    };
  }

  const avgLength = existingDocs.reduce((sum, d) => sum + d.wordCount, 0) / existingDocs.length;

  return {
    tone: avgLength > 300 ? 'conversational' : 'technical',
    headingStyle: 'sentence-case',
    codeExampleFrequency: avgLength > 200 ? 'high' : 'medium',
    averageSectionLength: Math.round(avgLength),
    usesAdmonitions: false,
  };
}

function detectEntryPoints(languages: LanguageBreakdown[], frameworks: string[]): string[] {
  const entryPoints: string[] = [];
  const primaryLang = languages[0]?.language;

  if (primaryLang === 'TypeScript' || primaryLang === 'JavaScript') {
    entryPoints.push('src/index.ts', 'src/main.ts', 'src/app.ts');
  } else if (primaryLang === 'Python') {
    entryPoints.push('main.py', 'app.py', 'src/__init__.py');
  } else if (primaryLang === 'Go') {
    entryPoints.push('main.go', 'cmd/main.go');
  }

  if (frameworks.includes('Next.js')) entryPoints.push('src/app/page.tsx');
  if (frameworks.includes('Express') || frameworks.includes('Hono'))
    entryPoints.push('src/server.ts');

  return entryPoints;
}

async function generateSection(
  repositoryId: string,
  section: DocPlanSection,
  analysis: RepoAnalysis
): Promise<GeneratedDoc> {
  const content = buildSectionContent(section, analysis);

  return {
    path: sectionToPath(section),
    title: section.title,
    content,
    type: section.type,
    confidence: analysis.docPlan.confidence,
    wordCount: content.split(/\s+/).length,
  };
}

function sectionToPath(section: DocPlanSection): string {
  switch (section.type) {
    case 'readme':
      return 'README.md';
    case 'api-reference':
      return 'docs/api-reference.md';
    case 'setup-guide':
      return 'docs/getting-started.md';
    case 'architecture':
      return 'docs/architecture.md';
    case 'contributing':
      return 'CONTRIBUTING.md';
    default:
      return `docs/${section.title.toLowerCase().replace(/\s+/g, '-')}.md`;
  }
}

function buildSectionContent(section: DocPlanSection, analysis: RepoAnalysis): string {
  const { styleProfile, languages, frameworks, publicAPIs } = analysis;
  const langList = languages.map((l) => l.language).join(', ');
  const frameworkList = frameworks.join(', ');

  switch (section.type) {
    case 'readme':
      return [
        `# Project Documentation`,
        '',
        `## Overview`,
        '',
        `This project is built with ${langList}${frameworkList ? ` using ${frameworkList}` : ''}.`,
        '',
        `## Quick Start`,
        '',
        '```bash',
        'npm install',
        'npm run dev',
        '```',
        '',
        `## Documentation`,
        '',
        `- [Getting Started](docs/getting-started.md)`,
        `- [API Reference](docs/api-reference.md)`,
        publicAPIs.length > 0
          ? `\n## API Surface\n\nThis project exports ${publicAPIs.length} public APIs.`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

    case 'api-reference': {
      const lines = [`# API Reference\n`];
      const grouped = groupBy(publicAPIs.slice(0, 30), (api) => api.filePath);
      for (const [file, apis] of Object.entries(grouped)) {
        lines.push(`## \`${file}\`\n`);
        for (const api of apis) {
          lines.push(`### \`${api.exportName}\`\n`);
          lines.push(`- **Type**: ${api.type}`);
          lines.push(`- **Complexity**: ${api.complexity}`);
          lines.push(`- **Has documentation**: ${api.hasJSDoc ? 'Yes' : 'No'}\n`);
        }
      }
      return lines.join('\n');
    }

    case 'setup-guide':
      return [
        `# Getting Started`,
        '',
        `## Prerequisites`,
        '',
        languages.map((l) => `- ${l.language}`).join('\n'),
        '',
        `## Installation`,
        '',
        '```bash',
        'git clone <repository-url>',
        'cd <project-name>',
        languages[0]?.language === 'TypeScript' ? 'npm install' : '# install dependencies',
        '```',
        '',
        `## Running`,
        '',
        '```bash',
        languages[0]?.language === 'TypeScript' ? 'npm run dev' : '# run the project',
        '```',
      ].join('\n');

    case 'architecture':
      return [
        `# Architecture Overview`,
        '',
        `## Technology Stack`,
        '',
        `| Layer | Technology |`,
        `|-------|-----------|`,
        ...languages.map(
          (l) => `| ${l.language} | ${l.percentage}% of codebase (${l.fileCount} files) |`
        ),
        ...frameworks.map((f) => `| Framework | ${f} |`),
        '',
        `## Structure`,
        '',
        styleProfile.tone === 'conversational'
          ? `This project follows a modular architecture with ${publicAPIs.length} public APIs.`
          : `Modular architecture. ${publicAPIs.length} public API exports.`,
      ].join('\n');

    default:
      return `# ${section.title}\n\nDocumentation section generated by DocSynth Autopilot.\n`;
  }
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}
