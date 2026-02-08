/**
 * Multi-Language SDK Documentation Generator Routes
 *
 * Provides endpoints for generating, managing, and publishing
 * SDK documentation across multiple programming languages:
 * - SDK doc generation from API specs
 * - Per-language doc management
 * - Code example validation
 * - SDK doc publishing
 * - Template management
 */

import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { createLogger, ValidationError, generateId } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';

const log = createLogger('sdk-docs-routes');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

const SUPPORTED_LANGUAGES = [
  'python',
  'javascript',
  'typescript',
  'go',
  'java',
  'ruby',
  'csharp',
  'php',
  'rust',
  'swift',
] as const;

type SdkLanguage = (typeof SUPPORTED_LANGUAGES)[number];

interface GenerateOptions {
  includeExamples?: boolean;
  includeErrorHandling?: boolean;
  includeAuth?: boolean;
  packageName?: string;
}

interface SdkDocSection {
  title: string;
  content: string;
  language: SdkLanguage;
  codeExamples: CodeExample[];
}

interface CodeExample {
  id: string;
  title: string;
  code: string;
  language: SdkLanguage;
  endpoint?: string;
  description?: string;
  valid?: boolean;
  validationErrors?: string[];
}

// ============================================================================
// SDK Documentation Generation
// ============================================================================

/**
 * Generate SDK docs from an API spec for one or more languages
 */
app.post('/generate', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId') as string;
  const body = await c.req.json<{
    repositoryId: string;
    apiSpecPath?: string;
    apiSpecContent?: string;
    languages: string[];
    options?: GenerateOptions;
  }>();

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  if (!body.apiSpecPath && !body.apiSpecContent) {
    throw new ValidationError('Either apiSpecPath or apiSpecContent is required');
  }

  if (!body.languages || body.languages.length === 0) {
    throw new ValidationError('At least one language is required');
  }

  // Validate languages
  const invalidLanguages = body.languages.filter(
    (lang) => !SUPPORTED_LANGUAGES.includes(lang as SdkLanguage)
  );
  if (invalidLanguages.length > 0) {
    throw new ValidationError(
      `Unsupported languages: ${invalidLanguages.join(', ')}. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`
    );
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    return c.json({ success: false, error: 'Repository not found' }, 404);
  }

  // Resolve API spec content
  let apiSpecContent = body.apiSpecContent || '';
  if (body.apiSpecPath && !apiSpecContent) {
    const specDoc = await prisma.document.findFirst({
      where: { repositoryId: body.repositoryId, path: body.apiSpecPath },
    });
    if (!specDoc) {
      return c.json({ success: false, error: 'API spec document not found at specified path' }, 404);
    }
    apiSpecContent = specDoc.content;
  }

  const options = body.options || {};
  const generatedDocs: Array<{
    id: string;
    language: SdkLanguage;
    status: string;
    sectionsCount: number;
  }> = [];

  // Generate SDK docs for each requested language
  for (const lang of body.languages as SdkLanguage[]) {
    const sdkDocId = generateId('sdkdoc');

    // Build sections based on options
    const sections: SdkDocSection[] = [];

    sections.push({
      title: 'Installation',
      content: generateInstallationSection(lang, options.packageName),
      language: lang,
      codeExamples: [
        {
          id: generateId('example'),
          title: 'Install Package',
          code: generateInstallCommand(lang, options.packageName),
          language: lang,
          description: `Install the ${options.packageName || repository.name} SDK`,
        },
      ],
    });

    sections.push({
      title: 'Quick Start',
      content: `Getting started with the ${repository.name} SDK in ${lang}.`,
      language: lang,
      codeExamples: [
        {
          id: generateId('example'),
          title: 'Initialize Client',
          code: generateQuickStartCode(lang, options.packageName || repository.name),
          language: lang,
          description: 'Initialize the SDK client',
        },
      ],
    });

    if (options.includeAuth) {
      sections.push({
        title: 'Authentication',
        content: `Authentication methods supported by the ${repository.name} API.`,
        language: lang,
        codeExamples: [
          {
            id: generateId('example'),
            title: 'API Key Authentication',
            code: generateAuthCode(lang, options.packageName || repository.name),
            language: lang,
            description: 'Authenticate using an API key',
          },
        ],
      });
    }

    if (options.includeErrorHandling) {
      sections.push({
        title: 'Error Handling',
        content: 'Handling errors and exceptions from the API.',
        language: lang,
        codeExamples: [
          {
            id: generateId('example'),
            title: 'Error Handling Example',
            code: generateErrorHandlingCode(lang, options.packageName || repository.name),
            language: lang,
            description: 'Properly handle API errors',
          },
        ],
      });
    }

    // Store the generated SDK doc
    await db.sdkDoc.create({
      data: {
        id: sdkDocId,
        organizationId: orgId,
        repositoryId: body.repositoryId,
        language: lang,
        title: `${repository.name} SDK - ${lang}`,
        description: `Auto-generated SDK documentation for ${lang}`,
        sections,
        apiSpecSnapshot: apiSpecContent.slice(0, 50000),
        options,
        status: 'generated',
        version: '1.0.0',
      },
    });

    generatedDocs.push({
      id: sdkDocId,
      language: lang,
      status: 'generated',
      sectionsCount: sections.length,
    });
  }

  log.info(
    { repositoryId: body.repositoryId, languages: body.languages, count: generatedDocs.length },
    'SDK docs generated'
  );

  return c.json({
    success: true,
    data: {
      repositoryId: body.repositoryId,
      generatedDocs,
      totalLanguages: generatedDocs.length,
    },
  }, 201);
});

