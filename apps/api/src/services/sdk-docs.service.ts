/**
 * Multi-Language SDK Documentation Generator Service
 *
 * Generates idiomatic SDK documentation for multiple programming languages
 * from API specifications. Produces installation guides, auth setup,
 * method references, error handling, and usage examples per language.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId, getAnthropicClient } from '@docsynth/utils';

const log = createLogger('sdk-docs-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export type SupportedLanguage =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'go'
  | 'java'
  | 'ruby'
  | 'csharp'
  | 'php'
  | 'rust'
  | 'swift';

export interface SDKDocGenerationRequest {
  repositoryId: string;
  apiSpecPath?: string;
  apiSpecContent?: string;
  languages: SupportedLanguage[];
  options: SDKDocOptions;
}

export interface SDKDocOptions {
  includeExamples: boolean;
  includeErrorHandling: boolean;
  includeAuth: boolean;
  packageName?: string;
}

export interface SDKDoc {
  id: string;
  repositoryId: string;
  language: SupportedLanguage;
  content: string;
  sections: SDKSection[];
  examples: CodeExample[];
  version: number;
  createdAt: Date;
}

export interface SDKSection {
  title: string;
  content: string;
  codeBlocks: { language: string; code: string; description: string }[];
}

export interface CodeExample {
  title: string;
  language: SupportedLanguage;
  code: string;
  description: string;
}

export interface LanguageConfig {
  language: SupportedLanguage;
  name: string;
  packageManager: string;
  fileExtension: string;
  commentStyle: string;
  installCommand: string;
  importStyle: string;
}

export interface LanguageStatus {
  language: SupportedLanguage;
  generated: boolean;
  lastGeneratedAt?: Date;
  version?: number;
  examplesValid: boolean;
}

export type PublishTarget = 'npm' | 'pypi' | 'github' | 'docs-site';

// ============================================================================
// Language Configurations
// ============================================================================

export const LANGUAGE_CONFIGS: Record<SupportedLanguage, LanguageConfig> = {
  python: {
    language: 'python',
    name: 'Python',
    packageManager: 'pip',
    fileExtension: '.py',
    commentStyle: '#',
    installCommand: 'pip install {{package}}',
    importStyle: 'from {{package}} import Client',
  },
  javascript: {
    language: 'javascript',
    name: 'JavaScript',
    packageManager: 'npm',
    fileExtension: '.js',
    commentStyle: '//',
    installCommand: 'npm install {{package}}',
    importStyle: "const { Client } = require('{{package}}');",
  },
  typescript: {
    language: 'typescript',
    name: 'TypeScript',
    packageManager: 'npm',
    fileExtension: '.ts',
    commentStyle: '//',
    installCommand: 'npm install {{package}}',
    importStyle: "import { Client } from '{{package}}';",
  },
  go: {
    language: 'go',
    name: 'Go',
    packageManager: 'go get',
    fileExtension: '.go',
    commentStyle: '//',
    installCommand: 'go get {{package}}',
    importStyle: 'import "{{package}}"',
  },
  java: {
    language: 'java',
    name: 'Java',
    packageManager: 'mvn',
    fileExtension: '.java',
    commentStyle: '//',
    installCommand: '<dependency>\n  <groupId>{{group}}</groupId>\n  <artifactId>{{package}}</artifactId>\n  <version>{{version}}</version>\n</dependency>',
    importStyle: 'import com.{{package}}.Client;',
  },
  ruby: {
    language: 'ruby',
    name: 'Ruby',
    packageManager: 'gem',
    fileExtension: '.rb',
    commentStyle: '#',
    installCommand: 'gem install {{package}}',
    importStyle: "require '{{package}}'",
  },
  csharp: {
    language: 'csharp',
    name: 'C#',
    packageManager: 'nuget',
    fileExtension: '.cs',
    commentStyle: '//',
    installCommand: 'dotnet add package {{package}}',
    importStyle: 'using {{package}};',
  },
  php: {
    language: 'php',
    name: 'PHP',
    packageManager: 'composer',
    fileExtension: '.php',
    commentStyle: '//',
    installCommand: 'composer require {{package}}',
    importStyle: "use {{package}}\\Client;",
  },
  rust: {
    language: 'rust',
    name: 'Rust',
    packageManager: 'cargo',
    fileExtension: '.rs',
    commentStyle: '//',
    installCommand: 'cargo add {{package}}',
    importStyle: 'use {{package}}::Client;',
  },
  swift: {
    language: 'swift',
    name: 'Swift',
    packageManager: 'swift pm',
    fileExtension: '.swift',
    commentStyle: '//',
    installCommand: '.package(url: "https://github.com/{{org}}/{{package}}.git", from: "{{version}}")',
    importStyle: 'import {{package}}',
  },
};

// ============================================================================
// Syntax validation patterns per language
// ============================================================================

const SYNTAX_PATTERNS: Record<SupportedLanguage, RegExp[]> = {
  python: [
    /def\s+\w+\s*\(/,        // function definitions
    /import\s+\w+/,           // imports
    /print\s*\(/,             // print calls
    /class\s+\w+/,            // class definitions
  ],
  javascript: [
    /(?:const|let|var)\s+\w+/, // variable declarations
    /(?:function\s+\w+|=>\s*\{)/, // functions
    /require\s*\(/,           // require calls
    /console\.\w+\s*\(/,     // console calls
  ],
  typescript: [
    /(?:const|let|var)\s+\w+/,       // variable declarations
    /(?:interface|type)\s+\w+/,       // type declarations
    /import\s+.*from\s+['"]/,        // ES imports
    /:\s*(?:string|number|boolean)/,  // type annotations
  ],
  go: [
    /func\s+\w+/,            // function definitions
    /package\s+\w+/,         // package declaration
    /import\s+["(]/,         // imports
    /fmt\.Print/,            // fmt calls
  ],
  java: [
    /(?:public|private|protected)\s+/,  // access modifiers
    /class\s+\w+/,                      // class definitions
    /import\s+[\w.]+;/,                 // imports
    /System\.out\.print/,               // print statements
  ],
  ruby: [
    /def\s+\w+/,             // method definitions
    /require\s+['"]/,        // requires
    /class\s+\w+/,           // class definitions
    /puts\s+/,               // output
  ],
  csharp: [
    /(?:public|private|protected)\s+/, // access modifiers
    /class\s+\w+/,                     // class definitions
    /using\s+[\w.]+;/,                 // using statements
    /Console\.Write/,                  // console calls
  ],
  php: [
    /\$\w+\s*=/,             // variable assignments
    /function\s+\w+/,        // function definitions
    /use\s+[\w\\]+;/,        // use statements
    /echo\s+/,               // echo statements
  ],
  rust: [
    /fn\s+\w+/,              // function definitions
    /use\s+[\w:]+/,          // use statements
    /let\s+(?:mut\s+)?\w+/,  // let bindings
    /println!\s*\(/,         // println macro
  ],
  swift: [
    /func\s+\w+/,            // function definitions
    /import\s+\w+/,          // imports
    /(?:let|var)\s+\w+/,     // variable declarations
    /print\s*\(/,            // print calls
  ],
};

// ============================================================================
// Service
// ============================================================================

class SDKDocsService {
  private anthropic = getAnthropicClient();

  /**
   * Generate SDK documentation for given languages from an API spec.
   * For each language, produces an idiomatic installation guide, auth setup,
   * method reference, error handling, and usage examples.
   */
  async generateSDKDocs(params: SDKDocGenerationRequest): Promise<SDKDoc[]> {
    log.info(
      { repositoryId: params.repositoryId, languages: params.languages },
      'Generating SDK docs'
    );

    // Resolve the API spec content
    const apiSpec = await this.resolveApiSpec(params);

    const results: SDKDoc[] = [];

    for (const language of params.languages) {
      try {
        const doc = await this.generateForLanguage(
          params.repositoryId,
          apiSpec,
          language,
          params.options
        );
        results.push(doc);
        log.info({ language, sdkDocId: doc.id }, 'SDK doc generated for language');
      } catch (error) {
        log.error({ error, language }, 'Failed to generate SDK doc for language');
      }
    }

    return results;
  }

  /**
   * Get language-specific documentation template with idioms.
   */
  getLanguageTemplate(language: SupportedLanguage): {
    config: LanguageConfig;
    template: SDKSection[];
  } {
    const config = LANGUAGE_CONFIGS[language];
    if (!config) {
      throw new Error(`Unsupported language: ${language}`);
    }

    const template: SDKSection[] = [
      {
        title: 'Installation',
        content: `Install the SDK using ${config.packageManager}.`,
        codeBlocks: [
          {
            language: config.language === 'csharp' ? 'bash' : config.language,
            code: config.installCommand,
            description: `Install via ${config.packageManager}`,
          },
        ],
      },
      {
        title: 'Getting Started',
        content: 'Import the SDK and initialize the client.',
        codeBlocks: [
          {
            language: config.language,
            code: config.importStyle,
            description: 'Import the client',
          },
        ],
      },
      {
        title: 'Authentication',
        content: 'Configure authentication for API access.',
        codeBlocks: [
          {
            language: config.language,
            code: this.getAuthSnippet(language),
            description: 'Set up authentication',
          },
        ],
      },
      {
        title: 'API Methods',
        content: 'Available API methods and their usage.',
        codeBlocks: [],
      },
      {
        title: 'Error Handling',
        content: 'Handle errors gracefully in your application.',
        codeBlocks: [
          {
            language: config.language,
            code: this.getErrorHandlingSnippet(language),
            description: 'Error handling pattern',
          },
        ],
      },
      {
        title: 'Examples',
        content: 'Complete usage examples.',
        codeBlocks: [],
      },
    ];

    return { config, template };
  }

  /**
   * Validate code examples by performing a basic syntax check
   * using regex patterns per language.
   */
  async validateExamples(
    sdkDocId: string,
    language: SupportedLanguage
  ): Promise<{
    valid: boolean;
    results: Array<{ example: string; valid: boolean; issues: string[] }>;
  }> {
    log.info({ sdkDocId, language }, 'Validating code examples');

    const sdkDoc = await db.sdkDoc.findUnique({
      where: { id: sdkDocId },
    });

    if (!sdkDoc) {
      throw new Error(`SDK doc not found: ${sdkDocId}`);
    }

    const examples = (sdkDoc.examples as CodeExample[]) || [];
    const patterns = SYNTAX_PATTERNS[language] || [];
    const results: Array<{ example: string; valid: boolean; issues: string[] }> = [];

    for (const example of examples) {
      const issues: string[] = [];

      // Check for balanced braces/brackets
      const braceIssues = this.checkBalancedDelimiters(example.code);
      if (braceIssues.length > 0) {
        issues.push(...braceIssues);
      }

      // Check for unclosed strings
      if (this.hasUnclosedStrings(example.code)) {
        issues.push('Unclosed string literal detected');
      }

      // Check that code contains at least one recognizable pattern for the language
      const hasValidPattern = patterns.some((pattern) => pattern.test(example.code));
      if (!hasValidPattern && example.code.trim().length > 0) {
        issues.push(`No recognizable ${language} syntax patterns found`);
      }

      results.push({
        example: example.title,
        valid: issues.length === 0,
        issues,
      });
    }

    const allValid = results.every((r) => r.valid);

    // Update the doc record with validation status
    await db.sdkDoc.update({
      where: { id: sdkDocId },
      data: {
        metadata: {
          ...(sdkDoc.metadata as Record<string, unknown> || {}),
          examplesValidated: true,
          examplesValid: allValid,
          validatedAt: new Date().toISOString(),
        },
      },
    });

    log.info(
      { sdkDocId, language, allValid, totalExamples: results.length },
      'Example validation complete'
    );

    return { valid: allValid, results };
  }

  /**
   * Regenerate SDK documentation with an updated spec or improved prompts.
   */
  async regenerateSDKDoc(
    sdkDocId: string,
    updatedSpec?: string
  ): Promise<SDKDoc> {
    log.info({ sdkDocId }, 'Regenerating SDK doc');

    const existing = await db.sdkDoc.findUnique({
      where: { id: sdkDocId },
    });

    if (!existing) {
      throw new Error(`SDK doc not found: ${sdkDocId}`);
    }

    const language = existing.language as SupportedLanguage;
    const repositoryId = existing.repositoryId as string;

    // Resolve spec: use updated spec, or fall back to what was stored
    const apiSpec = updatedSpec || (existing.apiSpecContent as string) || '';

    const options: SDKDocOptions = (existing.options as SDKDocOptions) || {
      includeExamples: true,
      includeErrorHandling: true,
      includeAuth: true,
    };

    const newDoc = await this.generateForLanguage(
      repositoryId,
      apiSpec,
      language,
      options
    );

    // Update version
    const version = ((existing.version as number) || 0) + 1;

    await db.sdkDoc.update({
      where: { id: sdkDocId },
      data: {
        content: newDoc.content,
        sections: newDoc.sections,
        examples: newDoc.examples,
        version,
        updatedAt: new Date(),
        apiSpecContent: apiSpec,
      },
    });

    log.info({ sdkDocId, version }, 'SDK doc regenerated');

    return {
      ...newDoc,
      id: sdkDocId,
      version,
    };
  }

  /**
   * Generate a preview of SDK documentation without persisting.
   */
  async previewGeneration(
    apiSpecSnippet: string,
    language: SupportedLanguage,
    endpoint: string
  ): Promise<{ sections: SDKSection[]; examples: CodeExample[] }> {
    log.info({ language, endpoint }, 'Generating SDK doc preview');

    const config = LANGUAGE_CONFIGS[language];
    if (!config) {
      throw new Error(`Unsupported language: ${language}`);
    }

    if (!this.anthropic) {
      // Fallback: generate a template-based preview
      return this.generateTemplatePreview(apiSpecSnippet, language, endpoint);
    }

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: `Generate idiomatic ${config.name} SDK documentation for this API endpoint.

API Spec Snippet:
\`\`\`
${apiSpecSnippet.slice(0, 3000)}
\`\`\`

Endpoint: ${endpoint}

Return JSON:
{
  "sections": [
    { "title": "...", "content": "...", "codeBlocks": [{ "language": "${language}", "code": "...", "description": "..." }] }
  ],
  "examples": [
    { "title": "...", "language": "${language}", "code": "...", "description": "..." }
  ]
}

Use idiomatic ${config.name} conventions:
- Package manager: ${config.packageManager}
- Import style: ${config.importStyle}
- Comment style: ${config.commentStyle}
Include error handling and authentication setup.`,
          },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          sections: parsed.sections || [],
          examples: parsed.examples || [],
        };
      }
    } catch (error) {
      log.warn({ error, language, endpoint }, 'AI preview generation failed, using template');
    }

    return this.generateTemplatePreview(apiSpecSnippet, language, endpoint);
  }

  /**
   * Get which languages have been generated for a repository and their status.
   */
  async getLanguageStatus(repositoryId: string): Promise<LanguageStatus[]> {
    log.info({ repositoryId }, 'Getting language status');

    const allLanguages = Object.keys(LANGUAGE_CONFIGS) as SupportedLanguage[];

    const existingDocs = await db.sdkDoc.findMany({
      where: { repositoryId },
      select: {
        language: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        metadata: true,
      },
    });

    const docMap = new Map<string, {
      language: string;
      version: number;
      createdAt: Date;
      updatedAt: Date | null;
      metadata: Record<string, unknown> | null;
    }>();
    for (const doc of existingDocs) {
      docMap.set(doc.language, doc);
    }

    return allLanguages.map((language) => {
      const doc = docMap.get(language);
      if (!doc) {
        return {
          language,
          generated: false,
          examplesValid: false,
        };
      }

      const metadata = (doc.metadata as Record<string, unknown>) || {};

      return {
        language,
        generated: true,
        lastGeneratedAt: doc.updatedAt || doc.createdAt,
        version: doc.version,
        examplesValid: (metadata.examplesValid as boolean) ?? false,
      };
    });
  }

  /**
   * Publish SDK documentation to a target (npm, pypi, github, or docs-site).
   */
  async publishSDKDocs(
    sdkDocId: string,
    target: PublishTarget
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    log.info({ sdkDocId, target }, 'Publishing SDK docs');

    const sdkDoc = await db.sdkDoc.findUnique({
      where: { id: sdkDocId },
    });

    if (!sdkDoc) {
      throw new Error(`SDK doc not found: ${sdkDocId}`);
    }

    const language = sdkDoc.language as SupportedLanguage;
    const config = LANGUAGE_CONFIGS[language];

    try {
      // Validate target compatibility with language
      this.validatePublishTarget(language, target);

      // Create a publish record
      const publishId = generateId('pub');
      await db.sdkDocPublish.create({
        data: {
          id: publishId,
          sdkDocId,
          target,
          language,
          status: 'pending',
          startedAt: new Date(),
        },
      });

      // Simulate publish operation
      // In production, this would dispatch to a background worker that
      // interacts with the actual package registry / hosting platform.
      const url = this.buildPublishUrl(sdkDoc, target, config);

      await db.sdkDocPublish.update({
        where: { id: publishId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          url,
        },
      });

      log.info({ sdkDocId, target, url }, 'SDK docs published');

      return { success: true, url };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown publish error';
      log.error({ error, sdkDocId, target }, 'Failed to publish SDK docs');
      return { success: false, error: message };
    }
  }

  /**
   * Return list of supported languages with metadata.
   */
  getSupportedLanguages(): LanguageConfig[] {
    return Object.values(LANGUAGE_CONFIGS);
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Resolve the API spec content from either direct content or by reading
   * the spec file from the repository.
   */
  private async resolveApiSpec(params: SDKDocGenerationRequest): Promise<string> {
    if (params.apiSpecContent) {
      return params.apiSpecContent;
    }

    if (params.apiSpecPath) {
      // Look up the document in the repository by path
      const document = await prisma.document.findFirst({
        where: {
          repositoryId: params.repositoryId,
          path: params.apiSpecPath,
        },
        select: { content: true },
      });

      if (document?.content) {
        return document.content;
      }

      throw new Error(`API spec not found at path: ${params.apiSpecPath}`);
    }

    // Fall back to searching for an OpenAPI/Swagger spec in the repository
    const specDoc = await prisma.document.findFirst({
      where: {
        repositoryId: params.repositoryId,
        type: 'API_REFERENCE',
      },
      select: { content: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (specDoc?.content) {
      return specDoc.content;
    }

    throw new Error('No API spec found. Provide apiSpecContent or apiSpecPath.');
  }

  /**
   * Generate SDK documentation for a single language.
   */
  private async generateForLanguage(
    repositoryId: string,
    apiSpec: string,
    language: SupportedLanguage,
    options: SDKDocOptions
  ): Promise<SDKDoc> {
    const config = LANGUAGE_CONFIGS[language];
    const packageName = options.packageName || 'my-sdk';

    let sections: SDKSection[];
    let examples: CodeExample[];

    if (this.anthropic) {
      const aiResult = await this.generateWithAI(apiSpec, language, config, options);
      sections = aiResult.sections;
      examples = aiResult.examples;
    } else {
      const templateResult = this.generateFromTemplate(apiSpec, language, config, options);
      sections = templateResult.sections;
      examples = templateResult.examples;
    }

    // Build full markdown content from sections
    const content = this.buildMarkdownContent(sections, config, packageName);

    // Persist
    const id = generateId('sdk');
    await db.sdkDoc.create({
      data: {
        id,
        repositoryId,
        language,
        content,
        sections,
        examples,
        version: 1,
        apiSpecContent: apiSpec.slice(0, 50000),
        options,
        metadata: {
          packageName,
          generatedWith: this.anthropic ? 'ai' : 'template',
        },
      },
    });

    return {
      id,
      repositoryId,
      language,
      content,
      sections,
      examples,
      version: 1,
      createdAt: new Date(),
    };
  }

  /**
   * Use AI to generate idiomatic SDK documentation.
   */
  private async generateWithAI(
    apiSpec: string,
    language: SupportedLanguage,
    config: LanguageConfig,
    options: SDKDocOptions
  ): Promise<{ sections: SDKSection[]; examples: CodeExample[] }> {
    try {
      const response = await this.anthropic!.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: `You are an expert SDK documentation writer. Generate idiomatic ${config.name} SDK documentation.

Use these conventions:
- Package manager: ${config.packageManager}
- File extension: ${config.fileExtension}
- Comment style: ${config.commentStyle}
- Import style: ${config.importStyle}
- Install command: ${config.installCommand}

Return JSON with this structure:
{
  "sections": [
    {
      "title": "Section Title",
      "content": "Markdown explanation",
      "codeBlocks": [{ "language": "${language}", "code": "...", "description": "..." }]
    }
  ],
  "examples": [
    { "title": "Example Title", "language": "${language}", "code": "...", "description": "..." }
  ]
}

Sections to include:
1. Installation
2. Getting Started
${options.includeAuth ? '3. Authentication' : ''}
4. API Methods (with method reference for each endpoint)
${options.includeErrorHandling ? '5. Error Handling' : ''}
${options.includeExamples ? '6. Complete Examples' : ''}`,
        messages: [
          {
            role: 'user',
            content: `Generate SDK documentation for this API spec:\n\n\`\`\`\n${apiSpec.slice(0, 6000)}\n\`\`\``,
          },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          sections: parsed.sections || [],
          examples: parsed.examples || [],
        };
      }
    } catch (error) {
      log.warn({ error, language }, 'AI SDK doc generation failed, using template fallback');
    }

    return this.generateFromTemplate(apiSpec, language, LANGUAGE_CONFIGS[language], options);
  }

  /**
   * Generate SDK documentation from templates when AI is unavailable.
   */
  private generateFromTemplate(
    apiSpec: string,
    language: SupportedLanguage,
    config: LanguageConfig,
    options: SDKDocOptions
  ): { sections: SDKSection[]; examples: CodeExample[] } {
    const packageName = options.packageName || 'my-sdk';
    const sections: SDKSection[] = [];

    // Installation section
    sections.push({
      title: 'Installation',
      content: `Install the ${config.name} SDK using ${config.packageManager}.`,
      codeBlocks: [
        {
          language: 'bash',
          code: config.installCommand.replace(/\{\{package\}\}/g, packageName),
          description: `Install via ${config.packageManager}`,
        },
      ],
    });

    // Getting started
    sections.push({
      title: 'Getting Started',
      content: `Import and initialize the ${config.name} SDK client.`,
      codeBlocks: [
        {
          language: config.language,
          code: config.importStyle.replace(/\{\{package\}\}/g, packageName),
          description: 'Import the SDK',
        },
        {
          language: config.language,
          code: this.getInitializationSnippet(language, packageName),
          description: 'Initialize the client',
        },
      ],
    });

    // Authentication
    if (options.includeAuth) {
      sections.push({
        title: 'Authentication',
        content: 'Configure authentication for API access.',
        codeBlocks: [
          {
            language: config.language,
            code: this.getAuthSnippet(language),
            description: 'Set up authentication',
          },
        ],
      });
    }

    // API Methods - extract endpoints from spec
    const endpoints = this.extractEndpointsFromSpec(apiSpec);
    if (endpoints.length > 0) {
      sections.push({
        title: 'API Methods',
        content: 'Available API methods and their usage.',
        codeBlocks: endpoints.map((ep) => ({
          language: config.language,
          code: this.getMethodSnippet(language, ep.method, ep.path),
          description: `${ep.method.toUpperCase()} ${ep.path}`,
        })),
      });
    } else {
      sections.push({
        title: 'API Methods',
        content: 'Refer to the API specification for available methods.',
        codeBlocks: [],
      });
    }

    // Error handling
    if (options.includeErrorHandling) {
      sections.push({
        title: 'Error Handling',
        content: 'Handle API errors gracefully in your application.',
        codeBlocks: [
          {
            language: config.language,
            code: this.getErrorHandlingSnippet(language),
            description: 'Error handling pattern',
          },
        ],
      });
    }

    // Examples
    const examples: CodeExample[] = [];
    if (options.includeExamples) {
      examples.push({
        title: 'Basic Usage',
        language,
        code: this.getBasicUsageExample(language, packageName),
        description: `Basic usage of the ${config.name} SDK`,
      });

      if (options.includeAuth) {
        examples.push({
          title: 'Authenticated Request',
          language,
          code: this.getAuthenticatedRequestExample(language, packageName),
          description: `Making an authenticated request with the ${config.name} SDK`,
        });
      }

      sections.push({
        title: 'Examples',
        content: 'Complete usage examples.',
        codeBlocks: examples.map((ex) => ({
          language: ex.language,
          code: ex.code,
          description: ex.description,
        })),
      });
    }

    return { sections, examples };
  }

  /**
   * Build full markdown content from sections.
   */
  private buildMarkdownContent(
    sections: SDKSection[],
    config: LanguageConfig,
    packageName: string
  ): string {
    const lines: string[] = [];

    lines.push(`# ${config.name} SDK Documentation`);
    lines.push('');
    lines.push(`> Auto-generated SDK documentation for the \`${packageName}\` package.`);
    lines.push('');

    for (const section of sections) {
      lines.push(`## ${section.title}`);
      lines.push('');
      lines.push(section.content);
      lines.push('');

      for (const block of section.codeBlocks) {
        if (block.description) {
          lines.push(`**${block.description}**`);
          lines.push('');
        }
        lines.push(`\`\`\`${block.language}`);
        lines.push(block.code);
        lines.push('```');
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate a template-based preview without AI.
   */
  private generateTemplatePreview(
    apiSpecSnippet: string,
    language: SupportedLanguage,
    endpoint: string
  ): { sections: SDKSection[]; examples: CodeExample[] } {
    const config = LANGUAGE_CONFIGS[language];
    const method = 'get';

    const sections: SDKSection[] = [
      {
        title: `${endpoint} - ${config.name} SDK`,
        content: `SDK usage for the \`${endpoint}\` endpoint.`,
        codeBlocks: [
          {
            language: config.language,
            code: this.getMethodSnippet(language, method, endpoint),
            description: `Call ${endpoint}`,
          },
        ],
      },
    ];

    const examples: CodeExample[] = [
      {
        title: `${endpoint} Example`,
        language,
        code: this.getMethodSnippet(language, method, endpoint),
        description: `Example call to ${endpoint}`,
      },
    ];

    return { sections, examples };
  }

  /**
   * Extract endpoints from an API spec (simplified regex-based parsing).
   */
  private extractEndpointsFromSpec(
    apiSpec: string
  ): Array<{ method: string; path: string }> {
    const endpoints: Array<{ method: string; path: string }> = [];

    // Try to parse JSON/YAML OpenAPI-like paths
    const pathPattern = /["']?(\/[\w\-\/:{}]+)["']?\s*:\s*\{/g;
    const methodPattern = /["']?(get|post|put|patch|delete)["']?\s*:/gi;

    let pathMatch;
    while ((pathMatch = pathPattern.exec(apiSpec)) !== null) {
      const path = pathMatch[1] || '';
      // Look for methods near this path
      const nearbyText = apiSpec.slice(pathMatch.index, pathMatch.index + 500);
      let methodMatch;
      while ((methodMatch = methodPattern.exec(nearbyText)) !== null) {
        endpoints.push({ method: (methodMatch[1] || 'get').toLowerCase(), path });
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    return endpoints.filter((ep) => {
      const key = `${ep.method}:${ep.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Validate that the publish target is compatible with the language.
   */
  private validatePublishTarget(language: SupportedLanguage, target: PublishTarget): void {
    const languageTargets: Record<SupportedLanguage, PublishTarget[]> = {
      python: ['pypi', 'github', 'docs-site'],
      javascript: ['npm', 'github', 'docs-site'],
      typescript: ['npm', 'github', 'docs-site'],
      go: ['github', 'docs-site'],
      java: ['github', 'docs-site'],
      ruby: ['github', 'docs-site'],
      csharp: ['github', 'docs-site'],
      php: ['github', 'docs-site'],
      rust: ['github', 'docs-site'],
      swift: ['github', 'docs-site'],
    };

    const allowed = languageTargets[language] || ['github', 'docs-site'];
    if (!allowed.includes(target)) {
      throw new Error(
        `Publish target '${target}' is not supported for ${language}. Supported: ${allowed.join(', ')}`
      );
    }
  }

  /**
   * Build a preview URL for the published docs.
   */
  private buildPublishUrl(
    sdkDoc: { repositoryId: string; language: string },
    target: PublishTarget,
    config: LanguageConfig
  ): string {
    switch (target) {
      case 'npm':
        return `https://www.npmjs.com/package/${sdkDoc.repositoryId}-sdk`;
      case 'pypi':
        return `https://pypi.org/project/${sdkDoc.repositoryId}-sdk/`;
      case 'github':
        return `https://github.com/org/${sdkDoc.repositoryId}/tree/main/sdk/${config.language}`;
      case 'docs-site':
        return `https://docs.example.com/${sdkDoc.repositoryId}/sdk/${config.language}`;
      default:
        return '';
    }
  }

  // ============================================================================
  // Language-specific snippet generators
  // ============================================================================

  private getAuthSnippet(language: SupportedLanguage): string {
    switch (language) {
      case 'python':
        return `import os

client = Client(
    api_key=os.environ["API_KEY"],
    base_url="https://api.example.com"
)`;
      case 'javascript':
        return `const client = new Client({
  apiKey: process.env.API_KEY,
  baseUrl: 'https://api.example.com',
});`;
      case 'typescript':
        return `const client = new Client({
  apiKey: process.env.API_KEY as string,
  baseUrl: 'https://api.example.com',
});`;
      case 'go':
        return `client, err := sdk.NewClient(
    sdk.WithAPIKey(os.Getenv("API_KEY")),
    sdk.WithBaseURL("https://api.example.com"),
)
if err != nil {
    log.Fatal(err)
}`;
      case 'java':
        return `Client client = Client.builder()
    .apiKey(System.getenv("API_KEY"))
    .baseUrl("https://api.example.com")
    .build();`;
      case 'ruby':
        return `client = Client.new(
  api_key: ENV['API_KEY'],
  base_url: 'https://api.example.com'
)`;
      case 'csharp':
        return `var client = new Client(new ClientOptions
{
    ApiKey = Environment.GetEnvironmentVariable("API_KEY"),
    BaseUrl = "https://api.example.com"
});`;
      case 'php':
        return `$client = new Client([
    'api_key' => getenv('API_KEY'),
    'base_url' => 'https://api.example.com',
]);`;
      case 'rust':
        return `let client = Client::builder()
    .api_key(std::env::var("API_KEY")?)
    .base_url("https://api.example.com")
    .build()?;`;
      case 'swift':
        return `let client = Client(
    apiKey: ProcessInfo.processInfo.environment["API_KEY"] ?? "",
    baseURL: URL(string: "https://api.example.com")!
)`;
    }
  }

  private getErrorHandlingSnippet(language: SupportedLanguage): string {
    switch (language) {
      case 'python':
        return `try:
    response = client.get_resource("id")
except ApiError as e:
    print(f"API error: {e.status_code} - {e.message}")
except NetworkError as e:
    print(f"Network error: {e}")`;
      case 'javascript':
        return `try {
  const response = await client.getResource('id');
} catch (error) {
  if (error instanceof ApiError) {
    console.error(\`API error: \${error.statusCode} - \${error.message}\`);
  } else {
    console.error('Unexpected error:', error);
  }
}`;
      case 'typescript':
        return `try {
  const response = await client.getResource('id');
} catch (error) {
  if (error instanceof ApiError) {
    console.error(\`API error: \${error.statusCode} - \${error.message}\`);
  } else if (error instanceof NetworkError) {
    console.error('Network error:', error.message);
  } else {
    throw error;
  }
}`;
      case 'go':
        return `resource, err := client.GetResource(ctx, "id")
if err != nil {
    var apiErr *sdk.APIError
    if errors.As(err, &apiErr) {
        fmt.Printf("API error: %d - %s\\n", apiErr.StatusCode, apiErr.Message)
    } else {
        fmt.Printf("Unexpected error: %v\\n", err)
    }
}`;
      case 'java':
        return `try {
    Resource resource = client.getResource("id");
} catch (ApiException e) {
    System.err.println("API error: " + e.getStatusCode() + " - " + e.getMessage());
} catch (NetworkException e) {
    System.err.println("Network error: " + e.getMessage());
}`;
      case 'ruby':
        return `begin
  response = client.get_resource('id')
rescue ApiError => e
  puts "API error: #{e.status_code} - #{e.message}"
rescue NetworkError => e
  puts "Network error: #{e.message}"
end`;
      case 'csharp':
        return `try
{
    var resource = await client.GetResourceAsync("id");
}
catch (ApiException ex)
{
    Console.Error.WriteLine($"API error: {ex.StatusCode} - {ex.Message}");
}
catch (HttpRequestException ex)
{
    Console.Error.WriteLine($"Network error: {ex.Message}");
}`;
      case 'php':
        return `try {
    $response = $client->getResource('id');
} catch (ApiException $e) {
    echo "API error: " . $e->getStatusCode() . " - " . $e->getMessage();
} catch (\\Exception $e) {
    echo "Unexpected error: " . $e->getMessage();
}`;
      case 'rust':
        return `match client.get_resource("id").await {
    Ok(resource) => println!("Got resource: {:?}", resource),
    Err(SdkError::Api(e)) => eprintln!("API error: {} - {}", e.status_code, e.message),
    Err(SdkError::Network(e)) => eprintln!("Network error: {}", e),
    Err(e) => eprintln!("Unexpected error: {}", e),
}`;
      case 'swift':
        return `do {
    let resource = try await client.getResource(id: "id")
} catch let error as APIError {
    print("API error: \\(error.statusCode) - \\(error.message)")
} catch {
    print("Unexpected error: \\(error)")
}`;
    }
  }

  private getInitializationSnippet(language: SupportedLanguage, packageName: string): string {
    switch (language) {
      case 'python':
        return `client = Client(api_key="your-api-key")`;
      case 'javascript':
        return `const client = new Client({ apiKey: 'your-api-key' });`;
      case 'typescript':
        return `const client: Client = new Client({ apiKey: 'your-api-key' });`;
      case 'go':
        return `client, err := ${packageName}.NewClient(${packageName}.WithAPIKey("your-api-key"))`;
      case 'java':
        return `Client client = Client.builder().apiKey("your-api-key").build();`;
      case 'ruby':
        return `client = Client.new(api_key: 'your-api-key')`;
      case 'csharp':
        return `var client = new Client(new ClientOptions { ApiKey = "your-api-key" });`;
      case 'php':
        return `$client = new Client(['api_key' => 'your-api-key']);`;
      case 'rust':
        return `let client = Client::builder().api_key("your-api-key").build()?;`;
      case 'swift':
        return `let client = Client(apiKey: "your-api-key")`;
    }
  }

  private getMethodSnippet(
    language: SupportedLanguage,
    method: string,
    path: string
  ): string {
    const methodName = this.pathToMethodName(path, method, language);

    switch (language) {
      case 'python':
        return `response = client.${methodName}()`;
      case 'javascript':
      case 'typescript':
        return `const response = await client.${methodName}();`;
      case 'go':
        return `response, err := client.${this.capitalize(methodName)}(ctx)`;
      case 'java':
        return `var response = client.${methodName}();`;
      case 'ruby':
        return `response = client.${methodName}`;
      case 'csharp':
        return `var response = await client.${this.capitalize(methodName)}Async();`;
      case 'php':
        return `$response = $client->${methodName}();`;
      case 'rust':
        return `let response = client.${methodName}().await?;`;
      case 'swift':
        return `let response = try await client.${methodName}()`;
    }
  }

  private getBasicUsageExample(language: SupportedLanguage, packageName: string): string {
    switch (language) {
      case 'python':
        return `from ${packageName.replace(/-/g, '_')} import Client

client = Client(api_key="your-api-key")

# List resources
resources = client.list_resources()
for resource in resources:
    print(f"Resource: {resource.name}")

# Get a specific resource
resource = client.get_resource("resource-id")
print(f"Found: {resource.name}")`;
      case 'javascript':
        return `const { Client } = require('${packageName}');

const client = new Client({ apiKey: 'your-api-key' });

// List resources
const resources = await client.listResources();
resources.forEach(r => console.log(\`Resource: \${r.name}\`));

// Get a specific resource
const resource = await client.getResource('resource-id');
console.log(\`Found: \${resource.name}\`);`;
      case 'typescript':
        return `import { Client, Resource } from '${packageName}';

const client = new Client({ apiKey: 'your-api-key' });

// List resources
const resources: Resource[] = await client.listResources();
resources.forEach((r) => console.log(\`Resource: \${r.name}\`));

// Get a specific resource
const resource: Resource = await client.getResource('resource-id');
console.log(\`Found: \${resource.name}\`);`;
      case 'go':
        return `package main

import (
    "context"
    "fmt"
    "log"

    sdk "${packageName}"
)

func main() {
    client, err := sdk.NewClient(sdk.WithAPIKey("your-api-key"))
    if err != nil {
        log.Fatal(err)
    }

    ctx := context.Background()

    // List resources
    resources, err := client.ListResources(ctx)
    if err != nil {
        log.Fatal(err)
    }
    for _, r := range resources {
        fmt.Printf("Resource: %s\\n", r.Name)
    }
}`;
      case 'java':
        return `import com.example.sdk.Client;
import com.example.sdk.model.Resource;

public class Example {
    public static void main(String[] args) {
        Client client = Client.builder()
            .apiKey("your-api-key")
            .build();

        // List resources
        var resources = client.listResources();
        resources.forEach(r -> System.out.println("Resource: " + r.getName()));

        // Get a specific resource
        Resource resource = client.getResource("resource-id");
        System.out.println("Found: " + resource.getName());
    }
}`;
      case 'ruby':
        return `require '${packageName}'

client = Client.new(api_key: 'your-api-key')

# List resources
resources = client.list_resources
resources.each do |r|
  puts "Resource: #{r.name}"
end

# Get a specific resource
resource = client.get_resource('resource-id')
puts "Found: #{resource.name}"`;
      case 'csharp':
        return `using ${this.capitalize(packageName.replace(/-/g, '.'))};

var client = new Client(new ClientOptions { ApiKey = "your-api-key" });

// List resources
var resources = await client.ListResourcesAsync();
foreach (var r in resources)
{
    Console.WriteLine($"Resource: {r.Name}");
}

// Get a specific resource
var resource = await client.GetResourceAsync("resource-id");
Console.WriteLine($"Found: {resource.Name}");`;
      case 'php':
        return `<?php
require_once 'vendor/autoload.php';

use ${this.capitalize(packageName.replace(/-/g, ''))}\\Client;

$client = new Client(['api_key' => 'your-api-key']);

// List resources
$resources = $client->listResources();
foreach ($resources as $r) {
    echo "Resource: " . $r->name . "\\n";
}

// Get a specific resource
$resource = $client->getResource('resource-id');
echo "Found: " . $resource->name . "\\n";`;
      case 'rust':
        return `use ${packageName.replace(/-/g, '_')}::Client;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::builder()
        .api_key("your-api-key")
        .build()?;

    // List resources
    let resources = client.list_resources().await?;
    for r in &resources {
        println!("Resource: {}", r.name);
    }

    // Get a specific resource
    let resource = client.get_resource("resource-id").await?;
    println!("Found: {}", resource.name);

    Ok(())
}`;
      case 'swift':
        return `import ${this.capitalize(packageName.replace(/-/g, ''))}

let client = Client(apiKey: "your-api-key")

// List resources
let resources = try await client.listResources()
for r in resources {
    print("Resource: \\(r.name)")
}

// Get a specific resource
let resource = try await client.getResource(id: "resource-id")
print("Found: \\(resource.name)")`;
    }
  }

  private getAuthenticatedRequestExample(
    language: SupportedLanguage,
    packageName: string
  ): string {
    switch (language) {
      case 'python':
        return `import os
from ${packageName.replace(/-/g, '_')} import Client

client = Client(api_key=os.environ["API_KEY"])

# Create a resource with authentication
resource = client.create_resource(
    name="new-resource",
    description="Created via SDK"
)
print(f"Created: {resource.id}")`;
      case 'javascript':
        return `const { Client } = require('${packageName}');

const client = new Client({ apiKey: process.env.API_KEY });

// Create a resource with authentication
const resource = await client.createResource({
  name: 'new-resource',
  description: 'Created via SDK',
});
console.log(\`Created: \${resource.id}\`);`;
      case 'typescript':
        return `import { Client } from '${packageName}';

const client = new Client({ apiKey: process.env.API_KEY as string });

// Create a resource with authentication
const resource = await client.createResource({
  name: 'new-resource',
  description: 'Created via SDK',
});
console.log(\`Created: \${resource.id}\`);`;
      case 'go':
        return `client, _ := sdk.NewClient(sdk.WithAPIKey(os.Getenv("API_KEY")))

resource, err := client.CreateResource(ctx, &sdk.CreateResourceInput{
    Name:        "new-resource",
    Description: "Created via SDK",
})
if err != nil {
    log.Fatal(err)
}
fmt.Printf("Created: %s\\n", resource.ID)`;
      case 'java':
        return `Client client = Client.builder()
    .apiKey(System.getenv("API_KEY"))
    .build();

Resource resource = client.createResource(
    CreateResourceRequest.builder()
        .name("new-resource")
        .description("Created via SDK")
        .build()
);
System.out.println("Created: " + resource.getId());`;
      case 'ruby':
        return `client = Client.new(api_key: ENV['API_KEY'])

resource = client.create_resource(
  name: 'new-resource',
  description: 'Created via SDK'
)
puts "Created: #{resource.id}"`;
      case 'csharp':
        return `var client = new Client(new ClientOptions
{
    ApiKey = Environment.GetEnvironmentVariable("API_KEY")
});

var resource = await client.CreateResourceAsync(new CreateResourceRequest
{
    Name = "new-resource",
    Description = "Created via SDK"
});
Console.WriteLine($"Created: {resource.Id}");`;
      case 'php':
        return `$client = new Client(['api_key' => getenv('API_KEY')]);

$resource = $client->createResource([
    'name' => 'new-resource',
    'description' => 'Created via SDK',
]);
echo "Created: " . $resource->id . "\\n";`;
      case 'rust':
        return `let client = Client::builder()
    .api_key(std::env::var("API_KEY")?)
    .build()?;

let resource = client.create_resource(&CreateResourceInput {
    name: "new-resource".to_string(),
    description: Some("Created via SDK".to_string()),
}).await?;
println!("Created: {}", resource.id);`;
      case 'swift':
        return `let client = Client(
    apiKey: ProcessInfo.processInfo.environment["API_KEY"] ?? ""
)

let resource = try await client.createResource(
    name: "new-resource",
    description: "Created via SDK"
)
print("Created: \\(resource.id)")`;
    }
  }

  // ============================================================================
  // Validation helpers
  // ============================================================================

  /**
   * Check for balanced delimiters in code.
   */
  private checkBalancedDelimiters(code: string): string[] {
    const issues: string[] = [];
    const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
    const stack: string[] = [];
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < code.length; i++) {
      const char = code[i]!;
      const prevChar = i > 0 ? code[i - 1] : '';

      // Handle string detection (skip escaped quotes)
      if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
        if (inString && char === stringChar) {
          inString = false;
        } else if (!inString) {
          inString = true;
          stringChar = char;
        }
        continue;
      }

      if (inString) continue;

      if (pairs[char]) {
        stack.push(pairs[char]!);
      } else if (Object.values(pairs).includes(char)) {
        if (stack.length === 0 || stack[stack.length - 1] !== char) {
          issues.push(`Unmatched '${char}' at position ${i}`);
        } else {
          stack.pop();
        }
      }
    }

    if (stack.length > 0) {
      issues.push(`Unclosed delimiter(s): ${stack.reverse().join(', ')}`);
    }

    return issues;
  }

  /**
   * Check for unclosed string literals.
   */
  private hasUnclosedStrings(code: string): boolean {
    const lines = code.split('\n');
    for (const line of lines) {
      let inString = false;
      let stringChar = '';

      for (let i = 0; i < line.length; i++) {
        const char = line[i]!;
        const prevChar = i > 0 ? line[i - 1] : '';

        if ((char === '"' || char === "'") && prevChar !== '\\') {
          if (inString && char === stringChar) {
            inString = false;
          } else if (!inString) {
            inString = true;
            stringChar = char;
          }
        }
      }

      // Template literals and multi-line strings are excluded from single-line check
      if (inString && stringChar !== '`') {
        return true;
      }
    }

    return false;
  }

  // ============================================================================
  // Utility helpers
  // ============================================================================

  /**
   * Convert an API path to a method name, e.g. /users/{id} -> getUser
   */
  private pathToMethodName(
    path: string,
    method: string,
    language: SupportedLanguage
  ): string {
    // Remove path params and leading slash
    const segments = path
      .replace(/^\//, '')
      .split('/')
      .filter((s) => !s.startsWith('{'));

    const resource = segments[segments.length - 1] || 'resource';

    // Remove trailing 's' for singular when using get with id
    const singular = path.includes('{')
      ? resource.replace(/s$/, '')
      : resource;

    const prefix = method === 'get' ? 'get' : method === 'post' ? 'create' : method === 'put' ? 'update' : method === 'delete' ? 'delete' : method;

    // Apply language-specific naming conventions
    switch (language) {
      case 'python':
      case 'ruby':
        // snake_case
        return `${prefix}_${this.toSnakeCase(singular)}`;
      case 'go':
        // PascalCase
        return `${this.capitalize(prefix)}${this.capitalize(singular)}`;
      default:
        // camelCase
        return `${prefix}${this.capitalize(singular)}`;
    }
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '')
      .replace(/-/g, '_');
  }
}

export const sdkDocsService = new SDKDocsService();