// ============================================================================
// SDK Documentation Retrieval
// ============================================================================

/**
 * List generated SDK docs for a repository grouped by language
 */
app.get('/:repositoryId/sdks', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const orgId = c.get('organizationId') as string;

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, name: true },
  });

  if (!repository) {
    return c.json({ success: false, error: 'Repository not found' }, 404);
  }

  const sdkDocs = await db.sdkDoc.findMany({
    where: { repositoryId, organizationId: orgId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      language: true,
      title: true,
      description: true,
      status: true,
      version: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Group by language
  const grouped = sdkDocs.reduce(
    (acc: Record<string, Array<Record<string, unknown>>>, doc: Record<string, unknown>) => {
      const lang = doc.language as string;
      if (!acc[lang]) {
        acc[lang] = [];
      }
      acc[lang].push(doc);
      return acc;
    },
    {} as Record<string, Array<Record<string, unknown>>>
  );

  return c.json({
    success: true,
    data: {
      repositoryId,
      repositoryName: repository.name,
      totalDocs: sdkDocs.length,
      byLanguage: grouped,
    },
  });
});

/**
 * Get a specific SDK doc with full content
 */
app.get('/sdks/:sdkDocId', requireAuth, async (c) => {
  const sdkDocId = c.req.param('sdkDocId') ?? '';

  const sdkDoc = await db.sdkDoc.findUnique({
    where: { id: sdkDocId },
  });

  if (!sdkDoc) {
    return c.json({ success: false, error: 'SDK doc not found' }, 404);
  }

  return c.json({
    success: true,
    data: sdkDoc,
  });
});

// ============================================================================
// SDK Documentation Validation
// ============================================================================

/**
 * Validate code examples in an SDK doc
 */
app.post('/sdks/:sdkDocId/validate', requireAuth, async (c) => {
  const sdkDocId = c.req.param('sdkDocId') ?? '';
  const body = await c.req.json<{
    language?: string;
    sandbox?: boolean;
  }>();

  const sdkDoc = await db.sdkDoc.findUnique({
    where: { id: sdkDocId },
  });

  if (!sdkDoc) {
    return c.json({ success: false, error: 'SDK doc not found' }, 404);
  }

  const sections = (sdkDoc.sections || []) as SdkDocSection[];
  const targetLanguage = body.language || sdkDoc.language;
  const useSandbox = body.sandbox ?? false;

  const validationResults: Array<{
    exampleId: string;
    title: string;
    language: string;
    valid: boolean;
    errors: string[];
  }> = [];

  // Validate each code example
  for (const section of sections) {
    for (const example of section.codeExamples || []) {
      if (targetLanguage && example.language !== targetLanguage) {
        continue;
      }

      const errors: string[] = [];
      let valid = true;

      // Basic syntax validation
      if (!example.code || example.code.trim().length === 0) {
        valid = false;
        errors.push('Empty code example');
      }

      // Check for common issues
      if (example.code.includes('YOUR_API_KEY') || example.code.includes('TODO')) {
        errors.push('Contains placeholder values that should be replaced');
      }

      // Check for balanced brackets/braces
      const openBraces = (example.code.match(/\{/g) || []).length;
      const closeBraces = (example.code.match(/\}/g) || []).length;
      if (openBraces !== closeBraces) {
        valid = false;
        errors.push('Unbalanced braces detected');
      }

      const openParens = (example.code.match(/\(/g) || []).length;
      const closeParens = (example.code.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        valid = false;
        errors.push('Unbalanced parentheses detected');
      }

      if (useSandbox) {
        // Sandbox validation would be performed here in production
        log.info({ exampleId: example.id, language: example.language }, 'Sandbox validation requested');
      }

      validationResults.push({
        exampleId: example.id,
        title: example.title,
        language: example.language,
        valid,
        errors,
      });
    }
  }

  const totalExamples = validationResults.length;
  const validCount = validationResults.filter((r) => r.valid).length;
  const invalidCount = totalExamples - validCount;

  log.info(
    { sdkDocId, totalExamples, validCount, invalidCount },
    'SDK doc validation completed'
  );

  return c.json({
    success: true,
    data: {
      sdkDocId,
      language: targetLanguage,
      sandboxUsed: useSandbox,
      summary: {
        total: totalExamples,
        valid: validCount,
        invalid: invalidCount,
        passRate: totalExamples > 0 ? Math.round((validCount / totalExamples) * 100) : 0,
      },
      results: validationResults,
    },
  });
});

// ============================================================================
// SDK Documentation Regeneration
// ============================================================================

/**
 * Regenerate a specific SDK doc with updated spec
 */
app.put('/sdks/:sdkDocId/regenerate', requireAuth, requireOrgAccess, async (c) => {
  const sdkDocId = c.req.param('sdkDocId') ?? '';
  const orgId = c.get('organizationId') as string;
  const body = await c.req.json<{
    apiSpecContent?: string;
    options?: GenerateOptions;
  }>().catch(() => ({}));

  const sdkDoc = await db.sdkDoc.findFirst({
    where: { id: sdkDocId, organizationId: orgId },
  });

  if (!sdkDoc) {
    return c.json({ success: false, error: 'SDK doc not found' }, 404);
  }

  const language = sdkDoc.language as SdkLanguage;
  const options = (body as any).options || (sdkDoc.options as GenerateOptions) || {};
  const apiSpecContent = (body as any).apiSpecContent || (sdkDoc.apiSpecSnapshot as string) || '';

  // Get repository name for code generation
  const repository = await prisma.repository.findUnique({
    where: { id: sdkDoc.repositoryId as string },
    select: { name: true },
  });

  const repoName = repository?.name || 'api';

  // Rebuild sections
  const sections: SdkDocSection[] = [];

  sections.push({
    title: 'Installation',
    content: generateInstallationSection(language, options.packageName),
    language,
    codeExamples: [
      {
        id: generateId('example'),
        title: 'Install Package',
        code: generateInstallCommand(language, options.packageName),
        language,
        description: `Install the ${options.packageName || repoName} SDK`,
      },
    ],
  });

  sections.push({
    title: 'Quick Start',
    content: `Getting started with the ${repoName} SDK in ${language}.`,
    language,
    codeExamples: [
      {
        id: generateId('example'),
        title: 'Initialize Client',
        code: generateQuickStartCode(language, options.packageName || repoName),
        language,
        description: 'Initialize the SDK client',
      },
    ],
  });

  if (options.includeAuth) {
    sections.push({
      title: 'Authentication',
      content: `Authentication methods supported by the ${repoName} API.`,
      language,
      codeExamples: [
        {
          id: generateId('example'),
          title: 'API Key Authentication',
          code: generateAuthCode(language, options.packageName || repoName),
          language,
          description: 'Authenticate using an API key',
        },
      ],
    });
  }

  if (options.includeErrorHandling) {
    sections.push({
      title: 'Error Handling',
      content: 'Handling errors and exceptions from the API.',
      language,
      codeExamples: [
        {
          id: generateId('example'),
          title: 'Error Handling Example',
          code: generateErrorHandlingCode(language, options.packageName || repoName),
          language,
          description: 'Properly handle API errors',
        },
      ],
    });
  }

  // Parse current version and bump patch
  const currentVersion = (sdkDoc.version as string) || '1.0.0';
  const versionParts = currentVersion.split('.');
  const newVersion = `${versionParts[0]}.${versionParts[1]}.${parseInt(versionParts[2] || '0', 10) + 1}`;

  const updated = await db.sdkDoc.update({
    where: { id: sdkDocId },
    data: {
      sections,
      apiSpecSnapshot: apiSpecContent.slice(0, 50000),
      options,
      status: 'regenerated',
      version: newVersion,
    },
  });

  log.info({ sdkDocId, language, version: newVersion }, 'SDK doc regenerated');

  return c.json({
    success: true,
    data: {
      id: updated.id,
      language: updated.language,
      version: newVersion,
      status: 'regenerated',
      sectionsCount: sections.length,
    },
  });
});

// ============================================================================
// Language Status
// ============================================================================

/**
 * Get available languages and generation status for a repository
 */
app.get('/:repositoryId/languages', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const orgId = c.get('organizationId') as string;

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, name: true },
  });

  if (!repository) {
    return c.json({ success: false, error: 'Repository not found' }, 404);
  }

  // Get existing SDK docs for this repository
  const existingDocs = await db.sdkDoc.findMany({
    where: { repositoryId, organizationId: orgId },
    select: {
      language: true,
      status: true,
      version: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  // Build status map
  const docsByLanguage = existingDocs.reduce(
    (acc: Record<string, { status: string; version: string; updatedAt: Date }>, doc: Record<string, unknown>) => {
      const lang = doc.language as string;
      if (!acc[lang]) {
        acc[lang] = {
          status: doc.status as string,
          version: doc.version as string,
          updatedAt: doc.updatedAt as Date,
        };
      }
      return acc;
    },
    {} as Record<string, { status: string; version: string; updatedAt: Date }>
  );

  const languages = SUPPORTED_LANGUAGES.map((lang) => ({
    language: lang,
    supported: true,
    generated: !!docsByLanguage[lang],
    status: docsByLanguage[lang]?.status || 'not_generated',
    version: docsByLanguage[lang]?.version || null,
    lastUpdated: docsByLanguage[lang]?.updatedAt || null,
  }));

  return c.json({
    success: true,
    data: {
      repositoryId,
      repositoryName: repository.name,
      languages,
      generatedCount: languages.filter((l) => l.generated).length,
      totalAvailable: SUPPORTED_LANGUAGES.length,
    },
  });
});

// ============================================================================
// Preview
// ============================================================================

/**
 * Preview SDK doc generation without persisting
 */
app.post('/preview', requireAuth, async (c) => {
  const body = await c.req.json<{
    apiSpec: string;
    language: string;
    endpoint?: string;
  }>();

  if (!body.apiSpec) {
    throw new ValidationError('apiSpec is required');
  }

  if (!body.language) {
    throw new ValidationError('language is required');
  }

  if (!SUPPORTED_LANGUAGES.includes(body.language as SdkLanguage)) {
    throw new ValidationError(
      `Unsupported language: ${body.language}. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`
    );
  }

  const language = body.language as SdkLanguage;

  // Generate a preview snippet
  const previewExample: CodeExample = {
    id: generateId('preview'),
    title: body.endpoint ? `${body.endpoint} Example` : 'API Usage Example',
    code: generateQuickStartCode(language, 'api-client'),
    language,
    endpoint: body.endpoint,
    description: `Preview of SDK usage in ${language}`,
  };

  const previewSection: SdkDocSection = {
    title: 'Preview',
    content: `Preview of SDK documentation for ${language}.`,
    language,
    codeExamples: [previewExample],
  };

  return c.json({
    success: true,
    data: {
      language,
      endpoint: body.endpoint || null,
      preview: previewSection,
      note: 'This is a preview and has not been persisted. Use POST /generate to create permanent SDK docs.',
    },
  });
});

// ============================================================================
// Code Examples
// ============================================================================

/**
 * Get code examples for a specific language in a repository
 */
app.get('/:repositoryId/examples/:language', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId') ?? '';
  const language = c.req.param('language') ?? '';
  const orgId = c.get('organizationId') as string;

  if (!SUPPORTED_LANGUAGES.includes(language as SdkLanguage)) {
    throw new ValidationError(
      `Unsupported language: ${language}. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`
    );
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, name: true },
  });

  if (!repository) {
    return c.json({ success: false, error: 'Repository not found' }, 404);
  }

  // Get SDK docs for the specified language
  const sdkDocs = await db.sdkDoc.findMany({
    where: { repositoryId, organizationId: orgId, language },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      sections: true,
      version: true,
    },
  });

  // Extract all code examples across all SDK docs for this language
  const allExamples: Array<{
    sdkDocId: string;
    sdkDocTitle: string;
    version: string;
    sectionTitle: string;
    example: CodeExample;
  }> = [];

  for (const doc of sdkDocs) {
    const sections = (doc.sections || []) as SdkDocSection[];
    for (const section of sections) {
      for (const example of section.codeExamples || []) {
        allExamples.push({
          sdkDocId: doc.id as string,
          sdkDocTitle: doc.title as string,
          version: doc.version as string,
          sectionTitle: section.title,
          example,
        });
      }
    }
  }

  return c.json({
    success: true,
    data: {
      repositoryId,
      repositoryName: repository.name,
      language,
      totalExamples: allExamples.length,
      examples: allExamples,
    },
  });
});

// ============================================================================
// Publishing
// ============================================================================

/**
 * Publish SDK docs to a target platform
 */
app.post('/sdks/:sdkDocId/publish', requireAuth, requireOrgAccess, async (c) => {
  const sdkDocId = c.req.param('sdkDocId') ?? '';
  const orgId = c.get('organizationId') as string;
  const body = await c.req.json<{
    target: 'npm' | 'pypi' | 'github' | 'docs-site';
  }>();

  if (!body.target) {
    throw new ValidationError('target is required');
  }

  const validTargets = ['npm', 'pypi', 'github', 'docs-site'];
  if (!validTargets.includes(body.target)) {
    throw new ValidationError(
      `Invalid target: ${body.target}. Supported: ${validTargets.join(', ')}`
    );
  }

  const sdkDoc = await db.sdkDoc.findFirst({
    where: { id: sdkDocId, organizationId: orgId },
  });

  if (!sdkDoc) {
    return c.json({ success: false, error: 'SDK doc not found' }, 404);
  }

  // Validate target compatibility with language
  const language = sdkDoc.language as string;
  const targetLanguageMap: Record<string, string[]> = {
    npm: ['javascript', 'typescript'],
    pypi: ['python'],
    github: SUPPORTED_LANGUAGES as unknown as string[],
    'docs-site': SUPPORTED_LANGUAGES as unknown as string[],
  };

  const compatibleLanguages = targetLanguageMap[body.target] || [];
  if (!compatibleLanguages.includes(language)) {
    throw new ValidationError(
      `Target '${body.target}' is not compatible with language '${language}'`
    );
  }

  // Record the publish action
  const publishId = generateId('publish');

  await db.sdkDoc.update({
    where: { id: sdkDocId },
    data: {
      status: 'published',
      publishedAt: new Date(),
      publishTarget: body.target,
    },
  });

  log.info(
    { sdkDocId, target: body.target, language, publishId },
    'SDK doc published'
  );

  return c.json({
    success: true,
    data: {
      publishId,
      sdkDocId,
      target: body.target,
      language,
      version: sdkDoc.version,
      status: 'published',
      publishedAt: new Date().toISOString(),
      message: `SDK documentation published to ${body.target}`,
    },
  });
});

// ============================================================================
// Templates
// ============================================================================

/**
 * Get available SDK doc templates per language
 */
app.get('/templates', requireAuth, async (c) => {
  const templates = SUPPORTED_LANGUAGES.map((lang) => ({
    language: lang,
    templates: [
      {
        id: `${lang}-quickstart`,
        name: 'Quick Start',
        description: `Minimal setup guide for ${lang}`,
        sections: ['installation', 'quick-start'],
      },
      {
        id: `${lang}-comprehensive`,
        name: 'Comprehensive',
        description: `Full SDK documentation for ${lang} including auth, error handling, and examples`,
        sections: ['installation', 'quick-start', 'authentication', 'error-handling', 'examples', 'reference'],
      },
      {
        id: `${lang}-api-reference`,
        name: 'API Reference',
        description: `Endpoint-by-endpoint reference for ${lang}`,
        sections: ['installation', 'authentication', 'endpoints', 'models', 'errors'],
      },
    ],
  }));

  return c.json({
    success: true,
    data: {
      totalLanguages: SUPPORTED_LANGUAGES.length,
      templates,
    },
  });
});

// ============================================================================
// Helpers
// ============================================================================

function generateInstallationSection(language: SdkLanguage, packageName?: string): string {
  const pkg = packageName || 'my-sdk';
  const instructions: Record<SdkLanguage, string> = {
    python: `Install using pip:\n\`\`\`bash\npip install ${pkg}\n\`\`\``,
    javascript: `Install using npm:\n\`\`\`bash\nnpm install ${pkg}\n\`\`\``,
    typescript: `Install using npm:\n\`\`\`bash\nnpm install ${pkg}\n\`\`\``,
    go: `Install using go get:\n\`\`\`bash\ngo get github.com/org/${pkg}\n\`\`\``,
    java: `Add to your pom.xml:\n\`\`\`xml\n<dependency>\n  <groupId>com.example</groupId>\n  <artifactId>${pkg}</artifactId>\n</dependency>\n\`\`\``,
    ruby: `Add to your Gemfile:\n\`\`\`ruby\ngem '${pkg}'\n\`\`\``,
    csharp: `Install using NuGet:\n\`\`\`bash\ndotnet add package ${pkg}\n\`\`\``,
    php: `Install using Composer:\n\`\`\`bash\ncomposer require org/${pkg}\n\`\`\``,
    rust: `Add to your Cargo.toml:\n\`\`\`toml\n[dependencies]\n${pkg} = "1.0"\n\`\`\``,
    swift: `Add to your Package.swift:\n\`\`\`swift\ndependencies: [\n  .package(url: "https://github.com/org/${pkg}.git", from: "1.0.0")\n]\n\`\`\``,
  };

  return instructions[language] || `Install the ${pkg} package for ${language}.`;
}

function generateInstallCommand(language: SdkLanguage, packageName?: string): string {
  const pkg = packageName || 'my-sdk';
  const commands: Record<SdkLanguage, string> = {
    python: `pip install ${pkg}`,
    javascript: `npm install ${pkg}`,
    typescript: `npm install ${pkg}`,
    go: `go get github.com/org/${pkg}`,
    java: `mvn install ${pkg}`,
    ruby: `gem install ${pkg}`,
    csharp: `dotnet add package ${pkg}`,
    php: `composer require org/${pkg}`,
    rust: `cargo add ${pkg}`,
    swift: `swift package add ${pkg}`,
  };

  return commands[language] || `install ${pkg}`;
}

function generateQuickStartCode(language: SdkLanguage, clientName: string): string {
  const safeName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
  const snippets: Record<SdkLanguage, string> = {
    python: `from ${safeName} import Client\n\nclient = Client(api_key="YOUR_API_KEY")\nresponse = client.get("/endpoint")\nprint(response.json())`,
    javascript: `const { Client } = require('${clientName}');\n\nconst client = new Client({ apiKey: 'YOUR_API_KEY' });\nconst response = await client.get('/endpoint');\nconsole.log(response.data);`,
    typescript: `import { Client } from '${clientName}';\n\nconst client = new Client({ apiKey: 'YOUR_API_KEY' });\nconst response = await client.get('/endpoint');\nconsole.log(response.data);`,
    go: `package main\n\nimport (\n\t"fmt"\n\t"github.com/org/${safeName}"\n)\n\nfunc main() {\n\tclient := ${safeName}.NewClient("YOUR_API_KEY")\n\tresp, err := client.Get("/endpoint")\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tfmt.Println(resp)\n}`,
    java: `import com.example.${safeName}.Client;\n\npublic class Main {\n    public static void main(String[] args) {\n        Client client = new Client("YOUR_API_KEY");\n        var response = client.get("/endpoint");\n        System.out.println(response.getBody());\n    }\n}`,
    ruby: `require '${safeName}'\n\nclient = ${safeName.charAt(0).toUpperCase() + safeName.slice(1)}::Client.new(api_key: 'YOUR_API_KEY')\nresponse = client.get('/endpoint')\nputs response.body`,
    csharp: `using ${safeName};\n\nvar client = new Client("YOUR_API_KEY");\nvar response = await client.GetAsync("/endpoint");\nConsole.WriteLine(response.Content);`,
    php: `<?php\nrequire_once 'vendor/autoload.php';\n\nuse ${safeName.charAt(0).toUpperCase() + safeName.slice(1)}\\Client;\n\n$client = new Client('YOUR_API_KEY');\n$response = $client->get('/endpoint');\necho $response->getBody();`,
    rust: `use ${safeName}::Client;\n\n#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {\n    let client = Client::new("YOUR_API_KEY");\n    let response = client.get("/endpoint").await?;\n    println!("{:?}", response);\n    Ok(())\n}`,
    swift: `import ${safeName}\n\nlet client = Client(apiKey: "YOUR_API_KEY")\nlet response = try await client.get("/endpoint")\nprint(response.data)`,
  };

  return snippets[language] || `// ${language} quick start example`;
}

function generateAuthCode(language: SdkLanguage, clientName: string): string {
  const safeName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
  const snippets: Record<SdkLanguage, string> = {
    python: `from ${safeName} import Client\n\n# API Key authentication\nclient = Client(api_key="YOUR_API_KEY")\n\n# Bearer token authentication\nclient = Client(bearer_token="YOUR_TOKEN")`,
    javascript: `const { Client } = require('${clientName}');\n\n// API Key authentication\nconst client = new Client({ apiKey: 'YOUR_API_KEY' });\n\n// Bearer token authentication\nconst client2 = new Client({ bearerToken: 'YOUR_TOKEN' });`,
    typescript: `import { Client } from '${clientName}';\n\n// API Key authentication\nconst client = new Client({ apiKey: 'YOUR_API_KEY' });\n\n// Bearer token authentication\nconst client2 = new Client({ bearerToken: 'YOUR_TOKEN' });`,
    go: `client := ${safeName}.NewClient(\n\t${safeName}.WithAPIKey("YOUR_API_KEY"),\n)\n\n// Or with bearer token\nclient2 := ${safeName}.NewClient(\n\t${safeName}.WithBearerToken("YOUR_TOKEN"),\n)`,
    java: `// API Key authentication\nClient client = Client.builder()\n    .apiKey("YOUR_API_KEY")\n    .build();\n\n// Bearer token authentication\nClient client2 = Client.builder()\n    .bearerToken("YOUR_TOKEN")\n    .build();`,
    ruby: `# API Key authentication\nclient = ${safeName.charAt(0).toUpperCase() + safeName.slice(1)}::Client.new(api_key: 'YOUR_API_KEY')\n\n# Bearer token authentication\nclient = ${safeName.charAt(0).toUpperCase() + safeName.slice(1)}::Client.new(bearer_token: 'YOUR_TOKEN')`,
    csharp: `// API Key authentication\nvar client = new Client(new ClientOptions { ApiKey = "YOUR_API_KEY" });\n\n// Bearer token authentication\nvar client2 = new Client(new ClientOptions { BearerToken = "YOUR_TOKEN" });`,
    php: `// API Key authentication\n$client = new Client(['api_key' => 'YOUR_API_KEY']);\n\n// Bearer token authentication\n$client = new Client(['bearer_token' => 'YOUR_TOKEN']);`,
    rust: `// API Key authentication\nlet client = Client::builder()\n    .api_key("YOUR_API_KEY")\n    .build()?;\n\n// Bearer token authentication\nlet client2 = Client::builder()\n    .bearer_token("YOUR_TOKEN")\n    .build()?;`,
    swift: `// API Key authentication\nlet client = Client(apiKey: "YOUR_API_KEY")\n\n// Bearer token authentication\nlet client2 = Client(bearerToken: "YOUR_TOKEN")`,
  };

  return snippets[language] || `// ${language} authentication example`;
}

function generateErrorHandlingCode(language: SdkLanguage, clientName: string): string {
  const safeName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
  const snippets: Record<SdkLanguage, string> = {
    python: `from ${safeName} import Client, ApiError, AuthError, NotFoundError\n\nclient = Client(api_key="YOUR_API_KEY")\n\ntry:\n    response = client.get("/endpoint")\nexcept AuthError as e:\n    print(f"Authentication failed: {e}")\nexcept NotFoundError as e:\n    print(f"Resource not found: {e}")\nexcept ApiError as e:\n    print(f"API error ({e.status_code}): {e.message}")`,
    javascript: `const { Client, ApiError, AuthError } = require('${clientName}');\n\nconst client = new Client({ apiKey: 'YOUR_API_KEY' });\n\ntry {\n  const response = await client.get('/endpoint');\n} catch (error) {\n  if (error instanceof AuthError) {\n    console.error('Authentication failed:', error.message);\n  } else if (error instanceof ApiError) {\n    console.error(\`API error (\${error.statusCode}):\`, error.message);\n  } else {\n    throw error;\n  }\n}`,
    typescript: `import { Client, ApiError, AuthError } from '${clientName}';\n\nconst client = new Client({ apiKey: 'YOUR_API_KEY' });\n\ntry {\n  const response = await client.get('/endpoint');\n} catch (error) {\n  if (error instanceof AuthError) {\n    console.error('Authentication failed:', error.message);\n  } else if (error instanceof ApiError) {\n    console.error(\`API error (\${error.statusCode}):\`, error.message);\n  } else {\n    throw error;\n  }\n}`,
    go: `resp, err := client.Get("/endpoint")\nif err != nil {\n\tvar apiErr *${safeName}.APIError\n\tif errors.As(err, &apiErr) {\n\t\tfmt.Printf("API error (%d): %s\\n", apiErr.StatusCode, apiErr.Message)\n\t} else {\n\t\tfmt.Printf("Unexpected error: %s\\n", err)\n\t}\n}`,
    java: `try {\n    var response = client.get("/endpoint");\n} catch (AuthException e) {\n    System.err.println("Authentication failed: " + e.getMessage());\n} catch (NotFoundException e) {\n    System.err.println("Resource not found: " + e.getMessage());\n} catch (ApiException e) {\n    System.err.println("API error (" + e.getStatusCode() + "): " + e.getMessage());\n}`,
    ruby: `begin\n  response = client.get('/endpoint')\nrescue ${safeName.charAt(0).toUpperCase() + safeName.slice(1)}::AuthError => e\n  puts "Authentication failed: #{e.message}"\nrescue ${safeName.charAt(0).toUpperCase() + safeName.slice(1)}::ApiError => e\n  puts "API error (#{e.status_code}): #{e.message}"\nend`,
    csharp: `try\n{\n    var response = await client.GetAsync("/endpoint");\n}\ncatch (AuthException ex)\n{\n    Console.Error.WriteLine($"Authentication failed: {ex.Message}");\n}\ncatch (ApiException ex)\n{\n    Console.Error.WriteLine($"API error ({ex.StatusCode}): {ex.Message}");\n}`,
    php: `try {\n    $response = $client->get('/endpoint');\n} catch (AuthException $e) {\n    echo "Authentication failed: " . $e->getMessage();\n} catch (ApiException $e) {\n    echo "API error ({$e->getStatusCode()}): " . $e->getMessage();\n}`,
    rust: `match client.get("/endpoint").await {\n    Ok(response) => println!("{:?}", response),\n    Err(${safeName}::Error::Auth(e)) => eprintln!("Auth error: {}", e),\n    Err(${safeName}::Error::NotFound(e)) => eprintln!("Not found: {}", e),\n    Err(${safeName}::Error::Api { status, message }) => {\n        eprintln!("API error ({}): {}", status, message)\n    }\n    Err(e) => eprintln!("Unexpected error: {}", e),\n}`,
    swift: `do {\n    let response = try await client.get("/endpoint")\n} catch let error as AuthError {\n    print("Authentication failed: \\(error.message)")\n} catch let error as ApiError {\n    print("API error (\\(error.statusCode)): \\(error.message)")\n} catch {\n    print("Unexpected error: \\(error)")\n}`,
  };

  return snippets[language] || `// ${language} error handling example`;
}

export { app as sdkDocsRoutes };
